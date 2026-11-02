// A1 tests: sign-up, age and parent consent functions, against a real Postgres.
// Each test runs in its own transaction and rolls back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import { modeFor, needsParentConsent } from "../packages/contract/src/age.ts";
import { PARENT_LINK_TTL_DAYS } from "../packages/contract/src/family.ts";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/quest";
const db = new pg.Client({ connectionString: url });

const T = "00000000-0000-4000-8000-0000000001a1"; // teen signing up
const U = "00000000-0000-4000-8000-0000000001a2"; // a second teen
const P = "00000000-0000-4000-8000-0000000001b1"; // parent
const S = "00000000-0000-4000-8000-0000000001b2"; // stranger

const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

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

const createTeen = (bracket, country = "US", source = "store") =>
  one("select * from create_teen_profile($1, $2, $3, null, 'America/Toronto')", [bracket, source, country]);

function scenario(name, fn) {
  test(name, async () => {
    await q("begin");
    try {
      for (const id of [T, U, P, S]) await q("insert into auth.users (id) values ($1)", [id]);
      await fn();
    } finally {
      await q("rollback");
    }
  });
}

before(async () => db.connect());
after(async () => db.end());

scenario("signed-out users can't call the sign-up functions", async () => {
  await as(null, "anon");
  await rejects("select * from create_teen_profile('13_15', 'store', 'US', null, 'UTC')", [], /permission denied/);
  await rejects("select * from create_parent_invite()", [], /permission denied/);
  await rejects("select * from accept_parent_invite('x')", [], /permission denied/);
});

for (const country of ["CA", "US"]) {
  for (const [age, bracket] of [[14, "13_15"], [16, "16_17"], [18, "18_19"], [19, "18_19"]]) {
    for (const wallsLive of [false, true]) {
      scenario(`create profile: ${country}, age ${age}, walls ${wallsLive ? "on" : "off"}`, async () => {
        await asAdmin();
        await q("update app_config set walls_live = $1", [wallsLive]);
        await as(T);
        const r = await createTeen(bracket, country);
        assert.equal(r.mode, modeFor({ country, bracket, wallsLive }), "server agrees with the contract's modeFor");
        assert.equal(r.needs_parent, needsParentConsent(bracket));
        assert.match(r.handle, /^[A-Z][a-z]+[A-Z][a-z]+-\d{2,3}$/);
        const row = await one("select age_bracket, age_source, country, mode, ai_coach_consent from teens");
        assert.deepEqual(row, { age_bracket: bracket, age_source: "store", country, mode: r.mode, ai_coach_consent: false });
        assert.equal(Number((await one("select count(*) n from notification_prefs")).n), 1);
      });
    }
  }
}

scenario("a profile can be made once, never for a parent, and the country must be a code", async () => {
  await as(T);
  await rejects("select * from create_teen_profile('13_15', 'store', 'canada', null, 'UTC')", [], /two-letter/);
  await createTeen("13_15");
  await rejects("select * from create_teen_profile('16_17', 'store', 'US', null, 'UTC')", [], /already exists/);
  await asAdmin();
  await q("insert into parents (id) values ($1)", [P]);
  await as(P);
  await rejects("select * from create_teen_profile('16_17', 'store', 'US', null, 'UTC')", [], /parent account/);
});

scenario("handles are unique", async () => {
  await as(T);
  const a = await createTeen("16_17");
  await as(U);
  const b = await createTeen("16_17");
  assert.notEqual(a.handle, b.handle);
});

scenario("abandoning sign-up deletes the account and keeps nothing", async () => {
  await as(T);
  await q("select abandon_signup()");
  await asAdmin();
  assert.equal(Number((await one("select count(*) n from auth.users where id = $1", [T])).n), 0);
});

scenario("abandoning is refused once a profile exists", async () => {
  await as(T);
  await createTeen("13_15");
  await rejects("select abandon_signup()", [], /account deletion/);
});

scenario(`invites: a 64-character token, only its hash stored, expires in ${PARENT_LINK_TTL_DAYS} days`, async () => {
  await as(T);
  await createTeen("13_15", "CA");
  const inv = await one("select * from create_parent_invite()");
  assert.match(inv.token, /^[0-9a-f]{64}$/);
  const days = (new Date(inv.expires_at) - Date.now()) / 86_400_000;
  assert.ok(Math.abs(days - PARENT_LINK_TTL_DAYS) < 0.01, `expires in ${days} days`);
  await asAdmin();
  const stored = await one("select invite_token_hash from parent_links where teen_id = $1", [T]);
  assert.equal(stored.invite_token_hash, createHash("sha256").update(inv.token).digest("hex"));
  assert.notEqual(stored.invite_token_hash, inv.token);
});

