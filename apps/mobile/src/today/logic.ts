import {
  MAKING_DAYS_PER_WEEK,
  ZONES,
  levelFor,
  skillName,
  weekDays,
  type Today,
  type TodayQuest,
  type TodayZone,
  type ZoneId,
} from "@quest/contract";

// Pure logic for the Today screen (H5, H15), kept apart so it's unit-tested.

// IANA names only ("Europe/London", "UTC"). Offsets like "GMT+05:30" are
// refused by the server, so they fall back to UTC.
export function cleanTimeZone(tz: string | null | undefined): string {
  if (!tz || /^(GMT|UTC|Etc\/GMT)[+-]/.test(tz) || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return "UTC";
  return tz;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const utc = (day: string) => new Date(`${day}T12:00:00Z`);

// "2026-10-23" → "Friday, Oct 23"
export function dayHeading(day: string): string {
  const d = utc(day);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function streakLabel(weeks: number): string {
  if (weeks <= 0) return "New streak";
  return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
}

export function streakAccessibilityLabel(weeks: number): string {
  if (weeks <= 0) return `No streak yet. A week counts when you make something on ${MAKING_DAYS_PER_WEEK} days.`;
  return `Streak: ${weeks} ${weeks === 1 ? "week" : "weeks"} in a row of making on ${MAKING_DAYS_PER_WEEK} or more days.`;
}

// The line under the week row: how this week stands against the gentle streak.
export function weekCaption(madeThisWeek: number, streakWeeks: number): string {
  const left = MAKING_DAYS_PER_WEEK - madeThisWeek;
  if (left <= 0) return "This week counts towards your streak.";
  const days = `${left} more ${left === 1 ? "day" : "days"}`;
  return streakWeeks > 0 ? `Make on ${days} this week to keep your streak going.` : `Make on ${days} this week to start a streak.`;
}

export interface WeekDot {
  day: string;
  letter: string;
  name: string;
  made: boolean;
  isToday: boolean;
  isFuture: boolean;
}

export function weekRow(today: Pick<Today, "day" | "week">): WeekDot[] {
  const made = new Set(today.week.madeDays);
  return weekDays(today.day).map((day) => {
    const name = WEEKDAYS[utc(day).getUTCDay()]!;
    return { day, letter: name[0]!, name, made: made.has(day), isToday: day === today.day, isFuture: day > today.day };
  });
}

export function weekAccessibilityLabel(dots: WeekDot[]): string {
  const made = dots.filter((d) => d.made).map((d) => d.name);
  if (made.length === 0) return "This week: nothing made yet.";
  return `This week you made something on ${made.length} ${made.length === 1 ? "day" : "days"}: ${made.join(", ")}.`;
}

// The big card goes to the first zone with a quest still to do; the rest are
// rows. `saving` holds quest ids with a photo on its way (A3), which count as done.
export function splitZones(zones: TodayZone[], saving: ReadonlySet<string> = new Set()): { main: TodayZone | null; rest: TodayZone[] } {
  const main = zones.find((z) => z.quest !== null && !z.madeToday && !saving.has(z.quest.id)) ?? null;
  return { main, rest: zones.filter((z) => z !== main) };
}

export function firstOpenQuest(today: Today | null, saving: ReadonlySet<string> = new Set()): TodayQuest | null {
  return today ? splitZones(today.zones, saving).main?.quest ?? null : null;
}

export function findQuest(today: Today | null, questId: string | undefined): TodayQuest | null {
  if (!today || !questId) return null;
  return today.zones.find((z) => z.quest?.id === questId)?.quest ?? null;
}

// "Daily quest · about 15 min · trains Light"
export function questMeta(quest: TodayQuest): string {
  return `Daily quest · about ${quest.minutes} min · trains ${skillName(quest.trainsSkill)}`;
}

// "Fashion · Level 2 · flat-lay": Fashion keeps its no-bodies rule in view (PRD R14b).
export function zoneLine(zone: ZoneId, points: number): string {
  const parts = [ZONES[zone].name, `Level ${levelFor(points).level}`];
  if (zone === "fashion") parts.push("flat-lay");
  return parts.join(" · ");
}
