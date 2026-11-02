import { z } from "zod";
import { Cheer } from "./family";

// The evening drop (A10): once a day, at the teen's drop time (8 pm local by
// default), a push says what the day earned. Pushes never arrive during quiet
// hours (9 pm to 7 am by default); minors' quiet hours are set server-side.

export const DEFAULT_PREFS = { dropTime: "20:00", quietStart: "21:00", quietEnd: "07:00", dailyReminder: false } as const;

// A drop that is due goes out within this long after the drop time; later
// than that (the phone was off, the job was down), it waits for tomorrow.
export const DROP_WINDOW_MINUTES = 120;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const Clock = z.string().regex(HHMM, "a time like 20:00");

export const NotificationPrefs = z.object({
  dropTime: Clock,
  quietStart: Clock,
  quietEnd: Clock,
  dailyReminder: z.boolean(),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefs>;

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

// Quiet hours can run past midnight (21:00–07:00). Start is quiet, end isn't.
export function inQuietHours(time: string, quietStart: string, quietEnd: string): boolean {
  const t = minutesOf(time);
  const s = minutesOf(quietStart);
  const e = minutesOf(quietEnd);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

// Whether a teen's drop goes out now. `localTime` and `localDay` are the
// teen's clock (HH:MM, YYYY-MM-DD). Never twice a day, never in quiet hours.
export function dropDue(prefs: NotificationPrefs, localTime: string, localDay: string, lastDropDay: string | null): "send" | "quiet" | "not_yet" | "done" | "missed" {
  if (lastDropDay === localDay) return "done";
  const now = minutesOf(localTime);
  const at = minutesOf(prefs.dropTime);
  if (now < at) return "not_yet";
  if (now >= at + DROP_WINDOW_MINUTES) return "missed";
  return inQuietHours(localTime, prefs.quietStart, prefs.quietEnd) ? "quiet" : "send";
}

// drop.get: what the drop screen (H19) shows, for the teen's local day and week.
export const Drop = z.object({
  day: z.iso.date(),
  todays: z.array(z.object({ makeId: z.uuid(), questTitle: z.string(), zone: z.string(), sentTo: z.array(z.string()) })),
  weekPoints: z.number().int().min(0),
  weekSkills: z.record(z.string(), z.number().int().min(0)),
  cheers: z.array(z.object({ from: z.string(), cheer: Cheer, questTitle: z.string() })), // this week, newest first
});
export type Drop = z.infer<typeof Drop>;

// The push itself. Lock screens are public, so it carries no names, handles
// or photos, only counts.
export function dropMessage(d: { pointsToday: number; cheersToday: number; madeToday: boolean }): { title: string; body: string } {
  const bits: string[] = [];
  if (d.pointsToday > 0) bits.push(`${d.pointsToday} skill ${d.pointsToday === 1 ? "point" : "points"}`);
  if (d.cheersToday > 0) bits.push(`${d.cheersToday === 1 ? "a cheer" : `${d.cheersToday} cheers`} from family`);
  if (bits.length) return { title: "Tonight's drop", body: `You earned ${bits.join(" and ")} today.` };
  if (d.madeToday) return { title: "Tonight's drop", body: "Your make is in. Your coach's review is waiting." };
  return { title: "Tonight's drop", body: "There's still time for today's quest." };
}
