// Production wiring (migration 20261114120100): a new photo calls the safety
// scan, a passed scan calls the coach, with the URL and secret from Vault.
// pg_net and Vault are stood in for inside each (rolled back) test.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/quest";
const db = new pg.Client({ connectionString: url });
const T = "00000000-0000-4000-8000-0000000014a1";

const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

async function standIns({ secrets = true } = {}) {
  await q("create schema net");
  await q("create table net.calls (url text, headers jsonb, body jsonb)");
  await q(`create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
           returns bigint language sql as $$ insert into net.calls values (url, headers, body); select 1::bigint $$`);
  await q("create schema vault");
  await q("create table vault.decrypted_secrets (name text, decrypted_secret text)");
  if (secrets) {
    await q(`insert into vault.decrypted_secrets values
      ('functions_url', 'https://ref.supabase.co/functions/v1/'), ('safety_secret', 's-safe'), ('coach_secret', 's-coach')`);
  }
}

function scenario(name, fn) {
  test(name, async () => {
    await q("begin");
    try {
      await q("insert into auth.users (id) values ($1)", [T]);
      await q("insert into teens (id, handle, age_bracket, country, ai_coach_consent) values ($1, 'NeatFox-21', '18_19', 'US', true)", [T]);
      await fn();
    } finally {
      await q("rollback");
    }
  });
}

before(async () => db.connect());
after(async () => db.end());

scenario("a new photo calls the safety scan, and a passed scan calls the coach", async () => {
  await standIns();
  const quest = (await one("select id from quests where status = 'approved' limit 1")).id;
  const m = (await one("insert into makes (teen_id, quest_id, storage_path, status) values ($1::uuid, $2, $1::text || '/w.jpg', 'uploaded') returning id", [T, quest])).id;
  // The scanner claims it (scanning), then saves a pass, which moves it to the coach.
  await q("update makes set status = 'scanning' where id = $1", [m]);
  await q("select scan_save($1, 'pass', '{}', 'test')", [m]);
  const calls = (await q("select url, headers, body from net.calls")).rows;
  assert.deepEqual(
    calls.map((c) => [c.url, Object.keys(c.headers).sort(), c.body.makeId]),
    [
      ["https://ref.supabase.co/functions/v1/safety-scan", ["Content-Type", "x-safety-secret"], m],
      ["https://ref.supabase.co/functions/v1/coach-review", ["Content-Type", "x-coach-secret"], m],
    ],
  );
  assert.deepEqual([calls[0].headers["x-safety-secret"], calls[1].headers["x-coach-secret"]], ["s-safe", "s-coach"]);
});

scenario("until the Vault secrets are set, nothing is called and nothing breaks", async () => {
  await standIns({ secrets: false });
  const quest = (await one("select id from quests where status = 'approved' limit 1")).id;
  await q("insert into makes (teen_id, quest_id, storage_path, status) values ($1::uuid, $2, $1::text || '/x.jpg', 'uploaded')", [T, quest]);
  assert.equal((await one("select count(*)::int n from net.calls")).n, 0);
  await q("select private.call_function('evening-drop', 'drop_secret', 'x-drop-secret')");
  assert.equal((await one("select count(*)::int n from net.calls")).n, 0);
});

scenario("without pg_net at all (a plain Postgres), a make is saved as usual", async () => {
  const quest = (await one("select id from quests where status = 'approved' limit 1")).id;
  const r = await one("insert into makes (teen_id, quest_id, storage_path, status) values ($1::uuid, $2, $1::text || '/y.jpg', 'uploaded') returning status", [T, quest]);
  assert.equal(r.status, "uploaded");
});

scenario("zones and skills come from a migration, so production has them", async () => {
  assert.equal((await one("select count(*)::int n from zones")).n, 5);
  assert.equal((await one("select count(*)::int n from skills")).n, 20);
});

test("every edge function is deployed by the setup script and has its CLI settings", () => {
  const functions = readdirSync(new URL("../supabase/functions", import.meta.url), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const script = readFileSync(new URL("./setup-production.sh", import.meta.url), "utf8");
  const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const deployed = script.match(/for f in ([a-z -]+); do/)[1].trim().split(/\s+/).sort();
  assert.deepEqual(deployed, functions);
  for (const f of functions) assert.match(config, new RegExp(`\\[functions\\.${f}\\]\\s+verify_jwt = false`), f);
  // Every secret header a schedule sends has a Vault secret to send.
  const wiring = readFileSync(new URL("../supabase/migrations/20261114120100_production_wiring.sql", import.meta.url), "utf8");
  const vault = readFileSync(new URL("../supabase/setup/vault.sql", import.meta.url), "utf8");
  for (const [, name] of wiring.matchAll(/'([a-z]+_secret)'/g)) assert.match(vault, new RegExp(`'${name}', :'${name}'`), name);
});
