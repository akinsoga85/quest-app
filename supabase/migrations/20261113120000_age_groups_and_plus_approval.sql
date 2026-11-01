-- Age groups that move up, and a parent's yes before a 16–17 buys Plus.
--
-- 1. Teens who give their birth month and year at sign-up keep the month
--    their age group ends (never the birth date). A daily job moves them up
--    on that day: free Plus stops at 16, and a parent's consent is no longer
--    needed at 18. Teens placed by their app store's age range are asked
--    again every 6 months (AGE_RECHECK_MONTHS) and moved up when the store
--    says so. Groups only ever move up.
-- 2. A 16–17 buys Plus in the app only after a linked parent says yes on the
--    parent page. A yes lasts 7 days (PLUS_APPROVAL_DAYS).
-- Contract: packages/contract/src/age.ts and plus.ts.

alter table public.teens
  add column age_group_ends date, -- first day of the month they move up; null for 18–19 and store-placed teens
  add column age_checked_at timestamptz not null default now(),
  add constraint teens_age_group_ends_first check (age_group_ends is null or extract(day from age_group_ends) = 1);

-- ---------------------------------------------------------------------------
-- teen.create, now with the month the age group ends
-- ---------------------------------------------------------------------------
drop function public.create_teen_profile(public.age_bracket, public.age_source, text, text, text);

create function public.create_teen_profile(
  p_age_bracket public.age_bracket,
  p_age_source public.age_source,
  p_country text,
  p_region text,
  p_timezone text,
  p_age_group_ends date default null
)
returns table (handle text, mode public.app_mode, needs_parent boolean)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  h text;
  m public.app_mode;
  ends date := case when p_age_bracket = '18_19' or p_age_source = 'store' then null else p_age_group_ends end;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.teens where id = uid) then
    raise exception 'profile already exists' using errcode = 'unique_violation';
  end if;
  if exists (select 1 from public.parents where id = uid) then
    raise exception 'this is a parent account' using errcode = 'check_violation';
  end if;
  if p_country !~ '^[A-Z]{2}$' then
    raise exception 'country must be a two-letter code' using errcode = 'check_violation';
  end if;
  if coalesce(p_timezone, '') = '' then
    raise exception 'timezone is required' using errcode = 'check_violation';
  end if;
  if p_age_source = 'self_declared' and p_age_bracket <> '18_19' then
    if ends is null then
      raise exception 'self-declared ages under 18 need the month the age group ends' using errcode = 'check_violation';
    end if;
    -- Within the group's span: up to 3 years ahead for 13–15, 2 for 16–17.
    if extract(day from ends) <> 1 or ends <= current_date
       or ends > (date_trunc('month', current_date) + case when p_age_bracket = '13_15' then interval '3 years 1 month' else interval '2 years 1 month' end)::date then
      raise exception 'that month doesn''t fit the age group' using errcode = 'check_violation';
    end if;
  end if;

  h := private.new_handle();
  m := private.mode_for(p_country, p_age_bracket);
  insert into public.teens (id, handle, age_bracket, age_source, country, region, mode, timezone, age_group_ends)
  values (uid, h, p_age_bracket, p_age_source, p_country, nullif(p_region, ''), m, p_timezone, ends);
  insert into public.notification_prefs (teen_id) values (uid);

  return query select h, m, p_age_bracket <> '18_19';
end;
$$;

-- The daily job (account-deletions, packages/ops): everyone whose month has
-- come moves up one group, or two if the job was down for years.
create function public.advance_age_groups(p_today date default current_date)
returns int
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  moved int := 0;
  k int;
begin
  loop
    update public.teens set
      age_bracket = (case age_bracket when '13_15' then '16_17' else '18_19' end)::public.age_bracket,
      age_group_ends = case when age_bracket = '13_15' then (age_group_ends + interval '2 years')::date end,
      age_checked_at = now()
    where age_group_ends is not null and age_group_ends <= p_today and age_bracket in ('13_15', '16_17');
    get diagnostics k = row_count;
    exit when k = 0;
    moved := moved + k;
  end loop;
  return moved;
