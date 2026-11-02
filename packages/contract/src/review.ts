import { z } from "zod";
import { SkillId } from "./zones";

// The coach agent (A4) returns exactly this. See the Lean V1 tab: "The coach agent".
export const SkillPoint = z.object({
  skill: SkillId,
  points: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});

export const CoachReview = z.object({
  worked: z.string().min(20).max(320),
  tryNext: z.string().min(20).max(320),
  why: z.string().min(10).max(200),
  question: z.string().max(160).nullable(),
  skillPoints: z.array(SkillPoint).min(1).max(2),
  lessonId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type CoachReview = z.infer<typeof CoachReview>;

// For structured output from the model.
export const coachReviewJsonSchema = z.toJSONSchema(CoachReview);

// Below this the teen gets a gentle retake message instead of a review.
export const MIN_REVIEW_CONFIDENCE = 0.6;

export const REVIEW_WORDS = { min: 40, max: 110 } as const;

// Deterministic first pass of the guardrails. The model-based check in A4 runs
// after this; both must pass. Starter lists, to tune with the mentors.
const APPEARANCE = [
  /\byour (face|body|skin|hair|weight|figure|looks?)\b/i,
  /\b(pretty|ugly|skinny|fat|thin|chubby|sexy|hot|cute) (you|girl|boy)\b/i,
  /\byou look\b/i,
];
const COMPARISON = [/\b(better|worse) than (other|the other|most|everyone)\b/i, /\bother (teens|kids|makers)\b/i, /\branked?\b/i];
const GENERIC = [/\bgreat job\b/i, /\bgood job\b/i, /\bamazing!/i, /\bawesome!/i, /\bperfect!/i];
const PERSONAL = [/\bwhat('?s| is) your (name|school|address)\b/i, /\bwhere do you live\b/i];

export interface GuardrailIssue {
  rule: "appearance" | "comparison" | "generic_praise" | "personal_data" | "length";
  detail: string;
}

export function reviewGuardrailIssues(r: CoachReview): GuardrailIssue[] {
  const text = [r.worked, r.tryNext, r.why, r.question ?? ""].join(" ");
  const issues: GuardrailIssue[] = [];
  const scan = (rule: GuardrailIssue["rule"], list: RegExp[]) => {
    for (const re of list) if (re.test(text)) issues.push({ rule, detail: re.source });
  };
  scan("appearance", APPEARANCE);
  scan("comparison", COMPARISON);
  scan("generic_praise", GENERIC);
  scan("personal_data", PERSONAL);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < REVIEW_WORDS.min || words > REVIEW_WORDS.max) {
    issues.push({ rule: "length", detail: `${words} words, want ${REVIEW_WORDS.min}-${REVIEW_WORDS.max}` });
  }
  return issues;
}

// What the server hands the coach for one make (coach_claim). Nothing
// personal: no handle, age or place, only the quest and the teen's craft history.
export const CoachContext = z.object({
  makeId: z.uuid(),
  storagePath: z.string(),
  zone: z.string(),
  quest: z.object({ title: z.string(), brief: z.string(), trainsSkill: SkillId, tips: z.array(z.string()) }),
  zonePoints: z.number().int().min(0), // for levelFor(): the coach matches its words to the level
  history: z.object({
    questsDone: z.number().int().min(0), // in this zone, before this one
    skillPoints: z.record(z.string(), z.number().int().min(0)), // per skill in this zone
    recentTips: z.array(z.string()).max(5), // the last five "try next" tips, newest first
  }),
});
export type CoachContext = z.infer<typeof CoachContext>;

// coach_claim's answer: null when there's nothing to do (not ready, already
// reviewed, or another worker has it).
export const CoachClaim = z
  .discriminatedUnion("consent", [z.object({ consent: z.literal(false) }), z.object({ consent: z.literal(true), context: CoachContext })])
  .nullable();
export type CoachClaim = z.infer<typeof CoachClaim>;

// What the coach decided, besides a review.
export const CoachOutcome = z.enum(["retake", "concern", "unavailable"]);
export type CoachOutcome = z.infer<typeof CoachOutcome>;

// The review screen (H16) asks for this; see review.forMake in api.ts.
export const ReviewState = z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending") }),
  z.object({ state: z.literal("no_consent") }),
  z.object({ state: z.literal("ready"), reviewId: z.uuid(), review: CoachReview, helpful: z.boolean().nullable() }),
  z.object({ state: z.literal("retake"), reason: z.string() }),
  z.object({ state: z.literal("unavailable"), lessonId: z.string().nullable() }), // the coach couldn't finish; a lesson instead
  z.object({ state: z.literal("held") }), // a person checks it first (safety)
]);
export type ReviewState = z.infer<typeof ReviewState>;
