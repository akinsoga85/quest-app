-- A1: sign-up, age and parent consent.
--
-- The app never writes these tables directly: it calls the functions below
-- (security definer), which check who is calling and keep the rules in one
-- place. Contract: packages/contract/src/api.ts (entries with `rpc`).

create type public.age_source as enum ('store', 'self_declared');
alter table public.teens add column age_source public.age_source not null default 'self_declared';

-- One-row settings table. Walls stay off for Lean V1.
create table public.app_config (
  id boolean primary key default true check (id),
  walls_live boolean not null default false
);
insert into public.app_config (id) values (true) on conflict do nothing;
alter table public.app_config enable row level security;
create policy app_config_read on public.app_config for select to authenticated using (true);
revoke insert, update, delete on public.app_config from authenticated;

-- Consent now goes through set_ai_coach_consent, which stamps the time.
revoke update (ai_coach_consent, ai_coach_consent_at) on public.teens from authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Mirrors modeFor() in packages/contract/src/age.ts (db tests compare them).
create function private.mode_for(p_country text, p_bracket public.age_bracket)
returns public.app_mode
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when not coalesce((select walls_live from public.app_config), false) then 'studio'::public.app_mode
    when upper(p_country) = 'CA' and p_bracket = '13_15' then 'studio'::public.app_mode
    else 'walls'::public.app_mode
  end;
$$;

-- Handles like BlueFox-482: made by the app, never a real name.
create function private.new_handle()
returns text
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  adjectives text[] := array['Blue','Mint','Paper','Soft','River','Night','Amber','Quiet','Bright','Lucky',
    'Silver','Copper','Velvet','Sunny','Misty','Coral','Indigo','Maple','Cloud','Pebble'];
  animals text[] := array['Fox','Owl','Kite','Comet','Lynx','Moth','Heron','Otter','Wren','Panda',
    'Finch','Hare','Seal','Koala','Robin','Gecko','Lark','Badger','Crane','Puffin'];
  h text;
begin
  for i in 1..50 loop
    h := adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
      || animals[1 + floor(random() * array_length(animals, 1))::int]
      || '-' || (10 + floor(random() * 990))::int;
    if not exists (select 1 from public.teens where handle = h) then
      return h;
    end if;
  end loop;
  raise exception 'could not find a free handle';
end;
$$;

-- Coach reviews need the teen's own yes, and for under-18s an active parent
-- link: nothing leaves the phone before that. A3, A4 and A5 call this.
create function private.coach_allowed(p_teen uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select t.ai_coach_consent
      and (t.age_bracket = '18_19' or exists (
        select 1 from public.parent_links l where l.teen_id = t.id and l.status = 'active'))
    from public.teens t where t.id = p_teen
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- teen.create
-- ---------------------------------------------------------------------------
create function public.create_teen_profile(
  p_age_bracket public.age_bracket,
  p_age_source public.age_source,
  p_country text,
  p_region text,
  p_timezone text
)
returns table (handle text, mode public.app_mode, needs_parent boolean)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  h text;
  m public.app_mode;
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

  h := private.new_handle();
  m := private.mode_for(p_country, p_age_bracket);
  insert into public.teens (id, handle, age_bracket, age_source, country, region, mode, timezone)
  values (uid, h, p_age_bracket, p_age_source, p_country, nullif(p_region, ''), m, p_timezone);
  insert into public.notification_prefs (teen_id) values (uid);

  return query select h, m, p_age_bracket <> '18_19';
end;
$$;

-- ---------------------------------------------------------------------------
-- signup.abandon: under-13s (and anyone who stops) leave nothing behind.
-- ---------------------------------------------------------------------------
create function public.abandon_signup()
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.teens where id = uid) or exists (select 1 from public.parents where id = uid) then
    raise exception 'account already set up: use account deletion instead' using errcode = 'check_violation';
  end if;
  delete from auth.users where id = uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- parent.invite: a fresh link each time; older pending links stop working.
-- Only a hash of the token is stored.
-- ---------------------------------------------------------------------------
create function public.create_parent_invite()
returns table (token text, expires_at timestamptz)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  t text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  exp timestamptz := now() + interval '7 days';
begin
  if not exists (select 1 from public.teens where id = uid) then
    raise exception 'only teens can invite a parent' using errcode = 'insufficient_privilege';
  end if;
  update public.parent_links
     set status = 'revoked', invite_token_hash = null
   where teen_id = uid and status = 'pending';
  insert into public.parent_links (teen_id, status, invite_token_hash, invite_expires_at)
  values (uid, 'pending', encode(sha256(convert_to(t, 'UTF8')), 'hex'), exp);
  return query select t, exp;
end;
$$;

-- ---------------------------------------------------------------------------
-- parent.accept: the signed-in parent gives consent with the teen's link.
-- The parent page (A8) asks for the adult check before calling this.
-- ---------------------------------------------------------------------------
create function public.accept_parent_invite(p_token text)
returns table (teen_handle text)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  link public.parent_links;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.teens where id = uid) then
    raise exception 'teen accounts cannot be parents' using errcode = 'check_violation';
  end if;

  select * into link from public.parent_links
   where status = 'pending'
     and invite_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     and invite_expires_at > now()
   for update;
  if not found then
    raise exception 'invite not found or expired' using errcode = 'no_data_found';
  end if;

  insert into public.parents (id) values (uid) on conflict (id) do nothing;

  if exists (select 1 from public.parent_links where teen_id = link.teen_id and parent_id = uid and status = 'active') then
    -- Already linked: retire this invite rather than creating a duplicate.
    update public.parent_links set status = 'revoked', invite_token_hash = null where id = link.id;
  else
    update public.parent_links
       set parent_id = uid, status = 'active', consented_at = now(), invite_token_hash = null
     where id = link.id;
  end if;

  return query select t.handle from public.teens t where t.id = link.teen_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- ai.consent
-- ---------------------------------------------------------------------------
create function public.set_ai_coach_consent(p_allow boolean, p_teen_id uuid default null)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  target uuid := coalesce(p_teen_id, auth.uid());
begin
  if uid is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  if target <> uid then
    if not private.is_linked_parent(target, uid) then
      raise exception 'only the teen or a linked parent can change this' using errcode = 'insufficient_privilege';
    end if;
    if p_allow then
      raise exception 'a parent can switch coach reviews off, not on' using errcode = 'insufficient_privilege';
    end if;
  end if;
  update public.teens
     set ai_coach_consent = p_allow,
         ai_coach_consent_at = case when p_allow then now() else null end
   where id = target;
  if not found then
    raise exception 'no teen profile' using errcode = 'no_data_found';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who can call what. Postgres lets everyone execute new functions by default.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.create_teen_profile(public.age_bracket, public.age_source, text, text, text),
  public.abandon_signup(),
  public.create_parent_invite(),
  public.accept_parent_invite(text),
  public.set_ai_coach_consent(boolean, uuid),
  private.mode_for(text, public.age_bracket),
  private.new_handle(),
  private.coach_allowed(uuid)
from public;

grant execute on function
  public.create_teen_profile(public.age_bracket, public.age_source, text, text, text),
  public.abandon_signup(),
  public.create_parent_invite(),
  public.accept_parent_invite(text),
  public.set_ai_coach_consent(boolean, uuid)
to authenticated;

grant execute on function private.coach_allowed(uuid), private.mode_for(text, public.age_bracket) to service_role;
