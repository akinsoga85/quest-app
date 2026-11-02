// A11 tests: the admin site's functions, account deletion and export,
// against a real Postgres. Each test runs in its own transaction and rolls back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { DueDeletion, runDeletions } from "../packages/ops/src/deletions.ts";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/quest";
const db = new pg.Client({ connectionString: url });

const T = "00000000-0000-4000-8000-0000000011a1"; // teen
const P = "00000000-0000-4000-8000-0000000011b1"; // T's parent
const S = "00000000-0000-4000-8000-0000000011c1"; // staff

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

let quest;
async function make(status = "reviewed", created = "now()") {
  await asAdmin();
  return (await one(
    `insert into makes (teen_id, quest_id, storage_path, status, created_at) values ($1::uuid, $2, $1::text || '/' || gen_random_uuid() || '.jpg', $3, ${created}) returning id`,
    [T, quest, status],
  )).id;
}
async function queued(reasons, source = "scan", result = "human_review") {
  const m = await make("held_for_review");
  await q("insert into safety_queue (make_id, source, result, reasons) values ($1, $2, $3, $4)", [m, source, result, reasons]);
  return m;
}

function scenario(name, fn) {
  test(name, async () => {
    await q("begin");
    try {
      for (const id of [T, P, S]) await q("insert into auth.users (id) values ($1)", [id]);
      await q("insert into teens (id, handle, age_bracket, country) values ($1, 'QuietOtter-42', '16_17', 'US')", [T]);
      await q("insert into parents (id, display_name, adult_check, adult_checked_at) values ($1, 'Mom', 'attested', now())", [P]);
      await q("insert into parent_links (teen_id, parent_id, status, consented_at) values ($1, $2, 'active', now())", [T, P]);
      await q("insert into staff (user_id, email, role) values ($1, 'staff@example.com', 'admin')", [S]);
      quest = (await one("select id from quests where zone_id = 'photography' and status = 'approved' limit 1")).id;
      await fn();
    } finally {
      await q("rollback");
    }
  });
}

before(async () => db.connect());
after(async () => db.end());

scenario("A11 done when: quest approval works in the admin", async () => {
  await asServer();
  const mon = (await one("select ((private.earliest_local_today() + (8 - extract(isodow from private.earliest_local_today())::int)))::text as d")).d;
  const skills = ["photography.light", "photography.colour", "photography.framing", "photography.story"];
  const quests = Array.from({ length: 7 }, (_, i) => ({ zone: "photography", title: `Admin quest ${i + 1}`, brief: "A quest to approve in the admin site, one per day.", minutes: 10, trainsSkill: skills[i % 4], tips: [] }));
  const week = (await one("select save_quest_week('photography', $1, $2, 'm') as id", [mon, JSON.stringify(quests)])).id;
  await as(S);
  const drafts = (await one("select admin_quest_weeks('draft') as w")).w;
  assert.deepEqual(drafts.map((w) => [w.id, w.quests.length]), [[week, 7]]);
  await q("select admin_decide_week($1, true)", [week]);
  assert.equal((await one("select admin_quest_weeks('approved') as w")).w[0].id, week);
  await asAdmin();
  assert.equal((await one("select decided_by from quest_weeks where id = $1", [week])).decided_by, "staff@example.com");
  for (const who of [T, P]) {
    await as(who);
    await rejects("select admin_quest_weeks('draft')", [], /staff only/);
    await rejects("select admin_decide_week($1, true)", [week], /staff only/);
  }
});

