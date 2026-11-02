import { z } from "zod";
import { SkillId, ZoneId, isSkillOfZone, skillIdsFor } from "./zones";

export const QuestStatus = z.enum(["draft", "approved", "retired"]);

export const Quest = z.object({
  id: z.uuid(),
  zone: ZoneId,
  title: z.string().min(3).max(60),
  brief: z.string().min(20).max(280),
  minutes: z.number().int().min(5).max(20),
  trainsSkill: SkillId,
  tips: z.array(z.string().max(80)).max(3),
  status: QuestStatus,
});
export type Quest = z.infer<typeof Quest>;

// What the quest writer agent (A6) hands over for approval: one week per zone.
export const QuestDraft = Quest.omit({ id: true, status: true });
export type QuestDraft = z.infer<typeof QuestDraft>;

export const QuestWeekDraft = z.object({
  zone: ZoneId,
  weekOf: z.iso.date(),
  quests: z.array(QuestDraft).length(7),
});
export type QuestWeekDraft = z.infer<typeof QuestWeekDraft>;

// Words a quest must never ask for: people, faces or anything that identifies a teen.
const BANNED = [
  /\bselfie\b/i,
  /\byour face\b/i,
  /\bface\b/i,
  /\bwear(ing)? it\b/i,
  /\bmodel it\b/i,
  /\byour (school|address|street|house number)\b/i,
  /\bfriends?\b.*\bphoto\b/i,
];

// Things a quest must never send a teen to do (risky places, tools or people).
const UNSAFE = [
  /\b(knife|knives|blade|razor|scalpel|box cutter)\b/i,
  /\b(fire|flame|candle|lighter|matches|burn)\b/i,
  /\b(climb|rooftop|roof|ledge|bridge|cliff)\b/i,
  /\b(road|traffic|railway|train tracks|highway)\b/i,
  /\b(stranger|strangers|someone you don't know)\b/i,
  /\b(at night alone|alone at night|after dark outside)\b/i,
  /\b(bleach|chemicals?|medicine|pills)\b/i,
];

export function questRuleProblems(q: QuestDraft): string[] {
  const problems: string[] = [];
  const text = `${q.title} ${q.brief} ${q.tips.join(" ")}`;
  if (!isSkillOfZone(q.trainsSkill, q.zone)) problems.push(`skill ${q.trainsSkill} is not in zone ${q.zone}`);
  for (const re of BANNED) if (re.test(text)) problems.push(`asks for something identifying: ${re.source}`);
  for (const re of UNSAFE) if (re.test(text)) problems.push(`asks for something unsafe: ${re.source}`);
  if (q.zone === "fashion" && !/flat[- ]?lay|laid out|on a surface/i.test(text)) {
    problems.push("fashion quests must be flat-lay (no one wears the outfit)");
  }
  return problems;
}

// A week from the quest writer (A6), checked as a whole: seven good quests,
// every skill in the zone trained at least once, no title twice, and nothing
// the teen saw in recent weeks.
export function weekRuleProblems(week: QuestWeekDraft, recentTitles: readonly string[] = []): string[] {
  const problems: string[] = [];
  const parsed = QuestWeekDraft.safeParse(week);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".") || "week"}: ${i.message}`);
  const recent = new Set(recentTitles.map((t) => t.trim().toLowerCase()));
  const seen = new Set<string>();
  week.quests.forEach((q, i) => {
    if (q.zone !== week.zone) problems.push(`day ${i + 1}: zone ${q.zone} isn't ${week.zone}`);
    for (const p of questRuleProblems(q)) problems.push(`day ${i + 1}: ${p}`);
    const key = q.title.trim().toLowerCase();
    if (seen.has(key)) problems.push(`day ${i + 1}: "${q.title}" appears twice this week`);
    if (recent.has(key)) problems.push(`day ${i + 1}: "${q.title}" ran in a recent week`);
    seen.add(key);
  });
  const trained = new Set(week.quests.map((q) => q.trainsSkill));
  for (const skill of skillIdsFor(week.zone)) if (!trained.has(skill)) problems.push(`no quest this week trains ${skill}`);
  if (new Date(`${week.weekOf}T00:00:00Z`).getUTCDay() !== 1) problems.push("weekOf must be a Monday");
  return problems;
}
