-- Reference data every environment needs: the zones and their skills.
-- They used to live in seed.sql, which `supabase db push` never runs, so a
-- production project would have had none. They must match ZONES in
-- packages/contract/src/zones.ts (checked by `npm run db:test`).
-- Re-running changes nothing.

insert into public.zones (id, name, status, sort) values
  ('photography', 'Photography', 'live', 1),
  ('fashion', 'Fashion', 'live', 2),
  ('art_crafts', 'Art and crafts', 'live', 3),
  ('music', 'Music', 'coming', 4),
  ('words', 'Words', 'coming', 5)
on conflict (id) do nothing;

insert into public.skills (id, zone_id, name, sort) values
  ('photography.light', 'photography', 'Light', 1),
  ('photography.colour', 'photography', 'Colour', 2),
  ('photography.framing', 'photography', 'Framing', 3),
  ('photography.story', 'photography', 'Story', 4),
  ('fashion.colour', 'fashion', 'Colour', 1),
  ('fashion.texture', 'fashion', 'Texture', 2),
  ('fashion.styling', 'fashion', 'Styling', 3),
  ('fashion.composition', 'fashion', 'Composition', 4),
  ('art_crafts.line', 'art_crafts', 'Line', 1),
  ('art_crafts.colour', 'art_crafts', 'Colour', 2),
  ('art_crafts.composition', 'art_crafts', 'Composition', 3),
  ('art_crafts.craft', 'art_crafts', 'Craft', 4),
  ('music.mood', 'music', 'Mood', 1),
  ('music.colour', 'music', 'Colour', 2),
  ('music.composition', 'music', 'Composition', 3),
  ('music.story', 'music', 'Story', 4),
  ('words.imagery', 'words', 'Imagery', 1),
  ('words.rhythm', 'words', 'Rhythm', 2),
  ('words.word_choice', 'words', 'Word choice', 3),
  ('words.story', 'words', 'Story', 4)
on conflict (id) do nothing;