scenario("A11 done when: the safety queue works", async () => {
  const borderline = await queued(["nudity:0.35"]);
  const known = await queued(["hash_match:vendor-1"], "scan", "block");
  const concern = await queued(["coach_concern"], "coach");
  const remove = await queued(["violence:0.6"]);
  await as(S);
  const items = (await one("select admin_safety_queue() as q")).q;
  assert.deepEqual(new Set(items.map((i) => i.makeId)), new Set([borderline, known, concern, remove]));
  const id = (m) => items.find((i) => i.makeId === m).id;

  // A person checks it and it's fine: it goes back to the coach.
  await q("select admin_resolve_safety($1, 'released')", [id(borderline)]);
  // Known abuse imagery can never be released.
  await rejects("select admin_resolve_safety($1, 'released')", [id(known)], /never be released/);
  await q("select admin_resolve_safety($1, 'reported')", [id(known)]);
  await q("select admin_resolve_safety($1, 'kept_blocked')", [id(concern)]);
  const path = (await one("select admin_resolve_safety($1, 'removed') as p", [id(remove)])).p;
  assert.match(path, new RegExp(`^${T}/`), "the admin site removes the photo from storage");

  await asAdmin();
  const status = async (m) => (await one("select status from makes where id = $1", [m]))?.status ?? "deleted";
  assert.deepEqual([await status(borderline), await status(known), await status(concern), await status(remove)], ["reviewing", "blocked", "blocked", "deleted"]);
  assert.equal((await one("select vendor from safety_scans where make_id = $1", [borderline])).vendor, "staff:staff@example.com");
  await as(S);
  assert.deepEqual((await one("select admin_safety_queue() as q")).q, []);
  await as(T);
  await rejects("select admin_safety_queue()", [], /staff only/);
});

scenario("A11 done when: the 1% coach spot check works", async () => {
  // 600 reviews this week: 1% is 6.
  await asAdmin();
  const week = (await one("select (current_date - (extract(isodow from current_date)::int - 1))::text as d")).d;
  await q(
    `with m as (
       insert into makes (teen_id, quest_id, storage_path, status)
       select $1::uuid, $2, $1::text || '/s' || n || '.jpg', 'reviewed' from generate_series(1, 600) n returning id)
     insert into reviews (make_id, teen_id, worked, try_next, why, confidence, model, prompt_version, created_at)
     select id, $1, 'w', 't', 'y', 0.8, 'm', 'v', $3::date + interval '1 hour' from m`,
    [T, quest, week],
  );
  await as(S);
  const sample = (await one("select admin_spot_check($1) as s", [week])).s;
  assert.equal(sample.length, 6);
  assert.deepEqual((await one("select admin_spot_check($1) as s", [week])).s.map((x) => x.reviewId), sample.map((x) => x.reviewId), "the same sample every time");
  // Grading, with the four scores and whether a guardrail broke.
  await q("select admin_grade_review($1, 5, 4, 5, 3, false, 'Specific and kind.')", [sample[0].reviewId]);
  await rejects("select admin_grade_review($1, 6, 4, 5, 3, false, '')", [sample[1].reviewId], /check/);
  const graded = (await one("select admin_spot_check($1) as s", [week])).s.find((x) => x.reviewId === sample[0].reviewId);
  assert.deepEqual([graded.grade.specific, graded.grade.grader, graded.grade.guardrail_break], [5, "staff@example.com", false]);
  // A quiet week still gets at least 5 (or all of them).
  assert.equal((await one("select admin_spot_check($1::date - 7) as s", [week])).s.length, 0);
});

scenario("A11 done when: account deletion works, with 7 days to change your mind", async () => {
  const kept = await make("reviewed");
  await as(T);
  const r = (await one("select request_account_deletion() as r")).r;
  assert.ok(Date.parse(r.completesBy) - Date.now() > 29 * 86400000, "finishes within 30 days");
  assert.deepEqual((await one("select request_account_deletion() as r")).r.requestId, r.requestId, "asking twice is one request");
  // Not due yet; cancelling works within the 7 days.
  await asServer();
  assert.deepEqual((await one("select deletions_due() as d")).d, []);
  await as(T);
  await q("select cancel_account_deletion()");
  assert.equal((await one("select my_deletion() as d")).d, null);

  // Asked again, and 8 days pass: the job empties the folder, then deletes.
  await q("select request_account_deletion()");
  await asAdmin();
  await q("update deletion_requests set requested_at = now() - interval '8 days' where user_id = $1 and cancelled_at is null", [T]);
  await asServer();
  const due = (await one("select deletions_due() as d")).d;
  assert.deepEqual(due, [{ userId: T, folder: T }]);
  await q("select complete_deletion($1)", [T]);
  await asAdmin();
  for (const t of ["teens", "teen_zones", "makes", "reviews", "skill_points", "postcards", "parent_links", "family_shares", "notification_prefs", "push_tokens", "entitlements"]) {
    const col = t === "teens" ? "id" : "teen_id";
    assert.equal(await count(`select count(*) n from ${t} where ${col} = $1`, [T]), 0, t);
  }
  assert.equal(await count("select count(*) n from makes where id = $1", [kept]), 0);
  assert.equal(await count("select count(*) n from deletion_requests where user_id = $1 and completed_at is not null", [T]), 1, "the record that it was done stays");
});

