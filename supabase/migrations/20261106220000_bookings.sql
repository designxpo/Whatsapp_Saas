-- Phase 6a: bookings kept in Talko — services (length, price, deposit), staff,
-- and each booking with its status (booked → confirmed → completed / no-show,
-- or cancelled), where it came from (added by hand, the AI via Google Calendar,
-- Cal.com, Calendly), an optional deposit (an order with a pay link) and a
-- reminder sent once. External bookings are matched by their own reference,
-- so a webhook retry or a reschedule updates the same row.

create table if not exists wa_booking_services (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 120),
  duration_minutes int not null default 30 check (duration_minutes between 5 and 720),
  price_cents      int not null default 0 check (price_cents >= 0),
  deposit_cents    int not null default 0 check (deposit_cents >= 0),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists wa_booking_staff (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  user_id    uuid references wa_users(id) on delete set null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists wa_bookings (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  phone            text not null,
  name             text not null default '',
  service_id       uuid references wa_booking_services(id) on delete set null,
  staff_id         uuid references wa_booking_staff(id) on delete set null,
  title            text not null default '',
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           text not null default 'booked' check (status in ('booked','confirmed','completed','no_show','cancelled')),
  source           text not null default 'manual' check (source in ('manual','google_calendar','calcom','calendly')),
  external_ref     text,
  deposit_cents    int not null default 0,
  deposit_order_id uuid references wa_orders(id) on delete set null,
  reminder_sent_at timestamptz,
  reminder_detail  text,
  notes            text not null default '',
  cancel_reason    text,
  created_by       text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (tenant_id, source, external_ref)
);
create index if not exists wa_bookings_time_idx on wa_bookings (tenant_id, starts_at);
create index if not exists wa_bookings_phone_idx on wa_bookings (tenant_id, phone, starts_at desc);
create index if not exists wa_bookings_reminder_idx on wa_bookings (starts_at) where reminder_sent_at is null and status in ('booked','confirmed');

do $$ declare t text; begin
  foreach t in array array['wa_booking_services','wa_booking_staff','wa_bookings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())', t);
  end loop;
end $$;
