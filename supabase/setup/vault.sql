-- Stores the edge functions' URL and shared secrets in Supabase Vault, where
-- the schedules and triggers (migration 20261114120100_production_wiring.sql)
-- read them. Run by scripts/setup-production.sh with psql variables; safe to
-- run again (it updates what's there).
--
--   psql "$PRODUCTION_DB_URL" -v functions_url=https://<ref>.supabase.co/functions/v1 \
--     -v safety_secret=... -v coach_secret=... -v drop_secret=... \
--     -v deletions_secret=... -v quests_secret=... -f supabase/setup/vault.sql

begin;
create temporary table wanted (name text primary key, value text not null) on commit drop;
insert into wanted values
  ('functions_url', :'functions_url'),
  ('safety_secret', :'safety_secret'),
  ('coach_secret', :'coach_secret'),
  ('drop_secret', :'drop_secret'),
  ('deletions_secret', :'deletions_secret'),
  ('quests_secret', :'quests_secret');

do $$
declare
  w record;
  existing uuid;
begin
  for w in select * from wanted loop
    if w.value = '' then
      raise exception 'no value for %', w.name;
    end if;
    select id into existing from vault.secrets where name = w.name;
    if existing is null then
      perform vault.create_secret(w.value, w.name);
    else
      perform vault.update_secret(existing, w.value);
    end if;
  end loop;
end;
$$;
commit;

select name from vault.decrypted_secrets where name in ('functions_url', 'safety_secret', 'coach_secret', 'drop_secret', 'deletions_secret', 'quests_secret') order by name;
