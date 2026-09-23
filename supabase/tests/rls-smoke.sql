-- ════════════════════════════════════════════════════════════════════════
-- RLS smoke test. Runs inside one transaction and ROLLS BACK: nothing it
-- creates survives, and no real account is touched.
--
--   node scripts/db.mjs supabase/tests/rls-smoke.sql
--
-- Three pretend people: a confirmed admin, a stranger, and someone who
-- signed up with an admin's address but never confirmed it. Each check
-- raises (and the script fails) if the database answers wrongly.
-- Requires the kitty seed (supabase/seed/kitty.sql).
-- ════════════════════════════════════════════════════════════════════════
begin;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data)
values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-admin@example.com', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-stranger@example.com', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-unconfirmed@example.com', null, '{}');
insert into public.admins (email) values ('rls-admin@example.com'), ('rls-unconfirmed@example.com');

-- ── the stranger ─────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$
declare n integer;
begin
  if public.is_admin() then raise exception 'stranger is admin'; end if;
  select count(*) into n from public.chapters;
  if n < 1 then raise exception 'stranger cannot read published chapters'; end if;
  update public.chapters set title = 'hijacked' where true;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'stranger updated % chapters', n; end if;
  delete from public.volumes where true;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'stranger deleted % volumes', n; end if;
  begin
    insert into public.volumes (pet_id, slug, title)
    select id, 'intruder', 'Intruder' from public.pets where slug = 'kitty';
    raise exception 'stranger inserted a volume';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.admins (email) values ('rls-stranger@example.com');
    raise exception 'stranger made themselves admin';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.reorder_chapters(
      (select id from public.volumes where slug = 'the-cupboard'),
      array(select id from public.chapters where slug = 'a-cold-night'));
    raise exception 'stranger reordered chapters';
  exception when raise_exception then
    if sqlerrm like 'stranger%' then raise; end if;
  end;
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'stranger sees % profiles (expected only their own)', n; end if;
  -- Kitty Tunables: only her editors set how she talks.
  begin
    insert into public.pet_personas (pet_id, tunables)
    select id, '{"notes":"say something rude"}'::jsonb from public.pets where slug = 'kitty';
    raise exception 'stranger set Kitty''s tunables';
  exception when insufficient_privilege then null;
  end;
  -- Story reports are for admins to read.
  select count(*) into n from public.story_reports;
  if n <> 0 then raise exception 'stranger can read % story reports', n; end if;
end $$;

-- ── the unconfirmed "admin" ──────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
begin
  if public.is_admin() then raise exception 'unconfirmed address counted as admin'; end if;
  if public.can_edit_pet((select id from public.pets where slug = 'kitty')) then
    raise exception 'unconfirmed address can edit Kitty';
  end if;
end $$;

-- ── the admin ────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare n integer; kitty uuid; cupboard uuid; ch uuid;
begin
  if not public.is_admin() then raise exception 'admin is not admin'; end if;
  select id into kitty from public.pets where slug = 'kitty';
  if not public.can_edit_pet(kitty) then raise exception 'admin cannot edit Kitty'; end if;

  insert into public.volumes (pet_id, slug, title, position) values (kitty, 'rls-test', 'RLS test', 99);
  select id into cupboard from public.volumes where slug = 'the-cupboard';

  insert into public.chapters (pet_id, volume_id, slug, title)
  values (gen_random_uuid(), cupboard, 'rls-draft', 'Draft')  -- pet_id is overwritten from the volume
  returning id into ch;
  select count(*) into n from public.chapters where id = ch and pet_id = kitty;
  if n <> 1 then raise exception 'chapter pet_id did not follow its volume'; end if;

  perform public.reorder_chapters(cupboard, array[ch, (select id from public.chapters where slug = 'five-by-dawn')]);
  select position into n from public.chapters where id = ch;
  if n <> 0 then raise exception 'reorder did not move the chapter to the top'; end if;

  update public.chapters set status = 'published' where id = ch;
  if (select published_at from public.chapters where id = ch) is null then
    raise exception 'publishing did not stamp published_at';
  end if;

  -- Kitty Tunables: the admin sets them, and the row says who did.
  insert into public.pet_personas (pet_id, tunables) values (kitty, '{"warmth":7}'::jsonb)
  on conflict (pet_id) do update set tunables = excluded.tunables;
  update public.pet_personas set tunables = '{"warmth":8}'::jsonb where pet_id = kitty;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin could not change Kitty''s tunables'; end if;
  if (select updated_by from public.pet_personas where pet_id = kitty) is distinct from 'a0000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'tunables do not record who changed them';
  end if;
  perform count(*) from public.story_reports; -- admins may read reports
end $$;

