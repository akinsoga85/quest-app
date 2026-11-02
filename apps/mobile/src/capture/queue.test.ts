import { stripJpegMetadata } from "@quest/contract";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StepError, UploadQueue, backoffMs, classifyRpcError, classifyStorageError, pendingLabel, type PendingMake, type QueueDeps } from "./queue";

const RAW = new Uint8Array(readFileSync(new URL("../../../../packages/contract/src/fixtures/gps.jpg", import.meta.url)));
const CLEAN = stripJpegMetadata(RAW);
const TEEN = "teen-1";

// A pretend phone (disk) and server (storage + makes), with a network that can
// be switched off or made to drop just after the server got the request.
function world() {
  const disk = { queue: "[]", photos: new Map<string, Uint8Array>() };
  const server = { objects: new Map<string, Uint8Array>(), makes: new Map<string, string>(), uploads: 0, records: 0, closedQuests: new Set<string>() };
  const net = { online: true, dropAfterServerGotIt: 0 };
  let clock = 1_000_000;

  const send = <T>(handle: () => T): T => {
    if (!net.online) throw new StepError("retry", "Network request failed");
    const result = handle();
    if (net.dropAfterServerGotIt > 0) {
      net.dropAfterServerGotIt--;
      throw new StepError("retry", "Network request failed"); // the answer never arrived
    }
    return result;
  };

  const deps: QueueDeps = {
    load: async () => JSON.parse(disk.queue) as PendingMake[],
    save: async (items) => {
      disk.queue = JSON.stringify(items);
    },
    readPhoto: async (id) => {
      const b = disk.photos.get(id);
      if (!b) throw new StepError("stop", "photo missing");
      return b;
    },
    deletePhoto: async (id) => {
      disk.photos.delete(id);
    },
    upload: async (path, bytes) =>
      send(() => {
        server.uploads++;
        if (server.objects.has(path)) throw new StepError("exists", "The resource already exists");
        server.objects.set(path, bytes);
      }),
    record: async (item) =>
      send(() => {
        server.records++;
        if (server.closedQuests.has(item.questId)) throw new StepError("stop", "That quest isn't open any more.");
        if (!server.objects.has(`${item.teenId}/${item.makeId}.jpg`)) throw new StepError("reupload", "upload the photo first");
        server.makes.set(item.makeId, item.questId); // same id again changes nothing
      }),
    now: () => clock,
  };
  const take = (makeId: string, bytes = CLEAN) => {
    disk.photos.set(makeId, bytes);
    return { makeId, teenId: TEEN, questId: `quest-${makeId}`, zone: "photography" as const, capturedAt: new Date(clock).toISOString() };
  };
  return { disk, server, net, deps, take, tick: (ms: number) => (clock += ms) };
}

