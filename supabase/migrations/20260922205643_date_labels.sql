-- Stories rarely have exact dates ("January 2025", "Four months", "Now").
-- date_label, when set, is shown instead of the formatted story_date; the
-- date still orders things and feeds the date picker.
alter table public.volumes
  add column date_label text check (char_length(date_label) <= 60);
alter table public.chapters
  add column date_label text check (char_length(date_label) <= 60);
