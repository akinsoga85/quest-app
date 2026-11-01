import { z } from "zod";
import { SkillId, type ZoneId } from "./zones";

// The starter lesson set (PRD R15): one 30-second lesson per skill in each
// live zone. Each coach review links one. Drafted to unblock the build; the
// mentor sprint rewrites them and adds the full library (about 40 per zone).

export const Lesson = z.object({
  id: z.string().regex(/^[a-z_]+\.[a-z_]+\.[a-z0-9-]+$/),
  zone: z.string(),
  skill: SkillId,
  title: z.string().max(40),
  seconds: z.number().int().positive(),
  steps: z.array(z.string().max(90)).length(3),
});
export type Lesson = z.infer<typeof Lesson>;

const lesson = (id: string, title: string, steps: [string, string, string]): Lesson => {
  const [zone, skill] = id.split(".") as [ZoneId, string];
  return { id, zone, skill: `${zone}.${skill}`, title, seconds: 30, steps };
};

export const LESSONS: readonly Lesson[] = [
  lesson("photography.light.side-light", "Side light", [
    "Stand so the light comes from the side, not from behind you.",
    "Watch how the shadows stretch and show texture.",
    "Turn your subject slowly until the shadows look strongest.",
  ]),
  lesson("photography.colour.one-colour-pops", "One colour that pops", [
    "Look for one strong colour among quiet ones.",
    "Fill more of the frame with the calm colours.",
    "Keep the bright one away from the dead centre.",
  ]),
  lesson("photography.framing.leading-lines", "Leading lines", [
    "Find a line: a path, a shelf edge, a shadow.",
    "Start it in a corner of the frame.",
    "Let it run towards the thing you want seen.",
  ]),
  lesson("photography.story.show-a-moment", "Show a moment", [
    "Ask: what just happened, or what's about to?",
    "Include one clue that answers it.",
    "Leave out anything that doesn't help.",
  ]),
  lesson("fashion.colour.colour-families", "Colour families", [
    "Pick pieces from one colour family, light to dark.",
    "Add one small piece in a contrasting colour.",
    "Put the darkest piece at the bottom to anchor the flat-lay.",
  ]),
  lesson("fashion.texture.mix-textures", "Mix textures", [
    "Put a smooth piece next to a rough one.",
    "Use side light so the texture shows.",
    "Shoot close enough to see the weave.",
  ]),
  lesson("fashion.styling.outfit-story", "An outfit with a plan", [
    "Decide where this outfit is going.",
    "Add one accessory that says so.",
    "Lay the pieces as they'd be worn, top to bottom.",
  ]),
  lesson("fashion.composition.space-in-a-flat-lay", "Space in a flat-lay", [
    "Leave even gaps between the pieces.",
    "Line the edges up with the frame.",
    "Shoot straight down so nothing tilts.",
  ]),
  lesson("art_crafts.line.confident-lines", "Confident lines", [
    "Draw from the shoulder, not the wrist.",
    "Make each line in one stroke.",
    "Press harder for near things and lighter for far ones.",
  ]),
  lesson("art_crafts.colour.three-colours", "Three colours", [
    "Choose three colours only.",
    "Use one of them for most of the piece.",
    "Save the brightest for the part you want seen first.",
  ]),
  lesson("art_crafts.composition.thirds", "Thirds", [
    "Imagine a 3 by 3 grid over your page.",
    "Put the main shape on a line or where two lines cross.",
    "Keep the opposite third quieter.",
  ]),
  lesson("art_crafts.craft.clean-finish", "A clean finish", [
    "Trim loose threads and ragged edges.",
    "Let glue or paint dry before you photograph it.",
    "Shoot it on a plain background.",
  ]),
];

export function lessonById(id: string | null | undefined): Lesson | null {
  return LESSONS.find((l) => l.id === id) ?? null;
}

export function lessonsForSkill(skill: string): Lesson[] {
  return LESSONS.filter((l) => l.skill === skill);
}

export function lessonsForZone(zone: ZoneId): Lesson[] {
  return LESSONS.filter((l) => l.zone === zone);
}
