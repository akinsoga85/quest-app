-- A11: admin and operations.
--
-- Staff work in the admin site (apps/admin): approving quest weeks, working the
-- safety queue, and grading a 1% sample of coach reviews. Anyone can download
-- their data and delete their account (Apple 5.1.1(v), Google Play). Deletion
-- waits 7 days, so it can be cancelled, and always finishes within 30 days
-- (DELETION_DAYS), unless a safety report needs the evidence kept.

create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'reviewer')),
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security; -- no policies: added by hand in the dashboard
revoke all on public.staff from authenticated;

create function private.staff_email(p_user uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$ select email from public.staff where user_id = p_user $$;

create function private.require_staff()
returns text
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  e text := private.staff_email(auth.uid());
begin
  if e is null then
    raise exception 'staff only' using errcode = 'insufficient_privilege';
  end if;
  return e;
end;
$$;

-- Mentor-style grades for the coach spot check (Lean V1: "How we know it's good").
create table public.review_grades (
  review_id uuid primary key references public.reviews (id) on delete cascade,
  grader text not null,
  specific smallint not null check (specific between 1 and 5),
  accurate smallint not null check (accurate between 1 and 5),
  kind smallint not null check (kind between 1 and 5),
  actionable smallint not null check (actionable between 1 and 5),
  guardrail_break boolean not null,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);
alter table public.review_grades enable row level security; -- staff only, through the functions
revoke all on public.review_grades from authenticated;

-- ---------------------------------------------------------------------------
-- Account deletion
-- ---------------------------------------------------------------------------
alter table public.deletion_requests
  add column cancelled_at timestamptz,
  add column held_reason text; -- why it's waiting past its date (a safety report)
create unique index deletion_requests_one_open on public.deletion_requests (user_id) where completed_at is null and cancelled_at is null;
-- Requests go through the functions below.
drop policy deletion_requests_own_insert on public.deletion_requests;
revoke insert, update, delete on public.deletion_requests from authenticated;

-- account.delete: teens and parents alike.
create function public.request_account_deletion()
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  r public.deletion_requests;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.deletion_requests where user_id = auth.uid() and completed_at is null and cancelled_at is null;
  if not found then
    insert into public.deletion_requests (user_id) values (auth.uid()) returning * into r;
  end if;
  return jsonb_build_object('requestId', r.id, 'deletesAfter', r.requested_at + interval '7 days', 'completesBy', r.completes_by);
end;
$$;

-- Changed your mind within the 7 days: nothing is deleted.
create function public.cancel_account_deletion()
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  update public.deletion_requests set cancelled_at = now()
  where user_id = auth.uid() and completed_at is null and cancelled_at is null and requested_at > now() - interval '7 days';
  if not found then
    raise exception 'no deletion to cancel' using errcode = 'no_data_found';
  end if;
end;
$$;

create function public.my_deletion()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('requestId', id, 'deletesAfter', requested_at + interval '7 days', 'completesBy', completes_by)
  from public.deletion_requests where user_id = auth.uid() and completed_at is null and cancelled_at is null;
$$;

-- Due deletions for the job (supabase/functions/account-deletions), with the
-- storage folder to empty first. Accounts with an open safety item, or one
-- reported in the last 90 days, are held for staff and say why.
create function public.deletions_due(p_now timestamptz default now())
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  r public.deletion_requests;
  due jsonb := '[]'::jsonb;
  held boolean;
begin
  for r in select * from public.deletion_requests
           where completed_at is null and cancelled_at is null and requested_at <= p_now - interval '7 days'
           order by requested_at loop
    held := exists (
      select 1 from public.safety_queue sq join public.makes m on m.id = sq.make_id
      where m.teen_id = r.user_id
        and (sq.resolved_at is null or (sq.resolution = 'reported' and sq.resolved_at > p_now - interval '90 days')));
    if held then
      update public.deletion_requests set held_reason = 'safety report: evidence kept for staff' where id = r.id;
    else
      due := due || jsonb_build_object('userId', r.user_id, 'folder', r.user_id::text);
    end if;
  end loop;
  return due;
end;
$$;

-- After the job has emptied the storage folder: delete the sign-in, which
-- removes every row that hangs off it, and keep the record that it was done.
create function public.complete_deletion(p_user uuid)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.deletion_requests where user_id = p_user and completed_at is null and cancelled_at is null) then
    raise exception 'no open deletion for this account' using errcode = 'no_data_found';
  end if;
  delete from auth.users where id = p_user;
  update public.deletion_requests set completed_at = now(), held_reason = null
  where user_id = p_user and completed_at is null and cancelled_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- account.export: everything about the signed-in person, as data. The app
