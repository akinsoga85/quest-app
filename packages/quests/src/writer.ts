import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { skillName, weekRuleProblems, type QuestWeekDraft, type ZoneId } from "@quest/contract";
import { z } from "zod";
import { RULES, WRITER_VERSION, curriculumFor } from "./curriculum";

// The quest writer agent (A6): drafts one week of quests for one zone. Every
// week goes through weekRuleProblems; a week with problems gets one rewrite,
// and is never saved with problems left.

export const DraftWeek = z.object({
  quests: z.array(
    z.object({
      title: z.string(),
      brief: z.string(),
      minutes: z.number().int(),
      trainsSkill: z.string(),
      tips: z.array(z.string()),
    }),
  ),
});
export type DraftWeek = z.infer<typeof DraftWeek>;

export interface WeekRequest {
  zone: string;
  weekOf: string; // a Monday, "YYYY-MM-DD"
  recentTitles: string[];
}

export interface WriterReply {
  parsed: DraftWeek | null;
  refused: boolean;
  model: string;
  turn?: unknown;
}

export interface WriterLLM {
  draft(req: WeekRequest): Promise<WriterReply>;
  rewrite(req: WeekRequest, previous: WriterReply, problems: string[]): Promise<WriterReply>;
}

export type WeekResult = { ok: true; week: QuestWeekDraft; model: string; attempts: number } | { ok: false; problems: string[]; attempts: number };

export function toWeek(req: WeekRequest, draft: DraftWeek): QuestWeekDraft {
  return {
    zone: req.zone as ZoneId,
    weekOf: req.weekOf,
    quests: draft.quests.map((q) => ({
      zone: req.zone as ZoneId,
      title: q.title.trim(),
      brief: q.brief.trim(),
      minutes: q.minutes,
      trainsSkill: q.trainsSkill,
      tips: q.tips.map((t) => t.trim()).filter(Boolean),
    })),
  };
}

export async function writeWeek(llm: WriterLLM, req: WeekRequest): Promise<WeekResult> {
  let reply = await llm.draft(req);
  for (let attempt = 1; ; attempt++) {
    if (reply.refused) return { ok: false, problems: ["the model declined"], attempts: attempt };
    const problems = reply.parsed ? weekRuleProblems(toWeek(req, reply.parsed), req.recentTitles) : ["the answer didn't match the JSON format"];
    if (problems.length === 0 && reply.parsed) return { ok: true, week: toWeek(req, reply.parsed), model: reply.model, attempts: attempt };
    if (attempt >= 2) return { ok: false, problems, attempts: attempt };
    reply = await llm.rewrite(req, reply, problems);
  }
}

// ---------------------------------------------------------------------------
// With Claude

export function writerSystem(zone: string): string {
  const c = curriculumFor(zone);
  return [
    `You write daily creative quests for teens aged 13 to 19. This week's zone: ${zone} (${c.what}).`,
    RULES,
    `Skills in this zone and what quests for them practise:\n${Object.entries(c.skills)
      .map(([id, what]) => `- ${id} (${skillName(id)}): ${what}`)
      .join("\n")}`,
    `Places quests can happen: ${c.places.join(", ")}.`,
    `Quests in the house style:\n${c.examples.map((e) => JSON.stringify(e)).join("\n")}`,
    "Make the week varied: mix quick and longer quests, and build from easier to harder across the week.",
  ].join("\n\n");
}

export function writerParams(req: WeekRequest, model: string) {
  return {
    model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    output_config: { effort: "high" as const, format: betaZodOutputFormat(DraftWeek) },
    system: [{ type: "text" as const, text: writerSystem(req.zone), cache_control: { type: "ephemeral" as const } }],
    messages: [
      {
        role: "user" as const,
        content: [
          `Write 7 quests for the week of Monday ${req.weekOf}, Monday first.`,
          req.recentTitles.length ? `Don't reuse these recent titles:\n${req.recentTitles.map((t) => `- ${t}`).join("\n")}` : "",
          "Use exactly these skill ids for trainsSkill.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  };
}

export function claudeWriter(client: Anthropic, model = "claude-opus-5-5"): WriterLLM {
  const toReply = (res: { parsed_output?: DraftWeek | null; stop_reason: string | null; model: string; content: unknown }): WriterReply => ({
    parsed: res.stop_reason === "refusal" ? null : (res.parsed_output ?? null),
    refused: res.stop_reason === "refusal",
    model: res.model,
    turn: res.content,
  });
  return {
    async draft(req) {
      return toReply(await client.beta.messages.parse(writerParams(req, model)));
    },
    async rewrite(req, previous, problems) {
      const first = writerParams(req, model);
      return toReply(
        await client.beta.messages.parse({
          ...first,
          messages: [
            ...first.messages,
            { role: "assistant" as const, content: previous.turn as Anthropic.Beta.BetaContentBlockParam[] },
            { role: "user" as const, content: `That week broke these rules:\n${problems.map((p) => `- ${p}`).join("\n")}\nRewrite the whole week to fix them. Same JSON format.` },
          ],
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// The weekly job: draft every week that's missing, save the good ones.

export interface WeeksDb {
  weeksToDraft(ahead: number): Promise<{ zone: string; weekOf: string }[]>;
  recentTitles(zone: string): Promise<string[]>;
  saveWeek(week: QuestWeekDraft, model: string): Promise<string>;
}

export interface JobResult {
  zone: string;
  weekOf: string;
  saved: string | null; // week id
  problems: string[];
}

export async function draftMissingWeeks(db: WeeksDb, llm: WriterLLM, ahead = 2): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const { zone, weekOf } of await db.weeksToDraft(ahead)) {
    try {
      const r = await writeWeek(llm, { zone, weekOf, recentTitles: await db.recentTitles(zone) });
      if (r.ok) results.push({ zone, weekOf, saved: await db.saveWeek(r.week, `${r.model} ${WRITER_VERSION}`), problems: [] });
      else results.push({ zone, weekOf, saved: null, problems: r.problems });
    } catch (e) {
      results.push({ zone, weekOf, saved: null, problems: [e instanceof Error ? e.message : String(e)] });
    }
  }
  return results;
}
