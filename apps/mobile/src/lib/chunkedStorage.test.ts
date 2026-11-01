import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, chunkedStorage, type SecureStoreLike } from "./chunkedStorage";

function memoryStore(): SecureStoreLike & { keys(): string[] } {
  const m = new Map<string, string>();
  return {
    getItemAsync: async (k) => m.get(k) ?? null,
    setItemAsync: async (k, v) => {
      if (v.length > 2048) throw new Error("value too large for secure store");
      m.set(k, v);
    },
    deleteItemAsync: async (k) => {
      m.delete(k);
    },
    keys: () => [...m.keys()],
  };
}

describe("chunkedStorage", () => {
  it("round-trips a value larger than the secure store limit", async () => {
    const store = memoryStore();
    const s = chunkedStorage(store);
    const big = "x".repeat(CHUNK_SIZE * 2 + 17);
    await s.setItem("sb-session", big);
    expect(await s.getItem("sb-session")).toBe(big);
  });

  it("leaves no stale chunks when a value shrinks", async () => {
    const store = memoryStore();
    const s = chunkedStorage(store);
    await s.setItem("k", "y".repeat(CHUNK_SIZE * 3));
    await s.setItem("k", "short");
    expect(await s.getItem("k")).toBe("short");
    expect(store.keys().sort()).toEqual(["k.0", "k.chunks"]);
  });

  it("removes every chunk and returns null when missing", async () => {
    const store = memoryStore();
    const s = chunkedStorage(store);
    await s.setItem("k", "z".repeat(CHUNK_SIZE + 1));
    await s.removeItem("k");
    expect(store.keys()).toEqual([]);
    expect(await s.getItem("k")).toBeNull();
  });
});
