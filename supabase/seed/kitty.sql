-- ════════════════════════════════════════════════════════════════════════
-- Kitty: the first pet on Kittyfive. Her volumes and the four chapters of the
-- landing story. Content, not schema, so it is not a migration: run it once
-- in the SQL editor of the project that hosts Kitty. Safe to re-run (it
-- updates by slug and never deletes).
--
-- The landing story had six chapters until 23 Sep 2026; the live project was
-- moved to these four in place (thousands-of-flyers became missing-found,
-- a-flat-on-the-thames became riverside-sofa, and-there-she-was and
-- next-to-me were folded into them), so this file describes a fresh project.
--
-- Self-hosting for your own pet? Copy this file, change the words, run it.
-- ════════════════════════════════════════════════════════════════════════

insert into public.pets (slug, name, species, tagline, is_public)
values ('kitty', 'Kitty', 'cat', 'A subtle type of love.', true)
on conflict (slug) do update
  set name = excluded.name, tagline = excluded.tagline;

-- ── volumes, in reading order ────────────────────────────────────────────
with pet as (select id from public.pets where slug = 'kitty'),
v (slug, position, title, date_label, story_date, mood, subtitle, body) as (
  values
  ('the-back-door', 0, 'The back door', 'January 2025', null::date, 'wary',
   'One cold night she walked in, did not ask, and stayed. We named her so we would not get attached.',
   array[
     'One cold January night at Smith Close, a black-and-white cat walked in through our back door. She did not ask. She just came in.',
     'We called her Kitty because we were not sure we would keep her, and we did not want to get attached.',
     'She stayed. She has never explained herself, and we have never asked her to.'
   ]),
  ('the-cupboard', 1, 'The cupboard', null, date '2025-04-14', 'half asleep',
   'Half past midnight, a cardboard box in the bedroom cupboard, and a cat who had clearly done the maths before I had.',
   array[
     'There was a cardboard box in the bedroom cupboard. At half past midnight on the fourteenth of April she got into it, and the first kitten arrived.',
     'Then another, every thirty minutes. I know because I started timing them, as if that was going to help. By dawn there were five, and she was cleaning them like it was nothing.',
     'She raised all five in that cupboard. She never once asked my opinion on it.',
     'One by one they were adopted, until the box was empty and it was just her again. She went back to the sofa as though nothing had happened. Something had happened.'
   ]),
  ('snacks-as-a-love-language', 2, 'Snacks as a love language', null, date '2025-07-06', 'hungry',
   'Kitty does not do gratitude. She does proximity. The exception is snacks.',
   array[
     'Kitty does not do gratitude. She does proximity. If she is near you, you are doing well. If she is on the other side of the room looking at the wall, you have been informed.',
     'The exception is snacks. Snacks get a look. Not a long one, but a real one.',
     'It was snacks that brought her home, in the end. A neighbour, a flyer, a handful of something, and a door that closed behind her.',
     'So there is a button on this site that gives her a snack. It costs a pound. It is real. She has approved it in the way she approves of most things, which is by being asleep nearby.'
   ]),
  ('the-sofa-on-the-river', 3, 'The sofa on the river', null, date '2025-11-16', 'settled',
   'New windows, new smells, the same cat on the same sofa. I worried about the move more than she did.',
   array[
     'In November we moved to a ground-floor flat on the Thames at Pacific Wharf. New windows, new smells, a light in the mornings that comes in off the water.',
     'I worried about the move more than she did. Cats are supposed to hate it. She walked in, checked the corners, and got on the sofa. The same sofa. It had come with us, so as far as she was concerned, so had the flat.',
     'She has been next to me on it the entire time I have been building this. She does not look at the screen. She has no notes.',
     'I have started to think that is what she meant, back on that first cold night at Smith Close. Not the door. The sofa.'
   ]),
  ('the-building-manager', 4, 'The building manager', null, date '2025-12-23', 'quiet',
   'We were away for three nights. She had food, the sofa and the river. She decided that was not the point.',
   array[
     'We were away for three nights. Three. The building manager came in every morning and every evening to feed her, which is more than I manage some days.',
     'She had food. She had the sofa. She had the river out of the window. What she did not have was us, and at some point she decided we had left.',
     'I understand it now. She walked in through a back door once and stayed on the understanding that we would too. Two days before Christmas the flat went quiet, and she drew the obvious conclusion.',
     'She went missing. I have never been so sorry about three nights away.'
   ]),
  ('what-the-flyer-said', 5, 'What the flyer said', null, date '2026-01-18', 'wet',
   'MISSING, in capitals, because that is what you write. It is the thing on this site I am most attached to.',
   array[
     'MISSING, in capitals, because that is what you write. A photo of a black-and-white cat, because that is what she is.',
     'What it could not say was that she had walked in through a back door one January night and never really explained herself. It did not say five kittens, or the cupboard, or that she had spent most evenings next to me on the sofa. There is not room on a flyer for the actual cat.',
     'We printed thousands. Every letterbox we could reach. It rained on a lot of those nights, which is the kind of detail you only notice when you are holding paper.',
     'The flyer is on a long-sleeve now, screen-printed so it feels like ink and not plastic. I did not expect to want to wear it. It turns out it is the thing on this site I am most attached to. It is the thing that found her.'
   ]),
  ('the-neighbour', 6, 'The neighbour', null, date '2026-04-19', 'out of breath',
   'Four months, thousands of flyers, and then one phone call from a person who had done the sensible thing.',
   array[
     'Four months. Then a call from a neighbour who had seen a flyer and had a black-and-white cat in their flat that was not theirs.',
     'They had done the sensible thing, which is the thing I would not have thought of: put some snacks down, let her come in, and called the number.',
     'I cycled over as fast as I could, which on a bike is exactly as fast as it sounds. I do not remember the route.',
     'And there she was. Nothing to say. A faint recognition, the kind you give a bus you used to take. That’s Kitty sometimes. A subtle type of love.',
     'I still do not know how to thank a person properly for that. I have tried. She, of course, has not.'
   ])
)
insert into public.volumes (pet_id, slug, position, title, date_label, story_date, mood, subtitle, body)
select pet.id, v.slug, v.position, v.title, v.date_label, v.story_date, v.mood, v.subtitle, v.body
  from pet, v
