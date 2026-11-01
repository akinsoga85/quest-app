-- A2: quests and Today.
--
-- Everything runs on the teen's local day, in their time zone: a new quest
-- appears at local midnight, and each make counts for the local day it was
-- made on. That day is stored on the make, so travelling later never moves it.
-- Contract: packages/contract/src/today.ts and the A2 entries in api.ts.

-- ---------------------------------------------------------------------------
-- Time zones
-- ---------------------------------------------------------------------------

-- The calendar date at an instant in an IANA time zone. Mirrors localDay() in
-- the contract (db tests compare them).
create function private.local_day(p_tz text, p_at timestamptz)
returns date
language sql stable
set search_path = pg_catalog, pg_temp
as $$ select (p_at at time zone p_tz)::date $$;

-- Only real zone names. Postgres also accepts POSIX strings like 'GMT+5',
-- whose sign is the reverse of what people expect, so those are refused.
create function private.teens_timezone_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) or new.timezone ~ '^(GMT|UTC|Etc/GMT)[+-]' then
    raise exception 'unknown time zone %', new.timezone using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger teens_timezone_guard before insert or update of timezone on public.teens
for each row execute function private.teens_timezone_guard();

-- The local day for whoever is signed in. Anyone who isn't a teen (a parent)
-- gets the newest date on Earth (UTC+14), so they can see whatever a teen can.
create function private.today_for(p_user uuid)
returns date
language sql stable security definer
set search_path = public, pg_temp
as $$
  select private.local_day(coalesce((select timezone from public.teens where id = p_user), 'Pacific/Kiritimati'), now());
$$;

-- ---------------------------------------------------------------------------
-- Quests appear at local midnight: nobody sees a later day's quest early.
-- ---------------------------------------------------------------------------
drop policy quest_schedule_read on public.quest_schedule;
create policy quest_schedule_read on public.quest_schedule for select to authenticated
  using (day <= (select private.today_for(auth.uid())));

