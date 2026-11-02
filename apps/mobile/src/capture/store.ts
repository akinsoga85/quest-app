import { Directory, File, Paths } from "expo-file-system";
import type { PendingMake } from "./queue";

// Photos waiting to upload live in the app's own documents folder, which other
// apps can't read, until they're saved. Nothing goes to the camera roll.
const dir = () => new Directory(Paths.document, "pending-makes");

function ensureDir(): Directory {
  const d = dir();
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

export const queueFile = () => new File(ensureDir(), "queue.json");
export const photoFile = (makeId: string) => new File(ensureDir(), `${makeId}.jpg`);

export async function loadQueue(): Promise<PendingMake[]> {
  const f = queueFile();
  if (!f.exists) return [];
  try {
    const items = JSON.parse(await f.text()) as PendingMake[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

export async function saveQueue(items: PendingMake[]): Promise<void> {
  const f = queueFile();
  if (!f.exists) f.create({ intermediates: true, overwrite: true });
  await f.write(JSON.stringify(items));
}

export async function readPhoto(makeId: string): Promise<Uint8Array> {
  return photoFile(makeId).bytes();
}

export async function writePhoto(makeId: string, bytes: Uint8Array): Promise<void> {
  const f = photoFile(makeId);
  if (!f.exists) f.create({ intermediates: true, overwrite: true });
  await f.write(bytes);
}

export async function deletePhoto(makeId: string): Promise<void> {
  const f = photoFile(makeId);
  if (f.exists) f.delete();
}

// Photos taken but not yet chosen ("Use photo" or "Retake") sit in the cache
// and are deleted as soon as the teen decides.
export function draftFile(name: string): File {
  return new File(Paths.cache, name);
}
