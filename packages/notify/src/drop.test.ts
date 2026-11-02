import { describe, expect, it, vi } from "vitest";
import { expoPush, runDrops, type Candidate, type DropDeps, type PushMessage } from "./drop";

const prefs = { dropTime: "20:00", quietStart: "21:00", quietEnd: "07:00", dailyReminder: false };
const cand = (over: Partial<Candidate>): Candidate => ({
  teenId: "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11",
  localDay: "2026-11-02",
  localTime: "20:05",
  prefs,
  lastDropDay: null,
  tokens: ["ExponentPushToken[a]", "ExponentPushToken[b]"],
  pointsToday: 2,
  cheersToday: 0,
  madeToday: true,
  ...over,
});

describe("the drop job", () => {
  it("pushes to every phone of a teen who's due, and records it first", async () => {
    const order: string[] = [];
    const deps: DropDeps = {
      candidates: async () => [cand({})],
      record: async () => (order.push("record"), true),
      push: async (m) => (order.push(`push:${m.length}`), { deadTokens: [] }),
      removeToken: vi.fn(),
      now: () => new Date(),
    };
    const r = await runDrops(deps);
    expect(r.pushed).toHaveLength(1);
    expect(order).toEqual(["record", "push:2"]);
  });

  it("doesn't push when another run already recorded today's drop", async () => {
    const push = vi.fn(async () => ({ deadTokens: [] }));
    const r = await runDrops({ candidates: async () => [cand({})], record: async () => false, push, removeToken: vi.fn(), now: () => new Date() });
    expect(r).toMatchObject({ pushed: [], skipped: 1 });
    expect(push).not.toHaveBeenCalled();
  });
});

describe("Expo push", () => {
  it("sends in batches of 100 and reports unregistered phones", async () => {
    const messages: PushMessage[] = Array.from({ length: 150 }, (_, i) => ({ to: `ExponentPushToken[${i}]`, title: "t", body: "b", data: { screen: "drop" }, sound: "default" }));
    const sizes: number[] = [];
    const fetch = vi.fn(async (_url: string, init: { body: string }) => {
      const batch = JSON.parse(init.body) as PushMessage[];
      sizes.push(batch.length);
      return new Response(JSON.stringify({ data: batch.map((m) => (m.to.endsWith("[7]") ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok" })) }));
    });
    expect(await expoPush(fetch as unknown as typeof globalThis.fetch, messages)).toEqual({ deadTokens: ["ExponentPushToken[7]"] });
    expect(sizes).toEqual([100, 50]);
  });
});