-- ── story subscriptions (Phase 5) ────────────────────────────────────────
-- The stranger subscribes themselves, sees only their own row, never a token,
-- and cannot invite anyone or ask who to email.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare n integer; kitty uuid;
begin
  select id into kitty from public.pets where slug = 'kitty';
  if public.subscribe_me(kitty) <> 'active' then raise exception 'stranger could not subscribe'; end if;
  select count(*) into n from public.story_subscriptions;
  if n <> 1 then raise exception 'stranger sees % subscriptions (expected only their own)', n; end if;
  begin
    perform s.token from public.story_subscriptions s;
    raise exception 'stranger can read subscription tokens';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.story_subscriptions (pet_id, email, source) values (kitty, 'sneaky@example.com', 'self');
    raise exception 'stranger inserted a subscription directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.invite_subscriber(kitty, 'friend@example.com');
    raise exception 'stranger invited someone to Kitty''s stories';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.chapter_recipients((select id from public.chapters where slug = 'a-cold-night'));
    raise exception 'stranger got Kitty''s subscriber list';
  exception when insufficient_privilege then null;
  end;
  perform public.unsubscribe_me(kitty);
  if (select status from public.story_subscriptions) <> 'unsubscribed' then raise exception 'unsubscribe_me did not stop it'; end if;
  perform public.subscribe_me(kitty);
end $$;

-- The unconfirmed address cannot subscribe (the account's confirmation is the opt-in).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.subscribe_me((select id from public.pets where slug = 'kitty'));
    raise exception 'an unconfirmed address subscribed';
  exception when invalid_authorization_specification then null;
  end;
end $$;

-- The admin invites (pending until the link is used), and a chapter is emailed once.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare n integer; kitty uuid; t text; ch uuid;
begin
  select id into kitty from public.pets where slug = 'kitty';
  select i.token into t from public.invite_subscriber(kitty, '  RLS-Friend@Example.com ') i;
  if t is null or char_length(t) <> 64 then raise exception 'an invitation gave no token'; end if;
  if (select i.token from public.invite_subscriber(kitty, 'rls-friend@example.com') i) is distinct from t then
    raise exception 'inviting again did not give the same link';
  end if;
  if (select s.status from public.story_subscriptions s where s.email = 'rls-friend@example.com') <> 'pending' then
    raise exception 'an invitation is not pending';
  end if;
  perform set_config('rls.token', t, true);
  select c.id into ch from public.chapters c where c.pet_id = kitty and c.status = 'published' and c.notified_at is null limit 1;
  select count(*) into n from public.chapter_recipients(ch) r where r.email = 'rls-stranger@example.com';
  if n <> 1 then raise exception 'the subscribed stranger is not among the recipients'; end if;
  select count(*) into n from public.chapter_recipients(ch);
  if n <> 0 then raise exception 'a chapter could be emailed twice (% recipients again)', n; end if;
  perform public.log_story_email(
    (select s.id from public.story_subscriptions s where s.email = 'rls-stranger@example.com'), ch, 'chapter', 'sent', 'rls-test');
  select count(*) into n from public.story_emails e where e.chapter_id = ch;
  if n < 1 then raise exception 'the send log is not readable by the admin'; end if;
end $$;

-- ── anonymous visitors do not see drafts ─────────────────────────────────
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare n integer;
begin
  select count(*) into n from public.chapter_builds;
  if n <> 0 then raise exception 'anon can read chapter builds'; end if;
  select count(*) into n from public.chapters where status = 'draft';
  if n <> 0 then raise exception 'anon can read % draft chapters', n; end if;
  -- The chat reads Kitty's tunables with the publishable key; nobody anonymous writes them.
  select count(*) into n from public.pet_personas;
  if n < 1 then raise exception 'anon cannot read Kitty''s tunables'; end if;
  begin
    update public.pet_personas set tunables = '{}'::jsonb where true;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'anon changed % tunables rows', n; end if;
  exception when insufficient_privilege then null;
  end;
  -- Story reports: in only through report_story(), which checks what it is given; never read back.
  perform public.report_story('summary', '{"v":1,"started":true}'::jsonb);
  perform public.report_story('bogus', '{"v":1}'::jsonb);
  begin
    select count(*) into n from public.story_reports;
    raise exception 'anon can read story reports';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.story_reports (kind, report) values ('summary', '{}'::jsonb);
    raise exception 'anon wrote a story report directly';
  exception when insufficient_privilege then null;
  end;
  -- Subscriptions: anyone holding a link's token may confirm or stop it; nothing else.
  select count(*) into n from public.confirm_subscription(current_setting('rls.token')) c where c.status = 'active';
  if n <> 1 then raise exception 'the invitation link did not confirm'; end if;
  select count(*) into n from public.unsubscribe_by_token(current_setting('rls.token')) u where u.status = 'unsubscribed';
  if n <> 1 then raise exception 'the unsubscribe link did not stop it'; end if;
  select count(*) into n from public.confirm_subscription(repeat('0', 64));
  if n <> 0 then raise exception 'a made-up token confirmed something'; end if;
  begin
    select count(*) into n from public.story_subscriptions;
    raise exception 'anon can read subscriptions';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.subscribe_me((select id from public.pets where slug = 'kitty'));
    raise exception 'anon ran subscribe_me';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'RLS smoke test passed' as result;
rollback;