scenario("the real deletion job: Plus stopped, photos removed, account gone, others untouched", async () => {
  const mine = await make("reviewed");
  await asAdmin();
  const other = "00000000-0000-4000-8000-0000000011a2";
  await q("insert into auth.users (id) values ($1)", [other]);
  await q("insert into teens (id, handle, age_bracket, country) values ($1, 'LoudHeron-71', '18_19', 'CA')", [other]);
  const path = (await one("select storage_path from makes where id = $1", [mine])).storage_path;
  const storage = new Set([path, `${T}/extra.jpg`, `${other}/keep.jpg`]);
  const billing = [];
  const deps = {
    due: async (now) => {
      await asServer();
      return DueDeletion.array().parse((await one("select deletions_due($1) as d", [now.toISOString()])).d);
    },
    cancelBilling: async (u) => (billing.push(u), 1),
    listFolder: async (f) => [...storage].filter((p) => p.startsWith(`${f}/`)).slice(0, 1),
    removeFiles: async (paths) => paths.forEach((p) => storage.delete(p)),
    complete: async (u) => {
      await asServer();
      await q("select complete_deletion($1)", [u]);
    },
    now: () => new Date(Date.now() + 8 * 86400000), // 8 days from now
  };
  await as(T);
  await q("select request_account_deletion()");
  const run = await runDeletions(deps);
  assert.deepEqual(run, { deleted: [T], photosRemoved: 2, subscriptionsCancelled: 1, failed: [] });
  assert.deepEqual([...storage], [`${other}/keep.jpg`]);
  assert.deepEqual(billing, [T]);
  await asAdmin();
  assert.equal(await count("select count(*) n from teens where id in ($1, $2)", [T, other]), 1);
  // The next run has nothing to do.
  assert.deepEqual((await runDeletions(deps)).deleted, []);
});

scenario("deletion waits while a safety report needs the evidence", async () => {
  await queued(["hash_match:vendor-1"], "scan", "block");
  await as(T);
  await q("select request_account_deletion()");
  await asAdmin();
  await q("update deletion_requests set requested_at = now() - interval '8 days' where user_id = $1", [T]);
  await asServer();
  assert.deepEqual((await one("select deletions_due() as d")).d, []);
  await as(S);
  assert.match((await one("select admin_deletions() as d")).d[0].held, /safety report/);
});

scenario("A11 done when: export works for teens and parents", async () => {
  const m = await make("reviewed");
  await asAdmin();
  const r = (await one("insert into reviews (make_id, teen_id, worked, try_next, why, confidence, model, prompt_version) values ($1, $2, 'Clean diagonals.', 'Get lower.', 'Edges lead the eye.', 0.9, 'm', 'v') returning id", [m, T])).id;
  await q("insert into skill_points (teen_id, review_id, skill_id, points) values ($1, $2, 'photography.light', 2)", [T, r]);
  await make("blocked");
  await as(T);
  const e = (await one("select export_my_data() as e")).e;
  assert.equal(e.kind, "teen");
  assert.equal(e.profile.handle, "QuietOtter-42");
  assert.deepEqual(e.makes.map((x) => [x.id, x.review?.worked, x.review?.skillPoints]), [[m, "Clean diagonals.", { "photography.light": 2 }]]);
  await as(P);
  const pe = (await one("select export_my_data() as e")).e;
  assert.deepEqual([pe.kind, pe.linkedTeens.map((t) => t.handle)], ["parent", ["QuietOtter-42"]]);
  await as(S);
  await rejects("select export_my_data()", [], /nothing to export/);
  await as(T);
  await rejects("select * from staff", [], /permission denied/);
  await rejects("select * from review_grades", [], /permission denied/);
});
