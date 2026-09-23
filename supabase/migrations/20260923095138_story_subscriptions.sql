-- ════════════════════════════════════════════════════════════════════════
-- Phase 5: subscribe to a pet's stories by email.
--
-- story_subscriptions  one row per (pet, email): pending (invited, not yet
--                      confirmed), active, unsubscribed or bounced. The token
--                      is the capability in the confirm and unsubscribe links;
--                      nobody can select it, only the functions below use it.
-- story_emails         the send log: which email went to which subscription
--                      for which chapter (or invitation), and how it went.
-- chapters.notified_at when a chapter's email went out: each chapter is
--                      emailed at most once.
--
-- Nobody writes these tables directly. Every change goes through a checked
-- function:
--   subscribe_me(pet)            a signed-in reader with a confirmed email
--   unsubscribe_me(pet)          the same reader, stopping
--   invite_subscriber(pet, e)    the pet's editors (double opt-in: pending)
--   confirm_subscription(token)  the invitation link
--   unsubscribe_by_token(token)  the link in every email (one click)
--   chapter_recipients(chapter)  editors, once per published chapter
--   log_story_email(...)         editors, for their own pet's subscriptions
-- Editors can read their pet's subscribers (without tokens); readers can read
-- their own subscriptions.
-- ════════════════════════════════════════════════════════════════════════

create table public.story_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  pet_id          uuid not null references public.pets (id) on delete cascade,
  email           text not null check (email = lower(email) and char_length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id         uuid references auth.users (id) on delete set null,
  status          text not null default 'pending' check (status in ('pending', 'active', 'unsubscribed', 'bounced')),
  source          text not null check (source in ('self', 'invite')),
  token           text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  invited_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz,
  unsubscribed_at timestamptz,
  unique (pet_id, email),
  unique (token)
);
create index story_subscriptions_user_idx on public.story_subscriptions (user_id);
alter table public.story_subscriptions enable row level security;

create policy "readers read their subscriptions" on public.story_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "editors read their pet's subscribers" on public.story_subscriptions
  for select to authenticated using (public.can_edit_pet(pet_id));

revoke all on public.story_subscriptions from anon, authenticated;
-- Every column but the token.
grant select (id, pet_id, email, user_id, status, source, invited_by, created_at, confirmed_at, unsubscribed_at)
  on public.story_subscriptions to authenticated;

create table public.story_emails (
  id              bigint generated always as identity primary key,
  subscription_id uuid not null references public.story_subscriptions (id) on delete cascade,
  chapter_id      uuid references public.chapters (id) on delete set null,
  kind            text not null check (kind in ('chapter', 'invite')),
  status          text not null check (status in ('sent', 'failed', 'skipped')),
  provider_id     text check (char_length(provider_id) <= 120),
  created_at      timestamptz not null default now()
);
create index story_emails_subscription_idx on public.story_emails (subscription_id);
create index story_emails_chapter_idx on public.story_emails (chapter_id);
alter table public.story_emails enable row level security;

create policy "editors read their pet's send log" on public.story_emails
  for select to authenticated using (
    exists (
      select 1 from public.story_subscriptions s
      where s.id = subscription_id and public.can_edit_pet(s.pet_id)
    )
  );
revoke all on public.story_emails from anon, authenticated;
grant select on public.story_emails to authenticated;

alter table public.chapters add column notified_at timestamptz;

-- ── readers ──────────────────────────────────────────────────────────────

