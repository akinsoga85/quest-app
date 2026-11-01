// A2 tests: quests and Today, against a real Postgres. Each test runs in its
// own transaction and rolls back. Times are fixed instants, so the results
// don't depend on when or where the tests run.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { Today, addDays, localDay, weekDays, weeklyStreak } from "../packages/contract/src/today.ts";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/quest";
const db = new pg.Client({ connectionString: url });

const T = "00000000-0000-4000-8000-0000000002a1"; // teen
const U = "00000000-0000-4000-8000-0000000002a2"; // second teen
const P = "00000000-0000-4000-8000-0000000002b1"; // parent

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

function scenario(name, fn) {
  test(name, async () => {
    await q("begin");
    try {
      for (const id of [T, U, P]) await q("insert into auth.users (id) values ($1)", [id]);
      await q(
        `insert into teens (id, handle, age_bracket, country, timezone) values
           ($1, 'PaperKite-21', '16_17', 'US', 'America/Los_Angeles'),
           ($2, 'SoftLark-32', '18_19', 'CA', 'Asia/Tokyo')`,
        [T, U],
      );
      await q("insert into parents (id) values ($1)", [P]);
      await q("insert into parent_links (teen_id, parent_id, status, consented_at) values ($1, $2, 'active', now())", [T, P]);
      await fn();
    } finally {
      await q("rollback");
    }
  });
}

before(async () => db.connect());
after(async () => db.end());

const ZONE_SKILL = { photography: "photography.light", fashion: "fashion.colour", art_crafts: "art_crafts.line" };

// One approved quest per zone for each day, titled so tests can tell them apart.
async function scheduleDays(days, zones = Object.keys(ZONE_SKILL)) {
  await asAdmin();
  for (const day of days) {
    for (const zone of zones) {
      await q(
        `with nq as (
           insert into quests (zone_id, title, brief, minutes, trains_skill_id, status, approved_at)
           values ($2, $3, 'A quest written for the A2 database tests, one per day.', 10, $4, 'approved', now())
           returning id)
         insert into quest_schedule (day, zone_id, quest_id) select $1::date, $2, id from nq
         on conflict (day, zone_id) do update set quest_id = excluded.quest_id`,
        [day, zone, `Quest ${day} ${zone}`.slice(0, 60), ZONE_SKILL[zone]],
      );
    }
  }
}

async function setZones(teen, zones) {
  await asAdmin();
  await q("delete from teen_zones where teen_id = $1", [teen]);
  for (const z of zones) await q("insert into teen_zones (teen_id, zone_id) values ($1, $2)", [teen, z]);
}

const todayAt = async (teen, at) => Today.parse((await one("select private.today_at($1, $2) as t", [teen, at])).t);

// The first instant of `day` in `tz`, to the millisecond. Some zones skip local
// midnight on their daylight-saving day, so this searches rather than assumes.
function midnight(day, tz) {
  let lo = Date.parse(`${day}T00:00:00Z`) - 15 * 3600_000;
  let hi = Date.parse(`${day}T00:00:00Z`) + 15 * 3600_000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDay(new Date(mid), tz) >= day) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

const ZONES_TO_TEST = [
  "UTC",
  "America/Los_Angeles",
  "America/Toronto",
  "America/St_Johns",
  "America/Santiago",
  "Europe/London",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Australia/Lord_Howe",
  "Pacific/Auckland",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
];

// ---------------------------------------------------------------------------

test("local day: the database agrees with the contract's localDay", async () => {
  // Every 20 minutes through the 2025 daylight-saving changes, plus every 6 hours through the year.
  const instants = [];
  for (const [from, to] of [["2025-03-07", "2025-03-11"], ["2025-03-28", "2025-04-08"], ["2025-09-04", "2025-09-08"], ["2025-09-25", "2025-10-01"], ["2025-10-24", "2025-11-04"]]) {
    for (let t = Date.parse(`${from}T00:00:00Z`); t < Date.parse(`${to}T00:00:00Z`); t += 20 * 60_000) instants.push(t);
  }
  for (let t = Date.parse("2025-01-01T00:00:00Z"); t < Date.parse("2026-01-01T00:00:00Z"); t += 6 * 3600_000) instants.push(t);

  const tzs = [];
  const ats = [];
  for (const tz of ZONES_TO_TEST) for (const t of instants) { tzs.push(tz); ats.push(new Date(t).toISOString()); }
  const rows = (await q("select private.local_day(tz, at)::text as d from unnest($1::text[], $2::timestamptz[]) with ordinality u(tz, at, i) order by i", [tzs, ats])).rows;
  let checked = 0;
  rows.forEach((r, i) => {
    assert.equal(r.d, localDay(new Date(ats[i]), tzs[i]), `${tzs[i]} at ${ats[i]}`);
    checked++;
  });
  assert.ok(checked > 20_000);
});

