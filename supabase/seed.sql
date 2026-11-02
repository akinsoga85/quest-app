-- Local and test data only: a first few days of quests. Never loaded into
-- production (`supabase db push` doesn't run it). Zones and skills are in the
-- migration 20261114120000_reference_data.sql.

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
