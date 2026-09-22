-- REAL MONEY. Append-only; nothing here is ever updated by a client.
--
-- Kitty store: orders written solely by the Stripe webhook (service role, on
-- the server). RLS is enabled on every table with NO policies, so anon and
-- authenticated roles can read and write nothing. The only public surface is
-- the snacks_public view (a count and a timestamp).
--
-- Apply in the Supabase SQL editor, or save as a migration and `supabase db push`.
-- Safe to re-run.

create extension if not exists pgcrypto;

-- orders ---------------------------------------------------------------------
create table if not exists public.orders (
  id                    uuid primary key default gen_random_uuid(),
  stripe_session_id     text unique not null,
  stripe_payment_intent text,
  kind                  text not null check (kind in ('merch', 'snack')),
  status                text not null default 'paid'
                        check (status in ('paid', 'submitted', 'in_production', 'shipped', 'delivered', 'cancelled', 'failed')),
  email                 text,
  name                  text,
  phone                 text,
  address               jsonb,
  amount_pence          integer not null check (amount_pence >= 0),
  currency              text not null default 'gbp',
  pod_provider          text,
  pod_order_id          text,
  tracking              jsonb,
  -- set when the Stripe webhook has finished fulfilment + email; a retried
  -- delivery for an order with this null resumes instead of returning early
  processed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table public.orders add column if not exists processed_at timestamptz;

create index if not exists orders_pod_order_id_idx on public.orders (pod_order_id);
create index if not exists orders_kind_created_idx on public.orders (kind, created_at desc);
create index if not exists orders_status_idx on public.orders (status);

-- order_items ----------------------------------------------------------------
create table if not exists public.order_items (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders (id) on delete cascade,
  product_id  text not null,
  variant_id  text not null,
  quantity    integer not null check (quantity > 0),
  unit_pence  integer not null check (unit_pence >= 0)
);

create index if not exists order_items_order_id_idx on public.order_items (order_id);

-- order_events (append-only audit log) --------------------------------------
create table if not exists public.order_events (
  id          bigint generated always as identity primary key,
  order_id    uuid references public.orders (id) on delete cascade,
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists order_events_order_id_idx on public.order_events (order_id, created_at);
create index if not exists order_events_type_idx on public.order_events (type);

-- housekeeping triggers ------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- Append-only, with one deliberate escape hatch for erasure requests and
-- test cleanup:  set_config('app.allow_delete', '1', true);  then delete.
create or replace function public.forbid_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('app.allow_delete', true) = '1' then
    return old;
  end if;
  raise exception 'order_events is append-only';
end $$;

drop trigger if exists order_events_append_only on public.order_events;
create trigger order_events_append_only
  before update or delete on public.order_events
  for each row execute function public.forbid_change();

-- row level security: on, with NO policies -----------------------------------
-- The service role bypasses RLS; everyone else gets nothing. Do not add
-- policies here. If the browser ever needs to read an order, add a server
-- route that uses the service role and checks the Stripe session id.
alter table public.orders        enable row level security;
alter table public.order_items   enable row level security;
alter table public.order_events  enable row level security;

revoke all on public.orders       from anon, authenticated;
revoke all on public.order_items  from anon, authenticated;
revoke all on public.order_events from anon, authenticated;

-- snacks_public: the only thing the browser may read --------------------------
-- A count of snacks and when the last one arrived, for a public counter.
-- Deliberately NOT security_invoker: the view runs as its owner so it can see
-- past RLS on orders; it exposes two aggregate columns and nothing else.
create or replace view public.snacks_public as
  select
    count(*)::integer      as count,
    max(created_at)        as last_created_at
  from public.orders
  where kind = 'snack' and status not in ('cancelled', 'failed');

grant select on public.snacks_public to anon, authenticated;

comment on table public.orders       is 'REAL MONEY. Written by the Stripe webhook only. Append-only from the browser''s point of view.';
comment on table public.order_items  is 'Line items per order; one row per variant.';
comment on table public.order_events is 'Append-only audit log: stripe.*, pod_*, email_*, pod_webhook:*.';
comment on view  public.snacks_public is 'Public snack counter: count + last_created_at. No personal data.';
