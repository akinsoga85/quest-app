import {
  CoachReview,
  MIN_REVIEW_CONFIDENCE,
  isSkillOfZone,
  lessonById,
  lessonsForSkill,
  reviewGuardrailIssues,
  type CoachContext,
  type ZoneId,
} from "@quest/contract";
import type { CoachLLM, ModelReply, ReviewInput } from "./claude";
import { PROMPT_VERSION } from "./knowledge";
import type { CoachDraft } from "./prompt";

// One make, one decision. "review" is the only one the teen sees as a review.
export type CoachResult =
  | { kind: "review"; review: CoachReview; model: string; promptVersion: string }
  | { kind: "retake"; note: string; model: string }
  | { kind: "concern"; note: string; model: string }
  | { kind: "unavailable"; lessonId: string | null; model: string; why: string };

export interface CoachTrace {
  attempts: number; // review model calls (1, or 2 with a rewrite)
  problems: string[][]; // what was wrong with each attempt
}

const DEFAULT_RETAKE = "We couldn't see your work clearly enough to coach it. Try another photo in good light?";

// The trained skill's starter lesson: what the teen gets if the coach can't finish.
function fallbackLesson(ctx: CoachContext): string | null {
  return lessonsForSkill(ctx.quest.trainsSkill)[0]?.id ?? null;
}

// Checks a draft against the contract and the deterministic guardrails.
// Returns the review if it's good, or the list of problems.
export function checkDraft(draft: CoachDraft, ctx: CoachContext): { review: CoachReview | null; problems: string[] } {
  const problems: string[] = [];
  const zone = ctx.zone as ZoneId;
  const skills = draft.skillPoints;
  if (skills.length < 1 || skills.length > 2) problems.push("give points for one or two skills");
  if (new Set(skills.map((s) => s.skill)).size !== skills.length) problems.push("each skill once");
  for (const s of skills) {
    if (!isSkillOfZone(s.skill, zone)) problems.push(`${s.skill} isn't a skill in this zone`);
    if (![0, 1, 2].includes(s.points)) problems.push(`points must be 0, 1 or 2 (got ${s.points} for ${s.skill})`);
  }
  // A missing or made-up lesson is fixed here rather than sent back.
  const lesson = lessonById(draft.lessonId);
  const lessonId = lesson && lesson.zone === zone ? lesson.id : fallbackLesson(ctx);

  const candidate = {
    worked: draft.worked.trim(),
    tryNext: draft.tryNext.trim(),
    why: draft.why.trim(),
    question: draft.question?.trim() || null,
    skillPoints: skills,
    lessonId,
    confidence: Math.max(0, Math.min(1, draft.confidence)),
  };
  const parsed = CoachReview.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(`${issue.path.join(".") || "review"}: ${issue.message}`);
  } else {
    for (const g of reviewGuardrailIssues(parsed.data)) problems.push(`${g.rule}: ${g.detail}`);
  }
  return { review: parsed.success && problems.length === 0 ? parsed.data : null, problems };
}

// Draft → checks → (one rewrite) → checks → saved, or a safe outcome. Never
// returns a review that failed a check.
export async function runCoach(llm: CoachLLM, input: ReviewInput, trace: CoachTrace = { attempts: 0, problems: [] }): Promise<CoachResult> {
  const { ctx } = input;
  let reply: ModelReply<CoachDraft> = await llm.review(input);
  trace.attempts = 1;

  for (let attempt = 1; ; attempt++) {
    if (reply.refused) {
      return { kind: "unavailable", lessonId: fallbackLesson(ctx), model: reply.model, why: "declined" };
    }
    const draft = reply.parsed;
    let problems: string[];

    if (draft?.outcome === "concern") {
      return { kind: "concern", note: (draft.note ?? "").trim() || "The coach raised a concern without a note.", model: reply.model };
    }
    if (draft?.outcome === "retake" || (draft && draft.confidence < MIN_REVIEW_CONFIDENCE)) {
      const note = (draft.note ?? "").trim();
      return { kind: "retake", note: note.length >= 10 && note.length <= 200 ? note : DEFAULT_RETAKE, model: reply.model };
    }

    if (!draft) {
      problems = ["the answer didn't match the JSON format"];
    } else {
      const checked = checkDraft(draft, ctx);
      problems = checked.problems;
      if (checked.review) {
        // The second model reads it as the teen would.
        const verdict = await llm.check(draft, ctx);
        const found = verdict.parsed?.problems.map((p) => `${p.rule}: "${p.quote}"`) ?? ["the guardrail check didn't answer"];
        if (found.length === 0) return { kind: "review", review: checked.review, model: reply.model, promptVersion: PROMPT_VERSION };
        problems = found;
      }
    }

    trace.problems.push(problems);
    if (attempt >= 2) {
      return { kind: "unavailable", lessonId: fallbackLesson(ctx), model: reply.model, why: "failed checks twice" };
    }
    reply = await llm.rewrite(input, reply, problems);
    trace.attempts = 2;
  }
}