scenario("A2 done when: one quest per zone appears at local midnight, in every time zone", async () => {
  // Days around the 2030 daylight-saving changes (US, Europe, Chile, Australia, New Zealand).
  const days = ["2030-03-09", "2030-03-10", "2030-03-30", "2030-04-06", "2030-09-07", "2030-09-28", "2030-10-26", "2030-11-02"];
  await scheduleDays([...new Set(days.flatMap((d) => [d, addDays(d, 1)]))]);
  await setZones(T, ["photography", "fashion", "art_crafts"]);

  for (const tz of ZONES_TO_TEST) {
    await asAdmin();
    await q("update teens set timezone = $1 where id = $2", [tz, T]);
    for (const day of days) {
      const next = addDays(day, 1);
      const m = midnight(next, tz);
      const before = await todayAt(T, new Date(m.getTime() - 1));
      const atMidnight = await todayAt(T, m);
      for (const [payload, d] of [[before, day], [atMidnight, next]]) {
        assert.equal(payload.day, d, `${tz}: day at ${m.toISOString()}`);
        assert.deepEqual(payload.zones.map((z) => z.zone), ["photography", "fashion", "art_crafts"]);
        for (const z of payload.zones) {
          assert.equal(z.quest?.zone, z.zone, "one quest per zone, in that zone");
          assert.equal(z.quest?.title, `Quest ${d} ${z.zone}`, `${tz}: ${z.zone} quest for ${d}`);
        }
      }
    }
  }
});

scenario("a later day's quest stays hidden until the teen's local midnight", async () => {
  await asAdmin();
  await q("update teens set timezone = 'Pacific/Kiritimati' where id = $1", [T]); // UTC+14
  await q("update teens set timezone = 'Pacific/Pago_Pago' where id = $1", [U]); // UTC-11
  const kiri = (await one("select private.today_for($1)::text as d", [T])).d;
  const pago = (await one("select private.today_for($1)::text as d", [U])).d;
  assert.ok(kiri > pago, "Kiritimati is always a day or two ahead of Pago Pago");
  await scheduleDays([kiri, addDays(kiri, 1)], ["photography"]);
  const ids = (await q("select day::text, quest_id from quest_schedule where zone_id = 'photography' and day in ($1::date, $2::date) order by day", [kiri, addDays(kiri, 1)])).rows;

  await as(T);
  assert.equal(await count("select count(*) n from quests where id = $1", [ids[0].quest_id]), 1, "today's quest is visible");
  assert.equal(await count("select count(*) n from quests where id = $1", [ids[1].quest_id]), 0, "tomorrow's quest is not");
  assert.equal(await count("select count(*) n from quest_schedule where day > $1::date", [kiri]), 0);

  await as(U);
  assert.equal(await count("select count(*) n from quests where id = $1", [ids[0].quest_id]), 0, "still tomorrow in Pago Pago");
  assert.equal(await count("select count(*) n from quest_schedule where day > $1::date", [pago]), 0);

  await as(P); // parents can see what any teen can, and no further
  assert.equal(await count("select count(*) n from quests where id = $1", [ids[0].quest_id]), 1);
  assert.equal(await count("select count(*) n from quests where id = $1", [ids[1].quest_id]), 0);
});

// ---------------------------------------------------------------------------
// Streaks

async function make(teen, localTime, tz, { status = "reviewed", zone = "photography" } = {}) {
  await asAdmin();
  const quest = (await one("select id from quests where zone_id = $1 and status = 'approved' limit 1", [zone])).id;
  const r = await one(
    `insert into makes (teen_id, quest_id, storage_path, status, created_at)
     values ($1::uuid, $2, $1::text || '/' || gen_random_uuid() || '.jpg', $3, ($4::timestamp at time zone $5))
     returning local_day::text`,
    [teen, quest, status, localTime, tz],
  );
  return r.local_day;
}