-- adds short-lived links to each photo.
-- ---------------------------------------------------------------------------
create function public.export_my_data()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if exists (select 1 from public.teens where id = uid) then
    return jsonb_build_object(
      'kind', 'teen',
      'exportedAt', now(),
      'profile', (select jsonb_build_object('handle', handle, 'ageGroup', age_bracket, 'country', country, 'timezone', timezone, 'coachReviews', ai_coach_consent, 'joined', created_at) from public.teens where id = uid),
      'zones', coalesce((select jsonb_agg(zone_id) from public.teen_zones where teen_id = uid), '[]'::jsonb),
      'makes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'quest', q.title, 'zone', q.zone_id, 'day', m.local_day, 'status', m.status, 'storagePath', m.storage_path,
          'review', (select jsonb_build_object('worked', r.worked, 'tryNext', r.try_next, 'why', r.why, 'question', r.question, 'helpful', r.helpful,
                       'skillPoints', coalesce((select jsonb_object_agg(sp.skill_id, sp.points) from public.skill_points sp where sp.review_id = r.id), '{}'::jsonb))
                     from public.reviews r where r.make_id = m.id),
          'sentTo', (select count(*) from public.family_shares s where s.make_id = m.id)
        ) order by m.created_at)
        from public.makes m join public.quests q on q.id = m.quest_id
        where m.teen_id = uid and m.status not in ('blocked', 'held_for_review')), '[]'::jsonb),
      'postcards', coalesce((select jsonb_agg(jsonb_build_object('zone', zone_id, 'level', level, 'earned', created_at) order by created_at) from public.postcards where teen_id = uid), '[]'::jsonb),
      'cheersReceived', coalesce((
        select jsonb_agg(jsonb_build_object('cheer', c.cheer, 'on', c.created_at) order by c.created_at)
        from public.family_cheers c join public.family_shares s on s.id = c.share_id where s.teen_id = uid), '[]'::jsonb),
      'plus', (select jsonb_build_object('source', source, 'activeUntil', active_until) from public.entitlements where teen_id = uid)
    );
  elsif exists (select 1 from public.parents where id = uid) then
    return jsonb_build_object(
      'kind', 'parent',
      'exportedAt', now(),
      'profile', (select jsonb_build_object('name', display_name, 'adultCheck', adult_check, 'weeklyEmail', weekly_email, 'joined', created_at) from public.parents where id = uid),
      'linkedTeens', coalesce((select jsonb_agg(jsonb_build_object('handle', t.handle, 'since', l.consented_at, 'status', l.status)) from public.parent_links l join public.teens t on t.id = l.teen_id where l.parent_id = uid), '[]'::jsonb),
      'cheersSent', coalesce((select jsonb_agg(jsonb_build_object('cheer', cheer, 'on', created_at) order by created_at) from public.family_cheers where parent_id = uid), '[]'::jsonb)
    );
  end if;
  raise exception 'nothing to export' using errcode = 'no_data_found';
end;
$$;

-- ---------------------------------------------------------------------------
-- The admin site (staff only)
-- ---------------------------------------------------------------------------
create function public.admin_quest_weeks(p_status public.week_status default 'draft')
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id, 'zone', w.zone_id, 'weekOf', w.week_of, 'status', w.status, 'model', w.model, 'created', w.created_at,
      'quests', (select jsonb_agg(jsonb_build_object('day', q.week_day, 'title', q.title, 'brief', q.brief, 'minutes', q.minutes, 'trainsSkill', q.trains_skill_id, 'tips', to_jsonb(q.tips)) order by q.week_day)
                 from public.quests q where q.week_id = w.id)
    ) order by w.week_of, w.zone_id)
    from public.quest_weeks w where w.status = p_status), '[]'::jsonb);
end;
$$;

create function public.admin_decide_week(p_week_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  who text := private.require_staff();
begin
  if p_approve then
    perform public.approve_quest_week(p_week_id, who);
  else
    perform public.reject_quest_week(p_week_id, who, p_note);
  end if;
end;
$$;

create function public.admin_safety_queue()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', sq.id, 'makeId', sq.make_id, 'storagePath', m.storage_path, 'source', sq.source, 'result', sq.result,
      'reasons', to_jsonb(sq.reasons), 'created', sq.created_at, 'quest', q.title, 'zone', q.zone_id,
      'note', (select note from public.coach_flags f where f.make_id = sq.make_id)
    ) order by sq.created_at)
    from public.safety_queue sq join public.makes m on m.id = sq.make_id join public.quests q on q.id = m.quest_id
    where sq.resolved_at is null), '[]'::jsonb);
end;
$$;

-- released: back to the coach. Never for a known-imagery match.
-- kept_blocked / reported: stays blocked (reporting itself happens with the vendor).
-- removed: the make is deleted; the admin site removes the photo.
create function public.admin_resolve_safety(p_item uuid, p_resolution text)
returns text
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  who text := private.require_staff();
  sq public.safety_queue;
  path text;
