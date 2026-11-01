import { z } from "zod";

// The account deletion job (A11), run daily (with moving age groups on, see runDaily). For each account past its 7 days:
// stop any web Plus, empty its photo folder, then delete the account (which
// removes every row that hangs off it). Anything that fails is left for the
// next run; deletions_due keeps returning it until it's done, well within
// DELETION_DAYS.

export const DueDeletion = z.object({ userId: z.uuid(), folder: z.string().regex(/^[0-9a-f-]{36}$/) });
export type DueDeletion = z.infer<typeof DueDeletion>;

export interface DeletionDeps {
  due: (now: Date) => Promise<DueDeletion[]>;
  cancelBilling: (userId: string) => Promise<number>;
  listFolder: (folder: string) => Promise<string[]>; // full paths, at most a page
  removeFiles: (paths: string[]) => Promise<void>;
  complete: (userId: string) => Promise<void>;
  now: () => Date;
}

export interface DeletionRun {
  deleted: string[];
  photosRemoved: number;
  subscriptionsCancelled: number;
  failed: { userId: string; error: string }[];
}

export async function emptyFolder(d: Pick<DeletionDeps, "listFolder" | "removeFiles">, folder: string): Promise<number> {
  let removed = 0;
  for (let page = 0; page < 1000; page++) {
    const paths = await d.listFolder(folder);
    if (paths.length === 0) return removed;
    if (paths.some((p) => !p.startsWith(`${folder}/`))) throw new Error("listed a file outside the folder");
    await d.removeFiles(paths);
    removed += paths.length;
  }
  throw new Error("folder didn't empty");
}

// The whole daily job: first teens whose age group has ended move up (free
// Plus stops at 16, a parent's consent at 18), then due deletions.
export interface DailyDeps extends DeletionDeps {
  advanceAgeGroups: (now: Date) => Promise<number>;
}

export async function runDaily(d: DailyDeps): Promise<DeletionRun & { ageGroupsMoved: number }> {
  const ageGroupsMoved = await d.advanceAgeGroups(d.now());
  return { ageGroupsMoved, ...(await runDeletions(d)) };
}

export async function runDeletions(d: DeletionDeps): Promise<DeletionRun> {
  const run: DeletionRun = { deleted: [], photosRemoved: 0, subscriptionsCancelled: 0, failed: [] };
  for (const item of await d.due(d.now())) {
    try {
      run.subscriptionsCancelled += await d.cancelBilling(item.userId);
      run.photosRemoved += await emptyFolder(d, item.folder);
      await d.complete(item.userId);
      run.deleted.push(item.userId);
    } catch (e) {
      run.failed.push({ userId: item.userId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return run;
}
