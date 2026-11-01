// A7 tests: points, levels, skill scores, postcards and the portfolio, against
// a real Postgres. Each test runs in its own transaction and rolls back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { Api, levelFor, skillScore } from "../packages/contract/src/index.ts";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/quest";
const db = new pg.Client({ connectionString: url });

const T = "00000000-0000-4000-8000-0000000007a1"; // teen
const U = "00000000-0000-4000-8000-0000000007a2"; // another teen
const P = "00000000-0000-4000-8000-0000000007b1"; // T's parent

const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const count = async (sql, params) => Number((await one(sql, params)).n);

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

let photoQuest;
// A photography make for `teen`, `daysAgo`, taken all the way through: scan
// passed, reviewed with these skill points. Returns its id.
async function finished(teen, daysAgo, points = [], { quest = photoQuest, status = "reviewed" } = {}) {
  await asAdmin();
  const m = (await one(
    `insert into makes (teen_id, quest_id, storage_path, status, created_at)
     values ($1::uuid, $2, $1::text || '/' || gen_random_uuid() || '.jpg', 'scanning', now() - ($3 || ' days')::interval) returning id`,
    [teen, quest, String(daysAgo)],
  )).id;
  await q("insert into safety_scans (make_id, result, vendor) values ($1, 'pass', 'test')", [m]);
  await q("update makes set status = 'reviewing' where id = $1", [m]);
  if (status === "reviewing") return m;
  if (points.length) {
    const r = (await one(
      "insert into reviews (make_id, teen_id, worked, try_next, why, confidence, model, prompt_version) values ($1, $2, 'w', 't', 'y', 0.9, 'm', 'v') returning id",
      [m, teen],
    )).id;
    for (const [skill, p] of points) await q("insert into skill_points (teen_id, review_id, skill_id, points) values ($1, $2, $3, $4)", [teen, r, skill, p]);
  }
  await q("update makes set status = $2 where id = $1", [m, status]);
  return m;
}
const points = async (teen) => (await one("select private.zone_points($1, 'photography') as p", [teen])).p;
const postcards = async (teen) => (await q("select level, make_id from postcards where teen_id = $1 order by level", [teen])).rows;

function scenario(name, fn) {
  test(name, async () => {
    await q("begin");
    try {
      for (const id of [T, U, P]) await q("insert into auth.users (id) values ($1)", [id]);
      await q("insert into teens (id, handle, age_bracket, country) values ($1, 'RiverLynx-77', '16_17', 'US'), ($2, 'MistyHare-12', '16_17', 'US')", [T, U]);
      await q("insert into teen_zones (teen_id, zone_id) values ($1, 'photography')", [T]);
      await q("insert into parents (id) values ($1)", [P]);
      await q("insert into parent_links (teen_id, parent_id, status, consented_at) values ($1, $2, 'active', now())", [T, P]);
      photoQuest = (await one("select id from quests where zone_id = 'photography' and status = 'approved' limit 1")).id;
      await fn();
    } finally {
      await q("rollback");
    }
  });
}

before(async () => db.connect());
after(async () => db.end());

test("levels and skill scores: the database agrees with the contract", async () => {
  for (let p = 0; p <= 120; p++) {
    assert.equal((await one("select private.level_for($1) as l", [p])).l, levelFor(p).level, `${p} points`);
  }
  assert.equal(skillScore([]), null);
  assert.equal(skillScore([0]), 1);
  assert.equal(skillScore([2, 2]), 10);
  assert.equal(skillScore([1, 2, 0, 1]), 6);
});

scenario("A7 done when: level-ups follow the rules", async () => {
  // One point per quest finished, plus coach skill points.
  await finished(T, 1, [["photography.light", 2], ["photography.framing", 1]]);
  assert.equal(await points(T), 4);
  // A finished make without a review (coach off, or no review) still counts once.
  await finished(T, 2, [], { status: "no_review" });
  assert.equal(await points(T), 5);
  // A second photo for the same quest on the same day (a retake) doesn't count twice.
  await finished(T, 2, [["photography.colour", 1]]);
  assert.equal(await points(T), 6);
  // Blocked or held photos, and photos not yet scanned, give nothing.
  await asAdmin();
  await q("insert into makes (teen_id, quest_id, storage_path, status) values ($1::uuid, $2, $1::text || '/b.jpg', 'blocked'), ($1::uuid, $2, $1::text || '/u.jpg', 'uploaded')", [T, photoQuest]);
  assert.equal(await points(T), 6);
  // Cheers from a parent give nothing either.
  const shared = await finished(T, 3, []);
  assert.equal(await points(T), 7);
  const share = (await one("insert into family_shares (make_id, teen_id, parent_id) values ($1, $2, $3) returning id", [shared, T, P])).id;
  await q("insert into family_cheers (share_id, parent_id, cheer) values ($1, $2, 'love_this')", [share, P]);
  assert.equal(await points(T), 7);
  // Today, the coach's context and the progress view all use the same number.
  await as(T);
  assert.deepEqual((await q("select zone_id, points from zone_progress")).rows, [{ zone_id: "photography", points: 7 }]);
  const today = (await one("select get_today() as t")).t;
  assert.equal(today.zones[0].points, 7);
  assert.equal(levelFor(7).level, 1);
});

