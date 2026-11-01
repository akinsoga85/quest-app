-- Plus in the app, and free for 13–15.
--
-- 13–15s get Plus included, free: the coach thinks harder and each quest can
-- be taken twice. 16+ pay. 16–17s can buy in the app once a parent is linked
-- (or a parent buys on the parent page); 18–19s can buy in the app. The App
-- Store asks that a subscription the app unlocks is also sold in the app
-- (guideline 3.1.3(b)). Contract: packages/contract/src/plus.ts.

create function private.plus_included(p_teen uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$ select exists (select 1 from public.teens where id = p_teen and age_bracket = '13_15') $$;

-- Everything that checks Plus (the coach's effort, the second take) goes
-- through has_plus, so 13–15s get it everywhere at once.
create or replace function private.has_plus(p_teen uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select private.plus_included(p_teen)
      or exists (select 1 from public.entitlements where teen_id = p_teen and active_until > now());
$$;

-- plus.status, for the teen.
create or replace function public.plus_status()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with t as (
    select t.id, t.age_bracket,
      exists (select 1 from public.parent_links l where l.teen_id = t.id and l.status = 'active') as linked,
      e.active_until > now() as paid, e.active_until, e.source
    from public.teens t left join public.entitlements e on e.teen_id = t.id
    where t.id = auth.uid())
  select jsonb_build_object(
    'active', age_bracket = '13_15' or coalesce(paid, false),
    'included', age_bracket = '13_15',
    'until', case when age_bracket <> '13_15' and paid then active_until end,
    'source', case when age_bracket <> '13_15' and paid then source end,
    'canBuyInApp', age_bracket = '18_19' or (age_bracket = '16_17' and linked),
    'needsParent', age_bracket = '16_17' and not linked)
  from t;
$$;

-- parent.plus, for the parent page.
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
    'source', case when t.age_bracket <> '13_15' and e.active_until > now() then e.source end) order by l.consented_at), '[]'::jsonb)
  from public.parent_links l
  join public.teens t on t.id = l.teen_id
  left join public.entitlements e on e.teen_id = l.teen_id
  where l.parent_id = auth.uid() and l.status = 'active';
$$;

revoke execute on function private.plus_included(uuid) from public;
grant execute on function private.plus_included(uuid) to service_role;
