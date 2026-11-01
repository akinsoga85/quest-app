// Row-level security and integrity tests against a real Postgres.
// Run `npm run db:up` first (or set DATABASE_URL). Each test runs in its own
// transaction and rolls back, so tests don't affect each other.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { ZONES } from "../packages/contract/src/zones.ts";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/quest";
const db = new pg.Client({ connectionString: url });

const A = "00000000-0000-4000-8000-00000000000a"; // teen, Canada 13–15
const B = "00000000-0000-4000-8000-00000000000b"; // teen, US 16–17
const P = "00000000-0000-4000-8000-0000000000aa"; // A's linked parent
const Q = "00000000-0000-4000-8000-0000000000bb"; // a parent linked to nobody

const q = (sql, params) => db.query(sql, params);

async function as(uid, role = "authenticated") {
  await q("reset role");
  await q("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
  await q(`set local role ${role}`);
}
const asAdmin = () => q("reset role");

async function rejects(sql, params, pattern) {
  await q("savepoint expect_error");
  try {
    await q(sql, params);
  } catch (e) {
    await q("rollback to savepoint expect_error");
    assert.match(e.message, pattern);
    return;
  }
  await q("rollback to savepoint expect_error");
  assert.fail(`expected an error matching ${pattern}: ${sql}`);
}

const count = async (sql, params) => Number((await q(sql, params)).rows[0].n);

async function fixture() {
  for (const id of [A, B, P, Q]) await q("insert into auth.users (id) values ($1)", [id]);
  await q(
    `insert into teens (id, handle, age_bracket, country, region) values
       ($1, 'BlueFox-482', '13_15', 'CA', 'ON'), ($2, 'MintOwl-77', '16_17', 'US', 'TX')`,
    [A, B],
  );
  await q("insert into parents (id, display_name) values ($1, 'Mom'), ($2, 'Stranger')", [P, Q]);
  await q("insert into parent_links (teen_id, parent_id, status, consented_at) values ($1, $2, 'active', now())", [A, P]);
  const quest = (await q("select id from quests where zone_id = 'photography' limit 1")).rows[0].id;
  const m = (await q(
    `insert into makes (teen_id, quest_id, storage_path, status) values
       ($1::uuid, $3, $1::text || '/m1.jpg', 'reviewed'),
       ($1::uuid, $3, $1::text || '/m2.jpg', 'uploaded'),
       ($2::uuid, $3, $2::text || '/m3.jpg', 'reviewed')
     returning id`,
    [A, B, quest],
  )).rows.map((r) => r.id);
  const review = (await q(
    `insert into reviews (make_id, teen_id, worked, try_next, why, confidence, model, prompt_version)
     values ($1, $2, 'Clean diagonal stripes.', 'Get lower and tilt up.', 'Diagonals lead the eye.', 0.86, 'test-model', 'v0')
     returning id`,
    [m[0], A],
  )).rows[0].id;
  await q("insert into skill_points (teen_id, review_id, skill_id, points) values ($1, $2, 'photography.light', 1)", [A, review]);
  return { quest, m1: m[0], m2: m[1], m3: m[2], review };
}

function scenario(name, fn) {
  test(name, async () => {
    await q("begin");
    try {
      const f = await fixture();
      await fn(f);
    } finally {
      await q("rollback");
    }
  });
}

before(async () => db.connect());
after(async () => db.end());

test("seeded zones and skills match the contract", async () => {
  const zones = (await q("select id, name, status from zones order by sort")).rows;
  assert.deepEqual(
    zones,
    Object.entries(ZONES).map(([id, z]) => ({ id, name: z.name, status: z.status })),
  );
  const skills = (await q("select id, name from skills order by id")).rows;
  const expected = Object.entries(ZONES)
    .flatMap(([zone, z]) => Object.entries(z.skills).map(([k, name]) => ({ id: `${zone}.${k}`, name })))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  assert.deepEqual(skills, expected);
});

scenario("signed-out users can read nothing", async () => {
  await as(null, "anon");
  await rejects("select * from quests", [], /permission denied/);
  await rejects("select * from makes", [], /permission denied/);
});

scenario("a teen sees only their own profile and makes", async () => {
  await as(A);
  assert.equal(await count("select count(*) n from teens"), 1);
  assert.equal(await count("select count(*) n from makes"), 2);
  assert.equal(await count("select count(*) n from makes where teen_id = $1", [B]), 0);
});

scenario("makes stay in the teen's own folder; the app adds them only through record_make (A3)", async ({ quest }) => {
  await as(A);
  await rejects("insert into makes (teen_id, quest_id, storage_path) values ($1::uuid, $2, $1::text || '/new.jpg')", [A, quest], /permission denied/);
  await asAdmin();
  await rejects("insert into makes (teen_id, quest_id, storage_path) values ($1, $2, $3 || '/z.jpg')", [A, quest, B], /path_in_teen_folder/);
});

scenario("a teen can't change their age bracket, mode or handle", async () => {
  await as(A);
  await rejects("update teens set age_bracket = '18_19' where id = $1", [A], /permission denied/);
  await rejects("update teens set mode = 'walls' where id = $1", [A], /permission denied/);
  assert.equal((await q("update teens set timezone = 'America/Toronto' where id = $1", [A])).rowCount, 1);
  assert.equal((await q("update teens set timezone = 'UTC' where id = $1", [B])).rowCount, 0);
});

scenario("reviews: a teen reads and rates their own, and nothing else", async ({ review, m2 }) => {
  await as(A);
  assert.equal(await count("select count(*) n from reviews"), 1);
  assert.equal((await q("update reviews set helpful = true where id = $1", [review])).rowCount, 1);
  await rejects("update reviews set worked = 'edited' where id = $1", [review], /permission denied/);
  await rejects(
    "insert into reviews (make_id, teen_id, worked, try_next, why, confidence, model, prompt_version) values ($1, $2, 'a', 'b', 'c', 0.9, 'm', 'v')",
    [m2, A],
    /row-level security/,
  );
  await as(B);
  assert.equal(await count("select count(*) n from reviews"), 0);
});

scenario("safety scans and invite tokens are hidden from the app", async ({ m1 }) => {
  await asAdmin();
  await q("insert into safety_scans (make_id, result, vendor) values ($1, 'pass', 'test')", [m1]);
  await as(A);
  assert.equal(await count("select count(*) n from safety_scans"), 0);
  await rejects("select invite_token_hash from parent_links", [], /permission denied/);
  assert.equal(await count("select count(*) n from parent_links"), 1);
});

scenario("family sharing: reviewed makes only, linked parents only", async ({ m1, m2, m3 }) => {
  await as(A);
  await q("insert into family_shares (make_id, teen_id, parent_id) values ($1, $2, $3)", [m1, A, P]);
  await rejects("insert into family_shares (make_id, teen_id, parent_id) values ($1, $2, $3)", [m2, A, P], /reviewed makes/);
  await rejects("insert into family_shares (make_id, teen_id, parent_id) values ($1, $2, $3)", [m1, A, Q], /not linked/);
  // Sharing someone else's make: the integrity trigger runs before RLS, so either may refuse it.
  await rejects("insert into family_shares (make_id, teen_id, parent_id) values ($1, $2, $3)", [m3, B, P], /row-level security|not linked/);

  await as(P);
  assert.equal(await count("select count(*) n from makes"), 1, "parent sees only the shared make");
  assert.equal(await count("select count(*) n from teens"), 1, "parent sees their linked teen");
  const share = (await q("select id from family_shares")).rows[0].id;
  await q("insert into family_cheers (share_id, parent_id, cheer) values ($1, $2, 'great_light')", [share, P]);

  await as(Q);
  assert.equal(await count("select count(*) n from makes"), 0);
  assert.equal(await count("select count(*) n from teens"), 0);
  await rejects("insert into family_cheers (share_id, parent_id, cheer) values ($1, $2, 'love_this')", [share, Q], /only the parent/);

  await as(A);
  assert.equal(await count("select count(*) n from family_cheers"), 1, "teen sees the cheer back");
});

scenario("zones: at most three, and only open ones", async () => {
  await as(A);
  for (const z of ["photography", "fashion", "art_crafts"]) await q("insert into teen_zones (teen_id, zone_id) values ($1, $2)", [A, z]);
  await as(B);
  await rejects("insert into teen_zones (teen_id, zone_id) values ($1, 'music')", [B], /not open/);
  await asAdmin();
  await q("update zones set status = 'live' where id = 'music'");
  await as(A);
  await rejects("insert into teen_zones (teen_id, zone_id) values ($1, 'music')", [A], /at most 3/);
});

scenario("skill points must match the review's zone", async ({ review }) => {
  await asAdmin();
  await rejects("insert into skill_points (teen_id, review_id, skill_id, points) values ($1, $2, 'fashion.colour', 1)", [A, review], /does not belong/);
});

scenario("only approved quests are visible", async () => {
  await asAdmin();
  await q("insert into quests (zone_id, title, brief, minutes, trains_skill_id) values ('photography', 'Draft quest', 'A draft quest the teen should not see yet.', 10, 'photography.light')");
  await as(A);
  assert.equal(await count("select count(*) n from quests where status = 'draft'"), 0);
  assert.equal(await count("select count(*) n from quest_schedule where day = current_date"), 3);
});

scenario("progress view shows a teen only their own points", async () => {
  // Points are quests finished plus coach skill points (PRD R32, A7): A has one
  // reviewed make with one skill point; B has one reviewed make and no points.
  await as(A);
  const rows = (await q("select zone_id, points from zone_progress")).rows;
  assert.deepEqual(rows, [{ zone_id: "photography", points: 2 }]);
  await as(B);
  assert.deepEqual((await q("select teen_id, points from zone_progress")).rows, [{ teen_id: B, points: 1 }]);
});

scenario("account deletion removes the teen's data but keeps the request record", async () => {
  // Requests go through request_account_deletion (A11); the app can't insert them.
  await as(A);
  await q("select request_account_deletion()");
  await rejects("insert into deletion_requests (user_id) values ($1)", [B], /permission denied/);
  await as(null, "service_role");
  await q("select complete_deletion($1)", [A]);
  await asAdmin();
  assert.equal(await count("select count(*) n from teens where id = $1", [A]), 0);
  assert.equal(await count("select count(*) n from makes where teen_id = $1", [A]), 0);
  assert.equal(await count("select count(*) n from reviews where teen_id = $1", [A]), 0);
  assert.equal(await count("select count(*) n from deletion_requests where user_id = $1", [A]), 1);
});
