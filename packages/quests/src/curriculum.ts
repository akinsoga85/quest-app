// The curriculum files the quest writer works from (A6: "runs alone with the
// curriculum files"). Starter versions: the mentor sprint rewrites them with
// the skill progression per level and a bank of proven quests.

export const WRITER_VERSION = "quests-v1";

export interface ZoneCurriculum {
  zone: string;
  what: string; // what teens make in this zone
  skills: Record<string, string>; // skill id → what a quest for it practises
  places: string[]; // where quests can happen
  examples: { title: string; brief: string; minutes: number; trainsSkill: string; tips: string[] }[];
}

export const RULES = `Rules for every quest (no exceptions):
- It takes 5 to 20 minutes with only a phone and things a teen already has at home or at school.
- It happens indoors or somewhere ordinary and safe in daylight. Never roads, roofs, ledges, water, railways,
  or being out alone after dark; never fire, blades, chemicals or medicine; never strangers.
- No people in the work: no selfies, faces, bodies or friends in the photo, and never anything that shows
  where a teen lives or studies (street names, house numbers, school names or uniforms).
- Fashion quests are flat-lays (clothes laid out flat), hangers or mannequins. Nobody wears the outfit.
- One clear idea per quest. The title is short and inviting (3 to 60 characters). The brief is one or two
  plain sentences (20 to 280 characters) a 13-year-old understands. Up to 3 tips, each under 80 characters.
- The week trains every skill in the zone at least once. No two quests in a week share a title, and none
  repeats a recent title.`;

export const CURRICULUM: Record<string, ZoneCurriculum> = {
  photography: {
    zone: "photography",
    what: "photos taken with a phone",
    skills: {
      "photography.light": "seeing and using light: direction, hard and soft light, shadows, reflections",
      "photography.colour": "colour: one colour that pops, palettes, warm against cool",
      "photography.framing": "framing: getting closer, lines, thirds, angles, frames within frames",
      "photography.story": "story: a moment, a clue, before and after, an object that says something",
    },
    places: ["a bedroom", "a kitchen table", "a window", "a garden or balcony in daylight", "a school desk"],
    examples: [
      {
        title: "Shadows that tell a story",
        brief: "Find hard light (a window, a lamp, a streetlight) and photograph the shadow, not the thing.",
        minutes: 15,
        trainsSkill: "photography.light",
        tips: ["Side light makes longer shadows", "Get low and tilt up"],
      },
    ],
  },
  fashion: {
    zone: "fashion",
    what: "flat-lays of clothes and accessories, photographed from above",
    skills: {
      "fashion.colour": "colour: families, accents, light to dark",
      "fashion.texture": "texture: smooth against rough, knits, denim, shine",
      "fashion.styling": "styling: an outfit for a plan, one accessory that makes it",
      "fashion.composition": "composition: spacing, straight edges, negative space in a flat-lay",
    },
    places: ["a bed", "a floor with a plain sheet", "a table"],
    examples: [
      {
        title: "Three pieces, one colour",
        brief: "Pick three pieces in one colour and lay them out flat so they work together. Shoot it as a flat-lay from above.",
        minutes: 10,
        trainsSkill: "fashion.colour",
        tips: ["Use a plain background", "Vary the textures"],
      },
    ],
  },
  art_crafts: {
    zone: "art_crafts",
    what: "drawing, collage, crochet, zines and small crafts, photographed when done",
    skills: {
      "art_crafts.line": "line: contour, one-stroke lines, line weight",
      "art_crafts.colour": "colour: limited palettes, layering, focus",
      "art_crafts.composition": "composition: thirds, balance, quiet and busy areas",
      "art_crafts.craft": "craft: neat edges, joins, finish, choosing materials",
    },
    places: ["a desk", "a kitchen table"],
    examples: [
      {
        title: "Draw only the shadows",
        brief: "Put a mug next to a lamp and draw only the shadows it throws, not the mug itself. One pen or pencil.",
        minutes: 15,
        trainsSkill: "art_crafts.line",
        tips: ["Squint to see the darkest parts", "Leave the light areas blank"],
      },
    ],
  },
};

export function curriculumFor(zone: string): ZoneCurriculum {
  const c = CURRICULUM[zone];
  if (!c) throw new Error(`no curriculum for zone ${zone}`);
  return c;
}
