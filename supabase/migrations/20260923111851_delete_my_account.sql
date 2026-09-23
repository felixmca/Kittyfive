-- Anyone signed in can delete their own account, and only their own: the
-- sign-in (auth.users; the profile goes with it), and every story
-- subscription under their user id or their address (the send log goes with
-- them). Pets they owned stay, without an owner (admins can still edit
-- them); orders are kept, as accounts must keep them.
create or replace function public.delete_my_account()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  delete from public.story_subscriptions s where s.user_id = v_uid or (v_email is not null and s.email = v_email);
  delete from auth.users u where u.id = v_uid;
  return true;
end;
$$;

revoke all on function public.delete_my_account() from public;
revoke execute on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;
