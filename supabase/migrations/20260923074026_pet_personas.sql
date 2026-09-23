-- ════════════════════════════════════════════════════════════════════════
-- Kitty Tunables: how a pet talks in the store's chat.
--
-- One row per pet: slider values and a few words (tunables, validated and
-- given defaults in src/lib/persona.ts). /api/chat compiles them into the
-- pet's system prompt. Readable by anyone for public pets, because the chat
-- route reads them with the publishable key and the store shows the opening
-- line; the admin page says not to put private details in the notes.
-- Editors (the owner, or an admin) write them.
-- ════════════════════════════════════════════════════════════════════════

create table public.pet_personas (
  pet_id     uuid primary key references public.pets (id) on delete cascade,
  tunables   jsonb not null default '{}'::jsonb
             check (jsonb_typeof(tunables) = 'object' and octet_length(tunables::text) <= 8000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.pet_personas enable row level security;

create or replace function public.pet_personas_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

create trigger pet_personas_stamp before insert or update on public.pet_personas
  for each row execute function public.pet_personas_stamp();

create policy "personas of public pets are readable" on public.pet_personas
  for select to anon, authenticated
  using (exists (select 1 from public.pets p where p.id = pet_id and p.is_public));
create policy "editors read personas" on public.pet_personas
  for select to authenticated using (public.can_edit_pet(pet_id));
create policy "editors add personas" on public.pet_personas
  for insert to authenticated with check (public.can_edit_pet(pet_id));
create policy "editors change personas" on public.pet_personas
  for update to authenticated
  using (public.can_edit_pet(pet_id)) with check (public.can_edit_pet(pet_id));

revoke all on public.pet_personas from anon, authenticated;
grant select on public.pet_personas to anon, authenticated;
grant insert, update on public.pet_personas to authenticated;
