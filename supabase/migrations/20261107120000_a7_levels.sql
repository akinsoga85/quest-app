-- A7: points, levels, skills, postcards and the portfolio.
--
-- Points per zone (PRD R32) come from quests finished and coach skill points
-- only: one point for each quest finished (a make that passed the safety
-- scan; a retake doesn't count twice), plus the coach's skill points. Cheers
-- give nothing. Levels follow LEVELS in packages/contract/src/levels.ts, and
-- each new level earns a digital postcard. Contract: levels.ts and the A7
-- entries in api.ts.

-- ---------------------------------------------------------------------------
-- Points and levels
-- ---------------------------------------------------------------------------
create function private.zone_points(p_teen uuid, p_zone text)
returns int
language sql stable security definer
set search_path = public, pg_temp
as $$
  select (
    coalesce((
      select sum(sp.points) from public.skill_points sp
      join public.skills s on s.id = sp.skill_id
      where sp.teen_id = p_teen and s.zone_id = p_zone
    ), 0)
    + (
      select count(*) from (
        select distinct m.quest_id, m.local_day
        from public.makes m join public.quests q on q.id = m.quest_id
        where m.teen_id = p_teen and q.zone_id = p_zone and m.status in ('reviewing', 'reviewed', 'no_review')
      ) finished
    )
  )::int;
$$;

-- Mirrors levelFor() in the contract (db tests compare them).
create function private.level_for(p_points int)
returns int
language sql immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_points >= 70 then 5
    when p_points >= 45 then 4
    when p_points >= 25 then 3
    when p_points >= 10 then 2
    else 1
  end;
$$;

-- Mirrors skillScore() in the contract: 1–10 from the last 10 coach scores
-- for a skill (PRD R33), or null before the first.
create function private.skill_score(p_teen uuid, p_skill text)
returns int
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case when count(*) = 0 then null else round(1 + 4.5 * avg(points))::int end
  from (
    -- Newest work first: when the make was made, then when it was scored.
    select sp.points from public.skill_points sp
    join public.reviews r on r.id = sp.review_id
    join public.makes m on m.id = r.make_id
    where sp.teen_id = p_teen and sp.skill_id = p_skill
    order by m.created_at desc, sp.created_at desc, sp.id
    limit 10
  ) last10;
$$;

-- ---------------------------------------------------------------------------
-- Postcards: one per level reached (2 to 5), made when the points arrive.
-- ---------------------------------------------------------------------------
alter table public.postcards add column seen_at timestamptz;

create function private.award_postcards(p_teen uuid, p_zone text, p_make uuid)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  lvl int := private.level_for(private.zone_points(p_teen, p_zone));
begin
  if lvl >= 2 then
    insert into public.postcards (teen_id, zone_id, level, make_id)
    select p_teen, p_zone, l, p_make from generate_series(2, lvl) l
    on conflict (teen_id, zone_id, level) do nothing;
  end if;
end;
$$;

create function private.postcards_after_points()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform private.award_postcards(
    new.teen_id,
    (select zone_id from public.skills where id = new.skill_id),
    (select make_id from public.reviews where id = new.review_id));
  return null;
end;
$$;
create trigger postcards_after_points after insert on public.skill_points
for each row execute function private.postcards_after_points();

create function private.postcards_after_finish()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('reviewing', 'reviewed', 'no_review') and old.status not in ('reviewing', 'reviewed', 'no_review') then
    perform private.award_postcards(new.teen_id, (select zone_id from public.quests where id = new.quest_id), new.id);
  end if;
  return null;
end;
$$;
create trigger postcards_after_finish after update of status on public.makes
for each row execute function private.postcards_after_finish();

-- ---------------------------------------------------------------------------
-- Everywhere that shows points uses the same rule.
-- ---------------------------------------------------------------------------
drop view public.zone_progress;
create view public.zone_progress with (security_invoker = true) as
select t.id as teen_id, z.id as zone_id, private.zone_points(t.id, z.id) as points
from public.teens t cross join public.zones z
where t.id = auth.uid() and private.zone_points(t.id, z.id) > 0;
grant select on public.zone_progress to authenticated;

create or replace function private.today_payload(p_teen uuid, p_day date)
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
        'points', private.zone_points(p_teen, tz.zone_id),
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
          where m.teen_id = p_teen and m.local_day = p_day and m.status not in ('blocked', 'retake')
        ),
        'make', (
          select jsonb_build_object('id', m.id, 'status', m.status)
          from public.makes m
          join public.quest_schedule qs on qs.quest_id = m.quest_id and qs.day = p_day and qs.zone_id = tz.zone_id
          where m.teen_id = p_teen and m.local_day = p_day
          order by m.created_at desc
          limit 1
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

create or replace function public.coach_claim(p_make_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  m public.makes;
  q public.quests;
  zone text;
begin
  select * into m from public.makes where id = p_make_id for update;
  if not found then
    raise exception 'no such make' using errcode = 'no_data_found';
  end if;
  if m.status <> 'reviewing' then
    return null;
  end if;
  if not private.coach_allowed(m.teen_id) then
    return jsonb_build_object('consent', false);
  end if;
  if m.review_started_at is not null and m.review_started_at > now() - interval '3 minutes' then
    return null; -- another worker has it
  end if;
  update public.makes set review_started_at = now() where id = m.id;

  select * into q from public.quests where id = m.quest_id;
  zone := q.zone_id;

  return jsonb_build_object('consent', true, 'context', jsonb_build_object(
    'makeId', m.id,
    'storagePath', m.storage_path,
    'zone', zone,
    'quest', jsonb_build_object('title', q.title, 'brief', q.brief, 'trainsSkill', q.trains_skill_id, 'tips', to_jsonb(q.tips)),
    'zonePoints', private.zone_points(m.teen_id, zone),
    'history', jsonb_build_object(
      'questsDone', (
        select count(*) from public.makes x join public.quests xq on xq.id = x.quest_id
        where x.teen_id = m.teen_id and xq.zone_id = zone and x.status = 'reviewed' and x.id <> m.id),
      'skillPoints', coalesce((
        select jsonb_object_agg(skill_id, total) from (
          select sp.skill_id, sum(sp.points)::int as total
          from public.skill_points sp join public.skills s on s.id = sp.skill_id
          where sp.teen_id = m.teen_id and s.zone_id = zone
          group by sp.skill_id) p), '{}'::jsonb),
      'recentTips', coalesce((
        select jsonb_agg(try_next order by created_at desc) from (
          select r.try_next, r.created_at
          from public.reviews r join public.makes x on x.id = r.make_id join public.quests xq on xq.id = x.quest_id
          where r.teen_id = m.teen_id and xq.zone_id = zone
          order by r.created_at desc limit 5) t), '[]'::jsonb)
    )
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- The app's reads and actions
-- ---------------------------------------------------------------------------

-- levels.get: points, skill scores and a "you vs. you" pair per zone, for the
-- teen's zones and any other zone they have points in.
create function public.get_levels()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if not exists (select 1 from public.teens where id = uid) then
    raise exception 'no teen profile' using errcode = 'no_data_found';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'zone', z.id,
      'points', private.zone_points(uid, z.id),
      'skills', (select jsonb_object_agg(s.id, private.skill_score(uid, s.id)) from public.skills s where s.zone_id = z.id),
      'compare', (
        -- A quest made on two days (a repeat, PRD R10) if there is one; else the first and latest finished makes.
        with done as (
          select m.id, m.quest_id, m.local_day, m.created_at from public.makes m join public.quests q on q.id = m.quest_id
          where m.teen_id = uid and q.zone_id = z.id and m.status in ('reviewed', 'no_review')
        ),
        repeat as (
          select quest_id from done group by quest_id having count(distinct local_day) >= 2
          order by max(created_at) desc limit 1
        ),
        pool as (
          select * from done where quest_id = (select quest_id from repeat)
          union all
          select * from done where not exists (select 1 from repeat)
        )
        select case when count(*) >= 2 then jsonb_build_object(
          'before', (select jsonb_build_object('makeId', id, 'day', local_day) from pool order by created_at limit 1),
          'after', (select jsonb_build_object('makeId', id, 'day', local_day) from pool order by created_at desc limit 1),
          'sameQuest', exists (select 1 from repeat))
        else null end
        from pool)
    ) order by z.sort)
    from public.zones z
    where exists (select 1 from public.teen_zones tz where tz.teen_id = uid and tz.zone_id = z.id)
       or private.zone_points(uid, z.id) > 0
  ), '[]'::jsonb);