scenario("A2 done when: the weekly streak counts correctly across time zones", async () => {
  // Auckland (UTC+13 in November). Monday to Wednesday mornings there are
  // Sunday to Tuesday in UTC, so counting by UTC days would split the week.
  await asAdmin();
  await q("update teens set timezone = 'Pacific/Auckland' where id = $1", [T]);
  assert.equal(await make(T, "2025-11-03 08:00", "Pacific/Auckland"), "2025-11-03");
  assert.equal(await make(T, "2025-11-04 08:00", "Pacific/Auckland"), "2025-11-04");
  assert.equal(await make(T, "2025-11-05 08:00", "Pacific/Auckland"), "2025-11-05");
  let t = await todayAt(T, "2025-11-05T12:00:00+13:00");
  assert.equal(t.day, "2025-11-05");
  assert.deepEqual(t.week, { start: "2025-11-03", madeDays: ["2025-11-03", "2025-11-04", "2025-11-05"] });
  assert.equal(t.streakWeeks, 1);

  // Los Angeles: late Sunday evening is already Monday in UTC; it still counts for Sunday.
  await asAdmin();
  await q("update teens set timezone = 'America/Los_Angeles' where id = $1", [U]);
  for (const d of ["2025-11-07 18:00", "2025-11-08 18:00", "2025-11-09 23:30"]) await make(U, d, "America/Los_Angeles");
  t = await todayAt(U, "2025-11-10T09:00:00-08:00"); // the next Monday
  assert.equal(t.streakWeeks, 1, "last week's Fri, Sat and Sun count; the new week hasn't broken it");
  assert.deepEqual(t.week.madeDays, []);
});

scenario("streak: travelling never moves a make to a different day", async () => {
  await asAdmin();
  await q("update teens set timezone = 'Asia/Tokyo' where id = $1", [T]);
  await make(T, "2025-11-10 21:00", "Asia/Tokyo"); // Monday in Tokyo
  await make(T, "2025-11-11 21:00", "Asia/Tokyo"); // Tuesday in Tokyo
  // Flies to Los Angeles: Tuesday 21:00 in Tokyo was Tuesday 04:00 there.
  await as(T);
  await q("update teens set timezone = 'America/Los_Angeles' where id = $1", [T]);
  await make(T, "2025-11-12 18:00", "America/Los_Angeles"); // Wednesday in LA
  const t = await todayAt(T, "2025-11-12T20:00:00-08:00");
  assert.deepEqual(t.week.madeDays, ["2025-11-10", "2025-11-11", "2025-11-12"]);
  assert.equal(t.streakWeeks, 1);
});

scenario("streak: gentle rules (3 days a week, one missed day never resets it)", async () => {
  await asAdmin();
  await q("update teens set timezone = 'Europe/London' where id = $1", [T]);
  const tz = "Europe/London";
  // Weeks from Monday 2025-10-06: 3 days, 4 days, then 2 days (one short).
  for (const d of ["2025-10-06", "2025-10-08", "2025-10-12"]) await make(T, `${d} 17:00`, tz);
  for (const d of ["2025-10-13", "2025-10-14", "2025-10-16", "2025-10-19"]) await make(T, `${d} 17:00`, tz);
  await make(T, "2025-10-14 19:00", tz); // a second make the same day adds nothing
  assert.equal((await todayAt(T, "2025-10-19T21:00:00+01:00")).streakWeeks, 2);
  assert.equal((await todayAt(T, "2025-10-20T09:00:00+01:00")).streakWeeks, 2, "a new, empty week doesn't break it");
  assert.equal((await todayAt(T, "2025-10-26T22:00:00+00:00")).streakWeeks, 2, "the last day of an unfinished week still doesn't");
  for (const d of ["2025-10-21", "2025-10-23"]) await make(T, `${d} 17:00`, tz);
  assert.equal((await todayAt(T, "2025-10-27T09:00:00+00:00")).streakWeeks, 0, "a finished week with 2 days does");
  await make(T, "2025-10-27 17:00", tz, { status: "blocked" }); // blocked by the safety scan: doesn't count
  for (const d of ["2025-10-28", "2025-10-29"]) await make(T, `${d} 17:00`, tz);
  assert.equal((await todayAt(T, "2025-10-29T18:00:00+00:00")).streakWeeks, 0);
  await make(T, "2025-10-30 17:00", tz);
  assert.equal((await todayAt(T, "2025-10-30T18:00:00+00:00")).streakWeeks, 1, "3 days this week starts a new streak");
});

