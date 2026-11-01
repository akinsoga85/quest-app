import { DELETION_DAYS, type DataExport, type DeletionRequest } from "@quest/contract";

// Settings (H20a): the pure parts, tested in settings.test.ts.

// "20:00" → "8:00 pm", as the drop row shows it.
export function clockLabel(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

// How the teen signed in, from the Supabase user's app_metadata.
export function providerLabel(appMetadata: { provider?: unknown; providers?: unknown } | undefined): string {
  const p = typeof appMetadata?.provider === "string" ? appMetadata.provider : Array.isArray(appMetadata?.providers) ? String(appMetadata.providers[0]) : "";
  return p === "apple" ? "Apple" : p === "google" ? "Google" : "—";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Nov 8", in the phone's own time zone.
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// The line on Settings while a deletion is waiting.
export function deletionLine(req: DeletionRequest): string {
  return `Your account will be deleted after ${shortDate(req.deletesAfter)}. Changed your mind? Keep it before then.`;
}

export const DELETE_FOOTNOTE = `Deleting removes your account and all your work within ${DELETION_DAYS} days. You have 7 days to change your mind.`;

// "quest-BlueFox-482-2026-11-01.json"
export function exportFileName(handle: string, exportedAt: string): string {
  const safe = handle.replace(/[^A-Za-z0-9-]/g, "");
  return `quest-${safe || "export"}-${exportedAt.slice(0, 10)}.json`;
}

// Short-lived links last this long, so there's time to save the photos.
export const PHOTO_LINK_SECONDS = 7 * 24 * 60 * 60;

// The storage paths of the teen's photos in an export.
export function photoPaths(data: DataExport): string[] {
  const makes = Array.isArray(data.makes) ? (data.makes as { storagePath?: unknown }[]) : [];
  return makes.map((m) => m.storagePath).filter((p): p is string => typeof p === "string");
}

// Adds a link to each photo, and says how long the links last. Storage paths
// stay out of the file: they're internal.
export function withPhotoLinks(data: DataExport, links: Record<string, string>): DataExport {
  if (!Array.isArray(data.makes)) return data;
  const makes = (data.makes as Record<string, unknown>[]).map(({ storagePath, ...m }) => ({
    ...m,
    photo: typeof storagePath === "string" ? (links[storagePath] ?? null) : null,
  }));
  return { ...data, makes, photoLinksExpire: new Date(Date.parse(data.exportedAt) + PHOTO_LINK_SECONDS * 1000).toISOString() };
}
