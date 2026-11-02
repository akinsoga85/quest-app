-- Production wiring: what calls the edge functions.
--
--   a new make (uploaded)        -> safety-scan, at once
--   a make ready for the coach   -> coach-review, at once
--   every 5 minutes              -> safety-scan and coach-review sweep up anything missed
--   every 10 minutes             -> evening-drop
--   daily, 03:17 UTC             -> account-deletions (also moves age groups on)
--   Mondays, 04:23 UTC           -> quest-writer drafts the weeks ahead
--
-- Calls go out through pg_net and are scheduled with pg_cron (both on every
-- Supabase project). The functions' URL and shared secrets live in Supabase
-- Vault, set once by supabase/setup/vault.sql, so nothing secret is in git.
-- Until those Vault secrets exist (and on a plain local Postgres) every call
-- quietly does nothing, so the database tests run without them.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
end;
$$;

-- POSTs to one edge function with its shared secret header. Never raises:
-- a failed call must not undo the make it was about; the sweeps catch it.
create function private.call_function(p_function text, p_secret_name text, p_header text, p_body jsonb default '{}'::jsonb)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  base_url text;
  secret text;
begin
  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into base_url using 'functions_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into secret using p_secret_name;
  if base_url is null or secret is null then
    return;
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 10000)'
    using rtrim(base_url, '/') || '/' || p_function,
          jsonb_build_object('Content-Type', 'application/json', p_header, secret),
          p_body;
exception when others then
  raise warning 'call to % failed: %', p_function, sqlerrm;
end;
$$;

-- A new photo goes to the safety scan; a photo that passed goes to the coach.
create function private.makes_call_functions()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'uploaded' and (tg_op = 'INSERT' or old.status is distinct from 'uploaded') then
    perform private.call_function('safety-scan', 'safety_secret', 'x-safety-secret', jsonb_build_object('makeId', new.id));
  elsif new.status = 'reviewing' and (tg_op = 'INSERT' or old.status is distinct from 'reviewing') then
    perform private.call_function('coach-review', 'coach_secret', 'x-coach-secret', jsonb_build_object('makeId', new.id));
  end if;
  return null;
end;
$$;

create trigger makes_call_functions
after insert or update of status on public.makes
for each row execute function private.makes_call_functions();

-- The schedules. Re-running replaces them (cron.schedule updates a job of the same name).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('safety-scan-sweep', '*/5 * * * *', $c$select private.call_function('safety-scan', 'safety_secret', 'x-safety-secret')$c$);
    perform cron.schedule('coach-review-sweep', '2-59/5 * * * *', $c$select private.call_function('coach-review', 'coach_secret', 'x-coach-secret')$c$);
    perform cron.schedule('evening-drop', '*/10 * * * *', $c$select private.call_function('evening-drop', 'drop_secret', 'x-drop-secret')$c$);
    perform cron.schedule('account-deletions', '17 3 * * *', $c$select private.call_function('account-deletions', 'deletions_secret', 'x-deletions-secret')$c$);
    perform cron.schedule('quest-writer', '23 4 * * 1', $c$select private.call_function('quest-writer', 'quests_secret', 'x-quests-secret')$c$);
  end if;
end;
$$;

-- The photo bucket takes only what the app uploads: JPEGs, at most 5 MB
-- (the app sends at most 1600 px tall, usually well under 1 MB).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'] where id = 'makes';
  end if;
end;
$$;

revoke execute on function private.call_function(text, text, text, jsonb), private.makes_call_functions() from public;
