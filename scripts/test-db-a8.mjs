// A8 tests: sharing with family, cheers, consent and the parent page, against
// a real Postgres. Each test runs in its own transaction and rolls back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { Api } from "../packages/contract/src/index.ts";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/quest";
const db = new pg.Client({ connectionString: url });

const T = "00000000-0000-4000-8000-0000000008a1"; // teen
const U = "00000000-0000-4000-8000-0000000008a2"; // another teen
const M = "00000000-0000-4000-8000-0000000008b1"; // T's mum
const D = "00000000-0000-4000-8000-0000000008b2"; // T's dad
const X = "00000000-0000-4000-8000-0000000008b3"; // U's parent

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

let quest;
async function make(teen, status = "reviewed") {
  await asAdmin();
  return (await one(
    "insert into makes (teen_id, quest_id, storage_path, status) values ($1::uuid, $2, $1::text || '/' || gen_random_uuid() || '.jpg', $3) returning id",
    [teen, quest, status],
  )).id;
}
const feed = async () => Api["parent.feed"].output.parse((await one("select parent_feed() as f")).f);

function scenario(name, fn) {
  test(name, async () => {
    await q("begin");
    try {
      for (const id of [T, U, M, D, X]) await q("insert into auth.users (id) values ($1)", [id]);
      await q("insert into teens (id, handle, age_bracket, country) values ($1, 'BlueFox-482', '13_15', 'CA'), ($2, 'MintOwl-77', '16_17', 'US')", [T, U]);
      await q("insert into parents (id, display_name, adult_check, adult_checked_at) values ($1, 'Mom', 'attested', now()), ($2, 'Dad', 'attested', now()), ($3, 'Parent', 'attested', now())", [M, D, X]);
      await q(
        "insert into parent_links (teen_id, parent_id, status, consented_at) values ($1, $2, 'active', now()), ($1, $3, 'active', now()), ($4, $5, 'active', now())",
        [T, M, D, U, X],
      );
      quest = (await one("select id from quests where zone_id = 'photography' and status = 'approved' limit 1")).id;
      await fn();
    } finally {
      await q("rollback");
    }
  });
}

before(async () => db.connect());
after(async () => db.end());

scenario("A8 done when: a parent sees only the makes sent to them, and can send one cheer back", async () => {
  const sent = await make(T);
  const kept = await make(T); // reviewed, never sent
  const other = await make(U);

  await as(T);
  assert.equal((await one("select share_with_family($1) as n", [sent])).n, 2, "to both linked parents");
  assert.equal((await one("select share_with_family($1) as n", [sent])).n, 0, "sending again changes nothing");
  await as(U);
  await q("select share_with_family($1)", [other]);

  await as(M);
  const items = await feed();
  assert.deepEqual(items.map((i) => [i.makeId, i.teenHandle, i.cheer]), [[sent, "BlueFox-482", null]]);
  // Nothing else of the teen's: not the kept make, not the other teen's, not reviews.
  assert.deepEqual((await q("select id from makes")).rows.map((r) => r.id), [sent]);
  assert.equal(await count("select count(*) n from makes where id = $1", [kept]), 0);
  assert.equal(await count("select count(*) n from reviews"), 0);
  assert.equal(await count("select count(*) n from skill_points"), 0);

  // One cheer, from the five, once.
  await q("select cheer_share($1, 'great_light')", [items[0].shareId]);
  await rejects("select cheer_share($1, 'love_this')", [items[0].shareId], /already cheered/);
  await rejects("select cheer_share($1, 'hello')", [items[0].shareId], /invalid input value/);
  assert.equal((await feed())[0].cheer, "great_light");

  // Dad cheers his own share; nobody can cheer a share sent to someone else.
  await as(D);
  const dads = await feed();
  await q("select cheer_share($1, 'clever_idea')", [dads[0].shareId]);
  await as(X);
  await rejects("select cheer_share($1, 'love_this')", [items[0].shareId], /not found/);
  assert.deepEqual((await feed()).map((i) => i.makeId), [other]);

  // The teen sees both cheers.
  await as(T);
  const status = Api["family.status"].output.parse((await one("select get_family_status($1) as s", [sent])).s);
  assert.deepEqual(status, { parents: [{ name: "Mom" }, { name: "Dad" }], sent: true, cheers: ["great_light", "clever_idea"] });
});

