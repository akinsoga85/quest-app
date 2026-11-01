import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { CoachContext } from "@quest/contract";
import { CoachDraft, GUARD_SYSTEM, GuardVerdict, guardRequestText, reviewRequestText, reviewSystem } from "./prompt";

// The coach talks to Claude only through this, so tests can stand in for it.
export interface ModelReply<T> {
  parsed: T | null; // null when the answer didn't match the schema
  refused: boolean; // the model (and every fallback) declined
  model: string; // which model answered
  turn?: unknown; // the assistant turn, replayed unchanged for a rewrite
}

export interface ReviewInput {
  ctx: CoachContext;
  image: { base64: string; mediaType: "image/jpeg" | "image/png" };
}

export interface CoachLLM {
  review(input: ReviewInput): Promise<ModelReply<CoachDraft>>;
  rewrite(input: ReviewInput, previous: ModelReply<CoachDraft>, problems: string[]): Promise<ModelReply<CoachDraft>>;
  check(draft: CoachDraft, ctx: CoachContext): Promise<ModelReply<GuardVerdict>>;
}

export interface CoachModels {
  review: string; // writes the review, sees the photo
  guard: string; // checks the review text against the guardrails
  reviewEffort: "low" | "medium" | "high";
}

// Claude Opus 5.5 writes reviews; Claude Haiku 5.5 checks them (the plan's
// "smaller model checks the draft"). Both can be changed with COACH_MODEL,
// COACH_GUARD_MODEL and COACH_EFFORT.
export const DEFAULT_MODELS: CoachModels = { review: "claude-opus-5-5", guard: "claude-haiku-5-5", reviewEffort: "medium" };

const MAX_TOKENS = 16000;

// The request for a first review. Exported so tests can check what's sent.
export function reviewParams(input: ReviewInput, models: CoachModels) {
  return {
    model: models.review,
    max_tokens: MAX_TOKENS,
    // If Claude declines (a safety classifier false positive on a teen's photo),
    // the API retries on a fallback model in the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    // Plus (A9): deeper coaching, with more thinking per review.
    output_config: { effort: input.ctx.plus ? ("high" as const) : models.reviewEffort, format: betaZodOutputFormat(CoachDraft) },
    system: [{ type: "text" as const, text: reviewSystem(input.ctx.zone), cache_control: { type: "ephemeral" as const } }],
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "image" as const, source: { type: "base64" as const, media_type: input.image.mediaType, data: input.image.base64 } },
          { type: "text" as const, text: reviewRequestText(input.ctx) },
        ],
      },
    ],
  };
}

export function guardParams(draft: CoachDraft, ctx: CoachContext, models: CoachModels) {
  return {
    model: models.guard,
    max_tokens: 4000,
    output_config: { effort: "low" as const, format: betaZodOutputFormat(GuardVerdict) },
    system: [{ type: "text" as const, text: GUARD_SYSTEM, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: guardRequestText(draft, ctx) }],
  };
}

export function claudeCoach(client: Anthropic, models: CoachModels = DEFAULT_MODELS): CoachLLM {
  const toReply = <T>(res: { parsed_output?: T | null; stop_reason: string | null; model: string; content: unknown }): ModelReply<T> => ({
    parsed: res.stop_reason === "refusal" ? null : (res.parsed_output ?? null),
    refused: res.stop_reason === "refusal",
    model: res.model,
    turn: res.content,
  });

  return {
    async review(input) {
      return toReply(await client.beta.messages.parse(reviewParams(input, models)));
    },
    async rewrite(input, previous, problems) {
      const first = reviewParams(input, models);
      // Append-only: the first answer goes back exactly as it came.
      const res = await client.beta.messages.parse({
        ...first,
        messages: [
          ...first.messages,
          { role: "assistant" as const, content: previous.turn as Anthropic.Beta.BetaContentBlockParam[] },
          {
            role: "user" as const,
            content: `Your review broke these rules:\n${problems.map((p) => `- ${p}`).join("\n")}\nRewrite it to fix them. Keep what was specific and true. Same JSON format.`,
          },
        ],
      });
      return toReply(res);
    },
    async check(draft, ctx) {
      return toReply(await client.beta.messages.parse(guardParams(draft, ctx, models)));
    },
  };
}

export function modelsFromEnv(env: Record<string, string | undefined>): CoachModels {
  const effort = env.COACH_EFFORT;
  return {
    review: env.COACH_MODEL || DEFAULT_MODELS.review,
    guard: env.COACH_GUARD_MODEL || DEFAULT_MODELS.guard,
    reviewEffort: effort === "low" || effort === "high" ? effort : DEFAULT_MODELS.reviewEffort,
  };
}