scenario("A7 done when: a digital postcard at each level-up", async () => {
  // 9 points: still Level 1, no postcard.
  await finished(T, 5, [["photography.light", 2], ["photography.colour", 2]]);
  await finished(T, 4, [["photography.light", 2], ["photography.story", 2]]);
  assert.equal(await points(T), 10);
  const [l2] = await postcards(T);
  assert.equal(l2.level, 2, "Level 2 (Explorer) at 10 points");
  // A big jump earns every postcard on the way.
  for (let d = 3; d >= 0; d--) await finished(T, d + 10, [["photography.framing", 2], ["photography.light", 2]]);
  assert.equal(await points(T), 30);
  assert.deepEqual((await postcards(T)).map((p) => p.level), [2, 3]);
  // Each level once, even as points keep coming.
  await finished(T, 0, [["photography.story", 1]]);
  assert.deepEqual((await postcards(T)).map((p) => p.level), [2, 3]);
  // The teen sees them once, can pick the photo, and a linked parent can see them.
  await as(T);
  const fresh = Api["postcards.new"].output.parse((await one("select get_new_postcards() as p")).p);
  assert.deepEqual(fresh.map((p) => p.level), [2, 3]);
  const pick = (await one("select id from makes where status = 'reviewed' order by created_at limit 1")).id;
  await q("select pick_postcard($1, $2)", [fresh[1].id, pick]);
  await q("select mark_postcards_seen($1)", [fresh.map((p) => p.id)]);
  assert.deepEqual((await one("select get_new_postcards() as p")).p, []);
  await as(P);
  assert.equal(await count("select count(*) n from postcards"), 2);
  await as(U);
  assert.equal(await count("select count(*) n from postcards"), 0);
  await rejects("select pick_postcard($1, $2)", [fresh[0].id, pick], /not found/);
});

scenario("levels: skill scores from the last 10 coach scores, and a you-vs-you pair", async () => {
  const old = await finished(T, 30, [["photography.light", 0]]);
  for (let d = 11; d >= 1; d--) await finished(T, d, [["photography.light", 2]]);
  // The same quest made again four weeks on: that's the pair shown.
  await as(T);
  const levels = Api["levels.get"].output.parse((await one("select get_levels() as l", [])).l);
  assert.equal(levels.length, 1);
  const p = levels[0];
  assert.equal(p.zone, "photography");
  assert.equal(p.skills["photography.light"], 10, "the oldest score is outside the last 10");
  assert.equal(p.skills["photography.story"], null);
  assert.equal(p.compare?.sameQuest, true);
  assert.equal(p.compare?.before.makeId, old);
});

scenario("Studio: own makes, newest first, nothing blocked or held", async () => {
  const a = await finished(T, 2, [["photography.light", 1]]);
  const b = await finished(T, 1, []);
  await asAdmin();
  await q("insert into makes (teen_id, quest_id, storage_path, status) values ($1::uuid, $2, $1::text || '/b.jpg', 'blocked'), ($1::uuid, $2, $1::text || '/h.jpg', 'held_for_review')", [T, photoQuest]);
  await finished(U, 1, []);
  await as(T);
  const page = Api["studio.list"].output.parse((await one("select get_studio() as s")).s);
  assert.equal(page.total, 2);
  assert.deepEqual(page.makes.map((m) => m.id), [b, a]);
  const older = Api["studio.list"].output.parse((await one("select get_studio(null, $1::timestamptz, 30) as s", [page.makes[0].createdAt])).s);
  assert.deepEqual(older.makes.map((m) => m.id), [a]);
  assert.equal(Api["studio.list"].output.parse((await one("select get_studio('fashion') as s")).s).total, 0);
});

scenario("deleting a make takes its review and points with it, not its postcards", async () => {
  for (let d = 3; d >= 1; d--) await finished(T, d, [["photography.light", 2], ["photography.colour", 2]]);
  assert.equal(await points(T), 15);
  assert.equal((await postcards(T)).length, 1);
  await as(T);
  const id = (await one("select id from makes order by created_at desc limit 1")).id;
  const path = (await one("select delete_make($1) as p", [id])).p;
  assert.match(path, new RegExp(`^${T}/`));
  assert.equal(await points(T), 10);
  assert.equal((await postcards(T)).length, 1);
  await rejects("select delete_make($1)", [id], /not found/);
  await as(U);
  const mine = (await one("select id from makes where teen_id = $1 limit 1", [T]).catch(() => null))?.id;
  assert.equal(mine, undefined, "another teen can't even see them");
});
