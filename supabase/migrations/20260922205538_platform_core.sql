-- ════════════════════════════════════════════════════════════════════════
-- Kittyfive · platform core: people, pets, volumes, chapters, scenes.
--
-- Multi-tenant from day one. A pet owns its volumes and chapters, and every
-- write policy asks one question: may this caller edit this pet? (Its owner,
-- or a platform admin.) Reads are public for published chapters of public
-- pets; drafts are visible to editors only.
--
-- RLS is the boundary. The publishable key ships in every browser bundle, so
-- whatever a policy allows, anyone with devtools can do. The UI only reflects
-- what these policies already decide.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── profiles ─────────────────────────────────────────────────────────────
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- A profile row arrives with the account, so the app never has to make one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 60))
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── admins ───────────────────────────────────────────────────────────────
-- Who runs the platform. A table rather than a list in code, so adding a
-- person is one INSERT. RLS with no policies plus a REVOKE means no client
-- can read it or write it: a successful INSERT here would be a privilege
-- escalation, so it gets two independent gates.
--
-- Seed it from the SQL editor. Addresses never go in this public repo:
--   insert into public.admins (email, note) values ('you@example.com', 'owner');
create table public.admins (
  email    text primary key check (email = lower(email)),
  note     text,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on table public.admins from anon, authenticated;

-- Is the caller an admin? Requires a CONFIRMED email. With confirm-email on,
-- an unconfirmed account cannot sign in anyway, but this does not rely on
-- that dashboard switch staying on: without the check, anyone could sign up
-- with an admin's address before the admin does and inherit the role.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from auth.users u
      join public.admins a on a.email = lower(u.email)
     where u.id = auth.uid()
       and u.email_confirmed_at is not null
  );
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ── pets ─────────────────────────────────────────────────────────────────
create table public.pets (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
  name       text not null check (char_length(name) between 1 and 60),
  species    text not null default 'cat' check (char_length(species) <= 30),
  tagline    text check (char_length(tagline) <= 160),
  owner_id   uuid references auth.users (id) on delete set null,
  is_public  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pets_owner_idx on public.pets (owner_id);
alter table public.pets enable row level security;

create or replace function public.can_edit_pet(p_pet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pets p where p.id = p_pet and p.owner_id = auth.uid()
  ) or public.is_admin();
$$;
revoke execute on function public.can_edit_pet(uuid) from public, anon;
grant execute on function public.can_edit_pet(uuid) to authenticated;

create policy "public pets are readable" on public.pets
  for select to anon, authenticated using (is_public);
create policy "editors read their pets" on public.pets
  for select to authenticated using (public.can_edit_pet(id));
create policy "admins create pets" on public.pets
  for insert to authenticated with check ((select public.is_admin()));
create policy "editors update their pets" on public.pets
  for update to authenticated
  using (public.can_edit_pet(id)) with check (public.can_edit_pet(id));
create policy "admins delete pets" on public.pets
  for delete to authenticated using ((select public.is_admin()));

-- Only an admin may hand a pet to someone else. Checked for signed-in API
-- callers only, so the SQL editor and the service role can still set owners.
create or replace function public.pets_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.owner_id is distinct from old.owner_id
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'only an admin can change who owns a pet';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger pets_guard before update on public.pets
  for each row execute function public.pets_guard();

-- ── volumes ──────────────────────────────────────────────────────────────
create table public.volumes (
  id         uuid primary key default gen_random_uuid(),
  pet_id     uuid not null references public.pets (id) on delete cascade,
  slug       text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'),
  title      text not null check (char_length(title) between 1 and 120),
  subtitle   text check (char_length(subtitle) <= 280),
  mood       text check (char_length(mood) <= 40),
  story_date date,
  body       text[] not null default '{}' check (cardinality(body) <= 40),
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pet_id, slug)
);
create index volumes_pet_position_idx on public.volumes (pet_id, position);
alter table public.volumes enable row level security;

create trigger volumes_touch before update on public.volumes
  for each row execute function public.touch_updated_at();

create policy "volumes of public pets are readable" on public.volumes
  for select to anon, authenticated
  using (exists (select 1 from public.pets p where p.id = pet_id and p.is_public));
create policy "editors read volumes" on public.volumes
  for select to authenticated using (public.can_edit_pet(pet_id));
