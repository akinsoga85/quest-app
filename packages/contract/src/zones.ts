import { z } from "zod";

export const ZoneId = z.enum(["photography", "fashion", "art_crafts", "music", "words"]);
export type ZoneId = z.infer<typeof ZoneId>;

export const ZoneStatus = z.enum(["live", "coming", "off"]);
export type ZoneStatus = z.infer<typeof ZoneStatus>;

// A teen picks up to this many zones (PRD: zones).
export const MAX_ZONES_PER_TEEN = 3;

// Skill ids are "<zone>.<skill>". Photography's four come from the hi-fi Levels
// screen; the others are drafts for the mentor sprint to confirm. `blurb` is
// the line under the zone's name on the zone picker (H4).
export const ZONES = {
  photography: {
    name: "Photography",
    status: "live",
    blurb: "Light, framing, colour",
    skills: { light: "Light", colour: "Colour", framing: "Framing", story: "Story" },
  },
  fashion: {
    name: "Fashion",
    status: "live",
    blurb: "Colour, texture, styling",
    skills: { colour: "Colour", texture: "Texture", styling: "Styling", composition: "Composition" },
  },
  art_crafts: {
    name: "Art and crafts",
    status: "live",
    blurb: "Drawing, collage, crochet",
    skills: { line: "Line", colour: "Colour", composition: "Composition", craft: "Craft" },
  },
  music: {
    name: "Music",
    status: "coming",
    blurb: "Beats, loops, sounds",
    skills: { mood: "Mood", colour: "Colour", composition: "Composition", story: "Story" },
  },
  words: {
    name: "Words",
    status: "coming",
    blurb: "Short poems, six-word stories",
    skills: { imagery: "Imagery", rhythm: "Rhythm", word_choice: "Word choice", story: "Story" },
  },
} as const satisfies Record<ZoneId, { name: string; status: ZoneStatus; blurb: string; skills: Record<string, string> }>;

export const SkillId = z.string().regex(/^[a-z_]+\.[a-z_]+$/, "skill id is <zone>.<skill>");
export type SkillId = z.infer<typeof SkillId>;

export function skillIdsFor(zone: ZoneId): string[] {
  return Object.keys(ZONES[zone].skills).map((k) => `${zone}.${k}`);
}

export function isSkillOfZone(skill: string, zone: ZoneId): boolean {
  return skillIdsFor(zone).includes(skill);
}

// "photography.light" → "Light".
export function skillName(skill: string): string {
  const [zone, key] = skill.split(".") as [ZoneId, string];
  const skills: Record<string, string> | undefined = ZONES[zone]?.skills;
  return skills?.[key] ?? key ?? skill;
}
