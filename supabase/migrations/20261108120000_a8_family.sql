-- A8: sharing with family, and the parent page.
--
-- A teen sends a reviewed make to their linked parents (H17). A parent sees
-- only the makes sent to them, and can send back one of five cheers; there's
-- no free text anywhere. Consent now needs the parent to confirm they're an
-- adult first (H24). Contract: packages/contract/src/family.ts and the A8
-- entries in api.ts.

create type public.adult_check as enum ('attested', 'card_verified');

alter table public.parents
  add column adult_check public.adult_check,
  add column adult_checked_at timestamptz,
  add column weekly_email boolean not null default true;

-- ---------------------------------------------------------------------------
-- Consent: preview the invite, confirm being an adult, then accept.
-- ---------------------------------------------------------------------------

-- What the consent page shows before sign-in: the teen's handle only.
create function public.invite_preview(p_token text)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('teenHandle', t.handle, 'expiresAt', l.invite_expires_at)
  from public.parent_links l join public.teens t on t.id = l.teen_id
  where l.status = 'pending' and l.invite_expires_at > now()
    and l.invite_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- The parent confirms they're an adult. Lean V1 records the parent's own
-- statement ('attested'); the card check (no charge) comes with payments (A9)
-- and records 'card_verified'.
create function public.confirm_adult()
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
  if exists (select 1 from public.teens where id = uid) then
    raise exception 'teen accounts cannot be parents' using errcode = 'check_violation';
  end if;
  insert into public.parents (id, adult_check, adult_checked_at) values (uid, 'attested', now())
  on conflict (id) do update
    set adult_check = coalesce(public.parents.adult_check, 'attested'),
        adult_checked_at = coalesce(public.parents.adult_checked_at, now());
end;
$$;

-- accept_parent_invite (A1), now refusing parents who haven't confirmed
-- they're adults. The token is checked first, so a bad link says so.
create or replace function public.accept_parent_invite(p_token text)
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

  if not exists (select 1 from public.parents where id = uid and adult_checked_at is not null) then
    raise exception 'confirm you''re an adult first' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.parent_links where teen_id = link.teen_id and parent_id = uid and status = 'active') then
    update public.parent_links set status = 'revoked', invite_token_hash = null where id = link.id;
  else
    update public.parent_links
       set parent_id = uid, status = 'active', consented_at = now(), invite_token_hash = null
     where id = link.id;
  end if;

  return query select t.handle from public.teens t where t.id = link.teen_id;
end;
$$;

-- parent.consent: both steps from the consent page in one call.
create function public.give_parent_consent(p_token text, p_is_adult boolean)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  h text;
begin
  if not coalesce(p_is_adult, false) then
    raise exception 'consent needs a parent or guardian who is an adult' using errcode = 'check_violation';
  end if;
  perform public.confirm_adult();
  select teen_handle into h from public.accept_parent_invite(p_token);
  return jsonb_build_object('teenHandle', h);
end;
$$;

-- ---------------------------------------------------------------------------
-- The teen's side
-- ---------------------------------------------------------------------------

