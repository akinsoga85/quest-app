// A4 tests: the coach's claim and save functions and the app's review reads,
// against a real Postgres. Each test runs in its own transaction and rolls back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { Api, CoachClaim, Today } from "../packages/contract/src/index.ts";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/quest";
const db = new pg.Client({ connectionString: url });

const T = "00000000-0000-4000-8000-0000000004a1"; // teen, 16–17
const A = "00000000-0000-4000-8000-0000000004a2"; // teen, 18–19
const P = "00000000-0000-4000-8000-0000000004b1"; // T's parent

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

const REVIEW = {
  worked: "The blind throws clean diagonal stripes across the wall, and the shadow is the subject.",
  tryNext: "Next time, get lower and tilt up so the stripes run in from a corner of the frame.",
  why: "Diagonals that start at an edge pull the eye through the picture.",
  question: "What would change if something moved through the light?",
  skillPoints: [{ skill: "photography.light", points: 2 }, { skill: "photography.framing", points: 1 }],
  lessonId: "photography.framing.leading-lines",
  confidence: 0.86,
};

// A teen's make for today's photography quest, waiting for the coach: the
// safety scan (A5) has passed it.
async function makeFor(teen, { status = "reviewing" } = {}) {
  await asAdmin();
  const quest = (await one(
    `select qs.quest_id from quest_schedule qs where qs.zone_id = 'photography' and qs.day = private.today_for($1)`,
    [teen],
  )).quest_id;
  const id = (await one(
    `insert into makes (teen_id, quest_id, storage_path, status) values ($1::uuid, $2, $1::text || '/' || gen_random_uuid() || '.jpg', $3) returning id`,
    [teen, quest, status === "reviewing" ? "scanning" : status],
  )).id;
  if (status === "reviewing") {
    await q("insert into safety_scans (make_id, result, vendor) values ($1, 'pass', 'test')", [id]);
    await q("update makes set status = 'reviewing' where id = $1", [id]);
  }
  return id;
}

const claim = async (makeId) => CoachClaim.parse((await one("select coach_claim($1) as c", [makeId])).c);
const reviewState = async (makeId) => Api["review.forMake"].output.parse((await one("select get_review($1) as r", [makeId])).r);

function scenario(name, fn) {
  test(name, async () => {
    await q("begin");
    try {
      for (const id of [T, A, P]) await q("insert into auth.users (id) values ($1)", [id]);
      await q(
        `insert into teens (id, handle, age_bracket, country, timezone) values
           ($1, 'QuietOtter-42', '16_17', 'US', 'America/Chicago'), ($2, 'AmberLark-19', '18_19', 'CA', 'America/Vancouver')`,
        [T, A],
      );
      await q("insert into teen_zones (teen_id, zone_id) values ($1, 'photography'), ($2, 'photography')", [T, A]);
      await q("insert into parents (id) values ($1)", [P]);
      await fn();
    } finally {
      await q("rollback");
    }
  });
}

before(async () => db.connect());
after(async () => db.end());

scenario("A4 done when: no review without ai_coach_consent", async () => {
  const make = await makeFor(T);

  // No consent at all: the coach gets nothing, not even the photo's path.
  await asServer();
  assert.deepEqual(await claim(make), { consent: false });
  await rejects("select coach_save_review($1, $2, 'm', 'v1')", [make, REVIEW], /no coach consent/);
  await rejects("select coach_save_outcome($1, 'retake', 'Too blurry to see the shadows.', null, 'm')", [make], /no coach consent/);
  await as(T);
  assert.deepEqual(await reviewState(make), { state: "no_consent" });

  // The teen says yes, but they're under 18 and no parent has: still nothing.
  await q("select set_ai_coach_consent(true)");
  await asServer();
  assert.deepEqual(await claim(make), { consent: false });
  assert.equal(await count("select count(*) n from coach_pending(100) id where id = $1", [make]), 0);

  // A parent links: now the coach can review.
  await asAdmin();
  await q("insert into parent_links (teen_id, parent_id, status, consented_at) values ($1, $2, 'active', now())", [T, P]);
  await asServer();
  assert.equal(await count("select count(*) n from coach_pending(100) id where id = $1", [make]), 1);
  const c = await claim(make);
  assert.equal(c?.consent, true);
  await as(T);
  assert.deepEqual(await reviewState(make), { state: "pending" });

  // The parent switches it off while the coach is working: nothing is saved.
  await as(P);
  await q("select set_ai_coach_consent(false, $1)", [T]);
  await asServer();
  await rejects("select coach_save_review($1, $2, 'm', 'v1')", [make, REVIEW], /no coach consent/);
  await asAdmin();
  assert.equal(await count("select count(*) n from reviews"), 0);
});

