// A9 tests: Plus from store and Stripe events, and its perks, against a real
// Postgres. Events go through the contract's own webhook parsers first. Each
// test runs in its own transaction and rolls back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { Api, fromRevenueCat, fromStripe } from "../packages/contract/src/index.ts";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/quest";
const db = new pg.Client({ connectionString: url });

const T = "00000000-0000-4000-8000-0000000009a1"; // teen, 16–17
const A = "00000000-0000-4000-8000-0000000009a2"; // teen, 18–19
const P = "00000000-0000-4000-8000-0000000009b1"; // T's parent

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

const DAY = 86_400_000;
let n = 0;
const rc = (type, teen, store, days, extra = {}) =>
  fromRevenueCat({ event: { id: `e${++n}`, type, app_user_id: teen, store, expiration_at_ms: Date.now() + days * DAY, environment: "SANDBOX", ...extra } });
const stripe = (type, teen, status, days, extra = {}) =>
  fromStripe({
    id: `evt_${++n}`,
    type,
    livemode: false,
    data: { object: { object: "subscription", status, metadata: { teen_id: teen }, items: { data: [{ current_period_end: Math.floor((Date.now() + days * DAY) / 1000) }] }, ...extra } },
  });

async function apply(e) {
  assert.ok(e, "the parser understood the event");
  await asServer();
  return (await one("select apply_entitlement_event($1, $2, $3, $4, $5, $6) as r", [e.eventId, e.teenId, e.source, e.kind, e.activeUntil, e.sandbox])).r;
}
async function plus(teen) {
  await as(teen);
  return Api["plus.status"].output.parse((await one("select plus_status() as p")).p);
}

function scenario(name, fn) {
  test(name, async () => {
    await q("begin");
    try {
      for (const id of [T, A, P]) await q("insert into auth.users (id) values ($1)", [id]);
      await q("insert into teens (id, handle, age_bracket, country) values ($1, 'SoftKite-31', '16_17', 'US'), ($2, 'NightPanda-90', '18_19', 'CA')", [T, A]);
      await q("insert into parents (id, adult_check, adult_checked_at) values ($1, 'attested', now())", [P]);
      await q("insert into parent_links (teen_id, parent_id, status, consented_at) values ($1, $2, 'active', now())", [T, P]);
      await fn();
    } finally {
      await q("rollback");
    }
  });
}

before(async () => db.connect());
after(async () => db.end());

scenario("A9 done when: buy, renew, cancel and refund work on both stores and the web", async () => {
  // App Store (18–19, in the app): buy, renew, cancel (Plus lasts to the end), expire.
  assert.equal(await apply(rc("INITIAL_PURCHASE", A, "APP_STORE", 30)), "applied");
  assert.deepEqual([(await plus(A)).active, (await plus(A)).source], [true, "app_store"]);
  await apply(rc("RENEWAL", A, "APP_STORE", 60));
  assert.ok(Date.parse((await plus(A)).until) > Date.now() + 59 * DAY);
  await apply(rc("CANCELLATION", A, "APP_STORE", 60, { cancel_reason: "UNSUBSCRIBE" }));
  assert.equal((await plus(A)).active, true, "cancelled: still Plus until the period ends");
  await apply(rc("EXPIRATION", A, "APP_STORE", 0));
  assert.equal((await plus(A)).active, false);

  // Google Play: buy, then a refund ends Plus straight away.
  await apply(rc("INITIAL_PURCHASE", A, "PLAY_STORE", 30));
  assert.equal((await plus(A)).source, "google_play");
  await apply(rc("CANCELLATION", A, "PLAY_STORE", 30, { cancel_reason: "CUSTOMER_SUPPORT" }));
  assert.equal((await plus(A)).active, false, "refunded: Plus stops now");

  // The web (a parent, through Stripe): buy, renew, cancel at period end, end.
  await apply(stripe("customer.subscription.created", T, "active", 30));
  assert.deepEqual([(await plus(T)).active, (await plus(T)).source], [true, "web"]);
  await apply(stripe("customer.subscription.updated", T, "active", 61));
  await apply(stripe("customer.subscription.updated", T, "active", 61, { cancel_at_period_end: true }));
  assert.equal((await plus(T)).active, true);
  // A refund on the web cancels the subscription now, which ends Plus.
  await apply(stripe("customer.subscription.deleted", T, "canceled", 61));
  assert.equal((await plus(T)).active, false);
});

scenario("each event counts once; billing issues wait; unknown teens are recorded, not applied", async () => {
  const buy = rc("INITIAL_PURCHASE", A, "APP_STORE", 30);
  assert.equal(await apply(buy), "applied");
  assert.equal(await apply(buy), "duplicate");
  const exp = rc("EXPIRATION", A, "APP_STORE", 0);
  await apply(exp);
  assert.equal(await apply(exp), "duplicate");
  assert.equal((await plus(A)).active, false);

  await apply(rc("INITIAL_PURCHASE", A, "APP_STORE", 30));
  assert.equal(await apply(rc("BILLING_ISSUE", A, "APP_STORE", 30)), "ignored");
  assert.equal((await plus(A)).active, true, "the store is still retrying");

  assert.equal(await apply(rc("INITIAL_PURCHASE", "00000000-0000-4000-8000-000000000999", "APP_STORE", 30)), "unknown_teen");
  await asAdmin();
  assert.equal(await count("select count(*) n from entitlement_events where applied = false"), 2);
});

scenario("A9 done when: under-18 purchases need a parent's approval", async () => {
  // In the app, only 18–19s are offered Plus; under-18s are sent to a parent.
  assert.equal((await plus(T)).canBuyInApp, false);
  assert.equal((await plus(A)).canBuyInApp, true);
  // The parent buys on the parent page and sees it there.
  await apply(stripe("customer.subscription.created", T, "active", 30));
  await as(P);
  const mine = Api["parent.plus"].output.parse((await one("select parent_plus() as p")).p);
  assert.deepEqual(mine.map((x) => [x.teenId, x.active]), [[T, true]]);
  // Nobody but the server records purchases or reads them.
  for (const who of [T, P]) {
    await as(who);
    await rejects("select apply_entitlement_event('x', $1, 'web', 'active', now() + interval '1 day', false)", [T], /permission denied/);
    await rejects("select * from entitlement_events", [], /permission denied/);
    await rejects("select * from billing_customers", [], /permission denied/);
  }
});

scenario("Plus perks: a second take on a quest, and deeper coaching", async () => {
  await asAdmin();
  const quest = (await one("select quest_id from quest_schedule where day = private.today_for($1) and zone_id = 'photography'", [A])).quest_id;
  await as(A);
  await q("select record_make(gen_random_uuid(), $1, now())", [quest]);
  await rejects("select record_make(gen_random_uuid(), $1, now())", [quest], /already made/);
  await apply(rc("INITIAL_PURCHASE", A, "APP_STORE", 30));
  await as(A);
  await q("select record_make(gen_random_uuid(), $1, now())", [quest]);
  await rejects("select record_make(gen_random_uuid(), $1, now())", [quest], /already made/, "one second take, not more");

  await asAdmin();
  await q("update teens set ai_coach_consent = true where id = $1", [A]);
  const m = (await one("select id from makes where teen_id = $1 limit 1", [A])).id;
  await q("update makes set status = 'scanning' where id = $1", [m]);
  await q("insert into safety_scans (make_id, result, vendor) values ($1, 'pass', 'test')", [m]);
  await q("update makes set status = 'reviewing' where id = $1", [m]);
  await asServer();
  assert.equal((await one("select coach_claim($1) as c", [m])).c.context.plus, true);
});
