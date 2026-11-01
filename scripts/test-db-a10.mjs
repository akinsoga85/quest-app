// A10 tests: the evening drop with a fake clock, running the real job
// (packages/notify) against a real Postgres. Each test runs in its own
// transaction and rolls back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { Api } from "../packages/contract/src/index.ts";
import { Candidate, runDrops } from "../packages/notify/src/drop.ts";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/quest";
const db = new pg.Client({ connectionString: url });

const LA = "00000000-0000-4000-8000-0000000010a1"; // Los Angeles, 16–17
const TK = "00000000-0000-4000-8000-0000000010a2"; // Tokyo, 18–19
const KT = "00000000-0000-4000-8000-0000000010a3"; // Kathmandu (UTC+5:45), 13–15
const P = "00000000-0000-4000-8000-0000000010b1"; // LA's parent

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

// The real job, wired to this database, with a fake clock and a fake Expo.
function job(clock) {
  const pushes = [];
  const deps = {
    candidates: async (now) => {
      await asServer();
      return Candidate.array().parse((await one("select drop_candidates($1) as c", [now.toISOString()])).c);
    },
    record: async (teen, day, pushed) => {
      await asServer();
      return (await one("select record_drop($1, $2, $3) as r", [teen, day, pushed])).r;
    },
    push: async (messages) => {
      pushes.push(...messages);
      return { deadTokens: messages.filter((m) => m.to.includes("dead")).map((m) => m.to) };
    },
    removeToken: async (token) => {
      await asServer();
      await q("select remove_push_token($1)", [token]);
    },
    now: () => new Date(clock.now),
  };
  return { run: () => runDrops(deps), pushes };
}

function scenario(name, fn) {
  test(name, async () => {
    await q("begin");
    try {
      for (const id of [LA, TK, KT, P]) await q("insert into auth.users (id) values ($1)", [id]);
      await q(
        `insert into teens (id, handle, age_bracket, country, timezone) values
           ($1, 'BlueFox-482', '16_17', 'US', 'America/Los_Angeles'),
           ($2, 'AmberLark-19', '18_19', 'CA', 'Asia/Tokyo'),
           ($3, 'MistyWren-33', '13_15', 'US', 'Asia/Kathmandu')`,
        [LA, TK, KT],
      );
      await q("insert into notification_prefs (teen_id) values ($1), ($2), ($3)", [LA, TK, KT]);
      for (const [teen, tok] of [[LA, "ExponentPushToken[la]"], [TK, "ExponentPushToken[tk]"], [KT, "ExponentPushToken[kt]"]]) {
        await as(teen);
        await q("select register_push_token($1, 'ios')", [tok]);
      }
      await fn();
    } finally {
      await q("rollback");
    }
  });
}

before(async () => db.connect());
after(async () => db.end());

scenario("A10 done when: the drop arrives at 8 pm local time, once, in every time zone", async () => {
  const clock = { now: 0 };
  const j = job(clock);
  const at = async (iso) => {
    clock.now = Date.parse(iso);
    return j.run();
  };
  // 19:55 in Tokyo: not yet. 20:00 in Tokyo (11:00 UTC): Tokyo only.
  assert.deepEqual((await at("2026-11-02T10:55:00Z")).pushed, []);
  assert.deepEqual((await at("2026-11-02T11:00:00Z")).pushed, [TK]);
  // Ten minutes later: nobody twice.
  assert.deepEqual((await at("2026-11-02T11:10:00Z")).pushed, []);
  // 20:00 in Kathmandu is 14:15 UTC.
  assert.deepEqual((await at("2026-11-02T14:14:00Z")).pushed, []);
  assert.deepEqual((await at("2026-11-02T14:15:00Z")).pushed, [KT]);
  // 20:00 in Los Angeles on Nov 2 (PST, UTC−8) is 04:00 UTC on Nov 3.
  assert.deepEqual((await at("2026-11-03T04:00:00Z")).pushed, [LA]);
  // The next evening in Tokyo, a new drop.
  assert.deepEqual((await at("2026-11-03T11:05:00Z")).pushed, [TK]);

  assert.equal(j.pushes.length, 4);
  assert.deepEqual(new Set(j.pushes.map((p) => p.data.screen)), new Set(["drop"]));
  // Lock screens are public: no handles or names in the push.
  assert.doesNotMatch(JSON.stringify(j.pushes), /BlueFox|AmberLark|MistyWren|Mom/);
  await asAdmin();
  assert.deepEqual((await q("select day::text, pushed from drops where teen_id = $1 order by day", [TK])).rows, [
    { day: "2026-11-02", pushed: true },
    { day: "2026-11-03", pushed: true },
  ]);
});

