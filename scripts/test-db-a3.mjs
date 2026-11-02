// A3 tests: recording a make after its photo is uploaded, against a real
// Postgres. Each test runs in its own transaction and rolls back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { Api, MakeStatus, makePath } from "../packages/contract/src/index.ts";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/quest";
const db = new pg.Client({ connectionString: url });

const T = "00000000-0000-4000-8000-0000000003a1"; // teen in Los Angeles
const U = "00000000-0000-4000-8000-0000000003a2"; // another teen
const P = "00000000-0000-4000-8000-0000000003b1"; // parent

const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const count = async (sql, params) => Number((await one(sql, params)).n);
const uuid = async () => (await one("select gen_random_uuid() as id")).id;

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

// A fresh approved photography quest scheduled on `day` (a SQL date expression).
async function questOn(dayExpr) {
  await asAdmin();
  const day = (await one(`select (${dayExpr})::text as d`)).d;
  const id = (await one(
    `insert into quests (zone_id, title, brief, minutes, trains_skill_id, status, approved_at)
     values ('photography', $1, 'A quest written for the A3 database tests.', 10, 'photography.light', 'approved', now()) returning id`,
    [`Quest for ${day}`],
  )).id;
  await q("insert into quest_schedule (day, zone_id, quest_id) values ($1, 'photography', $2) on conflict (day, zone_id) do update set quest_id = excluded.quest_id", [day, id]);
  return { id, day };
}

const record = async (makeId, questId, capturedAt = "now()") =>
  Api["make.record"].output.parse((await one(`select record_make($1, $2, ${capturedAt}) as r`, [makeId, questId])).r);

function scenario(name, fn) {
  test(name, async () => {
    await q("begin");
    try {
      for (const id of [T, U, P]) await q("insert into auth.users (id) values ($1)", [id]);
      await q(
        `insert into teens (id, handle, age_bracket, country, timezone) values
           ($1, 'MintHeron-31', '16_17', 'US', 'America/Los_Angeles'), ($2, 'CoralWren-77', '18_19', 'CA', 'America/Toronto')`,
        [T, U],
      );
      await q("insert into teen_zones (teen_id, zone_id) values ($1, 'photography')", [T]);
      await q("insert into parents (id) values ($1)", [P]);
      await fn();
    } finally {
      await q("rollback");
    }
  });
}

before(async () => db.connect());
after(async () => db.end());

test("the contract's make statuses match the database", async () => {
  const labels = (await one("select array_agg(e.enumlabel::text order by e.enumsortorder) as l from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'make_status'")).l;
  assert.deepEqual(labels, MakeStatus.options);
});

scenario("record_make saves today's make in the teen's folder", async () => {
  const quest = await questOn("private.today_for('" + T + "')");
  const id = await uuid();
  await as(T);
  const r = await record(id, quest.id);
  assert.deepEqual(r, { makeId: id, status: "uploaded", localDay: quest.day });
  const row = await one("select teen_id, quest_id, storage_path, status from makes where id = $1", [id]);
  assert.deepEqual(row, { teen_id: T, quest_id: quest.id, storage_path: makePath(T, id), status: "uploaded" });
  const today = (await one("select get_today() as t")).t;
  assert.equal(today.zones[0].madeToday, true, "Today shows the quest as done");
  assert.deepEqual(today.week.madeDays, [quest.day]);
});

scenario("A3 done when (server side): retrying after a dropped connection never makes a second make", async () => {
  const quest = await questOn("private.today_for('" + T + "')");
  const id = await uuid();
  await as(T);
  const first = await record(id, quest.id);
  // The phone lost the answer and tries again, maybe more than once.
  for (let i = 0; i < 3; i++) assert.deepEqual(await record(id, quest.id), first);
  assert.equal(await count("select count(*) n from makes"), 1);
});

scenario("one photo per quest; a photo the safety scan blocked can be retaken", async () => {
  const quest = await questOn("private.today_for('" + T + "')");
  const first = await uuid();
  await as(T);
  await record(first, quest.id);
  await rejects("select record_make(gen_random_uuid(), $1, now())", [quest.id], /already made this quest/);
  await asAdmin();
  await q("update makes set status = 'blocked' where id = $1", [first]);
  await as(T);
  const retake = await uuid();
  assert.equal((await record(retake, quest.id)).status, "uploaded");
  assert.equal(await count("select count(*) n from makes where status <> 'blocked'"), 1);
});

scenario("only the quest scheduled on the day the photo was taken", async () => {
  const today = await questOn("private.today_for('" + T + "')");
  const tomorrow = await questOn("private.today_for('" + T + "') + 1");
  await asAdmin();
  const draft = (await one("insert into quests (zone_id, title, brief, minutes, trains_skill_id) values ('photography', 'Draft', 'A draft quest that was never approved.', 10, 'photography.light') returning id")).id;
  await q("update quest_schedule set quest_id = $1 where day = private.today_for($2) + 2 and zone_id = 'photography'", [draft, T]);
  await as(T);
  await rejects("select record_make(gen_random_uuid(), $1, now())", [tomorrow.id], /isn't open/);
  await rejects("select record_make(gen_random_uuid(), $1, now())", [draft], /isn't open/);
  await rejects("select record_make(gen_random_uuid(), $1, now())", ["00000000-0000-4000-8000-000000000999"], /isn't open/);
  assert.equal((await record(await uuid(), today.id)).localDay, today.day);
});

scenario("a photo taken offline counts for the day it was taken, up to 48 hours later", async () => {
  // Taken 20 hours ago: whatever local day that was in Los Angeles, its quest counts.
  const then = await questOn(`private.local_day('America/Los_Angeles', now() - interval '20 hours')`);
  await as(T);
  const r = await record(await uuid(), then.id, "now() - interval '20 hours'");
  assert.equal(r.localDay, then.day);

  const old = await questOn(`private.local_day('America/Los_Angeles', now() - interval '3 days')`);
  await as(T);
  await rejects("select record_make(gen_random_uuid(), $1, now() - interval '3 days')", [old.id], /too old/);
  await rejects("select record_make(gen_random_uuid(), $1, now() + interval '1 hour')", [then.id], /from the future/);
});

scenario("only the teen can record their makes", async () => {
  const quest = await questOn("private.today_for('" + T + "')");
  const id = await uuid();
  await as(T);
  await record(id, quest.id);
  await as(U); // someone else re-using the id gets nothing
  await rejects("select record_make($1, $2, now())", [id, quest.id], /taken/);
  assert.equal(await count("select count(*) n from makes"), 0, "and can't see it");
  await as(P);
  await rejects("select record_make(gen_random_uuid(), $1, now())", [quest.id], /only teens/);
  await as(null, "anon");
  await rejects("select record_make(gen_random_uuid(), $1, now())", [quest.id], /permission denied/);
  await as(T);
  await rejects("insert into makes (id, teen_id, quest_id, storage_path) values (gen_random_uuid(), $1::uuid, $2, $1::text || '/x.jpg')", [T, quest.id], /permission denied/);
});
