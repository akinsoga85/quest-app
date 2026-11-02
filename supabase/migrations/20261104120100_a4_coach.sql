-- A4: the coach agent's side of the database.
--
-- The coach runs on the server (supabase/functions/coach-review). For each
-- make that passed the safety scan (status 'reviewing') it calls coach_claim,
-- which hands over the photo's path and the quest only if the teen allowed
-- coach reviews (and, under 18, a parent has said yes). No consent, no photo
-- path, no review. Then it saves a review or an outcome. The app reads the
-- result with get_review. Contract: review.ts and review.forMake in api.ts.

alter table public.makes
  add column coach_note text check (char_length(coach_note) <= 200), -- why a retake, in the coach's words
  add column coach_lesson_id text, -- the lesson offered when the coach couldn't finish
  add column review_started_at timestamptz; -- a worker is on it (stale after 3 minutes)

-- A coach concern (self-harm, abuse, danger) for the safety team. Server only.
create table public.coach_flags (
  make_id uuid primary key references public.makes (id) on delete cascade,
  note text not null,
  model text not null,
  created_at timestamptz not null default now()
);
alter table public.coach_flags enable row level security; -- no policies: the app never reads it
revoke all on public.coach_flags from authenticated;

-- ---------------------------------------------------------------------------
-- Retakes reopen the quest: Today shows it as not done, and record_make
-- accepts a new photo. Today also links each zone to today's make.
-- ---------------------------------------------------------------------------
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

create or replace function public.record_make(p_make_id uuid, p_quest_id uuid, p_captured_at timestamptz)
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

  d := private.local_day(tz, taken);
  if not exists (
    select 1 from public.quest_schedule s join public.quests q on q.id = s.quest_id
    where s.quest_id = p_quest_id and s.day = d and q.status = 'approved'
  ) then
    raise exception 'that quest isn''t open on %', d using errcode = 'check_violation';
  end if;

  -- One photo per quest (PRD R12). A photo the safety scan blocked, or one the
  -- coach asked to retake, can be taken again.
  if exists (
    select 1 from public.makes
    where teen_id = uid and quest_id = p_quest_id and local_day = d and status not in ('blocked', 'retake')
  ) then
    raise exception 'you already made this quest today' using errcode = 'unique_violation';
  end if;

  path := uid::text || '/' || p_make_id::text || '.jpg';
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

-- ---------------------------------------------------------------------------
-- The coach's functions (service role only)
-- ---------------------------------------------------------------------------

-- Hands over one make to review, or null if there's nothing to do. Without
-- consent it says so and hands over nothing, not even the photo's path.
create function public.coach_claim(p_make_id uuid)
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
    'zonePoints', coalesce((
      select sum(sp.points) from public.skill_points sp join public.skills s on s.id = sp.skill_id
      where sp.teen_id = m.teen_id and s.zone_id = zone), 0),
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

-- Makes waiting for the coach, oldest first, for the worker's sweep.
create function public.coach_pending(p_limit int default 20)
returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.id from public.makes m
  where m.status = 'reviewing'
    and (m.review_started_at is null or m.review_started_at <= now() - interval '3 minutes')
    and private.coach_allowed(m.teen_id)
  order by m.created_at
  limit greatest(1, least(p_limit, 100));
$$;

create function private.coach_locked_make(p_make_id uuid)
returns public.makes
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  m public.makes;
begin
  select * into m from public.makes where id = p_make_id for update;
  if not found then
    raise exception 'no such make' using errcode = 'no_data_found';
  end if;
  if m.status <> 'reviewing' then
    raise exception 'this make isn''t waiting for the coach' using errcode = 'check_violation';
  end if;
  -- Consent can be withdrawn while the coach works: then nothing is saved.
  if not private.coach_allowed(m.teen_id) then
    raise exception 'no coach consent for this teen' using errcode = 'insufficient_privilege';
  end if;
  return m;
end;
$$;

-- Saves a review that passed the guardrails, with its skill points.
create function public.coach_save_review(p_make_id uuid, p_review jsonb, p_model text, p_prompt_version text)
returns uuid
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  m public.makes := private.coach_locked_make(p_make_id);
  rid uuid;
  sp jsonb;
  worked text := p_review->>'worked';
  try_next text := p_review->>'tryNext';
  why text := p_review->>'why';
  question text := nullif(p_review->>'question', '');
  confidence numeric := (p_review->>'confidence')::numeric;
