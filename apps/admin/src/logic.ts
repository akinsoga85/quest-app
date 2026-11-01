import { type QueueItem, type SpotCheckItem } from "@quest/contract";

// Pure logic for the admin site, kept apart so it's unit-tested.

export type Tab = "weeks" | "safety" | "spot-check" | "deletions";
export const TABS: { tab: Tab; label: string }[] = [
  { tab: "safety", label: "Safety queue" },
  { tab: "weeks", label: "Quest weeks" },
  { tab: "spot-check", label: "Coach spot check" },
  { tab: "deletions", label: "Deletions" },
];

export function tabFor(hash: string): Tab {
  const t = hash.replace(/^#\/?/, "");
  return TABS.some((x) => x.tab === t) ? (t as Tab) : "safety";
}

// The Monday (UTC) of the week a date falls in, as YYYY-MM-DD.
export function weekMonday(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

export function isKnownImagery(item: Pick<QueueItem, "reasons">): boolean {
  return item.reasons.some((r) => r.startsWith("hash_match:"));
}

// Known abuse imagery is never shown to staff and never released: it's
// reported through the hash-matching vendor's reporting flow.
export function actionsFor(item: Pick<QueueItem, "reasons">): { resolution: "released" | "kept_blocked" | "reported" | "removed"; label: string }[] {
  if (isKnownImagery(item)) return [{ resolution: "reported", label: "Reported through the vendor" }];
  return [
    { resolution: "released", label: "Fine: release to the coach" },
    { resolution: "kept_blocked", label: "Keep blocked" },
    { resolution: "removed", label: "Remove the photo" },
    { resolution: "reported", label: "Reported" },
  ];
}

// SafetyLabel in the contract.
const LABELS: Record<string, string> = {
  nudity: "Nudity",
  sexual: "Sexual content",
  violence: "Violence",
  self_harm: "Self-harm",
  weapon: "Weapon",
  drugs: "Drugs",
  hate_symbol: "Hate symbol",
};

// "nudity:0.35" → "Nudity 35%", "coach_concern" → "Coach raised a concern".
export function reasonLabel(r: string): string {
  if (r === "coach_concern") return "Coach raised a concern";
  if (r.startsWith("hash_match:")) return `Known abuse imagery (${r.slice(11)})`;
  const [k = r, v] = r.split(":");
  const name = LABELS[k] ?? k.replace(/_/g, " ");
  const n = Number(v);
  return v !== undefined && Number.isFinite(n) ? `${name} ${Math.round(n * 100)}%` : name;
}

// The spot check's running totals: how many graded, average of each score,
// and guardrail breaks (any break is a must-fix).
export function gradeSummary(items: SpotCheckItem[]) {
  const graded = items.flatMap((i) => (i.grade ? [i.grade] : []));
  const avg = (k: "specific" | "accurate" | "kind" | "actionable") =>
    graded.length ? Math.round((graded.reduce((s, g) => s + g[k], 0) / graded.length) * 10) / 10 : null;
  return {
    graded: graded.length,
    total: items.length,
    specific: avg("specific"),
    accurate: avg("accurate"),
    kind: avg("kind"),
    actionable: avg("actionable"),
    breaks: graded.filter((g) => g.guardrail_break).length,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-11-08T15:00:00Z" → "Nov 8"
export function shortDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
