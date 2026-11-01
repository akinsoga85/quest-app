// expo-secure-store refuses values over about 2 KB on some devices, and a
// Supabase session can be bigger. This splits values across several keys.
export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export const CHUNK_SIZE = 1800;

export function chunkedStorage(store: SecureStoreLike) {
  const countKey = (key: string) => `${key}.chunks`;
  const chunkKey = (key: string, i: number) => `${key}.${i}`;

  async function removeItem(key: string): Promise<void> {
    const n = Number((await store.getItemAsync(countKey(key))) ?? 0);
    for (let i = 0; i < n; i++) await store.deleteItemAsync(chunkKey(key, i));
    await store.deleteItemAsync(countKey(key));
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const raw = await store.getItemAsync(countKey(key));
      if (raw === null) return null;
      const parts: string[] = [];
      for (let i = 0; i < Number(raw); i++) {
        const part = await store.getItemAsync(chunkKey(key, i));
        if (part === null) return null; // half-written value: treat as signed out
        parts.push(part);
      }
      return parts.join("");
    },
    async setItem(key: string, value: string): Promise<void> {
      await removeItem(key);
      const n = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
      for (let i = 0; i < n; i++) await store.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
      await store.setItemAsync(countKey(key), String(n));
    },
    removeItem,
  };
}
