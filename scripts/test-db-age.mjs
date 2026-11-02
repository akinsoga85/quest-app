// Age groups that move up: the month a self-declared teen's group ends is
// kept at sign-up, the daily job moves them on that day, and store-placed
// teens move up when their app store says so. Each test rolls back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { Api, ageGroupEndsOn } from "../packages/contract/src/index.ts";
import { runDaily } from "../packages/ops/src/deletions.ts";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/quest";
const db = new pg.Client({ connectionString: url });

const T = "00000000-0000-4000-8000-0000000013a1";
const U = "00000000-0000-4000-8000-0000000013a2";
const P = "00000000-0000-4000-8000-0000000013b1";

const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

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

const teen = async (id) => (await one("select age_bracket, age_group_ends::text as ends, age_source from teens where id = $1", [id]));
const plus = async (id) => {
  await as(id);
  return Api["plus.status"].output.parse((await one("select plus_status() as p")).p);
};
// A birth month and year that puts someone in a group today, ending in `months` months.
function endingIn(months) {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)).toISOString().slice(0, 10);
}

function scenario(name, fn) {
  test(name, async () => {
    await q("begin");
    try {
      for (const id of [T, U, P]) await q("insert into auth.users (id) values ($1)", [id]);
      await fn();
    } finally {
      await q("rollback");
    }
  });
}

before(async () => db.connect());
after(async () => db.end());

scenario("sign-up keeps the month a self-declared teen's group ends, and checks it fits", async () => {
  await as(T);
  const ends = ageGroupEndsOn(2011, 3, "13_15");
  await rejects("select * from create_teen_profile('13_15', 'self_declared', 'US', null, 'UTC')", [], /month the age group ends/);
  await rejects("select * from create_teen_profile('13_15', 'self_declared', 'US', null, 'UTC', $1)", [endingIn(40)], /doesn't fit/);
  await rejects("select * from create_teen_profile('16_17', 'self_declared', 'US', null, 'UTC', $1)", [endingIn(30)], /doesn't fit/);
  await rejects("select * from create_teen_profile('13_15', 'self_declared', 'US', null, 'UTC', '2027-04-15')", [], /doesn't fit/);
  await q("select * from create_teen_profile('13_15', 'self_declared', 'US', null, 'UTC', $1)", [endingIn(5)]);
  await asAdmin();
  assert.deepEqual(await teen(T), { age_bracket: "13_15", ends: endingIn(5), age_source: "self_declared" });
  assert.match(ends, /^\d{4}-\d{2}-01$/);
  // Store-placed and 18–19 teens keep no month.
  await as(U);
  await q("select * from create_teen_profile('16_17', 'store', 'US', null, 'UTC', $1)", [endingIn(5)]);
  await asAdmin();
  assert.equal((await teen(U)).ends, null);
});

scenario("the daily job moves teens up on their month: free Plus ends at 16, a parent's consent at 18", async () => {
  await asAdmin();
  await q("insert into teens (id, handle, age_bracket, country, ai_coach_consent, age_group_ends) values ($1, 'TinyOwl-15', '13_15', 'US', true, $2)", [T, endingIn(1)]);
  await q("insert into teens (id, handle, age_bracket, country, ai_coach_consent, age_group_ends) values ($1, 'TallFern-17', '16_17', 'US', true, $2)", [U, endingIn(2)]);
  assert.equal((await plus(T)).included, true);

  // The real job, with a fake clock and no deletions due.
  let today = new Date();
  const deps = {
    advanceAgeGroups: async (now) => {
      await asServer();
      return (await one("select advance_age_groups($1::date) as n", [now.toISOString().slice(0, 10)])).n;
    },
    due: async () => [],
    cancelBilling: async () => 0,
    listFolder: async () => [],
    removeFiles: async () => undefined,
    complete: async () => undefined,
    now: () => today,
  };
  assert.equal((await runDaily(deps)).ageGroupsMoved, 0, "nobody's month has come yet");

  today = new Date(Date.parse(endingIn(1)) + 3600_000); // the first of next month
  assert.equal((await runDaily(deps)).ageGroupsMoved, 1);
  await asAdmin();
  assert.deepEqual(await teen(T), { age_bracket: "16_17", ends: endingIn(25), age_source: "self_declared" }, "18 comes exactly 2 years after 16");
  const t = await plus(T);
  assert.deepEqual([t.included, t.active], [false, false], "free Plus stops at 16");

  today = new Date(Date.parse(endingIn(2)) + 3600_000);
  await runDaily(deps);
  await asAdmin();
  assert.deepEqual(await teen(U), { age_bracket: "18_19", ends: null, age_source: "self_declared" });
  assert.equal((await one("select private.coach_allowed($1) as ok", [U])).ok, true, "at 18 the coach no longer needs a parent's yes");

  // Years later, the job catches up one group at a time, and stops at 18–19.
  today = new Date(Date.parse(endingIn(60)));
  await runDaily(deps);
  await asAdmin();
  assert.deepEqual([(await teen(T)).age_bracket, (await teen(T)).ends], ["18_19", null]);
});

scenario("store-placed teens move up when the store says so: one group, at most monthly, never down", async () => {
  await asAdmin();
  await q("insert into teens (id, handle, age_bracket, age_source, country, age_checked_at) values ($1, 'QuietBay-15', '13_15', 'store', 'US', now() - interval '7 months')", [T]);
  await q("insert into teens (id, handle, age_bracket, age_source, country) values ($1, 'LoudCove-16', '16_17', 'self_declared', 'US')", [U]);
  await as(T);
  assert.deepEqual((await one("select confirm_age_group('13_15') as r")).r, { ageBracket: "13_15", moved: false });
  // Just checked: a move now waits a month.
  assert.deepEqual((await one("select confirm_age_group('16_17') as r")).r, { ageBracket: "13_15", moved: false });
  await asAdmin();
  await q("update teens set age_checked_at = now() - interval '6 months' where id = $1", [T]);
  await as(T);
  assert.deepEqual((await one("select confirm_age_group('18_19') as r")).r, { ageBracket: "16_17", moved: true }, "one group at a time");
  await asAdmin();
  await q("update teens set age_checked_at = now() - interval '6 months' where id = $1", [T]);
  await as(T);
  assert.deepEqual((await one("select confirm_age_group('13_15') as r")).r, { ageBracket: "16_17", moved: false }, "never down");
  // An 18–19 the store now calls "18 or older" (they've turned 20) stays in 18–19.
  await asAdmin();
  await q("update teens set age_bracket = '18_19', age_checked_at = now() - interval '6 months' where id = $1", [T]);
  await as(T);
  assert.deepEqual((await one("select confirm_age_group('18_19') as r")).r, { ageBracket: "18_19", moved: false });
  await asAdmin();
  assert.equal((await one("select count(*)::int n from teens where id = $1", [T])).n, 1, "they keep their account");
  await as(U);
  await rejects("select confirm_age_group('18_19')", [], /only ages from the app store/);
  await as(T);
  await rejects("select advance_age_groups()", [], /permission denied/);
});
