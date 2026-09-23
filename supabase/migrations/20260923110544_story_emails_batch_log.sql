-- The send log for a whole chapter send in one call (the route used one call
-- per email). Rows: [{"s": subscription id, "st": "sent" | "failed",
-- "id": provider id or null}]. Only the chapter's editors, and only rows for
-- that chapter's own pet's subscriptions are kept (anything else is ignored).
create or replace function public.log_story_emails(p_chapter uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pet uuid;
  v_n integer;
begin
  select c.pet_id into v_pet from public.chapters c where c.id = p_chapter;
  if v_pet is null or not public.can_edit_pet(v_pet) then
    raise exception 'not an editor of this chapter' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'rows must be an array of at most 5000' using errcode = '22023';
  end if;
  insert into public.story_emails (subscription_id, chapter_id, kind, status, provider_id)
  select s.id, p_chapter, 'chapter',
         case when r.st = 'sent' then 'sent' else 'failed' end,
         left(r.id, 120)
  from jsonb_to_recordset(p_rows) as r(s uuid, st text, id text)
  join public.story_subscriptions s on s.id = r.s and s.pet_id = v_pet;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.log_story_emails(uuid, jsonb) from public;
revoke execute on function public.log_story_emails(uuid, jsonb) from anon;
grant execute on function public.log_story_emails(uuid, jsonb) to authenticated;
