-- A9: Plus and payments.
--
-- Purchases happen in the stores (App Store, Google Play, through RevenueCat)
-- for 18–19s, and on the parent page (Stripe) for everyone, so under-18s
-- always need a parent. Each store webhook becomes one entitlement event,
-- applied once (the same event twice changes nothing). Plus gives deeper
-- coaching and a second take on a quest. Contract: packages/contract/src/plus.ts.

create type public.entitlement_kind as enum ('active', 'cancelled', 'expired', 'refunded', 'billing_issue');

create table public.entitlement_events (
  event_id text primary key,
  teen_id uuid, -- no foreign key: the record outlives a deleted account
  source public.entitlement_source not null,
  kind public.entitlement_kind not null,
  active_until timestamptz,
  sandbox boolean not null default false,
  applied boolean not null,
  received_at timestamptz not null default now()
);
alter table public.entitlement_events enable row level security; -- server only
revoke all on public.entitlement_events from authenticated;

-- Which Stripe customer is which parent, for the "manage Plus" page.
create table public.billing_customers (
  parent_id uuid primary key references public.parents (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);
alter table public.billing_customers enable row level security; -- server only
revoke all on public.billing_customers from authenticated;

create function private.has_plus(p_teen uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.entitlements where teen_id = p_teen and active_until > now());
$$;

-- Applies one store event. Returns 'applied', 'duplicate', 'unknown_teen'
-- or 'ignored' (a billing issue: the store is still retrying).
create function public.apply_entitlement_event(
  p_event_id text, p_teen_id uuid, p_source public.entitlement_source,
  p_kind public.entitlement_kind, p_active_until timestamptz, p_sandbox boolean
)
returns text
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  known boolean := exists (select 1 from public.teens where id = p_teen_id);
begin
  if exists (select 1 from public.entitlement_events where event_id = p_event_id) then
    return 'duplicate';
  end if;
  insert into public.entitlement_events (event_id, teen_id, source, kind, active_until, sandbox, applied)
  values (p_event_id, p_teen_id, p_source, p_kind, p_active_until, coalesce(p_sandbox, false), known and p_kind <> 'billing_issue');
  if not known then
    return 'unknown_teen';
  end if;

  if p_kind in ('active', 'cancelled') then
    if p_active_until is null then
      raise exception 'an active subscription needs an end date' using errcode = 'check_violation';
    end if;
    insert into public.entitlements (teen_id, source, active_until, updated_at)
    values (p_teen_id, p_source, p_active_until, now())
    on conflict (teen_id) do update set source = excluded.source, active_until = excluded.active_until, updated_at = now();
  elsif p_kind in ('expired', 'refunded') then
    update public.entitlements set active_until = least(active_until, now()), updated_at = now()
    where teen_id = p_teen_id and source = p_source;
  else
    return 'ignored';
  end if;
  return 'applied';
end;
$$;

create function public.save_billing_customer(p_parent_id uuid, p_customer_id text)
returns void
language sql volatile security definer
set search_path = public, pg_temp
as $$
  insert into public.billing_customers (parent_id, stripe_customer_id) values (p_parent_id, p_customer_id)
  on conflict (parent_id) do update set stripe_customer_id = excluded.stripe_customer_id;
$$;

create function public.billing_customer_for(p_parent_id uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$ select stripe_customer_id from public.billing_customers where parent_id = p_parent_id $$;

-- plus.status, for the teen.
create function public.plus_status()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'active', coalesce(e.active_until > now(), false),
    'until', case when e.active_until > now() then e.active_until end,
    'source', case when e.active_until > now() then e.source end,
    'canBuyInApp', t.age_bracket = '18_19')
  from public.teens t left join public.entitlements e on e.teen_id = t.id
  where t.id = auth.uid();
$$;

-- parent.plus, for the parent page.
create function public.parent_plus()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'teenId', l.teen_id,
    'active', coalesce(e.active_until > now(), false),
    'until', case when e.active_until > now() then e.active_until end,
    'source', case when e.active_until > now() then e.source end) order by l.consented_at), '[]'::jsonb)
  from public.parent_links l left join public.entitlements e on e.teen_id = l.teen_id
  where l.parent_id = auth.uid() and l.status = 'active';
$$;

-- Plus perks: the coach thinks harder, and a quest can be taken twice.
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
    'plus', private.has_plus(m.teen_id),
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

  -- One photo per quest (PRD R12); with Plus, one second take (A9). A photo
  -- the safety scan blocked, or one the coach asked to retake, doesn't count.
  if (
    select count(*) from public.makes
    where teen_id = uid and quest_id = p_quest_id and local_day = d and status not in ('blocked', 'retake')
  ) >= (case when private.has_plus(uid) then 2 else 1 end) then
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

revoke execute on function
  private.has_plus(uuid),
  public.apply_entitlement_event(text, uuid, public.entitlement_source, public.entitlement_kind, timestamptz, boolean),
  public.save_billing_customer(uuid, text),
  public.billing_customer_for(uuid),
  public.plus_status(),
  public.parent_plus()
from public;
grant execute on function
  private.has_plus(uuid),
  public.apply_entitlement_event(text, uuid, public.entitlement_source, public.entitlement_kind, timestamptz, boolean),
  public.save_billing_customer(uuid, text),
  public.billing_customer_for(uuid)
to service_role;
grant execute on function public.plus_status(), public.parent_plus() to authenticated;
