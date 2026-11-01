import { describe, expect, it } from "vitest";
import { emptyFolder, runDeletions, type DeletionDeps } from "./deletions";
import { handleDeletionsRequest } from "./supabase";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";

function fakes(files: Record<string, string[]>, opts: { billingFails?: string } = {}) {
  const log: string[] = [];
  const deps: DeletionDeps = {
    due: async () => [
      { userId: A, folder: A },
      { userId: B, folder: B },
    ],
    cancelBilling: async (u) => {
      log.push(`billing ${u}`);
      if (u === opts.billingFails) throw new Error("Stripe is down");
      return u === A ? 1 : 0;
    },
    listFolder: async (f) => (files[f] ?? []).slice(0, 2).map((n) => `${f}/${n}`),
    removeFiles: async (paths) => {
      for (const p of paths) {
        const [f, n] = p.split("/");
        files[f!] = (files[f!] ?? []).filter((x) => x !== n);
      }
      log.push(`remove ${paths.length}`);
    },
    complete: async (u) => void log.push(`complete ${u}`),
    now: () => new Date("2026-11-20T03:00:00Z"),
  };
  return { deps, log };
}

describe("the deletion job", () => {
  it("stops Plus, empties every page of the folder, then deletes the account", async () => {
    const files = { [A]: ["1.jpg", "2.jpg", "3.jpg"], [B]: [] };
    const { deps, log } = fakes(files);
    const run = await runDeletions(deps);
    expect(run).toEqual({ deleted: [A, B], photosRemoved: 3, subscriptionsCancelled: 1, failed: [] });
    expect(files[A]).toEqual([]);
    expect(log).toEqual([`billing ${A}`, "remove 2", "remove 1", `complete ${A}`, `billing ${B}`, `complete ${B}`]);
  });

  it("leaves an account for the next run if a step fails, and carries on", async () => {
    const files = { [A]: ["1.jpg"], [B]: ["9.jpg"] };
    const { deps, log } = fakes(files, { billingFails: A });
    const run = await runDeletions(deps);
    expect(run.deleted).toEqual([B]);
    expect(run.failed).toEqual([{ userId: A, error: "Stripe is down" }]);
    expect(files[A]).toEqual(["1.jpg"]); // nothing of A's was touched
    expect(log).not.toContain(`complete ${A}`);
  });

  it("never removes files outside the account's folder", async () => {
    await expect(emptyFolder({ listFolder: async () => ["other/1.jpg"], removeFiles: async () => undefined }, A)).rejects.toThrow(/outside/);
  });

  it("needs its secret, and says when it isn't set up", async () => {
    const post = (s: string) => new Request("https://x/account-deletions", { method: "POST", headers: { "x-deletions-secret": s } });
    expect((await handleDeletionsRequest(post("nope"), { DELETIONS_WEBHOOK_SECRET: "s" })).status).toBe(403);
    expect((await handleDeletionsRequest(post("s"), {})).status).toBe(403);
    expect((await handleDeletionsRequest(post("s"), { DELETIONS_WEBHOOK_SECRET: "s" })).status).toBe(503);
    const { deps } = fakes({ [A]: [], [B]: [] });
    const res = await handleDeletionsRequest(post("s"), { DELETIONS_WEBHOOK_SECRET: "s" }, deps);
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toEqual([A, B]);
  });
});
