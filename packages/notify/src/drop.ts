import { NotificationPrefs, dropDue, dropMessage } from "@quest/contract";
import { z } from "zod";

// The evening drop job (A10), kept free of Supabase and Expo so it runs with a
// fake clock in tests. Every few minutes: ask who could get a drop, decide with
// the contract's dropDue, push the ones due, and record each drop once.

export const Candidate = z.object({
  teenId: z.uuid(),
  localDay: z.iso.date(),
  localTime: z.string(),
  prefs: NotificationPrefs,
  lastDropDay: z.iso.date().nullable(),
  tokens: z.array(z.string()),
  pointsToday: z.number().int().min(0),
  cheersToday: z.number().int().min(0),
  madeToday: z.boolean(),
});
export type Candidate = z.infer<typeof Candidate>;

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: { screen: "drop" };
  sound: "default";
}

export interface DropDeps {
  candidates(now: Date): Promise<Candidate[]>;
  record(teenId: string, day: string, pushed: boolean): Promise<boolean>; // false if already recorded
  push(messages: PushMessage[]): Promise<{ deadTokens: string[] }>;
  removeToken(token: string): Promise<void>;
  now(): Date;
}

export interface RunResult {
  pushed: string[]; // teen ids
  quiet: string[]; // due, but in quiet hours: in the app only
  skipped: number;
}

export async function runDrops(deps: DropDeps): Promise<RunResult> {
  const now = deps.now();
  const result: RunResult = { pushed: [], quiet: [], skipped: 0 };
  const messages: PushMessage[] = [];
  for (const c of await deps.candidates(now)) {
    const due = dropDue(c.prefs, c.localTime, c.localDay, c.lastDropDay);
    if (due !== "send" && due !== "quiet") {
      result.skipped++;
      continue;
    }
    // Record first: two overlapping runs can't both push.
    if (!(await deps.record(c.teenId, c.localDay, due === "send"))) {
      result.skipped++;
      continue;
    }
    if (due === "quiet") {
      result.quiet.push(c.teenId);
      continue;
    }
    const msg = dropMessage(c);
    for (const to of c.tokens) messages.push({ to, title: msg.title, body: msg.body, data: { screen: "drop" }, sound: "default" });
    result.pushed.push(c.teenId);
  }
  if (messages.length) {
    const { deadTokens } = await deps.push(messages);
    for (const t of deadTokens) await deps.removeToken(t);
  }
  return result;
}

// Expo's push service: up to 100 messages a call. Tokens it reports as no
// longer registered are removed.
export async function expoPush(fetch: typeof globalThis.fetch, messages: PushMessage[], accessToken?: string): Promise<{ deadTokens: string[] }> {
  const dead: string[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`Expo push: ${res.status}`);
    const tickets = ((await res.json()) as { data?: { status: string; details?: { error?: string } }[] }).data ?? [];
    tickets.forEach((t, j) => {
      if (t.status === "error" && t.details?.error === "DeviceNotRegistered") dead.push(batch[j]!.to);
    });
  }
  return { deadTokens: dead };
}
