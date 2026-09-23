-- A chapter's one email send must not be used up by a send where nothing
-- went out (Resend down, the domain not verified yet). chapter_recipients()
-- marks the chapter first; if not a single email was sent, the owner's route
-- calls this to clear the mark so "Email it" works again. Refused once any
-- email for the chapter has been logged as sent.
create or replace function public.chapter_notify_failed(p_chapter uuid)
returns boolean
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
  if exists (select 1 from public.story_emails e where e.chapter_id = p_chapter and e.status = 'sent') then
    return false;
  end if;
  update public.chapters c set notified_at = null where c.id = p_chapter;
  return true;
end;
$$;

revoke all on function public.chapter_notify_failed(uuid) from public;
revoke execute on function public.chapter_notify_failed(uuid) from anon;
grant execute on function public.chapter_notify_failed(uuid) to authenticated;