end;
$$;

-- age.recheck: a store-placed teen's app asks the store again and reports
-- what it says. One group at a time, at most once a month, never down.
create function public.confirm_age_group(p_age_bracket public.age_bracket)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  t public.teens;
  moved boolean := false;
begin
  select * into t from public.teens where id = auth.uid() for update;
  if not found then
    raise exception 'no teen profile' using errcode = 'no_data_found';
  end if;
  if t.age_source <> 'store' then
    raise exception 'only ages from the app store are checked again' using errcode = 'check_violation';
  end if;
  if p_age_bracket > t.age_bracket and t.age_checked_at < now() - interval '30 days' then
    update public.teens set
      age_bracket = (case t.age_bracket when '13_15' then '16_17' else '18_19' end)::public.age_bracket,
      age_group_ends = null,
      age_checked_at = now()
    where id = t.id
    returning age_bracket into t.age_bracket;
    moved := true;
  else
    update public.teens set age_checked_at = now() where id = t.id;
  end if;
  return jsonb_build_object('ageBracket', t.age_bracket, 'moved', moved);
end;
$$;

-- ---------------------------------------------------------------------------
-- A parent's yes before a 16–17 buys Plus in the app
-- ---------------------------------------------------------------------------
create table public.plus_requests (
  id uuid primary key default gen_random_uuid(),
  teen_id uuid not null references public.teens (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.parents (id) on delete set null
);
create index plus_requests_teen on public.plus_requests (teen_id, requested_at desc);
alter table public.plus_requests enable row level security; -- through the functions below only
revoke all on public.plus_requests from authenticated;

-- Where the teen's latest request stands. Each answer lasts 7 days.
create function private.plus_approval(p_teen uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when status = 'pending' and requested_at > now() - interval '7 days' then 'pending'
      when status = 'approved' and decided_at > now() - interval '7 days' then 'approved'
      when status = 'declined' and decided_at > now() - interval '7 days' then 'declined'
    end
    from public.plus_requests where teen_id = p_teen order by requested_at desc limit 1), 'none');
$$;

-- plus.request
create function public.request_plus()
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  t public.teens;
  current text;
begin
  select * into t from public.teens where id = auth.uid();
  if not found or t.age_bracket <> '16_17' then
    raise exception 'only 16–17s ask a parent for Plus' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.parent_links where teen_id = t.id and status = 'active') then
    raise exception 'link a parent first' using errcode = 'check_violation';
  end if;
  if private.has_plus(t.id) then
    raise exception 'Plus is already on' using errcode = 'check_violation';
  end if;
  current := private.plus_approval(t.id);
  if current in ('pending', 'approved') then
    return jsonb_build_object('approval', current);
  end if;
  if current = 'declined' and exists (
    select 1 from public.plus_requests where teen_id = t.id and decided_at > now() - interval '1 day') then
    raise exception 'ask again tomorrow' using errcode = 'check_violation';
  end if;
  insert into public.plus_requests (teen_id) values (t.id);
  return jsonb_build_object('approval', 'pending');
end;
$$;

-- parent.decidePlus: only a parent actively linked to the teen.
create function public.decide_plus_request(p_request_id uuid, p_approve boolean)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  r public.plus_requests;
begin
  select * into r from public.plus_requests where id = p_request_id for update;
  if not found or not private.is_linked_parent(r.teen_id, auth.uid()) then
    raise exception 'no such request' using errcode = 'no_data_found';
  end if;
  if r.status <> 'pending' or r.requested_at <= now() - interval '7 days' then
    raise exception 'this request has already been answered or has expired' using errcode = 'check_violation';
  end if;
  update public.plus_requests set status = case when p_approve then 'approved' else 'declined' end, decided_at = now(), decided_by = auth.uid()
  where id = r.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- plus.status, with the parent's yes for 16–17s.
