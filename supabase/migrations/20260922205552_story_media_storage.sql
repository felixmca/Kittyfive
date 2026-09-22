-- ════════════════════════════════════════════════════════════════════════
-- Kittyfive · story-media bucket: chapter photos, tile images, clip frames.
--
-- Public bucket: published stories are public, and public URLs are served
-- from the CDN without a signed-URL round trip. Paths carry random ids, and
-- no one but a pet's editors can list the bucket.
--
-- Layout: pets/<pet-uuid>/…   Only editors of that pet may write under it.
-- ════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'story-media',
  'story-media',
  true,
  52428800, -- 50 MB: a phone photo, a frame, or a 5-second clip
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif',
        'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- May the caller write this object path? True only for pets/<uuid>/… where
-- the caller can edit that pet.
create or replace function public.can_edit_pet_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  parts text[] := storage.foldername(p_name);
begin
  if coalesce(array_length(parts, 1), 0) < 2 or parts[1] <> 'pets' then
    return false;
  end if;
  if parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_edit_pet(parts[2]::uuid);
end $$;
revoke execute on function public.can_edit_pet_path(text) from public, anon;
grant execute on function public.can_edit_pet_path(text) to authenticated;

create policy "story-media: editors list" on storage.objects
  for select to authenticated
  using (bucket_id = 'story-media' and public.can_edit_pet_path(name));
create policy "story-media: editors upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'story-media' and public.can_edit_pet_path(name));
create policy "story-media: editors replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'story-media' and public.can_edit_pet_path(name))
  with check (bucket_id = 'story-media' and public.can_edit_pet_path(name));
create policy "story-media: editors delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'story-media' and public.can_edit_pet_path(name));
