import { CHEER_LABELS, Cheer, ZONES, levelFor, type ParentOverview, type ZoneId } from "@quest/contract";

// Pure logic for the parent page, kept apart so it's unit-tested.

export type Route = { page: "consent"; token: string } | { page: "home" };

export function route(pathname: string, search: string): Route {
  const token = new URLSearchParams(search).get("t");
  if (pathname.replace(/\/+$/, "") === "/consent" && token) return { page: "consent", token };
  return { page: "home" };
}

// "Level 3" and "in Photography", for the teen's strongest zone (H25).
export function bestZone(teen: ParentOverview["teens"][number]): { level: string; where: string } | null {
  const top = [...teen.zones].sort((a, b) => b.points - a.points)[0];
  if (!top) return null;
  return { level: `Level ${levelFor(top.points).level}`, where: `in ${ZONES[top.zone as ZoneId]?.name ?? top.zone}` };
}

export function questsLine(n: number): string {
  return n === 1 ? "quest made" : "quests made";
}

export const CHEERS = Cheer.options.map((c) => ({ value: c, label: CHEER_LABELS[c] }));

export function signInRedirect(origin: string, pathname: string, search: string): string {
  return `${origin}${pathname}${search}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-10-23" → "Oct 23"
export function shortDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// "Plus until Dec 1, bought here" for the parent page.
export function plusLine(until: string | null, source: string | null): string {
  const when = until ? ` until ${shortDay(until.slice(0, 10))}` : "";
  const where = source === "web" ? "bought here" : source === "app_store" ? "bought in the App Store" : source === "google_play" ? "bought on Google Play" : "";
  return `Plus is on${when}${where ? `, ${where}` : ""}.`;
}
