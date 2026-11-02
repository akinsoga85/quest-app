-- Reference data and a first few days of quests. Zones and skills must match
-- ZONES in packages/contract/src/zones.ts (checked by `npm run db:test`).

insert into public.zones (id, name, status, sort) values
  ('photography', 'Photography', 'live', 1),
  ('fashion', 'Fashion', 'live', 2),
  ('art_crafts', 'Art and crafts', 'live', 3),
  ('music', 'Music', 'coming', 4),
  ('words', 'Words', 'coming', 5);

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
  ('words.story', 'words', 'Story', 4);

insert into public.quests (zone_id, title, brief, minutes, trains_skill_id, tips, status, written_by, approved_at) values
  ('photography', 'Shadows that tell a story',
   'Find hard light (a window, a lamp, a streetlight) and photograph the shadow, not the thing.',
   15, 'photography.light', array['Side light makes longer shadows', 'Get low and tilt up'], 'approved', 'human', now()),
  ('fashion', 'Three pieces, one colour',
   'Pick three pieces in one colour and lay them out flat so they work together. Shoot it as a flat-lay from above.',
   10, 'fashion.colour', array['Use a plain background', 'Vary the textures'], 'approved', 'human', now()),
  ('art_crafts', 'Draw only the shadows',
   'Put a mug next to a lamp and draw only the shadows it throws, not the mug itself. One pen or pencil.',
   15, 'art_crafts.line', array['Squint to see the darkest parts', 'Leave the light areas blank'], 'approved', 'human', now());

-- Yesterday, today and tomorrow, so every time zone has a quest today. The quest
-- writer agent (A6) fills real weeks once quests are approved in admin.
insert into public.quest_schedule (day, zone_id, quest_id)
select current_date + d, q.zone_id, q.id
from public.quests q cross join generate_series(-1, 1) d
where q.status = 'approved';