scenario("18–19s need only their own yes; a saved review comes back to the app", async () => {
  await asAdmin();
  await q("update teens set ai_coach_consent = true where id = $1", [A]);
  const make = await makeFor(A);
  await asServer();
  const c = await claim(make);
  assert.equal(c?.consent, true);
  const rid = (await one("select coach_save_review($1, $2, 'claude-opus-5-5', 'coach-v1') as id", [make, REVIEW])).id;
  await as(A);
  const state = await reviewState(make);
  assert.equal(state.state, "ready");
  assert.deepEqual(state.state === "ready" && state.review, {
    ...REVIEW,
    skillPoints: [...REVIEW.skillPoints].sort((x, y) => x.skill.localeCompare(y.skill)),
  });
  assert.equal(state.state === "ready" && state.reviewId, rid);
  // 3 skill points + 1 for finishing the quest (A7).
  assert.equal(await count("select count(*) n from zone_progress where zone_id = 'photography' and points = 4"), 1);

  // "Was this helpful?" — own reviews only.
  await q("select rate_review($1, true)", [rid]);
  assert.equal((await reviewState(make)).helpful, true);
  await as(T);
  await rejects("select rate_review($1, false)", [rid], /not found/);
  await rejects("select get_review($1)", [make], /not found/);
});

scenario("the coach sees the quest and craft history, and nothing personal", async () => {
  await asAdmin();
  await q("update teens set ai_coach_consent = true where id = $1", [A]);
  // Six earlier reviewed makes, so only the newest five tips come through.
  const quest = (await one("select id from quests where zone_id = 'photography' and status = 'approved' limit 1")).id;
  for (let i = 1; i <= 6; i++) {
    const m = (await one(
      `insert into makes (teen_id, quest_id, storage_path, status, created_at) values ($1::uuid, $2, $1::text || '/old' || $3 || '.jpg', 'reviewed', now() - ($3 || ' days')::interval) returning id`,
      [A, quest, String(10 - i)],
    )).id;
    const r = (await one(
      `insert into reviews (make_id, teen_id, worked, try_next, why, confidence, model, prompt_version, created_at)
       values ($1, $2, 'w', $3, 'y', 0.9, 'm', 'v', now() - ($4 || ' days')::interval) returning id`,
      [m, A, `Tip ${i}`, String(10 - i)],
    )).id;
    await q("insert into skill_points (teen_id, review_id, skill_id, points) values ($1, $2, 'photography.light', 1)", [A, r]);
  }
  const make = await makeFor(A);
  await asServer();
  const c = await claim(make);
  assert.ok(c && c.consent);
  const ctx = c.context;
  assert.equal(ctx.zone, "photography");
  assert.equal(ctx.zonePoints, 13, "6 skill points + 7 quests finished, this one included (A7)");
  assert.deepEqual(ctx.history, { questsDone: 6, skillPoints: { "photography.light": 6 }, recentTips: ["Tip 6", "Tip 5", "Tip 4", "Tip 3", "Tip 2"] });
  assert.match(ctx.storagePath, new RegExp(`^${A}/`));
  assert.doesNotMatch(JSON.stringify(ctx), /AmberLark|Vancouver|CA|18_19/, "no handle, place or age");
});

scenario("one worker at a time; a stuck claim frees up after 3 minutes", async () => {
  await asAdmin();
  await q("update teens set ai_coach_consent = true where id = $1", [A]);
  const make = await makeFor(A);
  await asServer();
  assert.equal((await claim(make))?.consent, true);
  assert.equal(await claim(make), null, "a second worker gets nothing");
  assert.equal(await count("select count(*) n from coach_pending(100)"), 0);
  await asAdmin();
  await q("update makes set review_started_at = now() - interval '4 minutes' where id = $1", [make]);
  await asServer();
  assert.equal((await claim(make))?.consent, true);
  // Not waiting for the coach (not scanned yet, or already done): nothing to do.
  const early = await makeFor(A, { status: "uploaded" });
  await asServer();
  assert.equal(await claim(early), null);
});