scenario("only reviewed makes, only to linked parents; an unlinked parent loses access", async () => {
  const early = await make(T, "uploaded");
  const done = await make(T);
  await as(T);
  await rejects("select share_with_family($1)", [early], /reviewed makes/);
  await as(U);
  await rejects("select share_with_family($1)", [done], /reviewed makes/);
  await as(T);
  await q("select share_with_family($1)", [done]);

  // Mum's link is revoked: she sees nothing more, even what was sent before.
  await asAdmin();
  await q("update parent_links set status = 'revoked' where teen_id = $1 and parent_id = $2", [T, M]);
  const mumsShare = (await one("select id from family_shares where make_id = $1 and parent_id = $2", [done, M])).id;
  await as(M);
  assert.deepEqual(await feed(), []);
  await rejects("select cheer_share($1, 'love_this')", [mumsShare], /not found|linked/);

  // A teen with no linked parent can't send.
  await asAdmin();
  await q("update parent_links set status = 'revoked' where teen_id = $1", [T]);
  const later = await make(T);
  await as(T);
  await rejects("select share_with_family($1)", [later], /no parent is linked/);
});

scenario("consent: preview signed out, then confirm being an adult and accept", async () => {
  await asAdmin();
  await q("update parent_links set status = 'revoked' where teen_id = $1", [T]);
  await as(T);
  const inv = (await one("select * from create_parent_invite()")).token;

  await as(null, "anon");
  assert.deepEqual(Api["parent.preview"].output.parse((await one("select invite_preview($1) as p", [inv])).p)?.teenHandle, "BlueFox-482");
  assert.equal((await one("select invite_preview($1) as p", ["0".repeat(64)])).p, null);

  // A new parent (no adult check yet) can't accept without it.
  await asAdmin();
  const NEW = "00000000-0000-4000-8000-0000000008c1";
  await q("insert into auth.users (id) values ($1)", [NEW]);
  await as(NEW);
  await rejects("select * from accept_parent_invite($1)", [inv], /confirm you're an adult/);
  await rejects("select give_parent_consent($1, false)", [inv], /adult/);
  const r = (await one("select give_parent_consent($1, true) as r", [inv])).r;
  assert.deepEqual(r, { teenHandle: "BlueFox-482" });
  assert.equal((await one("select adult_check from parents where id = $1", [NEW])).adult_check, "attested");
  await as(T);
  await rejects("select confirm_adult()", [], /teen accounts/);
});

scenario("the parent page: this week's quests and levels, weekly email, coach off", async () => {
  await asAdmin();
  await q("insert into teen_zones (teen_id, zone_id) values ($1, 'photography')", [T]);
  const m = (await one("insert into makes (teen_id, quest_id, storage_path, status) values ($1::uuid, $2, $1::text || '/w.jpg', 'scanning') returning id", [T, quest])).id;
  await q("insert into safety_scans (make_id, result, vendor) values ($1, 'pass', 'test')", [m]);
  await q("update makes set status = 'reviewing' where id = $1", [m]);
  await q("update teens set ai_coach_consent = true where id = $1", [T]);
  await as(M);
  const o = Api["parent.overview"].output.parse((await one("select parent_overview() as o")).o);
  assert.equal(o.weeklyEmail, true);
  assert.deepEqual(o.teens.map((t) => [t.handle, t.questsThisWeek, t.coachOn, t.zones]), [["BlueFox-482", 1, true, [{ zone: "photography", points: 1 }]]]);
  await q("select set_weekly_email(false)");
  assert.equal(Api["parent.overview"].output.parse((await one("select parent_overview() as o")).o).weeklyEmail, false);
  await q("select set_ai_coach_consent(false, $1)", [T]);
  assert.equal(Api["parent.overview"].output.parse((await one("select parent_overview() as o")).o).teens[0].coachOn, false);
  await as(X);
  assert.deepEqual(Api["parent.overview"].output.parse((await one("select parent_overview() as o")).o).teens.map((t) => t.handle), ["MintOwl-77"]);
});
