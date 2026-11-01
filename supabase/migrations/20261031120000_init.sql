-- Lean V1 schema: Studio for everyone, family sharing, no walls yet.
--
-- Teens and parents are Supabase auth users. Row-level security is on for every
-- table: the app (role "authenticated") sees only its own rows; server functions
-- use the service role. Only the age bracket is stored, never a birth date.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.age_bracket as enum ('13_15', '16_17', '18_19');
create type public.app_mode as enum ('studio', 'walls');
create type public.zone_status as enum ('live', 'coming', 'off');
create type public.quest_status as enum ('draft', 'approved', 'retired');
create type public.make_status as enum ('uploaded', 'scanning', 'blocked', 'held_for_review', 'reviewing', 'reviewed');
create type public.scan_result as enum ('pass', 'block', 'human_review');
create type public.link_status as enum ('pending', 'active', 'revoked');
create type public.cheer as enum ('great_light', 'great_framing', 'great_moment', 'clever_idea', 'love_this');
create type public.entitlement_source as enum ('app_store', 'google_play', 'web');

-- Helpers live in a schema the API doesn't expose.
create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table public.zones (
  id text primary key,
  name text not null,
  status public.zone_status not null default 'coming',
  sort smallint not null default 0
);

create table public.skills (
  id text primary key, -- '<zone>.<skill>'
  zone_id text not null references public.zones (id),
  name text not null,
  sort smallint not null default 0,
  constraint skill_id_prefix check (id like (zone_id || '.%'))
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.teens (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique check (handle ~ '^[A-Za-z]+-[0-9]{2,4}$'),
  age_bracket public.age_bracket not null,
  country char(2) not null,
  region text, -- state or province, for the rules table (e.g. 'TX', 'QC')
  mode public.app_mode not null default 'studio',
  ai_coach_consent boolean not null default false,
  ai_coach_consent_at timestamptz,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);

create table public.parents (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.parent_links (
  id uuid primary key default gen_random_uuid(),
  teen_id uuid not null references public.teens (id) on delete cascade,
  parent_id uuid references public.parents (id) on delete cascade, -- null until the parent accepts
  status public.link_status not null default 'pending',
  invite_token_hash text,
  invite_expires_at timestamptz,
  consented_at timestamptz,
  created_at timestamptz not null default now(),
  constraint active_link_is_complete check (status <> 'active' or (parent_id is not null and consented_at is not null))
);
create unique index parent_links_one_active on public.parent_links (teen_id, parent_id) where status = 'active';

create table public.teen_zones (
  teen_id uuid not null references public.teens (id) on delete cascade,
  zone_id text not null references public.zones (id),
  picked_at timestamptz not null default now(),
  primary key (teen_id, zone_id)
);

-- ---------------------------------------------------------------------------
-- Quests
-- ---------------------------------------------------------------------------
create table public.quests (
  id uuid primary key default gen_random_uuid(),
  zone_id text not null references public.zones (id),
  title text not null check (char_length(title) between 3 and 60),
  brief text not null check (char_length(brief) between 20 and 280),
  minutes smallint not null check (minutes between 5 and 20),
  trains_skill_id text not null references public.skills (id),
  tips text[] not null default '{}',
  status public.quest_status not null default 'draft',
  written_by text not null default 'agent' check (written_by in ('agent', 'human')),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

-- One quest per zone per day.
create table public.quest_schedule (
  day date not null,
  zone_id text not null references public.zones (id),
  quest_id uuid not null references public.quests (id),
  primary key (day, zone_id)
);

-- ---------------------------------------------------------------------------
-- Makes, safety and reviews
-- ---------------------------------------------------------------------------
create table public.makes (
  id uuid primary key default gen_random_uuid(),
  teen_id uuid not null references public.teens (id) on delete cascade,
  quest_id uuid not null references public.quests (id),
  storage_path text not null unique,
  status public.make_status not null default 'uploaded',
  created_at timestamptz not null default now(),
  constraint path_in_teen_folder check (storage_path like (teen_id::text || '/%'))
);
create index makes_teen_created on public.makes (teen_id, created_at desc);

create table public.safety_scans (
  make_id uuid primary key references public.makes (id) on delete cascade,
  result public.scan_result not null,
  reasons text[] not null default '{}',
  vendor text not null,
  scanned_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  make_id uuid not null unique references public.makes (id) on delete cascade,
  teen_id uuid not null references public.teens (id) on delete cascade,
  worked text not null,
  try_next text not null,
  why text not null,
  question text,
  lesson_id text,
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  model text not null,
  prompt_version text not null,
  helpful boolean,
  created_at timestamptz not null default now()
);

create table public.skill_points (
  id uuid primary key default gen_random_uuid(),
  teen_id uuid not null references public.teens (id) on delete cascade,
  review_id uuid not null references public.reviews (id) on delete cascade,
  skill_id text not null references public.skills (id),
  points smallint not null check (points between 0 and 2),
  created_at timestamptz not null default now(),
  unique (review_id, skill_id)
);

create table public.postcards (
  id uuid primary key default gen_random_uuid(),
  teen_id uuid not null references public.teens (id) on delete cascade,
  zone_id text not null references public.zones (id),
  level smallint not null check (level between 2 and 5),
  make_id uuid references public.makes (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (teen_id, zone_id, level)
);

-- ---------------------------------------------------------------------------
-- Family sharing
-- ---------------------------------------------------------------------------
create table public.family_shares (
  id uuid primary key default gen_random_uuid(),
  make_id uuid not null references public.makes (id) on delete cascade,
  teen_id uuid not null references public.teens (id) on delete cascade,
  parent_id uuid not null references public.parents (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (make_id, parent_id)
);

-- One cheer back per share.
create table public.family_cheers (
  share_id uuid primary key references public.family_shares (id) on delete cascade,
  parent_id uuid not null references public.parents (id) on delete cascade,
  cheer public.cheer not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Settings, plans, deletion
-- ---------------------------------------------------------------------------
create table public.notification_prefs (
  teen_id uuid primary key references public.teens (id) on delete cascade,
  drop_time time not null default '20:00',
  quiet_start time not null default '21:00',
  quiet_end time not null default '07:00',
  daily_reminder boolean not null default false
);

-- Written only by the payments webhook (A9).
create table public.entitlements (
  teen_id uuid primary key references public.teens (id) on delete cascade,
  plan text not null default 'plus' check (plan = 'plus'),
  source public.entitlement_source not null,
  active_until timestamptz not null,
  updated_at timestamptz not null default now()
);

-- No foreign key on purpose: the record outlives the account it deletes.
create table public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  requested_at timestamptz not null default now(),
  completes_by timestamptz not null default (now() + interval '30 days'),
  completed_at timestamptz
);

-- Skill points per teen per zone; levels are computed in @quest/contract.
create view public.zone_progress with (security_invoker = true) as
select sp.teen_id, s.zone_id, sum(sp.points)::int as points
from public.skill_points sp
join public.skills s on s.id = sp.skill_id
group by sp.teen_id, s.zone_id;

-- ---------------------------------------------------------------------------
-- Integrity rules (apply to every role, including server functions)
-- ---------------------------------------------------------------------------
create function private.is_linked_parent(p_teen uuid, p_parent uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.parent_links
    where teen_id = p_teen and parent_id = p_parent and status = 'active'
  );
$$;

create function private.teen_zones_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from public.teen_zones where teen_id = new.teen_id) >= 3 then
    raise exception 'a teen can pick at most 3 zones' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.zones where id = new.zone_id and status = 'live') then
    raise exception 'zone % is not open', new.zone_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger teen_zones_guard before insert on public.teen_zones
for each row execute function private.teen_zones_guard();

create function private.skill_points_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.reviews r
    join public.makes m on m.id = r.make_id
    join public.quests q on q.id = m.quest_id
    join public.skills s on s.id = new.skill_id
    where r.id = new.review_id and s.zone_id = q.zone_id and r.teen_id = new.teen_id
  ) then
    raise exception 'skill % does not belong to this review''s zone or teen', new.skill_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger skill_points_guard before insert on public.skill_points
for each row execute function private.skill_points_guard();

-- A make can only go to an actively linked parent, and only after its safety
-- scan and review (nothing leaves the phone before that).
create function private.family_shares_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.makes where id = new.make_id and teen_id = new.teen_id and status = 'reviewed') then
    raise exception 'only your own reviewed makes can be shared' using errcode = 'check_violation';
  end if;
  if not private.is_linked_parent(new.teen_id, new.parent_id) then
    raise exception 'that parent is not linked' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger family_shares_guard before insert on public.family_shares
for each row execute function private.family_shares_guard();

create function private.family_cheers_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.family_shares where id = new.share_id and parent_id = new.parent_id) then
    raise exception 'only the parent a make was sent to can cheer it' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger family_cheers_guard before insert on public.family_cheers