create or replace function public.plus_status()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with t as (
    select t.id, t.age_bracket,
      exists (select 1 from public.parent_links l where l.teen_id = t.id and l.status = 'active') as linked,
      private.plus_approval(t.id) as approval,
      e.active_until > now() as paid, e.active_until, e.source
    from public.teens t left join public.entitlements e on e.teen_id = t.id
    where t.id = auth.uid())
  select jsonb_build_object(
    'active', age_bracket = '13_15' or coalesce(paid, false),
    'included', age_bracket = '13_15',
    'until', case when age_bracket <> '13_15' and paid then active_until end,
    'source', case when age_bracket <> '13_15' and paid then source end,
    'canBuyInApp', age_bracket = '18_19' or (age_bracket = '16_17' and linked and approval = 'approved'),
    'needsParent', age_bracket = '16_17' and not linked,
    'approval', case when age_bracket = '16_17' then approval else 'none' end)
  from t;
$$;

-- parent.plus, with any request waiting for this parent's answer.
create or replace function public.parent_plus()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'teenId', l.teen_id,
    'active', t.age_bracket = '13_15' or coalesce(e.active_until > now(), false),
    'included', t.age_bracket = '13_15',
    'until', case when t.age_bracket <> '13_15' and e.active_until > now() then e.active_until end,
    'source', case when t.age_bracket <> '13_15' and e.active_until > now() then e.source end,
    'request', (
      select jsonb_build_object('id', r.id, 'requestedAt', r.requested_at)
      from public.plus_requests r
      where r.teen_id = l.teen_id and r.status = 'pending' and r.requested_at > now() - interval '7 days' and t.age_bracket = '16_17'
      order by r.requested_at desc limit 1)
  ) order by l.consented_at), '[]'::jsonb)
  from public.parent_links l
  join public.teens t on t.id = l.teen_id
  left join public.entitlements e on e.teen_id = l.teen_id
  where l.parent_id = auth.uid() and l.status = 'active';
$$;

-- account.export: the profile now includes the month the age group ends.
create or replace function public.export_my_data()
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
      'profile', (select jsonb_build_object('handle', handle, 'ageGroup', age_bracket, 'ageGroupEnds', age_group_ends, 'country', country, 'timezone', timezone, 'coachReviews', ai_coach_consent, 'joined', created_at) from public.teens where id = uid),
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
      'plus', (select jsonb_build_object('source', source, 'activeUntil', active_until) from public.entitlements where teen_id = uid),
      'plusRequests', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'requested', requested_at, 'decided', decided_at) order by requested_at) from public.plus_requests where teen_id = uid), '[]'::jsonb)
    );
  elsif exists (select 1 from public.parents where id = uid) then
    return jsonb_build_object(
      'kind', 'parent',
      'exportedAt', now(),
      'profile', (select jsonb_build_object('name', display_name, 'adultCheck', adult_check, 'weeklyEmail', weekly_email, 'joined', created_at) from public.parents where id = uid),
      'linkedTeens', coalesce((select jsonb_agg(jsonb_build_object('handle', t.handle, 'since', l.consented_at, 'status', l.status)) from public.parent_links l join public.teens t on t.id = l.teen_id where l.parent_id = uid), '[]'::jsonb),
      'cheersSent', coalesce((select jsonb_agg(jsonb_build_object('cheer', cheer, 'on', created_at) order by created_at) from public.family_cheers where parent_id = uid), '[]'::jsonb),
      'plusDecisions', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'decided', decided_at) order by decided_at) from public.plus_requests where decided_by = uid), '[]'::jsonb)
    );
  end if;
  raise exception 'nothing to export' using errcode = 'no_data_found';
end;
$$;

revoke execute on function
  public.create_teen_profile(public.age_bracket, public.age_source, text, text, text, date),
  public.advance_age_groups(date),
  public.confirm_age_group(public.age_bracket),
  private.plus_approval(uuid),
  public.request_plus(),
  public.decide_plus_request(uuid, boolean)
from public;
grant execute on function
  public.create_teen_profile(public.age_bracket, public.age_source, text, text, text, date),
  public.confirm_age_group(public.age_bracket),
  public.request_plus(),
  public.decide_plus_request(uuid, boolean)
to authenticated;
grant execute on function public.advance_age_groups(date), private.plus_approval(uuid) to service_role;
