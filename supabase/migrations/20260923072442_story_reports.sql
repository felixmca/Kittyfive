-- Anonymous, technical reports from the landing story (one summary per
-- visit, or a "stalled" note when it never started): which browser, the
-- screen size, how far the story got, how many frames were decoded, and the
-- first few errors. No IP, no cookies, no identifiers. They exist so the
-- story can be fixed on phones nobody here can test on (23 Sep 2026: blank
-- on an iPhone).
--
-- Nobody writes the table directly: the site's /api/story-report route calls
-- report_story(), which checks the size, keeps at most 2000 rows a day and
-- deletes rows older than 30 days. Admins can read them.

create table public.story_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('summary', 'stalled')),
  report jsonb not null check (octet_length(report::text) <= 6000)
);

create index story_reports_created_at_idx on public.story_reports (created_at);

alter table public.story_reports enable row level security;

create policy "admins read story reports" on public.story_reports
  for select to authenticated using ((select public.is_admin()));

revoke all on public.story_reports from anon, authenticated;
grant select on public.story_reports to authenticated;

create or replace function public.report_story(kind text, report jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if kind is null or kind not in ('summary', 'stalled') then
    return;
  end if;
  if report is null or jsonb_typeof(report) <> 'object' or octet_length(report::text) > 6000 then
    return;
  end if;
  -- An open endpoint must not be able to fill the database.
  if (select count(*) from public.story_reports r where r.created_at > now() - interval '1 day') >= 2000 then
    return;
  end if;
  delete from public.story_reports r where r.created_at < now() - interval '30 days';
  insert into public.story_reports (kind, report) values (kind, report);
end;
$$;

revoke all on function public.report_story(text, jsonb) from public;
grant execute on function public.report_story(text, jsonb) to anon, authenticated;
