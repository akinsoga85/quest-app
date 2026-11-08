-- Read-only health check of a Quest Supabase project (staging or production).
-- Paste it into the dashboard's SQL Editor and run it: it lists each check
-- with ok true or false and a short detail. It changes nothing and never
-- shows a secret's value (only which Vault secrets exist).

create temporary table if not exists quest_check (n int, check_name text, ok boolean, detail text);
truncate quest_check;

do $$
declare
  v text;
  i int;
  j int;
  want_jobs text[] := array['safety-scan-sweep', 'coach-review-sweep', 'evening-drop', 'account-deletions', 'quest-writer'];
  want_secrets text[] := array['functions_url', 'safety_secret', 'coach_secret', 'drop_secret', 'deletions_secret', 'quests_secret'];
begin
  -- 1. Migrations, by the latest one applied.
  if to_regclass('supabase_migrations.schema_migrations') is null then
    insert into quest_check values (1, 'migrations', false, 'none applied with the Supabase CLI: run the setup script');
  else
    execute 'select max(version), count(*) from supabase_migrations.schema_migrations' into v, i;
    insert into quest_check values (1, 'migrations', coalesce(v >= '20261114120100', false), format('%s applied, latest %s (expected 20261114120100 or later)', i, v));
  end if;

  -- 2. Zones and skills (reference data from a migration).
  if to_regclass('public.zones') is null then
    insert into quest_check values (2, 'zones and skills', false, 'tables missing: migrations not applied');
  else
    execute 'select (select count(*) from public.zones), (select count(*) from public.skills)' into i, j;
    insert into quest_check values (2, 'zones and skills', i = 5 and j = 20, format('%s zones (5 expected), %s skills (20 expected)', i, j));
  end if;

  -- 3. The private photo bucket: JPEG only, at most 5 MB.
  if to_regclass('storage.buckets') is null then
    insert into quest_check values (3, 'photo bucket', false, 'no storage schema');
  else
    execute $q$select format('public=%s, size limit=%s, types=%s', public, file_size_limit, allowed_mime_types)
              from storage.buckets where id = 'makes'$q$ into v;
    insert into quest_check values (3, 'photo bucket', coalesce(v = 'public=f, size limit=5242880, types={image/jpeg}', false), coalesce(v, 'bucket "makes" missing'));
  end if;

  -- 4. The extensions the schedules and triggers use.
  select string_agg(extname, ', ' order by extname) into v from pg_extension where extname in ('pg_cron', 'pg_net');
  insert into quest_check values (4, 'pg_cron and pg_net', coalesce(v = 'pg_cron, pg_net', false), coalesce(v, 'neither installed'));

  -- 5. The five schedules.
  if to_regclass('cron.job') is null then
    insert into quest_check values (5, 'schedules', false, 'pg_cron not installed');
  else
    execute 'select count(*) from cron.job where jobname = any($1) and active' into i using want_jobs;
    execute 'select string_agg(n, '', '') from unnest($1) n where n not in (select jobname from cron.job where active)' into v using want_jobs;
    insert into quest_check values (5, 'schedules', i = 5, format('%s of 5 active%s', i, coalesce('; missing: ' || v, '')));
  end if;

  -- 6. Vault: the functions' URL and shared secrets exist (names only).
  if to_regclass('vault.secrets') is null then
    insert into quest_check values (6, 'Vault secrets', false, 'Vault not available');
  else
    execute 'select string_agg(n, '', '') from unnest($1) n where n not in (select name from vault.secrets)' into v using want_secrets;
    insert into quest_check values (6, 'Vault secrets', v is null, coalesce('missing: ' || v || ' (run the setup script)', 'all 6 present'));
  end if;

  -- 7. Schedule runs in the last day.
  if to_regclass('cron.job_run_details') is null then
    insert into quest_check values (7, 'schedule runs, last 24h', false, 'pg_cron not installed');
  else
    execute $q$select count(*) filter (where status = 'succeeded'), count(*) filter (where status = 'failed')
              from cron.job_run_details where start_time > now() - interval '1 day'$q$ into i, j;
    insert into quest_check values (7, 'schedule runs, last 24h', j = 0 and i > 0, format('%s succeeded, %s failed', i, j));
  end if;

  -- 8. What the functions answered (pg_net keeps recent responses).
  -- 403 means a function rejected the secret: the Vault and function secrets differ.
  -- 503 means a function isn't set up yet (expected for payments on staging).
  if to_regclass('net._http_response') is null then
    insert into quest_check values (8, 'function responses', false, 'pg_net not installed');
  else
    execute $q$select string_agg(format('%s x%s', coalesce(status_code::text, 'error'), c), ', ' order by status_code)
              from (select status_code, count(*) c from net._http_response group by status_code) r$q$ into v;
    execute 'select count(*) from net._http_response where status_code = 403' into i;
    insert into quest_check values (8, 'function responses', i = 0, coalesce(v, 'no calls yet'));
  end if;

  -- 9. Every table the app can reach has row-level security on.
  select string_agg(c.relname, ', ' order by c.relname) into v
  from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  insert into quest_check values (9, 'row-level security', v is null, coalesce('OFF on: ' || v, 'on for every public table'));

  -- 10. At least one staff member, for the admin site.
  if to_regclass('public.staff') is null then
    insert into quest_check values (10, 'staff', false, 'table missing');
  else
    execute 'select count(*) from public.staff' into i;
    insert into quest_check values (10, 'staff', i > 0, format('%s staff', i));
  end if;

  -- 11. Quests scheduled for today (UTC), so Today isn't empty.
  if to_regclass('public.quest_schedule') is null then
    insert into quest_check values (11, 'quests today', false, 'table missing');
  else
    execute 'select count(*) from public.quest_schedule where day = current_date' into i;
    insert into quest_check values (11, 'quests today', i > 0, format('%s zones have a quest today', i));
  end if;
end;
$$;

select check_name, ok, detail from quest_check order by n;