end;
$$;

-- studio.list: the teen's portfolio, newest first (PRD R36). Photos the safety
-- scan blocked or holds aren't shown.
create function public.get_studio(p_zone text default null, p_before timestamptz default null, p_limit int default 30)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'total', (
      select count(*) from public.makes m join public.quests q on q.id = m.quest_id
      where m.teen_id = auth.uid() and m.status not in ('blocked', 'held_for_review')
        and (p_zone is null or q.zone_id = p_zone)),
    'makes', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x."createdAt" desc) from (
        select m.id, q.zone_id as zone, q.title as "questTitle", m.local_day as "localDay", m.status,
               m.storage_path as "storagePath", m.created_at as "createdAt"
        from public.makes m join public.quests q on q.id = m.quest_id
        where m.teen_id = auth.uid() and m.status not in ('blocked', 'held_for_review')
          and (p_zone is null or q.zone_id = p_zone)
          and (p_before is null or m.created_at < p_before)
        order by m.created_at desc
        limit greatest(1, least(p_limit, 60))
      ) x), '[]'::jsonb)
  );
$$;

-- postcards.new / postcards.seen / postcards.pick
create function public.get_new_postcards()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'zone', zone_id, 'level', level, 'makeId', make_id) order by created_at, level), '[]'::jsonb)
  from public.postcards where teen_id = auth.uid() and seen_at is null;
