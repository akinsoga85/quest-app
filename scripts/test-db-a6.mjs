// A6 tests: drafting, approving and rejecting quest weeks, against a real
// Postgres. Each test runs in its own transaction and rolls back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { weekRuleProblems } from "../packages/contract/src/index.ts";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/quest";
const db = new pg.Client({ connectionString: url });

const T = "00000000-0000-4000-8000-0000000006a1";

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

const SKILLS = ["photography.light", "photography.colour", "photography.framing", "photography.story"];
// A week that passes every rule, titled so tests can tell weeks apart.
const week = (weekOf, tag = "") => ({
  zone: "photography",
  weekOf,
  quests: Array.from({ length: 7 }, (_, i) => ({
    zone: "photography",
    title: `Quest ${i + 1}${tag}`,
    brief: "Find one thing at home and photograph it in window light from a low angle.",
    minutes: 10,
    trainsSkill: SKILLS[i % 4],
    tips: ["Turn off the room light"],
  })),
});

// The first Monday after today everywhere on Earth, plus n weeks.
const monday = async (n = 0) => (await one(
  "select ((private.earliest_local_today() + (8 - extract(isodow from private.earliest_local_today())::int)) + 7 * $1::int)::text as d",
  [n],
)).d;
const save = async (w) => (await one("select save_quest_week('photography', $1, $2, 'claude-opus-5-5') as id", [w.weekOf, JSON.stringify(w.quests)])).id;

function scenario(name, fn) {
  test(name, async () => {
    await q("begin");
    try {
      await q("insert into auth.users (id) values ($1)", [T]);
      await q("insert into teens (id, handle, age_bracket, country, timezone) values ($1, 'CopperCrane-64', '16_17', 'US', 'Pacific/Kiritimati')", [T]);
      await fn();
    } finally {
      await q("rollback");
    }
  });
}

before(async () => db.connect());
after(async () => db.end());

scenario("A6 done when: a drafted week with zero rule problems is approved and scheduled", async () => {
  const mon = await monday(1);
  const w = week(mon);
  assert.deepEqual(weekRuleProblems(w), [], "the contract's rules pass the week");
  await asServer();
  const id = await save(w);

  // Drafts are invisible to teens and not scheduled.
  await as(T);
  assert.equal(await count("select count(*) n from quests where title like 'Quest %'"), 0);
  await asAdmin();
  assert.equal(await count("select count(*) n from quest_schedule where day between $1::date and $1::date + 6 and quest_id in (select id from quests where week_id = $2)", [mon, id]), 0);

  await asServer();
  await q("select approve_quest_week($1, 'staff@example.com')", [id]);
  await asAdmin();
  const days = (await q(
    "select s.day::text, q.title, q.status from quest_schedule s join quests q on q.id = s.quest_id where s.zone_id = 'photography' and s.day between $1::date and $1::date + 6 order by s.day",
    [mon],
  )).rows;
  assert.equal(days.length, 7, "one quest per day, Monday to Sunday");
  assert.ok(days.every((d) => d.status === "approved"));
  assert.equal((await one("select status, decided_by from quest_weeks where id = $1", [id])).decided_by, "staff@example.com");
  await rejects("select 1 from (select approve_quest_week($1, 'x')) a", [id], /already approved/);
});

scenario("every fourth week brings back a quest from four weeks earlier (PRD R10)", async () => {
  // Find the next Monday whose ISO week number is a multiple of 4.
  let n = 1;
  while (Number((await one("select extract(week from $1::date)::int as w", [await monday(n)])).w) % 4 !== 0) n++;
  const mon = await monday(n);
  await asAdmin();
  const old = (await one("select id from quests where zone_id = 'photography' and status = 'approved' limit 1")).id;
  await q("insert into quest_schedule (day, zone_id, quest_id) values ($1::date + 3 - 28, 'photography', $2) on conflict (day, zone_id) do update set quest_id = excluded.quest_id", [mon, old]);
  await asServer();
  const id = await save(week(mon, "r"));
  await q("select approve_quest_week($1, 'staff')", [id]);
  await asAdmin();
  assert.equal((await one("select quest_id from quest_schedule where zone_id = 'photography' and day = $1::date + 3", [mon])).quest_id, old);
  assert.equal(await count("select count(*) n from quests where week_id = $1 and status = 'approved'", [id]), 7);
});

scenario("the database refuses weeks that break its rules", async () => {
  const mon = await monday(1);
  await asServer();
  const w = week(mon);
  await rejects("select save_quest_week('photography', $1, $2, 'm')", [mon, JSON.stringify(w.quests.slice(0, 6))], /7 quests/);
  await rejects("select save_quest_week('photography', $1::date + 1, $2, 'm')", [mon, JSON.stringify(w.quests)], /Monday/);
  await rejects("select save_quest_week('music', $1, $2, 'm')", [mon, JSON.stringify(w.quests)], /not open/);
  const otherZone = w.quests.map((x, i) => (i === 2 ? { ...x, trainsSkill: "fashion.colour" } : x));
  await rejects("select save_quest_week('photography', $1, $2, 'm')", [mon, JSON.stringify(otherZone)], /day 3/);
  const started = (await one("select (private.earliest_local_today() - (extract(isodow from private.earliest_local_today())::int - 1))::text as d")).d;
  await rejects("select save_quest_week('photography', $1, $2, 'm')", [started, JSON.stringify(w.quests)], /already started/);
  await save(w);
  await rejects("select save_quest_week('photography', $1, $2, 'm')", [mon, JSON.stringify(week(mon, "b").quests)], /duplicate|unique/);
});

scenario("a rejected week is retired and can be drafted again", async () => {
  const mon = await monday(1);
  await asServer();
  const first = await save(week(mon));
  await q("select reject_quest_week($1, 'staff', 'too samey')", [first]);
  await asAdmin();
  assert.equal(await count("select count(*) n from quests where week_id = $1 and status = 'retired'", [first]), 7);
  await asServer();
  assert.ok(await save(week(mon, "b")));
});

scenario("the writer knows which weeks to draft and which titles to avoid", async () => {
  await asServer();
  const todo = (await q("select zone_id, week_of::text from weeks_to_draft(2)")).rows;
  assert.deepEqual(new Set(todo.map((r) => r.zone_id)), new Set(["photography", "fashion", "art_crafts"]));
  assert.equal(todo.length, 6);
  const mon = await monday(0);
  await save(week(mon));
  assert.equal(await count("select count(*) n from weeks_to_draft(2) where zone_id = 'photography' and week_of = $1", [mon]), 0);
  const titles = (await q("select * from recent_quest_titles('photography')")).rows.map((r) => Object.values(r)[0]);
  assert.ok(titles.includes("Quest 1"), "drafted titles for later weeks");
  assert.ok(titles.includes("Shadows that tell a story"), "titles scheduled recently");
});

scenario("only the server can draft or approve", async () => {
  await as(T);
  await rejects("select save_quest_week('photography', current_date, '[]', 'm')", [], /permission denied/);
  await rejects("select approve_quest_week(gen_random_uuid(), 'me')", [], /permission denied/);
  await rejects("select * from quest_weeks", [], /permission denied/);
});