scenario("streak: the database agrees with the contract's weeklyStreak", async () => {
  // A seeded pseudo-random history per time zone, checked on every day of it.
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (const tz of ["Pacific/Auckland", "America/Los_Angeles", "Asia/Kathmandu", "America/St_Johns"]) {
    await asAdmin();
    await q("delete from makes where teen_id = $1", [T]);
    await q("update teens set timezone = $1 where id = $2", [tz, T]);
    const start = Date.parse("2025-09-01T00:00:00Z");
    const instants = [];
    for (let i = 0; i < 70; i++) {
      // Weeks alternate between busy and quiet so streaks build and break.
      const t = start + Math.floor(rand() * 70 * 24 * 3600_000);
      const week = Math.floor((t - start) / (7 * 24 * 3600_000));
      if (week % 4 === 3 && rand() < 0.7) continue;
      instants.push(new Date(t));
    }
    await q(
      `insert into makes (teen_id, quest_id, storage_path, status, created_at)
       select $1::uuid, (select id from quests where status = 'approved' limit 1), $1::text || '/' || gen_random_uuid() || '.jpg', 'reviewed', at
       from unnest($2::timestamptz[]) at`,
      [T, instants.map((d) => d.toISOString())],
    );
    for (let day = localDay(new Date(start), tz); day <= "2025-11-15"; day = addDays(day, 1)) {
      const at = new Date(midnight(day, tz).getTime() + 12 * 3600_000);
      const today = localDay(at, tz);
      const made = instants.map((i) => localDay(i, tz));
      const t = await todayAt(T, at);
      assert.equal(t.streakWeeks, weeklyStreak(made, today), `${tz} on ${today}`);
      const week = new Set(weekDays(today));
      assert.deepEqual(t.week.madeDays, [...new Set(made)].filter((d) => week.has(d) && d <= today).sort(), `${tz} week of ${today}`);
    }
  }
});

scenario("madeToday marks a zone done only for today's quest", async () => {
  await asAdmin();
  await q("update teens set timezone = 'UTC' where id = $1", [T]);
  await scheduleDays(["2025-11-03", "2025-11-04"], ["photography", "fashion"]);
  await setZones(T, ["photography", "fashion"]);
  const yesterday = (await one("select quest_id from quest_schedule where day = '2025-11-03' and zone_id = 'photography'")).quest_id;
  const today = (await one("select quest_id from quest_schedule where day = '2025-11-04' and zone_id = 'photography'")).quest_id;
  await q("insert into makes (teen_id, quest_id, storage_path, created_at) values ($1::uuid, $2, $1::text || '/a.jpg', '2025-11-04T10:00:00Z')", [T, yesterday]);
  let t = await todayAt(T, "2025-11-04T12:00:00Z");
  assert.deepEqual(t.zones.map((z) => z.madeToday), [false, false], "a make for yesterday's quest doesn't finish today's");
  await q("insert into makes (teen_id, quest_id, storage_path, created_at) values ($1::uuid, $2, $1::text || '/b.jpg', '2025-11-04T11:00:00Z')", [T, today]);
  t = await todayAt(T, "2025-11-04T12:00:00Z");
  assert.deepEqual(t.zones.map((z) => [z.zone, z.madeToday]), [["photography", true], ["fashion", false]]);
});

// ---------------------------------------------------------------------------
// The app's view

scenario("get_today: a teen gets their own Today, by their own clock", async () => {
  await setZones(T, ["fashion", "photography"]);
  await as(T);
  const t = Today.parse((await one("select get_today() as t")).t);
  const now = (await one("select now() as n")).n;
  assert.equal(t.day, localDay(now, "America/Los_Angeles"));
  assert.equal(t.timezone, "America/Los_Angeles");
  assert.deepEqual(t.zones.map((z) => z.zone), ["photography", "fashion"], "in zone order");
  for (const z of t.zones) assert.equal(z.quest?.zone, z.zone, "the seed schedules a quest for every time zone's today");
  assert.equal(t.zones[0].points, 0);

  await as(P);
  await rejects("select get_today()", [], /no teen profile/);
  await as(null, "anon");
  await rejects("select get_today()", [], /permission denied/);
  await as(T);
  await rejects("select private.today_at($1, now())", [U], /permission denied/);
});

