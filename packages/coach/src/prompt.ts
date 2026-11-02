import { LEVELS, ZONES, levelFor, lessonsForZone, skillIdsFor, skillName, type CoachContext, type ZoneId } from "@quest/contract";
import { z } from "zod";
import { VOICE, knowledgeFor } from "./knowledge";

// What the review model returns (structured output). Loose on purpose: the
// coach checks every field against the contract afterwards.
export const CoachDraft = z.object({
  outcome: z.enum(["review", "retake", "concern"]),
  worked: z.string(),
  tryNext: z.string(),
  why: z.string(),
  question: z.string().nullable(),
  skillPoints: z.array(z.object({ skill: z.string(), points: z.number().int() })),
  lessonId: z.string().nullable(),
  confidence: z.number(),
  note: z.string().nullable(), // retake: for the teen; concern: for the safety team
});
export type CoachDraft = z.infer<typeof CoachDraft>;

// What the guardrail check returns. No problems means it passed.
export const GUARD_RULES = [
  "appearance_or_identity",
  "comparison",
  "companion_or_feelings",
  "personal_data",
  "generic_praise",
  "more_than_one_fix",
  "score_in_words",
  "not_specific",
  "unkind_or_false",
  "unsafe_advice",
] as const;
export const GuardVerdict = z.object({
  problems: z.array(z.object({ rule: z.enum(GUARD_RULES), quote: z.string() })),
});
export type GuardVerdict = z.infer<typeof GuardVerdict>;

// The stable part of the prompt, one per zone, so it caches across reviews.
export function reviewSystem(zone: string): string {
  const k = knowledgeFor(zone);
  const z0 = ZONES[zone as ZoneId];
  const rubric = Object.entries(k.rubric)
    .map(([skill, levels]) => `${skillName(skill)} (${skill}):\n${levels.map((d, i) => `  Level ${i + 1} ${LEVELS[i]!.name}: ${d}`).join("\n")}`)
    .join("\n");
  const examples = k.examples
    .map((e) => `Quest "${e.quest}", Level ${e.level}.\nStrong review: ${e.strong}\nWeak review: ${e.weak}\nWhy it's weak: ${e.whyWeak}`)
    .join("\n\n");
  const lessons = lessonsForZone(zone as ZoneId)
    .map((l) => `${l.id}: ${l.title} (${skillName(l.skill)})`)
    .join("\n");
  return [
    VOICE,
    `\nZone: ${z0.name}.`,
    `\nWhat each skill looks like at each level:\n${rubric}`,
    `\nCommon mistakes in this zone:\n${k.mistakes.map((m) => `- ${m}`).join("\n")}`,
    examples ? `\nExample reviews in the house voice:\n${examples}` : "",
    `\nLessons you can link (lessonId):\n${lessons}`,
  ].join("\n");
}

// The per-photo part: the quest and the teen's craft history. Nothing personal.
export function reviewRequestText(ctx: CoachContext): string {
  const level = levelFor(ctx.zonePoints);
  const skills = skillIdsFor(ctx.zone as ZoneId);
  const history = ctx.history;
  const points = skills.map((s) => `${s}: ${history.skillPoints[s] ?? 0}`).join(", ");
  return [
    `Today's quest: "${ctx.quest.title}"`,
    `Brief: ${ctx.quest.brief}`,
    ctx.quest.tips.length ? `Tips given with the quest: ${ctx.quest.tips.join("; ")}` : "",
    `It trains: ${ctx.quest.trainsSkill}`,
    `The teen is Level ${level.level} (${level.name}) in this zone and has finished ${history.questsDone} quests here.`,
    `Their skill points so far: ${points}.`,
    history.recentTips.length ? `Their recent tips, newest first:\n${history.recentTips.map((t) => `- ${t}`).join("\n")}` : "No earlier tips yet.",
    `Allowed skills for skillPoints: ${skills.join(", ")}.`,
    "Review the photo of what they made.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const GUARD_SYSTEM = `You check a craft coach's review before a teen (13 to 19) sees it.
List every problem you find, quoting the words that cause it. Rules:
- appearance_or_identity: any comment on bodies, faces, weight, looks, clothes as worn, race, gender or identity.
- comparison: comparing the teen with others, or ranking.
- companion_or_feelings: acting like a friend or companion, talking about feelings, inviting a chat, or claiming memories beyond craft.
- personal_data: names, schools, places or other identifying details, or asking for them.
- generic_praise: praise with nothing specific ("great job!", "amazing").
- more_than_one_fix: more than one thing to try next.
- score_in_words: grades or scores ("7/10", "B+").
- not_specific: the tip is too vague to act on.
- unkind_or_false: harsh, sarcastic or clearly false praise.
- unsafe_advice: anything unsafe (climbing, roads, strangers, sharp tools without care).
If there are no problems, return an empty list.`;

export function guardRequestText(draft: { worked: string; tryNext: string; why: string; question: string | null }, ctx: CoachContext): string {
  return [
    `Quest: "${ctx.quest.title}". The teen is Level ${levelFor(ctx.zonePoints).level}.`,
    `What worked: ${draft.worked}`,
    `Try next: ${draft.tryNext}`,
    `Why: ${draft.why}`,
    draft.question ? `Question: ${draft.question}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
