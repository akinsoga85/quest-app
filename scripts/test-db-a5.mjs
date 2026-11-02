// A5 tests: the safety scan's gate and queue, against a real Postgres. Each
// test runs in its own transaction and rolls back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { ScanClaim } from "../packages/contract/src/index.ts";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/quest";
const db = new pg.Client({ connectionString: url });

const T = "00000000-0000-4000-8000-0000000005a1"; // teen, 18–19, coach on

const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const count = async (sql, params) => Number((await one(sql, params)).n);

async function as(uid, role = "authenticated") {
  await q("reset role");
  await q("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
  await q(`set local role ${role}`);
}
const asAdmin = () => q("reset role");
const asServer = () => as(null, "service_role");

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

// A freshly uploaded make, as record_make (A3) leaves it.
async function uploaded() {
  await asAdmin();
  const quest = (await one("select id from quests where zone_id = 'photography' and status = 'approved' limit 1")).id;
  return (await one(
    "insert into makes (teen_id, quest_id, storage_path) values ($1::uuid, $2, $1::text || '/' || gen_random_uuid() || '.jpg') returning id",
    [T, quest],
  )).id;
}
const status = async (id) => (await one("select status from makes where id = $1", [id])).status;
const claim = async (id) => ScanClaim.parse((await one("select scan_claim($1) as c", [id])).c);

function scenario(name, fn) {
  test(name, async () => {
    await q("begin");
    try {
      await q("insert into auth.users (id) values ($1)", [T]);
      await q("insert into teens (id, handle, age_bracket, country, ai_coach_consent) values ($1, 'MintFinch-55', '18_19', 'CA', true)", [T]);
      await fn();
    } finally {
      await q("rollback");
    }
  });
}

before(async () => db.connect());
after(async () => db.end());

scenario("A5 done when: nothing reaches the coach unscanned", async () => {
  const m = await uploaded();
  // Not even the database owner can skip the scan.
  await asAdmin();
  await rejects("update makes set status = 'reviewing' where id = $1", [m], /hasn't passed the safety scan/);
  const quest = (await one("select quest_id from makes where id = $1", [m])).quest_id;
  await rejects(
    "insert into makes (teen_id, quest_id, storage_path, status) values ($1::uuid, $2, $1::text || '/direct.jpg', 'reviewing')",
    [T, quest],
    /hasn't passed the safety scan/,
  );
  // The coach gets nothing while it's uploaded or being scanned.
  await asServer();
  assert.equal((await one("select coach_claim($1) as c", [m])).c, null);
  assert.deepEqual(await claim(m), { makeId: m, storagePath: (await one("select storage_path from makes where id = $1", [m])).storage_path });
  assert.equal(await status(m), "scanning");
  assert.equal((await one("select coach_claim($1) as c", [m])).c, null);
  assert.equal(await count("select count(*) n from coach_pending(100)"), 0);
  // A pass opens the gate.
  assert.equal((await one("select scan_save($1, 'pass', '{}', 'test-vendor') as s", [m])).s, "reviewing");
  assert.equal((await one("select coach_claim($1) as c", [m])).c.consent, true);

  // A blocked make can never be moved on to the coach.
  const b = await uploaded();
  await asServer();
  await claim(b);
  await q("select scan_save($1, 'block', '{hash_match:test-1}', 'test-vendor')", [b]);
  await asAdmin();
  await rejects("update makes set status = 'reviewing' where id = $1", [b], /hasn't passed/);
});

scenario("A5 done when: flagged items reach the admin queue", async () => {
  const blocked = await uploaded();
  const held = await uploaded();
  const passed = await uploaded();
  await asServer();
  for (const m of [blocked, held, passed]) await claim(m);
  assert.equal((await one("select scan_save($1, 'block', '{hash_match:test-1}', 'test') as s", [blocked])).s, "blocked");
  assert.equal((await one("select scan_save($1, 'human_review', '{self_harm:0.41}', 'test') as s", [held])).s, "held_for_review");
  await q("select scan_save($1, 'pass', '{}', 'test')", [passed]);

  // The coach raises a concern about the one that passed.
  await q("select coach_claim($1)", [passed]);
  await q("select coach_save_outcome($1, 'concern', 'Note in the photo mentions hurting themself.', null, 'm')", [passed]);

  await asAdmin();
  const queue = (await q("select make_id, source, result, reasons from safety_queue where resolved_at is null order by created_at, source")).rows;
  assert.deepEqual(
    queue.map((r) => [r.make_id, r.source, r.result, r.reasons]).sort(),
    [
      [blocked, "scan", "block", ["hash_match:test-1"]],
      [held, "scan", "human_review", ["self_harm:0.41"]],
      [passed, "coach", "human_review", ["coach_concern"]],
    ].sort(),
  );
  // The teen sees only "held" (A4), never the queue or the scan details.
  await as(T);
  await rejects("select * from safety_queue", [], /permission denied/);
  assert.equal(await count("select count(*) n from safety_scans"), 0);
  assert.deepEqual((await one("select get_review($1) as r", [blocked])).r, { state: "held" });
  assert.deepEqual((await one("select get_review($1) as r", [held])).r, { state: "held" });
});

scenario("one scanner at a time; a stuck scan is picked up again", async () => {
  const m = await uploaded();
  await asServer();
  assert.deepEqual(await count("select count(*) n from scan_pending(100) id where id = $1", [m]), 1);
  assert.ok(await claim(m));
  assert.equal(await claim(m), null);
  assert.equal(await count("select count(*) n from scan_pending(100) id where id = $1", [m]), 0);
  await asAdmin();
  await q("update makes set scan_started_at = now() - interval '4 minutes' where id = $1", [m]);
  await asServer();
  assert.equal(await count("select count(*) n from scan_pending(100) id where id = $1", [m]), 1);
  assert.ok(await claim(m));
  // Saving needs a scan in progress and the scanner's name.
  await rejects("select scan_save($1, 'pass', '{}', '')", [m], /which scanner/);
  await q("select scan_save($1, 'pass', '{}', 'test')", [m]);
  await rejects("select scan_save($1, 'block', '{}', 'test')", [m], /isn't being scanned/);
});

scenario("a blocked photo can be replaced with a new one", async () => {
  const m = await uploaded();
  await asServer();
  await claim(m);
  await q("select scan_save($1, 'block', '{nudity:0.92}', 'test')", [m]);
  await asAdmin();
  const day = (await one("select local_day::text d, quest_id from makes where id = $1", [m]));
  await q("insert into quest_schedule (day, zone_id, quest_id) values ($1, 'photography', $2) on conflict (day, zone_id) do update set quest_id = excluded.quest_id", [day.d, day.quest_id]);
  await as(T);
  const r = (await one("select record_make(gen_random_uuid(), $1, now()) as r", [day.quest_id])).r;
  assert.equal(r.status, "uploaded");
});

scenario("the app can't call the scanner's functions", async () => {
  const m = await uploaded();
  await as(T);
  await rejects("select scan_claim($1)", [m], /permission denied/);
  await rejects("select scan_save($1, 'pass', '{}', 'me')", [m], /permission denied/);
  await rejects("select scan_pending(5)", [], /permission denied/);
});
