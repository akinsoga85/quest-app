import { z } from "zod";

// Account deletion and export (anyone), and the admin site (staff only, A11).

export const DeletionRequest = z.object({ requestId: z.uuid(), deletesAfter: z.string(), completesBy: z.string() });
export type DeletionRequest = z.infer<typeof DeletionRequest>;

// Everything about the signed-in person. Loose on purpose: it's for them to keep.
export const DataExport = z.looseObject({ kind: z.enum(["teen", "parent"]), exportedAt: z.string() });
export type DataExport = z.infer<typeof DataExport>;

export const AdminWeek = z.object({
  id: z.uuid(),
  zone: z.string(),
  weekOf: z.iso.date(),
  status: z.enum(["draft", "approved", "rejected"]),
  model: z.string(),
  quests: z.array(z.object({ day: z.number().int(), title: z.string(), brief: z.string(), minutes: z.number().int(), trainsSkill: z.string(), tips: z.array(z.string()) })),
});
export type AdminWeek = z.infer<typeof AdminWeek>;

export const SafetyResolution = z.enum(["released", "kept_blocked", "reported", "removed"]);
export type SafetyResolution = z.infer<typeof SafetyResolution>;

export const QueueItem = z.object({
  id: z.uuid(),
  makeId: z.uuid(),
  storagePath: z.string(),
  source: z.enum(["scan", "coach"]),
  result: z.enum(["block", "human_review"]),
  reasons: z.array(z.string()),
  created: z.string(),
  quest: z.string(),
  zone: z.string(),
  note: z.string().nullable(),
});
export type QueueItem = z.infer<typeof QueueItem>;

export const SpotCheckItem = z.object({
  reviewId: z.uuid(),
  storagePath: z.string(),
  quest: z.string(),
  zone: z.string(),
  worked: z.string(),
  tryNext: z.string(),
  why: z.string(),
  question: z.string().nullable(),
  confidence: z.number(),
  helpful: z.boolean().nullable(),
  grade: z.looseObject({ specific: z.number(), accurate: z.number(), kind: z.number(), actionable: z.number(), guardrail_break: z.boolean() }).nullable(),
});
export type SpotCheckItem = z.infer<typeof SpotCheckItem>;

export const Grade = z.object({
  reviewId: z.uuid(),
  specific: z.number().int().min(1).max(5),
  accurate: z.number().int().min(1).max(5),
  kind: z.number().int().min(1).max(5),
  actionable: z.number().int().min(1).max(5),
  guardrailBreak: z.boolean(),
  note: z.string().max(500),
});
export type Grade = z.infer<typeof Grade>;

export const AdminDeletion = z.object({
  id: z.uuid(),
  requested: z.string(),
  completesBy: z.string(),
  completed: z.string().nullable(),
  held: z.string().nullable(),
});
export type AdminDeletion = z.infer<typeof AdminDeletion>;

// Download my work (the app and the web page). Photo links last a week, so
// there's time to save them; storage paths stay out of the file.
export const PHOTO_LINK_SECONDS = 7 * 24 * 60 * 60;

// "quest-BlueFox-482-2026-11-01.json"
export function exportFileName(name: string, exportedAt: string): string {
  const safe = name.replace(/[^A-Za-z0-9-]/g, "");
  return `quest-${safe || "export"}-${exportedAt.slice(0, 10)}.json`;
}

export function photoPaths(data: DataExport): string[] {
  const makes = Array.isArray(data.makes) ? (data.makes as { storagePath?: unknown }[]) : [];
  return makes.map((m) => m.storagePath).filter((p): p is string => typeof p === "string");
}

export function withPhotoLinks(data: DataExport, links: Record<string, string>): DataExport {
  if (!Array.isArray(data.makes)) return data;
  const makes = (data.makes as Record<string, unknown>[]).map(({ storagePath, ...m }) => ({
    ...m,
    photo: typeof storagePath === "string" ? (links[storagePath] ?? null) : null,
  }));
  return { ...data, makes, photoLinksExpire: new Date(Date.parse(data.exportedAt) + PHOTO_LINK_SECONDS * 1000).toISOString() };
}
