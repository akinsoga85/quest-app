-- A10: the evening drop and notifications.
--
-- A job runs every few minutes (supabase/functions/evening-drop). For each
-- teen with a push token it asks drop_candidates for their local time, and
-- sends the drop once a day at their drop time (8 pm by default), never in
-- quiet hours. Under-18s' quiet hours always cover 22:00–06:00: they can make
-- them longer, never shorter. Contract: packages/contract/src/notifications.ts.

create table public.push_tokens (
  token text primary key,
  teen_id uuid not null references public.teens (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);
create index push_tokens_teen on public.push_tokens (teen_id);
alter table public.push_tokens enable row level security; -- through the functions below only
revoke all on public.push_tokens from authenticated;

create table public.drops (
  teen_id uuid not null references public.teens (id) on delete cascade,
  day date not null,
  pushed boolean not null, -- false: it fell in quiet hours, so only the app shows it
  sent_at timestamptz not null default now(),
  primary key (teen_id, day)
);
alter table public.drops enable row level security;
create policy drops_own_read on public.drops for select to authenticated using (teen_id = auth.uid());
revoke insert, update, delete on public.drops from authenticated;

-- Preferences change through set_notification_prefs, which checks the limits.
revoke insert, update, delete on public.notification_prefs from authenticated;

-- push.register: this phone's Expo token. A phone that changes hands moves to the new teen.
create function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.teens where id = auth.uid()) then
    raise exception 'only teens get pushes' using errcode = 'insufficient_privilege';
  end if;
  if p_token !~ '^Expo(nent)?PushToken\[.+\]$' then
    raise exception 'not an Expo push token' using errcode = 'check_violation';
  end if;
  insert into public.push_tokens (token, teen_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set teen_id = excluded.teen_id, platform = excluded.platform, updated_at = now();
end;
$$;

create function public.unregister_push_token(p_token text)
returns void
language sql volatile security definer
set search_path = public, pg_temp
as $$ delete from public.push_tokens where token = p_token and teen_id = auth.uid() $$;

-- The server drops tokens Expo says are dead.
create function public.remove_push_token(p_token text)
returns void
language sql volatile security definer
set search_path = public, pg_temp
as $$ delete from public.push_tokens where token = p_token $$;

-- notifications.prefs
create function public.set_notification_prefs(p_drop_time time, p_quiet_start time, p_quiet_end time, p_daily_reminder boolean)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  bracket public.age_bracket;
  -- Quiet hours as a set of minutes past midnight, wrapping at 24:00.
  covers_night boolean;
begin
  select age_bracket into bracket from public.teens where id = auth.uid();
  if not found then
    raise exception 'only teens have notification settings' using errcode = 'insufficient_privilege';
  end if;
  if bracket <> '18_19' then
    -- 22:00–06:00 must be inside the quiet window.
    covers_night := p_quiet_start <> p_quiet_end
      and p_quiet_start > p_quiet_end -- wraps past midnight
      and p_quiet_start <= time '22:00'
      and p_quiet_end >= time '06:00';
    if not covers_night then
      raise exception 'under-18s keep quiet hours from 22:00 to 06:00 at least' using errcode = 'check_violation';
    end if;
  end if;
  insert into public.notification_prefs (teen_id, drop_time, quiet_start, quiet_end, daily_reminder)
  values (auth.uid(), p_drop_time, p_quiet_start, p_quiet_end, coalesce(p_daily_reminder, false))
  on conflict (teen_id) do update set drop_time = excluded.drop_time, quiet_start = excluded.quiet_start,
    quiet_end = excluded.quiet_end, daily_reminder = excluded.daily_reminder;
end;
$$;

-- drop.get: the drop screen (H19), by the teen's local day and week.
create function public.get_drop()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  d date;
  wk date;
  tz text;
begin
  select timezone into tz from public.teens where id = uid;
  if not found then
    raise exception 'no teen profile' using errcode = 'no_data_found';
  end if;
  d := private.today_for(uid);
  wk := d - (extract(isodow from d)::int - 1);
  return jsonb_build_object(
    'day', d,
    'todays', coalesce((
      select jsonb_agg(jsonb_build_object(
        'makeId', m.id, 'questTitle', q.title, 'zone', q.zone_id,
        'sentTo', coalesce((
          select jsonb_agg(coalesce(nullif(p.display_name, ''), 'your parent') order by s.created_at)
          from public.family_shares s join public.parents p on p.id = s.parent_id where s.make_id = m.id), '[]'::jsonb)
      ) order by m.created_at)
      from public.makes m join public.quests q on q.id = m.quest_id
      where m.teen_id = uid and m.local_day = d and m.status not in ('blocked', 'held_for_review')), '[]'::jsonb),
    'weekPoints', coalesce((
      select sum(sp.points) from public.skill_points sp
      join public.reviews r on r.id = sp.review_id join public.makes m on m.id = r.make_id
      where sp.teen_id = uid and m.local_day between wk and d), 0),
    'weekSkills', coalesce((
      select jsonb_object_agg(skill_id, total) from (
        select sp.skill_id, sum(sp.points)::int as total from public.skill_points sp
        join public.reviews r on r.id = sp.review_id join public.makes m on m.id = r.make_id
        where sp.teen_id = uid and m.local_day between wk and d
        group by sp.skill_id) x), '{}'::jsonb),
    'cheers', coalesce((
      select jsonb_agg(jsonb_build_object('from', coalesce(nullif(p.display_name, ''), 'your parent'), 'cheer', c.cheer, 'questTitle', q.title) order by c.created_at desc)
      from public.family_cheers c
      join public.family_shares s on s.id = c.share_id
      join public.parents p on p.id = c.parent_id
      join public.makes m on m.id = s.make_id
      join public.quests q on q.id = m.quest_id
      where s.teen_id = uid and private.local_day(tz, c.created_at) between wk and d), '[]'::jsonb)
  );
end;
$$;

-- Everyone who could get a drop, with their clock at p_now. The job decides
-- with the contract's dropDue; tests pass a fixed p_now (a fake clock).
create function public.drop_candidates(p_now timestamptz default now())
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'teenId', t.id,
    'localDay', private.local_day(t.timezone, p_now),
    'localTime', to_char(p_now at time zone t.timezone, 'HH24:MI'),
    'prefs', jsonb_build_object(
      'dropTime', to_char(coalesce(np.drop_time, '20:00'), 'HH24:MI'),
      'quietStart', to_char(coalesce(np.quiet_start, '21:00'), 'HH24:MI'),
      'quietEnd', to_char(coalesce(np.quiet_end, '07:00'), 'HH24:MI'),
      'dailyReminder', coalesce(np.daily_reminder, false)),
    'lastDropDay', (select max(day) from public.drops dr where dr.teen_id = t.id),
    'tokens', (select jsonb_agg(token order by updated_at desc) from public.push_tokens pt where pt.teen_id = t.id),
    'pointsToday', coalesce((
      select sum(sp.points) from public.skill_points sp
      join public.reviews r on r.id = sp.review_id join public.makes m on m.id = r.make_id
      where sp.teen_id = t.id and m.local_day = private.local_day(t.timezone, p_now)), 0),
    'cheersToday', (
      select count(*) from public.family_cheers c join public.family_shares s on s.id = c.share_id
      where s.teen_id = t.id and private.local_day(t.timezone, c.created_at) = private.local_day(t.timezone, p_now)),
    'madeToday', exists (
      select 1 from public.makes m where m.teen_id = t.id and m.local_day = private.local_day(t.timezone, p_now) and m.status <> 'blocked')
  )), '[]'::jsonb)
  from public.teens t
  left join public.notification_prefs np on np.teen_id = t.id
  where exists (select 1 from public.push_tokens pt where pt.teen_id = t.id);
$$;

-- Records a drop for the day. Returns false if it was already sent (two
-- overlapping runs never both push).
create function public.record_drop(p_teen uuid, p_day date, p_pushed boolean)
returns boolean
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.drops (teen_id, day, pushed) values (p_teen, p_day, p_pushed);
  return true;
exception when unique_violation then
  return false;
end;
$$;

revoke execute on function
  public.register_push_token(text, text),
  public.unregister_push_token(text),
  public.remove_push_token(text),
  public.set_notification_prefs(time, time, time, boolean),
  public.get_drop(),
  public.drop_candidates(timestamptz),
  public.record_drop(uuid, date, boolean)
from public;
grant execute on function
  public.register_push_token(text, text),
  public.unregister_push_token(text),
  public.set_notification_prefs(time, time, time, boolean),
  public.get_drop()
to authenticated;
grant execute on function public.remove_push_token(text), public.drop_candidates(timestamptz), public.record_drop(uuid, date, boolean) to service_role;