begin
  select * into sq from public.safety_queue where id = p_item and resolved_at is null for update;
  if not found then
    raise exception 'queue item not found' using errcode = 'no_data_found';
  end if;
  if p_resolution = 'released' then
    if exists (select 1 from unnest(sq.reasons) r where r like 'hash_match:%') then
      raise exception 'a known-imagery match can never be released' using errcode = 'check_violation';
    end if;
    insert into public.safety_scans (make_id, result, reasons, vendor) values (sq.make_id, 'pass', '{released_by_staff}', 'staff:' || who)
    on conflict (make_id) do update set result = 'pass', reasons = excluded.reasons, vendor = excluded.vendor, scanned_at = now();
    update public.makes set status = 'reviewing', review_started_at = null where id = sq.make_id;
  elsif p_resolution in ('kept_blocked', 'reported') then
    update public.makes set status = 'blocked' where id = sq.make_id;
  elsif p_resolution = 'removed' then
    select storage_path into path from public.makes where id = sq.make_id;
  else
    raise exception 'unknown resolution %', p_resolution using errcode = 'check_violation';
  end if;
  update public.safety_queue set resolved_at = now(), resolution = p_resolution where id = sq.id;
  if p_resolution = 'removed' then
    delete from public.makes where id = sq.make_id;
  end if;
  return path;
end;
$$;

-- The weekly 1% coach spot check: a fixed sample of the week's reviews (at
-- least 5, when there are that many), with any grade already given.
create function public.admin_spot_check(p_week_of date)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  total int;
  take int;
begin
  perform private.require_staff();
  select count(*) into total from public.reviews r
  where r.created_at >= p_week_of and r.created_at < p_week_of + 7;
  take := greatest(ceil(total * 0.01)::int, least(5, total));
  return coalesce((
    select jsonb_agg(x.item order by x.k) from (
      select abs(hashtext(r.id::text)) as k, jsonb_build_object(
        'reviewId', r.id, 'storagePath', m.storage_path, 'quest', q.title, 'zone', q.zone_id,
        'worked', r.worked, 'tryNext', r.try_next, 'why', r.why, 'question', r.question, 'confidence', r.confidence, 'helpful', r.helpful,
        'grade', (select to_jsonb(g) - 'review_id' from public.review_grades g where g.review_id = r.id)) as item
      from public.reviews r join public.makes m on m.id = r.make_id join public.quests q on q.id = m.quest_id
      where r.created_at >= p_week_of and r.created_at < p_week_of + 7
      order by abs(hashtext(r.id::text))
      limit take
    ) x), '[]'::jsonb);
end;
$$;

create function public.admin_grade_review(p_review uuid, p_specific int, p_accurate int, p_kind int, p_actionable int, p_guardrail_break boolean, p_note text)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  who text := private.require_staff();
begin
  insert into public.review_grades (review_id, grader, specific, accurate, kind, actionable, guardrail_break, note)
  values (p_review, who, p_specific, p_accurate, p_kind, p_actionable, p_guardrail_break, nullif(p_note, ''))
  on conflict (review_id) do update set grader = excluded.grader, specific = excluded.specific, accurate = excluded.accurate,
    kind = excluded.kind, actionable = excluded.actionable, guardrail_break = excluded.guardrail_break, note = excluded.note, created_at = now();
end;
$$;

create function public.admin_deletions()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'requested', requested_at, 'completesBy', completes_by, 'completed', completed_at, 'held', held_reason) order by requested_at desc)
    from public.deletion_requests where cancelled_at is null and (completed_at is null or completed_at > now() - interval '30 days')), '[]'::jsonb);
end;
$$;

-- Staff can open photos in the queue and the spot check (Supabase only).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $p$create policy "makes: staff read" on storage.objects for select to authenticated
      using (bucket_id = 'makes' and private.staff_email(auth.uid()) is not null)$p$;
    execute $p$create policy "makes: staff remove" on storage.objects for delete to authenticated
      using (bucket_id = 'makes' and private.staff_email(auth.uid()) is not null)$p$;
  end if;
end;
$$;

revoke execute on function
  private.staff_email(uuid), private.require_staff(),
  public.request_account_deletion(), public.cancel_account_deletion(), public.my_deletion(),
  public.deletions_due(timestamptz), public.complete_deletion(uuid), public.export_my_data(),
  public.admin_quest_weeks(public.week_status), public.admin_decide_week(uuid, boolean, text),
  public.admin_safety_queue(), public.admin_resolve_safety(uuid, text),
  public.admin_spot_check(date), public.admin_grade_review(uuid, int, int, int, int, boolean, text),
  public.admin_deletions()
from public;
grant execute on function private.staff_email(uuid) to authenticated, service_role;
grant execute on function
  public.request_account_deletion(), public.cancel_account_deletion(), public.my_deletion(), public.export_my_data(),
  public.admin_quest_weeks(public.week_status), public.admin_decide_week(uuid, boolean, text),
  public.admin_safety_queue(), public.admin_resolve_safety(uuid, text),
  public.admin_spot_check(date), public.admin_grade_review(uuid, int, int, int, int, boolean, text),
  public.admin_deletions()
to authenticated;
grant execute on function public.deletions_due(timestamptz), public.complete_deletion(uuid) to service_role;
