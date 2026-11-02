-- A5: the child-safety scan.
--
-- Every make is scanned before the coach or any person sees it:
--   uploaded → scanning (scan_claim) → reviewing (pass) | blocked | held_for_review
-- The database refuses 'reviewing' without a passing scan, whoever asks, so
-- nothing reaches the coach unscanned. Anything blocked or held, and every
-- coach concern, goes into the safety queue for a person (A11's admin).
-- Contract: packages/contract/src/safety.ts.

create type public.queue_source as enum ('scan', 'coach');

create table public.safety_queue (
  id uuid primary key default gen_random_uuid(),
  make_id uuid not null references public.makes (id) on delete cascade,
  source public.queue_source not null,
  result public.scan_result not null, -- block or human_review (coach concerns: human_review)
  reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text check (resolution in ('released', 'kept_blocked', 'reported', 'removed'))
);
create index safety_queue_open on public.safety_queue (created_at) where resolved_at is null;
alter table public.safety_queue enable row level security; -- no policies: staff only, through A11
revoke all on public.safety_queue from authenticated;

alter table public.makes add column scan_started_at timestamptz;

-- ---------------------------------------------------------------------------
-- The gate: no 'reviewing' without a pass.
-- ---------------------------------------------------------------------------
create function private.makes_review_gate()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'reviewing' and (tg_op = 'INSERT' or old.status is distinct from 'reviewing') then
    if not exists (select 1 from public.safety_scans where make_id = new.id and result = 'pass') then
      raise exception 'make % hasn''t passed the safety scan', new.id using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
create trigger makes_review_gate before insert or update of status on public.makes
for each row execute function private.makes_review_gate();

-- Coach concerns join the same queue.
create function private.coach_flag_to_queue()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.safety_queue (make_id, source, result, reasons)
  values (new.make_id, 'coach', 'human_review', array['coach_concern']);
  return new;
end;
$$;
create trigger coach_flag_to_queue after insert on public.coach_flags
for each row execute function private.coach_flag_to_queue();

-- ---------------------------------------------------------------------------
-- The scanner's functions (service role only)
-- ---------------------------------------------------------------------------

-- Takes one uploaded make for scanning, or null if there's nothing to do. A
-- scan stuck for 3 minutes can be taken again.
create function public.scan_claim(p_make_id uuid)
returns jsonb
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
  if not (m.status = 'uploaded' or (m.status = 'scanning' and m.scan_started_at <= now() - interval '3 minutes')) then
    return null;
  end if;
  update public.makes set status = 'scanning', scan_started_at = now() where id = m.id;
  return jsonb_build_object('makeId', m.id, 'storagePath', m.storage_path);
end;
$$;

create function public.scan_pending(p_limit int default 20)
returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select id from public.makes
  where status = 'uploaded' or (status = 'scanning' and scan_started_at <= now() - interval '3 minutes')
  order by created_at
  limit greatest(1, least(p_limit, 100));
$$;

-- Saves the scan and moves the make on. Only from 'scanning'.
create function public.scan_save(p_make_id uuid, p_result public.scan_result, p_reasons text[], p_vendor text)
returns text
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  m public.makes;
  next_status public.make_status;
begin
  select * into m from public.makes where id = p_make_id for update;
  if not found then
    raise exception 'no such make' using errcode = 'no_data_found';
  end if;
  if m.status <> 'scanning' then
    raise exception 'this make isn''t being scanned' using errcode = 'check_violation';
  end if;
  if coalesce(p_vendor, '') = '' then
    raise exception 'say which scanner decided' using errcode = 'check_violation';
  end if;

  insert into public.safety_scans (make_id, result, reasons, vendor)
  values (m.id, p_result, coalesce(p_reasons, '{}'), p_vendor)
  on conflict (make_id) do update set result = excluded.result, reasons = excluded.reasons, vendor = excluded.vendor, scanned_at = now();

  next_status := case p_result when 'pass' then 'reviewing' when 'block' then 'blocked' else 'held_for_review' end;
  update public.makes set status = next_status, scan_started_at = null where id = m.id;

  if p_result <> 'pass' then
    insert into public.safety_queue (make_id, source, result, reasons) values (m.id, 'scan', p_result, coalesce(p_reasons, '{}'));
  end if;
  return next_status::text;
end;
$$;

revoke execute on function
  public.scan_claim(uuid),
  public.scan_pending(int),
  public.scan_save(uuid, public.scan_result, text[], text)
from public;
grant execute on function
  public.scan_claim(uuid),
  public.scan_pending(int),
  public.scan_save(uuid, public.scan_result, text[], text)
to service_role;
