create extension if not exists btree_gist;

create table if not exists public.christmas_bookings (
  id uuid primary key default gen_random_uuid(),
  package_id text not null check (
    package_id in ('mini', 'standard-60', 'standard-90', 'extended')
  ),
  package_price_cents integer not null check (package_price_cents > 0),
  deposit_cents integer not null check (deposit_cents > 0),
  start_at timestamptz not null,
  end_at timestamptz not null,
  full_name text not null,
  email text not null,
  phone text not null,
  status text not null default 'pending_payment' check (
    status in ('pending_payment', 'confirmed', 'cancelled', 'expired')
  ),
  hold_expires_at timestamptz,
  payment_provider text,
  payment_reference text,
  created_at timestamptz not null default now(),
  check (end_at > start_at),
  exclude using gist (
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status in ('pending_payment', 'confirmed'))
);

alter table public.christmas_bookings enable row level security;

create or replace function public.christmas_available_slots(
  p_service_date date,
  p_package_id text
)
returns table (slot_start timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duration_minutes integer;
  v_open_time time;
  v_close_time time;
  v_first_start timestamp;
  v_last_start timestamp;
begin
  v_duration_minutes := case p_package_id
    when 'mini' then 30
    when 'standard-60' then 60
    when 'standard-90' then 90
    when 'extended' then 120
    else null
  end;

  if v_duration_minutes is null then
    raise exception 'Invalid package.';
  end if;

  if p_service_date < (now() at time zone 'America/Vancouver')::date
    or p_service_date > date '2026-11-30' then
    return;
  end if;

  if extract(isodow from p_service_date) in (6, 7) then
    v_open_time := time '10:00';
    v_close_time := time '19:00';
  else
    v_open_time := time '19:00';
    v_close_time := time '22:00';
  end if;

  v_first_start := p_service_date + v_open_time;
  v_last_start := p_service_date + v_close_time - make_interval(mins => v_duration_minutes);

  update public.christmas_bookings
  set status = 'expired'
  where status = 'pending_payment'
    and hold_expires_at <= now();

  return query
  select (candidate.local_start at time zone 'America/Vancouver')
  from generate_series(v_first_start, v_last_start, interval '45 minutes') as candidate(local_start)
  where (candidate.local_start at time zone 'America/Vancouver') > now()
    and not exists (
    select 1
    from public.christmas_bookings booking
    where booking.status in ('pending_payment', 'confirmed')
      and (booking.status = 'confirmed' or booking.hold_expires_at > now())
      and booking.start_at < (candidate.local_start at time zone 'America/Vancouver')
        + make_interval(mins => v_duration_minutes)
      and booking.end_at > (candidate.local_start at time zone 'America/Vancouver')
  )
  order by candidate.local_start;
end;
$$;

create or replace function public.admin_create_christmas_booking(
  p_service_date date,
  p_start_time time,
  p_package_id text,
  p_full_name text,
  p_email text,
  p_phone text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duration_minutes integer;
  v_price_cents integer;
  v_deposit_cents integer;
  v_open_time time;
  v_close_time time;
  v_local_start timestamp;
  v_start_at timestamptz;
  v_booking_id uuid;
begin
  v_duration_minutes := case p_package_id
    when 'mini' then 30
    when 'standard-60' then 60
    when 'standard-90' then 90
    when 'extended' then 120
    else null
  end;

  if v_duration_minutes is null then
    raise exception 'Choose a valid session package.';
  end if;

  if p_service_date < (now() at time zone 'America/Vancouver')::date
    or p_service_date > date '2026-11-30' then
    raise exception 'Choose a date within the session season.';
  end if;

  if nullif(trim(p_full_name), '') is null
    or nullif(trim(p_email), '') is null
    or nullif(trim(p_phone), '') is null then
    raise exception 'Name, email, and phone are required.';
  end if;

  if extract(isodow from p_service_date) in (6, 7) then
    v_open_time := time '10:00';
    v_close_time := time '19:00';
  else
    v_open_time := time '19:00';
    v_close_time := time '22:00';
  end if;

  if p_start_time < v_open_time
    or p_start_time + make_interval(mins => v_duration_minutes) > v_close_time then
    raise exception 'The session must fit within the available hours.';
  end if;

  v_local_start := p_service_date + p_start_time;
  v_start_at := v_local_start at time zone 'America/Vancouver';
  if v_start_at <= now() then
    raise exception 'Choose a future session time.';
  end if;

  select package_price, deposit
  into v_price_cents, v_deposit_cents
  from (values
    ('mini', 20000, 10000),
    ('standard-60', 35000, 17500),
    ('standard-90', 45000, 22500),
    ('extended', 65000, 32500)
  ) as prices(package_id, package_price, deposit)
  where prices.package_id = p_package_id;

  update public.christmas_bookings
  set status = 'expired'
  where status = 'pending_payment'
    and hold_expires_at <= now();

  insert into public.christmas_bookings (
    package_id,
    package_price_cents,
    deposit_cents,
    start_at,
    end_at,
    full_name,
    email,
    phone,
    status
  )
  values (
    p_package_id,
    v_price_cents,
    v_deposit_cents,
    v_start_at,
    v_start_at + make_interval(mins => v_duration_minutes),
    trim(p_full_name),
    trim(p_email),
    trim(p_phone),
    'confirmed'
  )
  returning id into v_booking_id;

  return v_booking_id;
exception
  when exclusion_violation then
    raise exception 'That time overlaps another confirmed session.';
end;
$$;

create or replace function public.create_christmas_booking_hold(
  p_package_id text,
  p_start_at timestamptz,
  p_full_name text,
  p_email text,
  p_phone text
)
returns table (booking_id uuid, hold_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duration_minutes integer;
  v_price_cents integer;
  v_deposit_cents integer;
  v_booking_id uuid;
  v_hold_expires_at timestamptz := now() + interval '15 minutes';
begin
  v_duration_minutes := case p_package_id
    when 'mini' then 30
    when 'standard-60' then 60
    when 'standard-90' then 90
    when 'extended' then 120
    else null
  end;

  if v_duration_minutes is null then
    raise exception 'Invalid package.';
  end if;

  if nullif(trim(p_full_name), '') is null
    or nullif(trim(p_email), '') is null
    or nullif(trim(p_phone), '') is null then
    raise exception 'Name, email, and phone are required.';
  end if;

  if not exists (
    select 1
    from public.christmas_available_slots(
      (p_start_at at time zone 'America/Vancouver')::date,
      p_package_id
    ) available
    where available.slot_start = p_start_at
  ) then
    raise exception 'That session time is no longer available.';
  end if;

  select package_price, deposit
  into v_price_cents, v_deposit_cents
  from (values
    ('mini', 20000, 10000),
    ('standard-60', 35000, 17500),
    ('standard-90', 45000, 22500),
    ('extended', 65000, 32500)
  ) as prices(package_id, package_price, deposit)
  where prices.package_id = p_package_id;

  insert into public.christmas_bookings (
    package_id,
    package_price_cents,
    deposit_cents,
    start_at,
    end_at,
    full_name,
    email,
    phone,
    status,
    hold_expires_at
  )
  values (
    p_package_id,
    v_price_cents,
    v_deposit_cents,
    p_start_at,
    p_start_at + make_interval(mins => v_duration_minutes),
    trim(p_full_name),
    trim(p_email),
    trim(p_phone),
    'pending_payment',
    v_hold_expires_at
  )
  returning id into v_booking_id;

  return query select v_booking_id, v_hold_expires_at;
exception
  when exclusion_violation then
    raise exception 'That session time was just booked. Please choose another time.';
end;
$$;

revoke all on public.christmas_bookings from anon, authenticated;
revoke all on function public.christmas_available_slots(date, text) from public, anon, authenticated;
revoke all on function public.admin_create_christmas_booking(date, time, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_christmas_booking_hold(text, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.christmas_available_slots(date, text) to service_role;
grant execute on function public.admin_create_christmas_booking(date, time, text, text, text, text) to service_role;
grant execute on function public.create_christmas_booking_hold(text, timestamptz, text, text, text) to service_role;