on conflict (pet_id, slug) do update
  set position = excluded.position, title = excluded.title, date_label = excluded.date_label,
      story_date = excluded.story_date, mood = excluded.mood, subtitle = excluded.subtitle,
      body = excluded.body;

-- ── the four landing chapters, each inside the volume that fits it ───────
-- Tile images are the chapter's own pictures from public/story (chapters 3
-- and 4 get theirs once their clips are processed; until then the tile
-- shows its gradient).
with pet as (select id from public.pets where slug = 'kitty'),
c (slug, volume_slug, position, landing_order, title, date_label, story_date, subtitle, description,
   tile_image_a, tile_image_b) as (
  values
  ('a-cold-night', 'the-back-door', 0, 1, 'A cold night', 'January 2025', null::date,
   'She did not ask. She just came in. She stayed.',
   'The night a black-and-white cat walked in through the back door at Smith Close, and stayed.',
   '/story/01-a-cold-night/still.webp', '/story/01-a-cold-night/extras/end-frame.webp'),
  ('five-by-dawn', 'the-cupboard', 0, 2, 'Five by dawn', null, date '2025-04-14',
   'Half past midnight, a cardboard box, one kitten every thirty minutes.',
   'A cardboard box in the bedroom cupboard, five kittens by dawn, and a cat who had clearly done the maths.',
   '/story/02-five-by-dawn/extras/end-frame.webp', '/story/02-five-by-dawn/extras/kittens1.webp'),
  ('missing-found', 'the-neighbour', 0, 3, 'Missing, Found', 'December 2025 – April 2026', null,
   'Four months of flyers. Then a neighbour, some snacks, and a phone call.',
   'Two days before Christmas she went missing. Four months of flyers, rainy nights and wet paper, until a neighbour saw one, put some snacks down, and called.',
   null, null),
  ('riverside-sofa', 'the-sofa-on-the-river', 0, 4, 'Riverside sofa', 'November 2025 – now', null,
   'She''s been next to me the entire time I''ve been building this.',
   'A ground-floor flat on the Thames at Pacific Wharf: new windows, new smells, and the same cat on the same sofa, next to me the whole time.',
   null, null)
)
insert into public.chapters (pet_id, volume_id, slug, position, landing_order, status,
                             title, date_label, story_date, subtitle, description,
                             tile_image_a, tile_image_b)