scenario("a review must match the contract, or nothing is saved", async () => {
  await asAdmin();
  await q("update teens set ai_coach_consent = true where id = $1", [A]);
  const make = await makeFor(A);
  await asServer();
  await claim(make);
  const bad = [
    [{ ...REVIEW, worked: "Too short." }, /contract/],
    [{ ...REVIEW, question: "x".repeat(161) }, /contract/],
    [{ ...REVIEW, confidence: 1.5 }, /contract/],
    [{ ...REVIEW, skillPoints: [] }, /one or two skills/],
    [{ ...REVIEW, skillPoints: [{ skill: "photography.light", points: 1 }, { skill: "photography.colour", points: 1 }, { skill: "photography.story", points: 1 }] }, /one or two skills/],
    [{ ...REVIEW, skillPoints: [{ skill: "fashion.colour", points: 1 }] }, /does not belong/],
    [{ ...REVIEW, skillPoints: [{ skill: "photography.light", points: 3 }] }, /check/],
  ];
  for (const [review, pattern] of bad) await rejects("select coach_save_review($1, $2, 'm', 'v1')", [make, review], pattern);
  await asAdmin();
  assert.equal(await count("select count(*) n from reviews"), 0);
  assert.equal((await one("select status from makes where id = $1", [make])).status, "reviewing");
});

scenario("retake, concern and unavailable outcomes", async () => {
  await asAdmin();
  await q("update teens set ai_coach_consent = true where id = $1", [A]);

  // Retake: the quest opens again and a new photo can be saved.
  const blurry = await makeFor(A);
  await asServer();
  await claim(blurry);
  await q("select coach_save_outcome($1, 'retake', 'It''s too blurry to see the shadows. Hold steady and try again?', null, 'm')", [blurry]);
  await as(A);
  assert.deepEqual(await reviewState(blurry), { state: "retake", reason: "It's too blurry to see the shadows. Hold steady and try again?" });
  const today = Today.parse((await one("select get_today() as t")).t);
  assert.equal(today.zones[0].madeToday, false);
  assert.deepEqual(today.zones[0].make, { id: blurry, status: "retake" });
  const questId = today.zones[0].quest.id;
  await q("select record_make(gen_random_uuid(), $1, now())", [questId]);

  // Concern: held for a person; the note is for the safety team only.
  const worrying = await makeFor(A);
  await asServer();
  await claim(worrying);
  await q("select coach_save_outcome($1, 'concern', 'Possible self-harm reference in the background.', null, 'm')", [worrying]);
  await as(A);
  assert.deepEqual(await reviewState(worrying), { state: "held" });
  await rejects("select * from coach_flags", [], /permission denied/);
  await asAdmin();
  assert.equal(await count("select count(*) n from coach_flags where make_id = $1", [worrying]), 1);

  // Unavailable: a lesson instead.
  const tricky = await makeFor(A);
  await asServer();
  await claim(tricky);
  await q("select coach_save_outcome($1, 'unavailable', null, 'photography.light.side-light', 'm')", [tricky]);
  await as(A);
  assert.deepEqual(await reviewState(tricky), { state: "unavailable", lessonId: "photography.light.side-light" });

  await asServer();
  await rejects("select coach_save_outcome($1, 'retake', 'Again?', null, 'm')", [tricky], /isn't waiting/);
});

scenario("the app can't call the coach's functions", async () => {
  const make = await makeFor(A);
  await as(A);
  for (const sql of [
    "select coach_claim($1)",
    "select coach_save_review($1, '{}'::jsonb, 'm', 'v')",
    "select coach_save_outcome($1, 'retake', 'nope nope nope', null, 'm')",
  ]) {
    await rejects(sql, [make], /permission denied/);
  }
  await rejects("select coach_pending(5)", [], /permission denied/);
  await as(null, "anon");
  await rejects("select get_review($1)", [make], /permission denied/);
});