for each row execute function private.family_cheers_guard();

-- ---------------------------------------------------------------------------
-- Privileges. Supabase grants broad table rights by default; RLS below narrows
-- them. Anonymous users get nothing: every screen needs a signed-in user.
-- ---------------------------------------------------------------------------
grant usage on schema private to authenticated, service_role;
grant execute on function private.is_linked_parent(uuid, uuid) to authenticated, service_role;

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
revoke all on all tables in schema public from anon;

-- Column-level limits: the app may change only these columns.
revoke update on public.teens from authenticated;
grant update (timezone, ai_coach_consent, ai_coach_consent_at) on public.teens to authenticated;
revoke update on public.parents from authenticated;
grant update (display_name) on public.parents to authenticated;
revoke update on public.reviews from authenticated;
grant update (helpful) on public.reviews to authenticated;
revoke select on public.parent_links from authenticated;
grant select (id, teen_id, parent_id, status, invite_expires_at, consented_at, created_at) on public.parent_links to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.zones enable row level security;
alter table public.skills enable row level security;
alter table public.teens enable row level security;
alter table public.parents enable row level security;
alter table public.parent_links enable row level security;
alter table public.teen_zones enable row level security;
alter table public.quests enable row level security;
alter table public.quest_schedule enable row level security;
alter table public.makes enable row level security;
alter table public.safety_scans enable row level security; -- no policies: server only
alter table public.reviews enable row level security;
alter table public.skill_points enable row level security;
alter table public.postcards enable row level security;
alter table public.family_shares enable row level security;
alter table public.family_cheers enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.entitlements enable row level security;
alter table public.deletion_requests enable row level security;