begin
  -- The same limits as CoachReview in the contract.
  if coalesce(char_length(worked), 0) not between 20 and 320
     or coalesce(char_length(try_next), 0) not between 20 and 320
     or coalesce(char_length(why), 0) not between 10 and 200
     or coalesce(char_length(question), 0) > 160
     or confidence is null or confidence not between 0 and 1 then
    raise exception 'review doesn''t match the contract' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_review->'skillPoints') <> 'array' or jsonb_array_length(p_review->'skillPoints') not between 1 and 2 then
    raise exception 'a review gives points for one or two skills' using errcode = 'check_violation';
  end if;

  insert into public.reviews (make_id, teen_id, worked, try_next, why, question, lesson_id, confidence, model, prompt_version)
  values (m.id, m.teen_id, worked, try_next, why, question, nullif(p_review->>'lessonId', ''), round(confidence, 2), p_model, p_prompt_version)
  returning id into rid;

  for sp in select * from jsonb_array_elements(p_review->'skillPoints') loop
    insert into public.skill_points (teen_id, review_id, skill_id, points)
    values (m.teen_id, rid, sp->>'skill', (sp->>'points')::smallint);
  end loop;

  update public.makes set status = 'reviewed', review_started_at = null where id = m.id;
  return rid;
end;
$$;

-- Saves what the coach decided instead of a review.
create function public.coach_save_outcome(p_make_id uuid, p_outcome text, p_note text, p_lesson_id text, p_model text)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  m public.makes := private.coach_locked_make(p_make_id);
begin
  if p_outcome = 'retake' then
    if coalesce(char_length(p_note), 0) not between 10 and 200 then
      raise exception 'a retake needs a short, kind reason' using errcode = 'check_violation';
    end if;
    update public.makes set status = 'retake', coach_note = p_note, review_started_at = null where id = m.id;
  elsif p_outcome = 'concern' then
    insert into public.coach_flags (make_id, note, model) values (m.id, coalesce(p_note, 'no note'), p_model)
    on conflict (make_id) do update set note = excluded.note;
    update public.makes set status = 'held_for_review', review_started_at = null where id = m.id;
  elsif p_outcome = 'unavailable' then
    update public.makes set status = 'no_review', coach_lesson_id = p_lesson_id, review_started_at = null where id = m.id;
  else
    raise exception 'unknown outcome %', p_outcome using errcode = 'check_violation';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The app's side
-- ---------------------------------------------------------------------------

-- review.forMake: where a make's review stands, for its own teen only.
create function public.get_review(p_make_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  m public.makes;
  r public.reviews;
begin
  select * into m from public.makes where id = p_make_id and teen_id = auth.uid();
  if not found then
    raise exception 'make not found' using errcode = 'no_data_found';
  end if;

  if m.status in ('uploaded', 'scanning', 'reviewing') then
    return case when private.coach_allowed(m.teen_id) then '{"state":"pending"}'::jsonb else '{"state":"no_consent"}'::jsonb end;
  elsif m.status = 'reviewed' then
    select * into r from public.reviews where make_id = m.id;
    return jsonb_build_object(
      'state', 'ready',
      'reviewId', r.id,
      'helpful', r.helpful,
      'review', jsonb_build_object(
        'worked', r.worked, 'tryNext', r.try_next, 'why', r.why, 'question', r.question,
        'lessonId', r.lesson_id, 'confidence', r.confidence::float8,
        'skillPoints', coalesce((
          select jsonb_agg(jsonb_build_object('skill', sp.skill_id, 'points', sp.points) order by sp.skill_id)
          from public.skill_points sp where sp.review_id = r.id), '[]'::jsonb)));
  elsif m.status = 'retake' then
    return jsonb_build_object('state', 'retake', 'reason', m.coach_note);
  elsif m.status = 'no_review' then
    return jsonb_build_object('state', 'unavailable', 'lessonId', m.coach_lesson_id);
  else
    return '{"state":"held"}'::jsonb; -- blocked or held_for_review: the app shows a calm message
  end if;
end;
$$;

-- review.rate
create function public.rate_review(p_review_id uuid, p_helpful boolean)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  update public.reviews set helpful = p_helpful where id = p_review_id and teen_id = auth.uid();
  if not found then
    raise exception 'review not found' using errcode = 'no_data_found';
  end if;
end;
$$;

revoke execute on function
  public.coach_claim(uuid),
  public.coach_pending(int),
  private.coach_locked_make(uuid),
  public.coach_save_review(uuid, jsonb, text, text),
  public.coach_save_outcome(uuid, text, text, text, text),
  public.get_review(uuid),
  public.rate_review(uuid, boolean)
from public;

grant execute on function
  public.coach_claim(uuid),
  public.coach_pending(int),
  public.coach_save_review(uuid, jsonb, text, text),
  public.coach_save_outcome(uuid, text, text, text, text)
to service_role;
grant execute on function public.get_review(uuid), public.rate_review(uuid, boolean) to authenticated;