scenario("zones: swap in one step, keep progress, at most three", async () => {
  await as(T);
  await q("select set_teen_zones($1)", [["photography", "fashion", "art_crafts"]]);
  assert.equal(await count("select count(*) n from teen_zones"), 3);
  // A full swap works in one call, even though the table never holds more than three.
  await q("select set_teen_zones($1)", [["art_crafts"]]);
  assert.deepEqual((await q("select zone_id from teen_zones")).rows, [{ zone_id: "art_crafts" }]);
  await q("select set_teen_zones($1)", [["photography", "photography", "art_crafts"]]);
  assert.equal(await count("select count(*) n from teen_zones"), 2, "duplicates count once");

  await rejects("select set_teen_zones($1)", [[]], /at least one/);
  await rejects("select set_teen_zones($1)", [["photography", "fashion", "art_crafts", "music"]], /at most 3/);
  await rejects("select set_teen_zones($1)", [["music"]], /not open/);
  await rejects("select set_teen_zones($1)", [["nope"]], /not open|foreign key/);

  // Points stay with the zone: drop it, come back, the level is still there.
  await asAdmin();
  const quest = (await one("select id from quests where zone_id = 'fashion' and status = 'approved' limit 1")).id;
  const mk = (await one("insert into makes (teen_id, quest_id, storage_path, status) values ($1::uuid, $2, $1::text || '/f.jpg', 'reviewed') returning id", [T, quest])).id;
  const rv = (await one("insert into reviews (make_id, teen_id, worked, try_next, why, confidence, model, prompt_version) values ($1, $2, 'w', 't', 'y', 0.9, 'm', 'v1') returning id", [mk, T])).id;
  await q("insert into skill_points (teen_id, review_id, skill_id, points) values ($1, $2, 'fashion.colour', 2)", [T, rv]);
  await as(T);
  await q("select set_teen_zones($1)", [["fashion"]]);
  await q("select set_teen_zones($1)", [["photography"]]);
  await q("select set_teen_zones($1)", [["photography", "fashion"]]);
  await asAdmin();
  const t = await todayAt(T, new Date());
  assert.equal(t.zones.find((z) => z.zone === "fashion")?.points, 2);

  await as(P);
  await rejects("select set_teen_zones($1)", [["photography"]], /only teens/);
  await as(U);
  await q("select set_teen_zones($1)", [["fashion"]]);
  await as(T);
  assert.equal(await count("select count(*) n from teen_zones where teen_id = $1", [U]), 0, "a teen sees only their own zones");
});

scenario("time zones: only real ones, and the app can't backdate a make", async () => {
  await as(T);
  await q("update teens set timezone = 'Europe/Paris' where id = $1", [T]);
  for (const bad of ["Mars/Olympus", "GMT+5", "Etc/GMT-3", ""]) {
    await rejects("update teens set timezone = $1 where id = $2", [bad, T], /unknown time zone/);
  }
  const quest = (await one("select quest_id from quest_schedule limit 1")).quest_id;
  await rejects(
    "insert into makes (teen_id, quest_id, storage_path, created_at) values ($1::uuid, $2, $1::text || '/x.jpg', '2025-01-01')",
    [T, quest],
    /permission denied/,
  );
  await rejects(
    "insert into makes (teen_id, quest_id, storage_path, local_day) values ($1::uuid, $2, $1::text || '/x.jpg', '2025-01-01')",
    [T, quest],
    /permission denied/,
  );
  const r = await one("insert into makes (teen_id, quest_id, storage_path) values ($1::uuid, $2, $1::text || '/y.jpg') returning local_day::text", [T, quest]);
  assert.equal(r.local_day, localDay(new Date((await one("select now() as n")).n), "Europe/Paris"));

  await asAdmin();
  await rejects(
    "insert into makes (teen_id, quest_id, storage_path, created_at) values ($1::uuid, $2, $1::text || '/z.jpg', now() + interval '1 day')",
    [T, quest],
    /from the future/,
  );
});