create policy "editors add volumes" on public.volumes
  for insert to authenticated with check (public.can_edit_pet(pet_id));
create policy "editors change volumes" on public.volumes
  for update to authenticated
  using (public.can_edit_pet(pet_id)) with check (public.can_edit_pet(pet_id));
create policy "editors remove volumes" on public.volumes
  for delete to authenticated using (public.can_edit_pet(pet_id));

-- ── chapters ─────────────────────────────────────────────────────────────
-- The tile face (date, title, subtitle, description, two images blended by a
-- gradient) and the chapter's place in its volume. Image fields hold either a
-- site path ("/story/…"), an absolute URL, or a path inside the story-media
-- bucket ("pets/<pet-id>/…").
create table public.chapters (
  id            uuid primary key default gen_random_uuid(),
  pet_id        uuid not null references public.pets (id) on delete cascade,
  volume_id     uuid not null references public.volumes (id) on delete cascade,
  slug          text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'),
  position      integer not null default 0,
  status        text not null default 'draft' check (status in ('draft', 'published')),
  story_date    date,
  title         text not null check (char_length(title) between 1 and 120),
  subtitle      text check (char_length(subtitle) <= 160),
  description   text check (char_length(description) <= 600),
  tile_image_a  text check (char_length(tile_image_a) <= 500),
  tile_image_b  text check (char_length(tile_image_b) <= 500),
  -- {"angle": 180, "from": 35, "to": 70}: the gradient runs along `angle`
  -- (CSS degrees) and image A gives way to image B between from% and to%.
  tile_blend    jsonb not null default '{"angle": 180, "from": 35, "to": 70}'::jsonb,
  -- Place in the pet's landing-page story (1, 2, 3…), or null.
  landing_order smallint check (landing_order between 1 and 50),
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (pet_id, slug),
  unique (pet_id, landing_order)
);
create index chapters_volume_position_idx on public.chapters (volume_id, position);
create index chapters_pet_idx on public.chapters (pet_id);
alter table public.chapters enable row level security;

-- pet_id always follows the volume, so a client cannot file a chapter under
-- one pet while the policies check another. Definer rights so the lookup
-- does not depend on what the caller can read; the policies still decide.
create or replace function public.chapters_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select v.pet_id into new.pet_id from public.volumes v where v.id = new.volume_id;
  -- First publication stamps published_at (Phase 5 emails subscribers then).
  if new.status = 'published' then
    if tg_op = 'INSERT' then
      new.published_at := coalesce(new.published_at, now());
    elsif old.status is distinct from 'published' then
      new.published_at := coalesce(new.published_at, now());
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.chapters_sync() from public, anon, authenticated;

create trigger chapters_sync before insert or update on public.chapters
  for each row execute function public.chapters_sync();

create policy "published chapters of public pets are readable" on public.chapters
  for select to anon, authenticated
  using (
    status = 'published'
    and exists (select 1 from public.pets p where p.id = pet_id and p.is_public)
  );
create policy "editors read chapters" on public.chapters
  for select to authenticated using (public.can_edit_pet(pet_id));
create policy "editors add chapters" on public.chapters
  for insert to authenticated with check (public.can_edit_pet(pet_id));
create policy "editors change chapters" on public.chapters
  for update to authenticated
  using (public.can_edit_pet(pet_id)) with check (public.can_edit_pet(pet_id));
create policy "editors remove chapters" on public.chapters
  for delete to authenticated using (public.can_edit_pet(pet_id));

