-- A6: the quest writer's weeks.
--
-- The quest writer agent drafts a week (7 quests) per zone; a person approves
-- it in the admin (A11), which schedules the quests Monday to Sunday. Drafts
-- are never visible to teens. Contract: QuestWeekDraft and weekRuleProblems
-- in packages/contract/src/quest.ts.

create type public.week_status as enum ('draft', 'approved', 'rejected');

create table public.quest_weeks (
  id uuid primary key default gen_random_uuid(),
  zone_id text not null references public.zones (id),
  week_of date not null check (extract(isodow from week_of) = 1), -- a Monday
  status public.week_status not null default 'draft',
  model text not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  note text
);
create unique index quest_weeks_one_per_zone on public.quest_weeks (zone_id, week_of) where status <> 'rejected';
alter table public.quest_weeks enable row level security; -- no policies: staff only
revoke all on public.quest_weeks from authenticated;

alter table public.quests
  add column week_id uuid references public.quest_weeks (id) on delete set null,
  add column week_day smallint check (week_day between 1 and 7);

-- The newest date anywhere on Earth: a week that has started there is too
-- late to change, because some teen can already see it.
create function private.earliest_local_today()
returns date
language sql stable
set search_path = pg_catalog, pg_temp
as $$ select (now() at time zone 'Pacific/Kiritimati')::date $$;

-- Saves a drafted week. The worker checks weekRuleProblems first; this
-- checks the parts the database can see.
create function public.save_quest_week(p_zone text, p_week_of date, p_quests jsonb, p_model text)
returns uuid
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  wid uuid;
  q jsonb;
  i int := 0;
begin
  if not exists (select 1 from public.zones where id = p_zone and status = 'live') then
    raise exception 'zone % is not open', p_zone using errcode = 'check_violation';
  end if;
  if extract(isodow from p_week_of) <> 1 then
    raise exception 'a week starts on a Monday' using errcode = 'check_violation';
  end if;
  if p_week_of <= private.earliest_local_today() then
    raise exception 'that week has already started somewhere' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_quests) <> 'array' or jsonb_array_length(p_quests) <> 7 then
    raise exception 'a week has 7 quests' using errcode = 'check_violation';
  end if;

  insert into public.quest_weeks (zone_id, week_of, model) values (p_zone, p_week_of, coalesce(p_model, 'unknown'))
  returning id into wid;

  for q in select * from jsonb_array_elements(p_quests) loop
    i := i + 1;
    if q->>'zone' is distinct from p_zone or (q->>'trainsSkill') not like p_zone || '.%' then
      raise exception 'day %: quest isn''t in zone %', i, p_zone using errcode = 'check_violation';
    end if;
    insert into public.quests (zone_id, title, brief, minutes, trains_skill_id, tips, status, written_by, week_id, week_day)
    values (
      p_zone, q->>'title', q->>'brief', (q->>'minutes')::smallint, q->>'trainsSkill',
      coalesce(array(select jsonb_array_elements_text(q->'tips')), '{}'),
      'draft', 'agent', wid, i
    );
  end loop;
  return wid;
end;
$$;

-- Approves a week: its quests go live on their days. Every fourth week (ISO
-- week number divisible by 4), Thursday brings back the quest from four weeks
-- earlier, so the coach can compare old and new work (PRD R10); that week's
-- own Thursday quest stays approved, for later.
create function public.approve_quest_week(p_week_id uuid, p_by text)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  w public.quest_weeks;
  q public.quests;
  repeat_id uuid;
begin
  select * into w from public.quest_weeks where id = p_week_id for update;
  if not found then
    raise exception 'no such week' using errcode = 'no_data_found';
  end if;
  if w.status <> 'draft' then
    raise exception 'this week was already %', w.status using errcode = 'check_violation';
  end if;
  if w.week_of <= private.earliest_local_today() then
    raise exception 'that week has already started somewhere; draft a later one' using errcode = 'check_violation';
  end if;
  if coalesce(p_by, '') = '' then
    raise exception 'say who approved it' using errcode = 'check_violation';
  end if;

  if extract(week from w.week_of)::int % 4 = 0 then
    select quest_id into repeat_id from public.quest_schedule
    where zone_id = w.zone_id and day = w.week_of + 3 - 28;
  end if;

  update public.quests set status = 'approved', approved_at = now() where week_id = w.id;
  for q in select * from public.quests where week_id = w.id order by week_day loop
    insert into public.quest_schedule (day, zone_id, quest_id)
    values (w.week_of + q.week_day - 1, w.zone_id, case when q.week_day = 4 and repeat_id is not null then repeat_id else q.id end)
    on conflict (day, zone_id) do update set quest_id = excluded.quest_id;
  end loop;
  update public.quest_weeks set status = 'approved', decided_at = now(), decided_by = p_by where id = w.id;
end;
$$;

create function public.reject_quest_week(p_week_id uuid, p_by text, p_note text)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  update public.quest_weeks set status = 'rejected', decided_at = now(), decided_by = p_by, note = p_note
  where id = p_week_id and status = 'draft';
  if not found then
    raise exception 'no draft week %', p_week_id using errcode = 'no_data_found';
  end if;
  update public.quests set status = 'retired' where week_id = p_week_id;
end;
$$;

-- Titles the writer shouldn't repeat: scheduled in the last p_weeks weeks, or
-- already drafted or approved for later.
create function public.recent_quest_titles(p_zone text, p_weeks int default 8)
returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select distinct q.title from public.quests q
  left join public.quest_schedule s on s.quest_id = q.id
  where q.zone_id = p_zone and q.status <> 'retired'
    and (s.day >= current_date - 7 * p_weeks or q.week_id in (
      select id from public.quest_weeks where zone_id = p_zone and status <> 'rejected' and week_of > current_date))
$$;

-- Weeks the writer should draft next: the coming p_ahead Mondays per live zone
-- that have no draft or approved week yet.
create function public.weeks_to_draft(p_ahead int default 2)
returns table (zone_id text, week_of date)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with mondays as (
    select (private.earliest_local_today() + (8 - extract(isodow from private.earliest_local_today())::int)) + 7 * n as week_of
    from generate_series(0, greatest(1, least(p_ahead, 6)) - 1) n
  )
  select z.id, m.week_of
  from public.zones z cross join mondays m
  where z.status = 'live'
    and not exists (select 1 from public.quest_weeks w where w.zone_id = z.id and w.week_of = m.week_of and w.status <> 'rejected')
  order by m.week_of, z.sort;
$$;

revoke execute on function
  private.earliest_local_today(),
  public.save_quest_week(text, date, jsonb, text),
  public.approve_quest_week(uuid, text),
  public.reject_quest_week(uuid, text, text),
  public.recent_quest_titles(text, int),
  public.weeks_to_draft(int)
from public;
grant execute on function
  private.earliest_local_today(),
  public.save_quest_week(text, date, jsonb, text),
  public.approve_quest_week(uuid, text),
  public.reject_quest_week(uuid, text, text),
  public.recent_quest_titles(text, int),
  public.weeks_to_draft(int)
to service_role;