scenario("A10 done when: no pushes during quiet hours", async () => {
  const clock = { now: 0 };
  const j = job(clock);
  // Tokyo (18–19) moves the drop to 21:30, inside quiet hours (21:00–07:00).
  await as(TK);
  await q("select set_notification_prefs('21:30', '21:00', '07:00', false)");
  clock.now = Date.parse("2026-11-02T12:30:00Z"); // 21:30 in Tokyo
  const r = await j.run();
  assert.deepEqual(r.quiet, [TK]);
  assert.deepEqual(r.pushed, []);
  assert.equal(j.pushes.length, 0);
  await asAdmin();
  assert.equal((await one("select pushed from drops where teen_id = $1", [TK])).pushed, false, "shown in the app only");
  // An hour later: still nothing, and it isn't retried.
  clock.now = Date.parse("2026-11-02T13:30:00Z");
  assert.deepEqual((await j.run()).pushed, []);
  // Missed by more than two hours (the job was down): it waits for tomorrow.
  await as(LA);
  await q("select set_notification_prefs('18:00', '21:00', '07:00', false)");
  clock.now = Date.parse("2026-11-03T05:00:00Z"); // 21:00 in LA, 3 hours late
  assert.deepEqual((await j.run()).pushed, []);
});

scenario("under-18s can make quiet hours longer, never shorter", async () => {
  await as(LA);
  await q("select set_notification_prefs('19:00', '20:30', '07:30', true)"); // longer: fine
  await rejects("select set_notification_prefs('20:00', '23:00', '07:00', false)", [], /22:00 to 06:00/);
  await rejects("select set_notification_prefs('20:00', '21:00', '05:00', false)", [], /22:00 to 06:00/);
  await rejects("select set_notification_prefs('20:00', '21:00', '21:00', false)", [], /22:00 to 06:00/);
  await as(TK);
  await q("select set_notification_prefs('20:00', '23:30', '06:30', false)"); // an 18–19 chooses
  await as(LA);
  await rejects("update notification_prefs set quiet_start = '23:59' where teen_id = $1", [LA], /permission denied/);
});

scenario("the drop screen: today's makes, this week's points and skills, cheers back", async () => {
  await asAdmin();
  await q("insert into parents (id, display_name, adult_check, adult_checked_at) values ($1, 'Mom', 'attested', now())", [P]);
  await q("insert into parent_links (teen_id, parent_id, status, consented_at) values ($1, $2, 'active', now())", [LA, P]);
  const quest = (await one("select quest_id from quest_schedule where zone_id = 'photography' and day = private.today_for($1)", [LA])).quest_id;
  const m = (await one("insert into makes (teen_id, quest_id, storage_path, status) values ($1::uuid, $2, $1::text || '/d.jpg', 'reviewed') returning id", [LA, quest])).id;
  const r = (await one("insert into reviews (make_id, teen_id, worked, try_next, why, confidence, model, prompt_version) values ($1, $2, 'w', 't', 'y', 0.9, 'm', 'v') returning id", [m, LA])).id;
  await q("insert into skill_points (teen_id, review_id, skill_id, points) values ($1, $2, 'photography.light', 2), ($1, $2, 'photography.story', 1)", [LA, r]);
  const s = (await one("insert into family_shares (make_id, teen_id, parent_id) values ($1, $2, $3) returning id", [m, LA, P])).id;
  await q("insert into family_cheers (share_id, parent_id, cheer) values ($1, $2, 'great_light')", [s, P]);

  await as(LA);
  const d = Api["drop.get"].output.parse((await one("select get_drop() as d")).d);
  assert.deepEqual(d.todays.map((t) => [t.makeId, t.sentTo]), [[m, ["Mom"]]]);
  assert.equal(d.weekPoints, 3);
  assert.deepEqual(d.weekSkills, { "photography.light": 2, "photography.story": 1 });
  assert.deepEqual(d.cheers.map((c) => [c.from, c.cheer]), [["Mom", "great_light"]]);
  // The push for today counts the same things, without names.
  await asServer();
  const c = Candidate.array().parse((await one("select drop_candidates() as c")).c).find((x) => x.teenId === LA);
  assert.deepEqual([c.pointsToday, c.cheersToday, c.madeToday], [3, 1, true]);
});

scenario("push tokens: only through the functions; dead tokens are removed", async () => {
  await as(LA);
  await rejects("select register_push_token('not-a-token', 'ios')", [], /Expo push token/);
  await rejects("select * from push_tokens", [], /permission denied/);
  await rejects("select drop_candidates()", [], /permission denied/);
  await q("select register_push_token('ExponentPushToken[dead]', 'android')");
  const clock = { now: Date.parse("2026-11-03T04:00:00Z") }; // 20:00 in LA
  const j = job(clock);
  assert.deepEqual((await j.run()).pushed, [LA]);
  await asAdmin();
  assert.equal(await count("select count(*) n from push_tokens where token like '%dead%'"), 0);
  assert.equal(await count("select count(*) n from push_tokens where teen_id = $1", [LA]), 1);
  await as(LA);
  await q("select unregister_push_token('ExponentPushToken[la]')");
  await asAdmin();
  assert.equal(await count("select count(*) n from push_tokens where teen_id = $1", [LA]), 0);
});