create or replace function public.subscribe_me(p_pet uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  -- A confirmed address only: the account's own confirmation is the opt-in.
  select lower(u.email) into v_email
  from auth.users u
  where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'sign in with a confirmed email first' using errcode = '28000';
  end if;
  if not exists (select 1 from public.pets p where p.id = p_pet and p.is_public) then
    raise exception 'no such pet' using errcode = 'P0002';
  end if;
  insert into public.story_subscriptions as s (pet_id, email, user_id, status, source, confirmed_at)
  values (p_pet, v_email, (select auth.uid()), 'active', 'self', now())
  on conflict (pet_id, email) do update
    set status = 'active',
        user_id = excluded.user_id,
        confirmed_at = coalesce(s.confirmed_at, now()),
        unsubscribed_at = null;
  return 'active';
end;
$$;

create or replace function public.unsubscribe_me(p_pet uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select lower(u.email) into v_email from auth.users u where u.id = (select auth.uid());
  update public.story_subscriptions
     set status = 'unsubscribed', unsubscribed_at = now()
   where pet_id = p_pet
     and (user_id = (select auth.uid()) or email = v_email)
     and status <> 'unsubscribed';
  return 'unsubscribed';
end;
$$;

-- ── owners ───────────────────────────────────────────────────────────────

create or replace function public.invite_subscriber(p_pet uuid, p_email text)
returns table (subscription_id uuid, token text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_row public.story_subscriptions;
begin
  if not public.can_edit_pet(p_pet) then
    raise exception 'not an editor of this pet' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'that does not look like an email address' using errcode = '22023';
  end if;
  -- No more than 30 invitations a day per pet.
  if (
    select count(*) from public.story_subscriptions s
    where s.pet_id = p_pet and s.source = 'invite' and s.created_at > now() - interval '1 day'
  ) >= 30 then
    raise exception 'thirty invitations a day is the limit' using errcode = '54000';
  end if;
  select * into v_row from public.story_subscriptions s where s.pet_id = p_pet and s.email = v_email;
  if found then
    -- Already in, or said no: never ask again. Pending: the same link again.
    if v_row.status = 'pending' then
      return query select v_row.id, v_row.token, v_row.status;
    else
      return query select v_row.id, null::text, v_row.status;
    end if;
    return;
  end if;
  insert into public.story_subscriptions (pet_id, email, status, source, invited_by)
  values (p_pet, v_email, 'pending', 'invite', (select auth.uid()))
  returning * into v_row;
  return query select v_row.id, v_row.token, v_row.status;
end;
$$;

-- Once per chapter: marks it notified and returns who to email (active
-- subscribers of a public pet, the chapter published). A second call returns
-- nobody.
create or replace function public.chapter_recipients(p_chapter uuid)
returns table (subscription_id uuid, email text, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pet uuid;
begin
  select c.pet_id into v_pet from public.chapters c where c.id = p_chapter;
  if v_pet is null or not public.can_edit_pet(v_pet) then
    raise exception 'not an editor of this chapter' using errcode = '42501';
  end if;
  update public.chapters c
     set notified_at = now()
   where c.id = p_chapter
     and c.status = 'published'
     and c.notified_at is null
     and exists (select 1 from public.pets p where p.id = c.pet_id and p.is_public);
  if not found then
    return;
  end if;
  return query
    select s.id, s.email, s.token
    from public.story_subscriptions s
    where s.pet_id = v_pet and s.status = 'active'
    order by s.created_at
    limit 5000;
end;
$$;

create or replace function public.log_story_email(
  p_subscription uuid, p_chapter uuid, p_kind text, p_status text, p_provider_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.story_subscriptions s
    where s.id = p_subscription and public.can_edit_pet(s.pet_id)
  ) then
    raise exception 'not an editor of this subscription' using errcode = '42501';
  end if;
  insert into public.story_emails (subscription_id, chapter_id, kind, status, provider_id)
  values (p_subscription, p_chapter, p_kind, p_status, left(p_provider_id, 120));
end;
$$;

-- ── the links in the emails (anyone holding the token) ───────────────────

create or replace function public.confirm_subscription(p_token text)
returns table (pet_slug text, pet_name text, status text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or char_length(p_token) <> 64 then
    return;
  end if;
  return query
    with changed as (
      update public.story_subscriptions s
         set status = 'active',
             confirmed_at = coalesce(s.confirmed_at, now()),
             unsubscribed_at = null
       where s.token = p_token and s.status in ('pending', 'active', 'unsubscribed')
      returning s.pet_id, s.status
    )
    select p.slug, p.name, ch.status from changed ch join public.pets p on p.id = ch.pet_id;
end;
$$;

create or replace function public.unsubscribe_by_token(p_token text)
returns table (pet_slug text, pet_name text, status text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or char_length(p_token) <> 64 then
    return;
  end if;
  return query
    with changed as (
      update public.story_subscriptions s
         set status = case when s.status = 'bounced' then 'bounced' else 'unsubscribed' end,
             unsubscribed_at = coalesce(s.unsubscribed_at, now())
       where s.token = p_token
      returning s.pet_id, s.status
    )
    select p.slug, p.name, ch.status from changed ch join public.pets p on p.id = ch.pet_id;
end;
$$;

revoke all on function public.subscribe_me(uuid) from public;
revoke all on function public.unsubscribe_me(uuid) from public;
revoke all on function public.invite_subscriber(uuid, text) from public;
revoke all on function public.chapter_recipients(uuid) from public;
revoke all on function public.log_story_email(uuid, uuid, text, text, text) from public;
revoke all on function public.confirm_subscription(text) from public;
revoke all on function public.unsubscribe_by_token(text) from public;
grant execute on function public.subscribe_me(uuid) to authenticated;
grant execute on function public.unsubscribe_me(uuid) to authenticated;
grant execute on function public.invite_subscriber(uuid, text) to authenticated;
grant execute on function public.chapter_recipients(uuid) to authenticated;
grant execute on function public.log_story_email(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.confirm_subscription(text) to anon, authenticated;
grant execute on function public.unsubscribe_by_token(text) to anon, authenticated;
