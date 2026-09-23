-- Supabase grants EXECUTE on new functions to anon directly (not only through
-- PUBLIC), so the signed-in-only subscription functions are revoked from anon
-- by name. (Each also checks its caller; this keeps them off the anon API.)
revoke execute on function public.subscribe_me(uuid) from anon;
revoke execute on function public.unsubscribe_me(uuid) from anon;
revoke execute on function public.invite_subscriber(uuid, text) from anon;
revoke execute on function public.chapter_recipients(uuid) from anon;
revoke execute on function public.log_story_email(uuid, uuid, text, text, text) from anon;
