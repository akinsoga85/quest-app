import { Api, makePath, type ReviewState } from "@quest/contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { NOT_SAVED_YET, pollDelay } from "./logic";

// A make's review (review.forMake), asked again every few seconds while the
// coach works, plus a short-lived link to the photo in private storage.
export function useReview(makeId: string | undefined, teenId: string | undefined) {
  const [state, setState] = useState<ReviewState | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!makeId) return;
    const { data, error: rpcError } = await supabase.rpc("get_review", { p_make_id: makeId });
    if (rpcError) {
      // Not on the server yet: the photo is still uploading from this phone.
      if (rpcError.code === "P0002") return NOT_SAVED_YET;
      setError("Couldn't load your review. Check your connection.");
      return null;
    }
    const parsed = Api["review.forMake"].output.safeParse(data);
    if (!parsed.success) {
      setError("Couldn't read your review. Try again later.");
      return null;
    }
    setError(null);
    return parsed.data;
  }, [makeId]);

  const poll = useCallback(async () => {
    const next = await load();
    if (next) setState(next);
    if (!next || next.state === "pending") {
      const delay = pollDelay(attempt.current++);
      if (delay === null) setStalled(true);
      else timer.current = setTimeout(() => void poll(), delay);
    }
  }, [load]);

  useEffect(() => {
    attempt.current = 0;
    setStalled(false);
    void poll();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  useEffect(() => {
    if (!makeId || !teenId || state?.state !== "ready") return;
    void supabase.storage
      .from("makes")
      .createSignedUrl(makePath(teenId, makeId), 600)
      .then(({ data }) => setPhotoUrl(data?.signedUrl ?? null));
  }, [makeId, teenId, state?.state]);

  const rate = useCallback(
    async (helpful: boolean) => {
      if (state?.state !== "ready") return;
      setState({ ...state, helpful }); // show it straight away
      const { error: rateError } = await supabase.rpc("rate_review", { p_review_id: state.reviewId, p_helpful: helpful });
      if (rateError) setError("Couldn't save that. Try again.");
    },
    [state],
  );

  const retry = useCallback(() => {
    attempt.current = 0;
    setStalled(false);
    void poll();
  }, [poll]);

  return { state, photoUrl, stalled, error, rate, retry };
}