drop policy quests_approved on public.quests;
create policy quests_approved on public.quests for select to authenticated
  using (
    status = 'approved'
    and exists (
      select 1 from public.quest_schedule s
      where s.quest_id = quests.id and s.day <= (select private.today_for(auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- Each make's local day, fixed when it's made
-- ---------------------------------------------------------------------------
-- The default only keeps the column optional for inserts; the trigger below
-- always sets the real value from the teen's time zone.
alter table public.makes add column local_day date not null default current_date;
update public.makes m set local_day = private.local_day(t.timezone, m.created_at)
  from public.teens t where t.id = m.teen_id;
create index makes_teen_day on public.makes (teen_id, local_day);

create function private.makes_local_day()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.created_at > now() + interval '5 minutes' then
    raise exception 'a make can''t be from the future' using errcode = 'check_violation';
  end if;
  new.local_day := (select private.local_day(t.timezone, new.created_at) from public.teens t where t.id = new.teen_id);
  return new;
end;
$$;
create trigger makes_local_day before insert on public.makes
for each row execute function private.makes_local_day();

-- The app can't set when a make happened (or its day): only server functions
-- can, for photos taken offline (A3).
revoke insert on public.makes from authenticated;
grant insert (teen_id, quest_id, storage_path, status) on public.makes to authenticated;

-- ---------------------------------------------------------------------------
-- zones.set: swap zones in one step. Points stay with the zone, not the pick,
-- so dropping a zone and coming back later keeps its level.
-- ---------------------------------------------------------------------------
create function public.set_teen_zones(p_zones text[])
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  picked text[] := array(select distinct z from unnest(coalesce(p_zones, '{}')) z where z is not null);
begin
  if not exists (select 1 from public.teens where id = uid) then
    raise exception 'only teens pick zones' using errcode = 'insufficient_privilege';
  end if;
  if cardinality(picked) < 1 then
    raise exception 'pick at least one zone' using errcode = 'check_violation';
  end if;
  if cardinality(picked) > 3 then
    raise exception 'a teen can pick at most 3 zones' using errcode = 'check_violation';
  end if;

  delete from public.teen_zones where teen_id = uid and zone_id <> all (picked);
  -- Zones already picked stay as they are, even if one has since closed.
  insert into public.teen_zones (teen_id, zone_id)
  select uid, z from unnest(picked) z
  where not exists (select 1 from public.teen_zones where teen_id = uid and zone_id = z);
end;
$$;

-- ---------------------------------------------------------------------------
-- today.get
-- ---------------------------------------------------------------------------

-- Weeks in a row with 3+ making days, Monday to Sunday. The current week counts
-- once it qualifies; an unfinished week never breaks the streak. Mirrors
-- weeklyStreak() in the contract (db tests compare them).
create function private.weekly_streak(p_teen uuid, p_day date)
returns int
language sql stable security definer
set search_path = public, pg_temp
as $$
  with days as (
    select distinct local_day as d from public.makes
    where teen_id = p_teen and status <> 'blocked' and local_day <= p_day
  ),
  good as (
    select d - (extract(isodow from d)::int - 1) as w
    from days group by 1 having count(*) >= 3
  ),
  anchor as (
    select case
      when exists (select 1 from good where w = p_day - (extract(isodow from p_day)::int - 1))
        then p_day - (extract(isodow from p_day)::int - 1)
      else p_day - (extract(isodow from p_day)::int - 1) - 7
    end as a
  )
  select count(*)::int
  from (select w, row_number() over (order by w desc) as rn from good, anchor where w <= a) g, anchor
  where g.w = anchor.a - 7 * (g.rn - 1)::int;
$$;

-- Everything the Today screen shows for one teen on one local day.
create function private.today_payload(p_teen uuid, p_day date)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'day', p_day,
    'timezone', t.timezone,
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'zone', tz.zone_id,
        'points', coalesce((
          select sum(sp.points) from public.skill_points sp
          join public.skills s on s.id = sp.skill_id
          where sp.teen_id = p_teen and s.zone_id = tz.zone_id
        ), 0),
        'quest', (
          select jsonb_build_object(
            'id', q.id, 'zone', q.zone_id, 'title', q.title, 'brief', q.brief,
            'minutes', q.minutes, 'trainsSkill', q.trains_skill_id, 'tips', to_jsonb(q.tips))
          from public.quest_schedule qs
          join public.quests q on q.id = qs.quest_id and q.status = 'approved'
          where qs.day = p_day and qs.zone_id = tz.zone_id
        ),
        'madeToday', exists (
          select 1 from public.makes m
          join public.quest_schedule qs on qs.quest_id = m.quest_id and qs.day = p_day and qs.zone_id = tz.zone_id
          where m.teen_id = p_teen and m.local_day = p_day and m.status <> 'blocked'
        )
      ) order by z.sort)
      from public.teen_zones tz
      join public.zones z on z.id = tz.zone_id
      where tz.teen_id = p_teen
    ), '[]'::jsonb),
    'week', jsonb_build_object(
      'start', p_day - (extract(isodow from p_day)::int - 1),
      'madeDays', coalesce((
        select jsonb_agg(d order by d) from (
          select distinct m.local_day as d from public.makes m
          where m.teen_id = p_teen and m.status <> 'blocked'
            and m.local_day between p_day - (extract(isodow from p_day)::int - 1) and p_day
        ) w
      ), '[]'::jsonb)
    ),
    'streakWeeks', private.weekly_streak(p_teen, p_day)
  )
  from public.teens t
  where t.id = p_teen;
$$;

-- Today for a teen at a given instant; tests use this with a fixed clock.
create function private.today_at(p_teen uuid, p_at timestamptz)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select private.today_payload(p_teen, private.local_day(t.timezone, p_at))
  from public.teens t where t.id = p_teen;
$$;

create function public.get_today()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb := private.today_at(auth.uid(), now());
begin
  if result is null then
    raise exception 'no teen profile' using errcode = 'no_data_found';
  end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------
revoke execute on function
  private.local_day(text, timestamptz),
  private.today_for(uuid),
  private.weekly_streak(uuid, date),
  private.today_payload(uuid, date),
  private.today_at(uuid, timestamptz),
  public.set_teen_zones(text[]),
  public.get_today()
from public;

-- today_for runs inside the quest policies, so signed-in users need it.
grant execute on function private.today_for(uuid) to authenticated, service_role;
grant execute on function private.local_day(text, timestamptz) to service_role;
grant execute on function public.set_teen_zones(text[]), public.get_today() to authenticated;
grant execute on function private.weekly_streak(uuid, date), private.today_payload(uuid, date), private.today_at(uuid, timestamptz) to service_role;
