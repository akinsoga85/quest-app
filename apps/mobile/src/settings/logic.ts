import { DELETION_DAYS, type DeletionRequest } from "@quest/contract";

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

export { PHOTO_LINK_SECONDS, exportFileName, photoPaths, withPhotoLinks } from "@quest/contract";
