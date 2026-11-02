import { hasPrivateMetadata, jpegMetadata, makePath, type ZoneId } from "@quest/contract";

// The upload queue: photos the teen chose wait here, on the phone, until they
// are uploaded and recorded. Every step can be repeated safely (the make id is
// fixed when the photo is taken), so after a dropped connection, a closed app
// or a restart, the queue picks up where it stopped.
//
// Kept free of Expo and Supabase so it's unit-tested; the real storage and
// network come in through QueueDeps (see store.ts and UploadProvider.tsx).

export type Stage = "upload" | "record" | "failed";

export interface PendingMake {
  makeId: string;
  teenId: string;
  questId: string;
  zone: ZoneId;
  capturedAt: string; // ISO time the photo was taken
  stage: Stage;
  attempts: number;
  nextTryAt: number; // ms since epoch
  error: string | null; // why it stopped, for the teen (failed only)
}

// What went wrong, as far as the queue cares.
export type FailureKind = "retry" | "stop" | "exists" | "reupload";

export class StepError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
  ) {
    super(message);
  }
}

export interface QueueDeps {
  load(): Promise<PendingMake[]>;
  save(items: PendingMake[]): Promise<void>;
  readPhoto(makeId: string): Promise<Uint8Array>;
  deletePhoto(makeId: string): Promise<void>;
  upload(path: string, bytes: Uint8Array): Promise<void>; // throws StepError
  record(item: PendingMake): Promise<void>; // throws StepError
  now(): number;
}

// 15 s, 30 s, 1 min … up to 10 minutes between tries. Coming back online or
// opening the app retries at once.
export function backoffMs(attempts: number): number {
  return Math.min(10 * 60_000, 15_000 * 2 ** Math.max(0, attempts - 1));
}

type Listener = (items: PendingMake[], event?: { done: PendingMake }) => void;

export class UploadQueue {
  private items: PendingMake[] = [];
  private loaded: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private listeners = new Set<Listener>();

  constructor(private deps: QueueDeps) {}

  load(): Promise<void> {
    this.loaded ??= this.deps.load().then((items) => {
      this.items = items;
      this.emit();
    });
    return this.loaded;
  }

  get pending(): readonly PendingMake[] {
    return this.items;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async add(item: Omit<PendingMake, "stage" | "attempts" | "nextTryAt" | "error">): Promise<void> {
    await this.load();
    this.items = [...this.items.filter((i) => i.makeId !== item.makeId), { ...item, stage: "upload", attempts: 0, nextTryAt: 0, error: null }];
    await this.persist();
  }

  async discard(makeId: string): Promise<void> {
    await this.load();
    this.items = this.items.filter((i) => i.makeId !== makeId);
    await this.persist();
    await this.deps.deletePhoto(makeId).catch(() => undefined);
  }

  // Works through what's due, one at a time. `force` ignores the backoff (the
  // network just came back) and also retries failed items when asked.
  run(opts: { force?: boolean; retryFailed?: boolean } = {}): Promise<void> {
    if (this.running) return this.running;
    this.running = this.runAll(opts).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runAll({ force = false, retryFailed = false }: { force?: boolean; retryFailed?: boolean }) {
    await this.load();
    if (retryFailed) {
      this.items = this.items.map((i) => (i.stage === "failed" ? { ...i, stage: "upload", error: null, attempts: 0, nextTryAt: 0 } : i));
    }
    for (const id of this.items.map((i) => i.makeId)) {
      const item = this.items.find((i) => i.makeId === id);
      if (!item || item.stage === "failed") continue;
      if (!force && item.nextTryAt > this.deps.now()) continue;
      await this.process(item);
    }
  }

  private async process(start: PendingMake) {
    let item = start;
    try {
      if (item.stage === "upload") {
        const bytes = await this.deps.readPhoto(item.makeId);
        // Last check before anything leaves the phone (PRD R13).
        if (hasPrivateMetadata(jpegMetadata(bytes))) throw new StepError("stop", "This photo still has location data, so it wasn't sent.");
        try {
          await this.deps.upload(makePath(item.teenId, item.makeId), bytes);
        } catch (e) {
          if (!(e instanceof StepError && e.kind === "exists")) throw e; // already there from an earlier try
        }
        item = await this.update(item, { stage: "record" });
      }
      if (item.stage === "record") {
        try {
          await this.deps.record(item);
        } catch (e) {
          if (e instanceof StepError && e.kind === "reupload") {
            await this.update(item, { stage: "upload" });
          }
          throw e;
        }
        this.items = this.items.filter((i) => i.makeId !== item.makeId);
        await this.persist({ done: item });
        await this.deps.deletePhoto(item.makeId).catch(() => undefined);
      }
    } catch (e) {
      const current = this.items.find((i) => i.makeId === item.makeId) ?? item;
      const kind = e instanceof StepError ? e.kind : "retry";
      if (kind === "stop") {
        await this.update(current, { stage: "failed", error: e instanceof Error ? e.message : "Something went wrong." });
      } else {
        const attempts = current.attempts + 1;
        await this.update(current, { attempts, nextTryAt: this.deps.now() + backoffMs(attempts), error: null });
      }
    }
  }

  private async update(item: PendingMake, patch: Partial<PendingMake>): Promise<PendingMake> {
    const next = { ...item, ...patch };
    this.items = this.items.map((i) => (i.makeId === item.makeId ? next : i));
    await this.persist();
    return next;
  }

  private async persist(event?: { done: PendingMake }) {
    await this.deps.save(this.items);
    this.emit(event);
  }

  private emit(event?: { done: PendingMake }) {
    for (const fn of this.listeners) fn(this.items, event);
  }
}

// ---------------------------------------------------------------------------
// Turning Supabase errors into queue decisions.

interface ErrorLike {
  message?: string;
  code?: string;
  status?: number | string;
  statusCode?: number | string;
}

const NETWORK = /network|fetch|timed? ?out|timeout|offline|connection|socket|aborted/i;

// Storage upload errors.
export function classifyStorageError(err: ErrorLike): FailureKind {
  const status = Number(err.statusCode ?? err.status ?? 0);
  if (status === 409 || /already exists|duplicate/i.test(err.message ?? "")) return "exists";
  if (status === 0 || status === 401 || status === 408 || status === 429 || status >= 500) return "retry";
  if (NETWORK.test(err.message ?? "")) return "retry";
  return "stop"; // 400, 403 (not your folder), 413 (too big)
}

// record_make errors (Postgres SQLSTATE codes from the function).
export function classifyRpcError(err: ErrorLike): FailureKind {
  const code = err.code ?? "";
  if (code === "P0002") return "reupload"; // the photo isn't in storage yet
  if (/^(23|22|42|P0)/.test(code)) return "stop"; // not open, too old, already made, not a teen
  return "retry"; // network, timeouts, expired sign-in, server busy
}

// What the teen sees on Today for a quest with a photo still on the phone.
export function pendingLabel(p: PendingMake): string {
  if (p.stage === "failed") return p.error ?? "Couldn't save this photo.";
  return p.attempts === 0 ? "Saving your photo…" : "Waiting for a connection to save your photo";
}
