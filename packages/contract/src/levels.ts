import { z } from "zod";
import { MakeStatus } from "./photo";

// Levels per zone. Points (PRD R32) come from quests finished (one per quest,
// once the safety scan passes; a retake doesn't count twice) and coach skill
// points only; cheers, fans and second takes give nothing. Names come from the
// hi-fi Levels screen; thresholds are a first guess to tune in the pilot.
// private.zone_points and private.level_for in the database mirror these.
export const LEVELS = [
  { level: 1, name: "Spark", from: 0 },
  { level: 2, name: "Explorer", from: 10 },
  { level: 3, name: "Maker", from: 25 },
  { level: 4, name: "Crafter", from: 45 },
  { level: 5, name: "Master", from: 70 },
] as const;

export interface LevelState {
  level: number;
  name: string;
  points: number;
  nextAt: number | null; // null at the top level
  progress: number; // 0..1 towards the next level
}

export function levelFor(points: number): LevelState {
  const p = Math.max(0, Math.floor(points));
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) if (p >= LEVELS[k]!.from) i = k;
  const cur = LEVELS[i]!;
  const next = LEVELS[i + 1];
  if (!next) return { level: cur.level, name: cur.name, points: p, nextAt: null, progress: 1 };
  return {
    level: cur.level,
    name: cur.name,
    points: p,
    nextAt: next.from,
    progress: (p - cur.from) / (next.from - cur.from),
  };
}

// True when going from `before` to `after` points crosses into a new level,
// which earns a digital postcard (PRD: postcards).
export function levelledUp(before: number, after: number): boolean {
  return levelFor(after).level > levelFor(before).level;
}

// A skill's score, 1–10, from its last 10 coach scores (0–2 each), or null
// before the first (PRD R33). Mirrors private.skill_score in the database.
export function skillScore(lastTenPoints: readonly number[]): number | null {
  const pts = lastTenPoints.slice(0, 10);
  if (pts.length === 0) return null;
  const avg = pts.reduce((a, b) => a + b, 0) / pts.length;
  return Math.round(1 + 4.5 * avg);
}

const MakeRef = z.object({ makeId: z.uuid(), day: z.iso.date() });

// levels.get: one entry per zone the teen has picked or has points in.
export const ZoneLevel = z.object({
  zone: z.string(),
  points: z.number().int().min(0),
  skills: z.record(z.string(), z.number().int().min(1).max(10).nullable()),
  compare: z.object({ before: MakeRef, after: MakeRef, sameQuest: z.boolean() }).nullable(), // "You vs. you"
});
export type ZoneLevel = z.infer<typeof ZoneLevel>;

// studio.list: the portfolio, newest first.
export const StudioMake = z.object({
  id: z.uuid(),
  zone: z.string(),
  questTitle: z.string(),
  localDay: z.iso.date(),
  status: MakeStatus,
  storagePath: z.string(),
  createdAt: z.string(),
});
export type StudioMake = z.infer<typeof StudioMake>;
export const StudioPage = z.object({ total: z.number().int().min(0), makes: z.array(StudioMake) });
export type StudioPage = z.infer<typeof StudioPage>;

// A postcard earned at a level-up, until the teen has seen it.
export const NewPostcard = z.object({ id: z.uuid(), zone: z.string(), level: z.number().int().min(2).max(5), makeId: z.uuid().nullable() });
export type NewPostcard = z.infer<typeof NewPostcard>;