create policy zones_read on public.zones for select to authenticated using (true);
create policy skills_read on public.skills for select to authenticated using (true);

create policy teens_self_read on public.teens for select to authenticated
  using (id = auth.uid());
create policy teens_parent_read on public.teens for select to authenticated
  using (private.is_linked_parent(id, auth.uid()));
create policy teens_self_update on public.teens for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy parents_self_read on public.parents for select to authenticated
  using (id = auth.uid());
create policy parents_teen_read on public.parents for select to authenticated
  using (private.is_linked_parent(auth.uid(), id));
create policy parents_self_update on public.parents for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy parent_links_read on public.parent_links for select to authenticated
  using (teen_id = auth.uid() or parent_id = auth.uid());

create policy teen_zones_own on public.teen_zones for all to authenticated
  using (teen_id = auth.uid()) with check (teen_id = auth.uid());

create policy quests_approved on public.quests for select to authenticated
  using (status = 'approved');
create policy quest_schedule_read on public.quest_schedule for select to authenticated using (true);

create policy makes_own_read on public.makes for select to authenticated
  using (teen_id = auth.uid());
create policy makes_own_insert on public.makes for insert to authenticated
  with check (teen_id = auth.uid() and status = 'uploaded');
create policy makes_own_delete on public.makes for delete to authenticated
  using (teen_id = auth.uid());
create policy makes_shared_read on public.makes for select to authenticated
  using (exists (select 1 from public.family_shares fs where fs.make_id = makes.id and fs.parent_id = auth.uid()));

create policy reviews_own_read on public.reviews for select to authenticated
  using (teen_id = auth.uid());
create policy reviews_own_rate on public.reviews for update to authenticated
  using (teen_id = auth.uid()) with check (teen_id = auth.uid());

create policy skill_points_own on public.skill_points for select to authenticated
  using (teen_id = auth.uid());

create policy postcards_read on public.postcards for select to authenticated
  using (teen_id = auth.uid() or private.is_linked_parent(teen_id, auth.uid()));

create policy family_shares_teen_insert on public.family_shares for insert to authenticated
  with check (teen_id = auth.uid());
create policy family_shares_read on public.family_shares for select to authenticated
  using (teen_id = auth.uid() or parent_id = auth.uid());

create policy family_cheers_parent_insert on public.family_cheers for insert to authenticated
  with check (parent_id = auth.uid());
create policy family_cheers_read on public.family_cheers for select to authenticated
  using (
    parent_id = auth.uid()
    or exists (select 1 from public.family_shares fs where fs.id = family_cheers.share_id and fs.teen_id = auth.uid())
  );

create policy notification_prefs_own on public.notification_prefs for all to authenticated
  using (teen_id = auth.uid()) with check (teen_id = auth.uid());

create policy entitlements_read on public.entitlements for select to authenticated
  using (teen_id = auth.uid() or private.is_linked_parent(teen_id, auth.uid()));

create policy deletion_requests_own_insert on public.deletion_requests for insert to authenticated
  with check (user_id = auth.uid());
create policy deletion_requests_own_read on public.deletion_requests for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Photo storage (Supabase only; skipped on plain Postgres). Private bucket,
-- one folder per teen. Parents get short-lived signed links from A8, never
-- direct access.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('makes', 'makes', false)
    on conflict (id) do nothing;
    execute $p$create policy "makes: teen reads own" on storage.objects for select to authenticated
      using (bucket_id = 'makes' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy "makes: teen uploads own" on storage.objects for insert to authenticated
      with check (bucket_id = 'makes' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy "makes: teen deletes own" on storage.objects for delete to authenticated
      using (bucket_id = 'makes' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
end;
$$;
