import type { ZoneId } from "@quest/contract";
import * as Crypto from "expo-crypto";
import { addNetworkStateListener } from "expo-network";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAccount } from "../lib/account";
import { supabase } from "../lib/supabase";
import { useToday } from "../today/TodayProvider";
import { StepError, UploadQueue, classifyRpcError, classifyStorageError, type PendingMake, type QueueDeps } from "./queue";
import { deletePhoto, loadQueue, readPhoto, saveQueue, writePhoto } from "./store";

interface UploadValue {
  pending: PendingMake[];
  // Keep a prepared photo for a quest and start saving it. Returns the make id.
  save: (photo: Uint8Array, quest: { id: string; zone: ZoneId }) => Promise<string>;
  discard: (makeId: string) => Promise<void>;
  retry: () => void;
}

const UploadContext = createContext<UploadValue | null>(null);

const deps: QueueDeps = {
  load: loadQueue,
  save: saveQueue,
  readPhoto,
  deletePhoto,
  upload: async (path, bytes) => {
    let result;
    try {
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      result = await supabase.storage.from("makes").upload(path, body, { contentType: "image/jpeg", upsert: false });
    } catch (e) {
      throw new StepError("retry", e instanceof Error ? e.message : "Network request failed");
    }
    if (result.error) {
      const err = result.error as { message: string; status?: number; statusCode?: string };
      throw new StepError(classifyStorageError(err), "Couldn't upload this photo.");
    }
  },
  record: async (item) => {
    let result;
    try {
      result = await supabase.rpc("record_make", { p_make_id: item.makeId, p_quest_id: item.questId, p_captured_at: item.capturedAt });
    } catch (e) {
      throw new StepError("retry", e instanceof Error ? e.message : "Network request failed");
    }
    if (result.error) throw new StepError(classifyRpcError(result.error), friendly(result.error.message));
  },
  now: () => Date.now(),
};

// The server's reasons, in the app's voice.
function friendly(message: string): string {
  if (/already made/i.test(message)) return "You already made this quest today.";
  if (/too old/i.test(message)) return "This photo was taken too long ago to save for a quest.";
  if (/isn't open/i.test(message)) return "That quest has closed, so this photo can't be saved for it.";
  return "Couldn't save this photo.";
}

// Saves chosen photos in the background and keeps trying until they're saved:
// straight away, when the connection comes back, when the app is opened, and
// on a growing timer in between.
export function UploadProvider({ children }: { children: React.ReactNode }) {
  const { teen } = useAccount();
  const { refresh } = useToday();
  const queue = useMemo(() => new UploadQueue(deps), []);
  const [pending, setPending] = useState<PendingMake[]>([]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(
    () =>
      queue.subscribe((items, event) => {
        setPending([...items]);
        if (event?.done) void refreshRef.current();
      }),
    [queue],
  );

  const teenId = teen?.id ?? null;
  useEffect(() => {
    if (!teenId) return;
    void queue.run({ force: true });
    const net = addNetworkStateListener((s) => {
      if (s.isConnected && s.isInternetReachable !== false) void queue.run({ force: true });
    });
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") void queue.run({ force: true });
    });
    const timer = setInterval(() => {
      if (queue.pending.length > 0) void queue.run();
    }, 15_000);
    return () => {
      net.remove();
      app.remove();
      clearInterval(timer);
    };
  }, [queue, teenId]);

  const save = useCallback(
    async (photo: Uint8Array, quest: { id: string; zone: ZoneId }) => {
      if (!teenId) throw new Error("Sign in first.");
      const makeId = Crypto.randomUUID();
      await writePhoto(makeId, photo);
      await queue.add({ makeId, teenId, questId: quest.id, zone: quest.zone, capturedAt: new Date().toISOString() });
      void queue.run({ force: true });
      return makeId;
    },
    [queue, teenId],
  );

  const discard = useCallback((makeId: string) => queue.discard(makeId), [queue]);
  const retry = useCallback(() => void queue.run({ force: true, retryFailed: true }), [queue]);

  const value = useMemo(() => ({ pending, save, discard, retry }), [pending, save, discard, retry]);
  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUploads(): UploadValue {
  const v = useContext(UploadContext);
  if (!v) throw new Error("useUploads must be used inside UploadProvider");
  return v;
}