scenario("a new invite cancels the old one", async () => {
  await as(T);
  await createTeen("13_15");
  const first = await one("select * from create_parent_invite()");
  await one("select * from create_parent_invite()");
  await as(P);
  await rejects("select * from accept_parent_invite($1)", [first.token], /not found or expired/);
});

scenario("only teens can create invites", async () => {
  await as(S);
  await rejects("select * from create_parent_invite()", [], /only teens/);
});

scenario("a parent accepts: link active, parent can see the teen, teen sees the link", async () => {
  await as(T);
  const teen = await createTeen("13_15", "CA");
  const inv = await one("select * from create_parent_invite()");
  await as(P);
  await q("select confirm_adult()"); // A8: parents confirm they're adults first
  const r = await one("select * from accept_parent_invite($1)", [inv.token]);
  assert.equal(r.teen_handle, teen.handle);
  assert.equal((await one("select handle from teens")).handle, teen.handle);
  await as(T);
  const link = await one("select status, parent_id, consented_at from parent_links");
  assert.equal(link.status, "active");
  assert.equal(link.parent_id, P);
  assert.ok(link.consented_at);
});

scenario("A1 done-when: a parent link expires after 7 days", async () => {
  await as(T);
  await createTeen("16_17");
  const inv = await one("select * from create_parent_invite()");
  await asAdmin();
  await q("update parent_links set invite_expires_at = now() - interval '1 second' where teen_id = $1", [T]);
  await as(P);
  await rejects("select * from accept_parent_invite($1)", [inv.token], /not found or expired/);
});

scenario("tokens can't be reused, guessed or accepted by a teen", async () => {
  await as(T);
  await createTeen("13_15");
  const inv = await one("select * from create_parent_invite()");
  await as(U);
  await createTeen("16_17");
  await rejects("select * from accept_parent_invite($1)", [inv.token], /cannot be parents/);
  await as(P);
  await rejects("select * from accept_parent_invite($1)", ["0".repeat(64)], /not found or expired/);
  await q("select confirm_adult()"); // A8: parents confirm they're adults first
  await one("select * from accept_parent_invite($1)", [inv.token]);
  await as(S);
  await rejects("select * from accept_parent_invite($1)", [inv.token], /not found or expired/);
});

scenario("the app can't read invite tokens or change consent directly", async () => {
  await as(T);
  await createTeen("13_15");
  await one("select * from create_parent_invite()");
  await rejects("select invite_token_hash from parent_links", [], /permission denied/);
  await rejects("update teens set ai_coach_consent = true where id = $1", [T], /permission denied/);
  await rejects("update app_config set walls_live = true", [], /permission denied/);
});

scenario("AI coach consent: teen on and off, parent off only, strangers never", async () => {
  await as(T);
  await createTeen("13_15");
  const inv = await one("select * from create_parent_invite()");
  await as(P);
  await q("select confirm_adult()"); // A8: parents confirm they're adults first
  await one("select * from accept_parent_invite($1)", [inv.token]);

  await as(T);
  await q("select set_ai_coach_consent(true)");
  let row = await one("select ai_coach_consent, ai_coach_consent_at from teens");
  assert.equal(row.ai_coach_consent, true);
  assert.ok(row.ai_coach_consent_at);

  await as(P);
  await rejects("select set_ai_coach_consent(true, $1)", [T], /off, not on/);
  await q("select set_ai_coach_consent(false, $1)", [T]);
  await as(T);
  row = await one("select ai_coach_consent, ai_coach_consent_at from teens");
  assert.deepEqual(row, { ai_coach_consent: false, ai_coach_consent_at: null });

  await as(S);
  await rejects("select set_ai_coach_consent(false, $1)", [T], /linked parent/);
});

scenario("coach reviews need the teen's yes, plus a parent for under-18s", async () => {
  const allowed = async (id) => (await one("select private.coach_allowed($1) ok", [id])).ok;
  await as(T);
  await createTeen("13_15");
  await q("select set_ai_coach_consent(true)");
  await as(U);
  await createTeen("18_19");
  await asAdmin();
  assert.equal(await allowed(T), false, "13–15 with consent but no parent yet");
  assert.equal(await allowed(U), false, "18–19 without consent");

  await as(U);
  await q("select set_ai_coach_consent(true)");
  await as(T);
  const inv = await one("select * from create_parent_invite()");
  await as(P);
  await q("select confirm_adult()"); // A8: parents confirm they're adults first
  await one("select * from accept_parent_invite($1)", [inv.token]);
  await asAdmin();
  assert.equal(await allowed(T), true, "13–15 with consent and a parent");
  assert.equal(await allowed(U), true, "18–19 with consent");
});