-- ── chapter_scenes ───────────────────────────────────────────────────────
-- The pages of a chapter: a photo (the still, and the clip's start frame),
-- optionally the clip cut into frames, and the lines of text over it.
create table public.chapter_scenes (
  id           uuid primary key default gen_random_uuid(),
  chapter_id   uuid not null references public.chapters (id) on delete cascade,
  pet_id       uuid not null references public.pets (id) on delete cascade,
  position     integer not null default 0,
  kicker       text check (char_length(kicker) <= 80),
  title        text check (char_length(title) <= 120),
  beats        text[] not null default '{}' check (cardinality(beats) <= 12),
  image        text check (char_length(image) <= 500),
  -- {"x": 0.5, "y": 0.35}: where the slow push-in heads, as fractions.
  focus        jsonb,
  -- {"base": "<path or url>", "count": 72, "width": 720, "height": 1280, "ext": "webp"}
  frames       jsonb,
  video_prompt text check (char_length(video_prompt) <= 2000),
  pin_length   real not null default 2.2 check (pin_length between 1 and 6),
  transition   text not null default 'crossfade'
               check (transition in ('crossfade', 'zoom', 'slide-up', 'walk-out-of-frame', 'fall')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index chapter_scenes_chapter_idx on public.chapter_scenes (chapter_id, position);
create index chapter_scenes_pet_idx on public.chapter_scenes (pet_id);
alter table public.chapter_scenes enable row level security;

create or replace function public.chapter_child_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select c.pet_id into new.pet_id from public.chapters c where c.id = new.chapter_id;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.chapter_child_sync() from public, anon, authenticated;

create trigger chapter_scenes_sync before insert or update on public.chapter_scenes
  for each row execute function public.chapter_child_sync();

create policy "scenes of readable chapters are readable" on public.chapter_scenes
  for select to anon, authenticated
  using (
    exists (
      select 1
        from public.chapters c
        join public.pets p on p.id = c.pet_id
       where c.id = chapter_id and c.status = 'published' and p.is_public
    )
  );
create policy "editors read scenes" on public.chapter_scenes
  for select to authenticated using (public.can_edit_pet(pet_id));
create policy "editors add scenes" on public.chapter_scenes
  for insert to authenticated with check (public.can_edit_pet(pet_id));
create policy "editors change scenes" on public.chapter_scenes
  for update to authenticated
  using (public.can_edit_pet(pet_id)) with check (public.can_edit_pet(pet_id));
create policy "editors remove scenes" on public.chapter_scenes
  for delete to authenticated using (public.can_edit_pet(pet_id));

-- ── chapter_builds ───────────────────────────────────────────────────────
-- The owner's working notes for the chapter builder: what happened (in their
-- words), the photos they uploaded, and Claude's draft. Never public.
create table public.chapter_builds (
  chapter_id  uuid primary key references public.chapters (id) on delete cascade,
  pet_id      uuid not null references public.pets (id) on delete cascade,
  source_text text check (char_length(source_text) <= 6000),
  photos      text[] not null default '{}' check (cardinality(photos) <= 12),
  draft       jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index chapter_builds_pet_idx on public.chapter_builds (pet_id);
alter table public.chapter_builds enable row level security;

create trigger chapter_builds_sync before insert or update on public.chapter_builds
  for each row execute function public.chapter_child_sync();

create policy "editors read builds" on public.chapter_builds
  for select to authenticated using (public.can_edit_pet(pet_id));
create policy "editors add builds" on public.chapter_builds
  for insert to authenticated with check (public.can_edit_pet(pet_id));
create policy "editors change builds" on public.chapter_builds
  for update to authenticated
  using (public.can_edit_pet(pet_id)) with check (public.can_edit_pet(pet_id));
create policy "editors remove builds" on public.chapter_builds
  for delete to authenticated using (public.can_edit_pet(pet_id));

-- ── ordering ─────────────────────────────────────────────────────────────
-- One statement per drag. Invoker rights: the update policies decide, and
-- if any id is not the caller's to move, nothing moves.
create or replace function public.reorder_chapters(p_volume uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  moved integer;
begin
  update public.chapters c
     set position = t.ord::integer - 1,
         volume_id = p_volume
    from unnest(p_ids) with ordinality as t(id, ord)
   where c.id = t.id;
  get diagnostics moved = row_count;
  if moved <> coalesce(cardinality(p_ids), 0) then
    raise exception 'reorder_chapters: % of % chapters could be moved', moved, cardinality(p_ids);
  end if;
end $$;
revoke execute on function public.reorder_chapters(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_chapters(uuid, uuid[]) to authenticated;

create or replace function public.reorder_volumes(p_pet uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  moved integer;
begin
  update public.volumes v
     set position = t.ord::integer - 1
    from unnest(p_ids) with ordinality as t(id, ord)
   where v.id = t.id and v.pet_id = p_pet;
  get diagnostics moved = row_count;
  if moved <> coalesce(cardinality(p_ids), 0) then
    raise exception 'reorder_volumes: % of % volumes could be moved', moved, cardinality(p_ids);
  end if;
end $$;
revoke execute on function public.reorder_volumes(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_volumes(uuid, uuid[]) to authenticated;
