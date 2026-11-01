import { LEVELS, ZONES, levelFor, skillIdsFor, skillName, type ZoneId, type ZoneLevel } from "@quest/contract";

// Pure logic for the Studio (H18), Levels (H12) and level-up (H13) screens.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Today", or "Oct 22" (the date chip on each make).
export function dayChip(day: string, today: string | null): string {
  if (day === today) return "Today";
  const d = new Date(`${day}T12:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function makesCount(total: number): string {
  return `${total} ${total === 1 ? "make" : "makes"} · only you and your family see these`;
}

export interface LevelView {
  level: number;
  name: string;
  progressPct: number; // 0–100 towards the next level
  progressText: string;
  nextText: string | null; // what the next level earns
  dots: { name: string; reached: boolean; current: boolean }[];
}

export function levelView(points: number): LevelView {
  const l = levelFor(points);
  const next = LEVELS[l.level]; // LEVELS is 0-based; the next level's entry
  return {
    level: l.level,
    name: l.name,
    progressPct: Math.round(l.progress * 100),
    progressText: next ? `${Math.round(l.progress * 100)}% of the way to Level ${next.level}` : "Top level. Keep making.",
    nextText: next ? `Level ${next.level} earns a postcard.` : null,
    dots: LEVELS.map((x) => ({ name: x.name, reached: x.level <= l.level, current: x.level === l.level })),
  };
}

export interface SkillBar {
  skill: string;
  name: string;
  score: number | null; // 1–10
}

export function skillBars(zone: ZoneLevel): SkillBar[] {
  return skillIdsFor(zone.zone as ZoneId).map((skill) => ({ skill, name: skillName(skill), score: zone.skills[skill] ?? null }));
}

export function zoneName(zone: string): string {
  return ZONES[zone as ZoneId]?.name ?? zone;
}
