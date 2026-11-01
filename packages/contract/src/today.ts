import { z } from "zod";
import { Quest } from "./quest";
import { MAX_ZONES_PER_TEEN, ZoneId } from "./zones";

// Days are local calendar dates, "YYYY-MM-DD", in the teen's time zone. A new
// quest appears at the teen's local midnight, and each make counts for the
// local day it was made on (stored once, so travelling later never moves it).

// The gentle streak (PRD R9): a week counts when the teen made something on at
// least this many different days. Weeks run Monday to Sunday.
export const MAKING_DAYS_PER_WEEK = 3;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The calendar date at `at` in an IANA time zone. Mirrors private.local_day()
// in the database (db tests compare them).
export function localDay(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function toUtc(day: string): Date {
  if (!DAY.test(day)) throw new Error(`not a day: ${day}`);
  return new Date(`${day}T00:00:00Z`);
}

export function addDays(day: string, n: number): string {
  const d = toUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Monday of the week that contains `day`.
export function weekStart(day: string): string {
  const dow = toUtc(day).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

// The seven days, Monday first, of the week that contains `day`.
export function weekDays(day: string): string[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// Weeks in a row with MAKING_DAYS_PER_WEEK or more making days. The current
// week counts once it qualifies, but an unfinished week never breaks the
// streak, so one missed day never resets it. Mirrors the server's streak.
export function weeklyStreak(makingDays: Iterable<string>, today: string): number {
  const perWeek = new Map<string, Set<string>>();
  for (const d of makingDays) {
    if (d > today) continue;
    const w = weekStart(d);
    if (!perWeek.has(w)) perWeek.set(w, new Set());
    perWeek.get(w)!.add(d);
  }
  const qualifies = (w: string) => (perWeek.get(w)?.size ?? 0) >= MAKING_DAYS_PER_WEEK;
  const thisWeek = weekStart(today);
  let streak = qualifies(thisWeek) ? 1 : 0;
  for (let w = addDays(thisWeek, -7); qualifies(w); w = addDays(w, -7)) streak++;
  return streak;
}

// What the Today screen shows (H5, H15), from `today.get`.
export const TodayQuest = Quest.omit({ status: true });
export type TodayQuest = z.infer<typeof TodayQuest>;

export const TodayZone = z.object({
  zone: ZoneId,
  points: z.number().int().min(0), // coach skill points in this zone, for the level chip
  quest: TodayQuest.nullable(), // null if nothing is scheduled (shouldn't happen once A6 runs)
  madeToday: z.boolean(),
});
export type TodayZone = z.infer<typeof TodayZone>;

export const Today = z.object({
  day: z.iso.date(),
  timezone: z.string(),
  zones: z.array(TodayZone).max(MAX_ZONES_PER_TEEN),
  week: z.object({ start: z.iso.date(), madeDays: z.array(z.iso.date()).max(7) }),
  streakWeeks: z.number().int().min(0),
});
export type Today = z.infer<typeof Today>;