$$;

create function public.mark_postcards_seen(p_ids uuid[])
returns void
language sql volatile security definer
set search_path = public, pg_temp
as $$
  update public.postcards set seen_at = now() where teen_id = auth.uid() and id = any (p_ids) and seen_at is null;
$$;

create function public.pick_postcard(p_postcard_id uuid, p_make_id uuid)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  pc public.postcards;
begin
  select * into pc from public.postcards where id = p_postcard_id and teen_id = auth.uid();
  if not found then
    raise exception 'postcard not found' using errcode = 'no_data_found';
  end if;
  if not exists (
    select 1 from public.makes m join public.quests q on q.id = m.quest_id
    where m.id = p_make_id and m.teen_id = auth.uid() and q.zone_id = pc.zone_id and m.status in ('reviewed', 'no_review')
  ) then
    raise exception 'pick one of your own finished makes in this zone' using errcode = 'check_violation';
  end if;
  update public.postcards set make_id = p_make_id where id = pc.id;
end;
$$;

-- make.delete: the teen deletes a piece (PRD R36). Returns the photo's path,
-- for the app to remove from storage. Its review and points go with it.
create function public.delete_make(p_make_id uuid)
returns text
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  path text;
begin
  delete from public.makes where id = p_make_id and teen_id = auth.uid() and status not in ('blocked', 'held_for_review')
  returning storage_path into path;
  if path is null then
    raise exception 'make not found' using errcode = 'no_data_found';
  end if;
  return path;
end;
$$;

revoke execute on function
  private.zone_points(uuid, text),
  private.level_for(int),
  private.skill_score(uuid, text),
  private.award_postcards(uuid, text, uuid),
  public.get_levels(),
  public.get_studio(text, timestamptz, int),
  public.get_new_postcards(),
  public.mark_postcards_seen(uuid[]),
  public.pick_postcard(uuid, uuid),
  public.delete_make(uuid)
from public;
-- zone_points runs inside the zone_progress view, as the signed-in teen.
grant execute on function private.zone_points(uuid, text) to authenticated, service_role;
grant execute on function private.level_for(int), private.skill_score(uuid, text) to service_role;
grant execute on function
  public.get_levels(),
  public.get_studio(text, timestamptz, int),
  public.get_new_postcards(),
  public.mark_postcards_seen(uuid[]),
  public.pick_postcard(uuid, uuid),
  public.delete_make(uuid)
to authenticated;
