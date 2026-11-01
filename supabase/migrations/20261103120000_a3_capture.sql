-- A3: capture and upload.
--
-- The phone takes the photo, removes its metadata, uploads it to the private
-- "makes" bucket at <teen id>/<make id>.jpg, then calls record_make. The make
-- id is made on the phone when the photo is taken, so retrying after a dropped
-- connection never creates a second make. Contract: make.record in api.ts and
-- packages/contract/src/photo.ts.

-- The app no longer inserts makes directly: record_make checks the quest and
-- the day first.
drop policy makes_own_insert on public.makes;
revoke insert on public.makes from authenticated;

create function public.record_make(p_make_id uuid, p_quest_id uuid, p_captured_at timestamptz)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  tz text;
  taken timestamptz := coalesce(p_captured_at, now());
  d date;
  path text;
  existing public.makes;
begin
  select timezone into tz from public.teens where id = uid;
  if not found then
    raise exception 'only teens can save makes' using errcode = 'insufficient_privilege';
  end if;

  -- Same id again (a retry): answer with what's already there.
  select * into existing from public.makes where id = p_make_id;
  if found then
    if existing.teen_id <> uid or existing.quest_id <> p_quest_id then
      raise exception 'that make id is taken' using errcode = 'unique_violation';
    end if;
    return jsonb_build_object('makeId', existing.id, 'status', existing.status, 'localDay', existing.local_day);
  end if;

  if taken > now() + interval '5 minutes' then
    raise exception 'a make can''t be from the future' using errcode = 'check_violation';
  end if;
  if taken < now() - interval '48 hours' then
    raise exception 'this photo is too old to save for a quest' using errcode = 'check_violation';
  end if;

  -- The quest must be the one scheduled on the teen's local day when the photo was taken.
  d := private.local_day(tz, taken);
  if not exists (
    select 1 from public.quest_schedule s join public.quests q on q.id = s.quest_id
    where s.quest_id = p_quest_id and s.day = d and q.status = 'approved'
  ) then
    raise exception 'that quest isn''t open on %', d using errcode = 'check_violation';
  end if;

  -- One photo per quest (PRD R12). A photo the safety scan blocked can be retaken.
  if exists (
    select 1 from public.makes
    where teen_id = uid and quest_id = p_quest_id and local_day = d and status <> 'blocked'
  ) then
    raise exception 'you already made this quest today' using errcode = 'unique_violation';
  end if;

  path := uid::text || '/' || p_make_id::text || '.jpg';

  -- On Supabase, the photo must already be in storage. (Plain Postgres in the
  -- tests has no storage schema.)
  if to_regclass('storage.objects') is not null then
    if not exists (select 1 from storage.objects where bucket_id = 'makes' and name = path) then
      raise exception 'upload the photo first' using errcode = 'no_data_found';
    end if;
  end if;

  insert into public.makes (id, teen_id, quest_id, storage_path, status, created_at)
  values (p_make_id, uid, p_quest_id, path, 'uploaded', taken)
  returning * into existing;

  return jsonb_build_object('makeId', existing.id, 'status', existing.status, 'localDay', existing.local_day);
end;
$$;

revoke execute on function public.record_make(uuid, uuid, timestamptz) from public;
grant execute on function public.record_make(uuid, uuid, timestamptz) to authenticated;
