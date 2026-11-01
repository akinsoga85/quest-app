import { z } from "zod";
import { SkillId, ZoneId, isSkillOfZone } from "./zones";

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

export function questRuleProblems(q: QuestDraft): string[] {
  const problems: string[] = [];
  const text = `${q.title} ${q.brief} ${q.tips.join(" ")}`;
  if (!isSkillOfZone(q.trainsSkill, q.zone)) problems.push(`skill ${q.trainsSkill} is not in zone ${q.zone}`);
  for (const re of BANNED) if (re.test(text)) problems.push(`asks for something identifying: ${re.source}`);
  if (q.zone === "fashion" && !/flat[- ]?lay|laid out|on a surface/i.test(text)) {
    problems.push("fashion quests must be flat-lay (no one wears the outfit)");
  }
  return problems;
}