select pet.id, vol.id, c.slug, c.position, c.landing_order, 'published',
       c.title, c.date_label, c.story_date, c.subtitle, c.description,
       c.tile_image_a, c.tile_image_b
  from pet
  join c on true
  join public.volumes vol on vol.pet_id = pet.id and vol.slug = c.volume_slug
on conflict (pet_id, slug) do update
  set volume_id = excluded.volume_id, position = excluded.position,
      landing_order = excluded.landing_order, title = excluded.title,
      date_label = excluded.date_label, story_date = excluded.story_date,
      subtitle = excluded.subtitle, description = excluded.description,
      tile_image_a = excluded.tile_image_a, tile_image_b = excluded.tile_image_b;

-- ── one scene per landing chapter: the clip and its words ────────────────
-- Media comes from the landing story's build (public/story/<folder>/): the
-- reader loads <dir>/manifest.json if it exists, else still.webp, else a
-- placeholder. So these chapters animate as soon as the clips are processed.
with s (chapter_slug, folder, kicker, beats, transition) as (
  values
  ('a-cold-night', '01-a-cold-night', 'January 2025 · Smith Close, SE16', array[
     'One cold January night, a black-and-white cat walked in through our back door.',
     'She did not ask. She just came in.',
     'We called her Kitty because we weren''t sure we''d keep her.',
     'She stayed.'], 'zoom'),
  ('five-by-dawn', '02-five-by-dawn', '14 April 2025 · 12:30am', array[
     'At half past midnight, in a cardboard box in the bedroom cupboard, the first kitten arrived.',
     'Then another, every thirty minutes.',
     'By dawn there were five.',
     'She raised them in that cupboard, until every one was adopted and the box was empty again.'], 'walk-out-of-frame'),
  ('missing-found', '03-missing-found', '23 December 2025 – April 2026', array[
     'Two days before Christmas we were away for three nights. The building manager fed her every morning and every evening.',
     'She thought we had left her. She went missing.',
     'Thousands of flyers. Every letterbox we could reach. Rainy nights. Wet paper. Four months.',
     'Then a neighbour saw a flyer, lured her inside with some snacks, and called.',
     'I cycled over as fast as I could. And there she was. That''s Kitty sometimes. A subtle type of love.'], 'fall'),
  ('riverside-sofa', '04-riverside-sofa', 'November 2025 – now · Pacific Wharf', array[
     'In November we moved to a ground-floor flat on the Thames.',
     'New windows. New smells. The same cat on the same sofa.',
     'She''s been next to me the entire time I''ve been building this.'], 'crossfade')
)
insert into public.chapter_scenes (chapter_id, position, kicker, title, beats, image, frames, pin_length, transition)
select ch.id, 0, s.kicker, ch.title, s.beats,
       '/story/' || s.folder || '/still.webp',
       jsonb_build_object('dir', '/story/' || s.folder),
       2.4, s.transition
  from s
  join public.chapters ch on ch.slug = s.chapter_slug
  join public.pets p on p.id = ch.pet_id and p.slug = 'kitty'
 where not exists (select 1 from public.chapter_scenes x where x.chapter_id = ch.id);