describe("upload queue", () => {
  it("A3 done when: an upload resumes after a dropped connection", async () => {
    const w = world();
    const queue = new UploadQueue(w.deps);
    w.net.online = false;
    await queue.add(w.take("m1"));
    await queue.run();
    expect(queue.pending[0]).toMatchObject({ stage: "upload", attempts: 1 });
    expect(pendingLabel(queue.pending[0]!)).toBe("Waiting for a connection to save your photo");

    // Still offline, and not due yet: nothing happens.
    await queue.run();
    expect(queue.pending[0]!.attempts).toBe(1);

    // Back online: the app retries straight away.
    w.net.online = true;
    await queue.run({ force: true });
    expect(queue.pending).toEqual([]);
    expect([...w.server.makes]).toEqual([["m1", "quest-m1"]]);
    expect(w.server.objects.get(`${TEEN}/m1.jpg`)).toEqual(CLEAN);
    expect(w.disk.photos.size).toBe(0); // the phone's copy is gone once it's saved
  });

  it("the connection drops after the server got the photo: no second copy", async () => {
    const w = world();
    const queue = new UploadQueue(w.deps);
    w.net.dropAfterServerGotIt = 1;
    await queue.add(w.take("m1"));
    await queue.run();
    expect(queue.pending[0]!.stage).toBe("upload");
    w.tick(backoffMs(1));
    await queue.run();
    expect(queue.pending).toEqual([]);
    expect(w.server.objects.size).toBe(1);
    expect(w.server.makes.size).toBe(1);
  });

  it("the connection drops after the server recorded the make: still one make", async () => {
    const w = world();
    const queue = new UploadQueue(w.deps);
    await queue.add(w.take("m1"));
    w.net.dropAfterServerGotIt = 0;
    // Let the upload through, then lose the answer to record.
    const record = w.deps.record;
    let first = true;
    w.deps.record = async (item) => {
      await record(item);
      if (first) {
        first = false;
        throw new StepError("retry", "Network request failed");
      }
    };
    await queue.run();
    expect(queue.pending[0]!.stage).toBe("record");
    await queue.run({ force: true });
    expect(queue.pending).toEqual([]);
    expect(w.server.makes.size).toBe(1);
    expect(w.server.records).toBe(2);
    expect(w.server.uploads).toBe(1); // the photo wasn't sent twice
  });

  it("picks up where it stopped after the app is closed", async () => {
    const w = world();
    const first = new UploadQueue(w.deps);
    const record = w.deps.record;
    w.deps.record = async () => {
      throw new StepError("retry", "Network request failed");
    };
    await first.add(w.take("m1"));
    await first.run();
    expect(JSON.parse(w.disk.queue)[0].stage).toBe("record");

    // A new app session reads the queue back from disk.
    w.deps.record = record;
    const second = new UploadQueue(w.deps);
    await second.run({ force: true });
    expect(second.pending).toEqual([]);
    expect(w.server.uploads).toBe(1);
    expect(w.server.makes.size).toBe(1);
  });

  it("stops, and says why, when the server refuses for good", async () => {
    const w = world();
    const queue = new UploadQueue(w.deps);
    const item = w.take("m1");
    w.server.closedQuests.add(item.questId);
    await queue.add(item);
    await queue.run();
    expect(queue.pending[0]).toMatchObject({ stage: "failed", error: "That quest isn't open any more." });
    expect(pendingLabel(queue.pending[0]!)).toBe("That quest isn't open any more.");
    await queue.run({ force: true });
    expect(w.server.records).toBe(1); // not retried on its own
    expect(w.disk.photos.size).toBe(1); // kept until the teen discards it
    await queue.discard("m1");
    expect(queue.pending).toEqual([]);
    expect(w.disk.photos.size).toBe(0);
  });

  it("never sends a photo that still has location data", async () => {
    const w = world();
    const queue = new UploadQueue(w.deps);
    await queue.add(w.take("m1", RAW));
    await queue.run();
    expect(queue.pending[0]).toMatchObject({ stage: "failed" });
    expect(w.server.uploads).toBe(0);
  });

  it("uploads again if the server can't find the photo", async () => {
    const w = world();
    const queue = new UploadQueue(w.deps);
    await queue.add(w.take("m1"));
    const upload = w.deps.upload;
    let lost = true;
    w.deps.upload = async (path, bytes) => {
      if (lost) {
        lost = false; // the server said yes but didn't keep it
        return;
      }
      return upload(path, bytes);
    };
    await queue.run();
    expect(queue.pending[0]!.stage).toBe("upload");
    await queue.run({ force: true });
    expect(queue.pending).toEqual([]);
    expect(w.server.makes.size).toBe(1);
  });

  it("waits longer between tries, up to 10 minutes", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([15_000, 30_000, 60_000, 120_000]);
    expect(backoffMs(20)).toBe(600_000);
  });
});

describe("reading Supabase errors", () => {
  it("storage", () => {
    expect(classifyStorageError({ statusCode: "409", message: "The resource already exists" })).toBe("exists");
    expect(classifyStorageError({ message: "Network request failed" })).toBe("retry");
    expect(classifyStorageError({ status: 503 })).toBe("retry");
    expect(classifyStorageError({ status: 401, message: "jwt expired" })).toBe("retry");
    expect(classifyStorageError({ status: 403, message: "new row violates row-level security policy" })).toBe("stop");
    expect(classifyStorageError({ status: 413, message: "Payload too large" })).toBe("stop");
  });

  it("record_make", () => {
    expect(classifyRpcError({ code: "23514", message: "that quest isn't open" })).toBe("stop");
    expect(classifyRpcError({ code: "23505", message: "you already made this quest today" })).toBe("stop");
    expect(classifyRpcError({ code: "42501", message: "only teens can save makes" })).toBe("stop");
    expect(classifyRpcError({ code: "P0002", message: "upload the photo first" })).toBe("reupload");
    expect(classifyRpcError({ code: "", message: "TypeError: Network request failed" })).toBe("retry");
    expect(classifyRpcError({ code: "PGRST301", message: "JWT expired" })).toBe("retry");
  });
});
