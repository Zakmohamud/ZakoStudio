alter table public.christmas_bookings drop constraint if exists christmas_bookings_package_id_check;
alter table public.christmas_bookings add constraint christmas_bookings_package_id_check
  check (package_id in ('quick', 'mini', 'standard-60', 'standard-90', 'extended'));