-- family.share: send a reviewed make to every actively linked parent.
create function public.share_with_family(p_make_id uuid)
returns int
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  n int;
begin
  if not exists (select 1 from public.makes where id = p_make_id and teen_id = uid and status = 'reviewed') then
    raise exception 'only your own reviewed makes can be shared' using errcode = 'check_violation';
  end if;
  insert into public.family_shares (make_id, teen_id, parent_id)
  select p_make_id, uid, l.parent_id from public.parent_links l
  where l.teen_id = uid and l.status = 'active'
  on conflict (make_id, parent_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 and not exists (select 1 from public.family_shares where make_id = p_make_id) then
    raise exception 'no parent is linked yet' using errcode = 'check_violation';
  end if;
  return n;
end;
$$;

-- family.status: who it can go to, whether it went, and any cheers back.
create function public.get_family_status(p_make_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if not exists (select 1 from public.makes where id = p_make_id and teen_id = uid) then
    raise exception 'make not found' using errcode = 'no_data_found';
  end if;
  return jsonb_build_object(
    'parents', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(nullif(p.display_name, ''), 'your parent')) order by l.consented_at)
      from public.parent_links l join public.parents p on p.id = l.parent_id
      where l.teen_id = uid and l.status = 'active'), '[]'::jsonb),
    'sent', exists (select 1 from public.family_shares where make_id = p_make_id),
    'cheers', coalesce((
      select jsonb_agg(c.cheer::text order by c.created_at)
      from public.family_shares s join public.family_cheers c on c.share_id = s.id
      where s.make_id = p_make_id), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- The parent's side
-- ---------------------------------------------------------------------------

-- family.cheer: one of five cheers, once per share.
create function public.cheer_share(p_share_id uuid, p_cheer public.cheer)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  -- Only on shares sent to this parent, while they're still linked.
  if not exists (
    select 1 from public.family_shares
    where id = p_share_id and parent_id = auth.uid() and private.is_linked_parent(teen_id, auth.uid())
  ) then
    raise exception 'share not found' using errcode = 'no_data_found';
  end if;
  insert into public.family_cheers (share_id, parent_id, cheer) values (p_share_id, auth.uid(), p_cheer);
exception when unique_violation then
  raise exception 'you already cheered this one' using errcode = 'unique_violation';
end;
$$;

-- parent.feed: the makes sent to this parent, newest first.
create function public.parent_feed(p_before timestamptz default null, p_limit int default 20)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x."sharedAt" desc), '[]'::jsonb) from (
    select s.id as "shareId", m.id as "makeId", m.storage_path as "storagePath", t.handle as "teenHandle",
           q.title as "questTitle", q.zone_id as zone, m.local_day as "day", s.created_at as "sharedAt",
           c.cheer as cheer
    from public.family_shares s
    join public.makes m on m.id = s.make_id
    join public.teens t on t.id = s.teen_id
    join public.quests q on q.id = m.quest_id
    left join public.family_cheers c on c.share_id = s.id
    where s.parent_id = auth.uid()
      and private.is_linked_parent(s.teen_id, auth.uid())
      and (p_before is null or s.created_at < p_before)
    order by s.created_at desc
    limit greatest(1, least(p_limit, 50))
  ) x;
$$;

-- parent.overview: each linked teen this week (H25). Counts and levels only;
-- no photos unless the teen sends one.
create function public.parent_overview()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'weeklyEmail', coalesce((select weekly_email from public.parents where id = auth.uid()), true),
    'teens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'teenId', t.id,
        'handle', t.handle,
        'coachOn', t.ai_coach_consent,
        'questsThisWeek', (
          select count(distinct (m.quest_id, m.local_day)) from public.makes m
          where m.teen_id = t.id and m.status in ('reviewing', 'reviewed', 'no_review')
            and m.local_day >= private.today_for(t.id) - (extract(isodow from private.today_for(t.id))::int - 1)),
        'zones', coalesce((
          select jsonb_agg(jsonb_build_object('zone', z.id, 'points', private.zone_points(t.id, z.id)) order by z.sort)
          from public.zones z
          where exists (select 1 from public.teen_zones tz where tz.teen_id = t.id and tz.zone_id = z.id)), '[]'::jsonb)
      ) order by l.consented_at)
      from public.parent_links l join public.teens t on t.id = l.teen_id
      where l.parent_id = auth.uid() and l.status = 'active'), '[]'::jsonb));
$$;

create function public.set_weekly_email(p_on boolean)
returns void
language sql volatile security definer
set search_path = public, pg_temp
as $$
  update public.parents set weekly_email = coalesce(p_on, true) where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Parents can open the photos sent to them, and only those (Supabase only).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $p$create policy "makes: parent reads what was sent" on storage.objects for select to authenticated
      using (bucket_id = 'makes' and exists (
        select 1 from public.makes m join public.family_shares s on s.make_id = m.id
        where m.storage_path = storage.objects.name and s.parent_id = auth.uid()
          and private.is_linked_parent(s.teen_id, auth.uid())))$p$;
  end if;
end;
$$;

revoke execute on function
  public.invite_preview(text),
  public.confirm_adult(),
  public.give_parent_consent(text, boolean),
  public.share_with_family(uuid),
  public.get_family_status(uuid),
  public.cheer_share(uuid, public.cheer),
  public.parent_feed(timestamptz, int),
  public.parent_overview(),
  public.set_weekly_email(boolean)
from public;
grant execute on function public.invite_preview(text) to anon, authenticated;
grant execute on function
  public.confirm_adult(),
  public.give_parent_consent(text, boolean),
  public.share_with_family(uuid),
  public.get_family_status(uuid),
  public.cheer_share(uuid, public.cheer),
  public.parent_feed(timestamptz, int),
  public.parent_overview(),
  public.set_weekly_email(boolean)
to authenticated;
