import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// Short-lived links to photos in the private "makes" bucket, fetched in one
// call per screen and kept until a minute before they run out.
const LIFETIME_S = 600;
const cache = new Map<string, { url: string; until: number }>();

export function usePhotoUrls(paths: readonly string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join("|");

  useEffect(() => {
    let live = true;
    const now = Date.now();
    const known: Record<string, string> = {};
    const missing: string[] = [];
    for (const p of paths) {
      const c = cache.get(p);
      if (c && c.until > now) known[p] = c.url;
      else missing.push(p);
    }
    setUrls(known);
    if (missing.length === 0) return;
    void supabase.storage
      .from("makes")
      .createSignedUrls(missing, LIFETIME_S)
      .then(({ data }) => {
        if (!live || !data) return;
        const fresh: Record<string, string> = {};
        for (const d of data) {
          if (d.path && d.signedUrl) {
            fresh[d.path] = d.signedUrl;
            cache.set(d.path, { url: d.signedUrl, until: Date.now() + (LIFETIME_S - 60) * 1000 });
          }
        }
        setUrls((u) => ({ ...u, ...fresh }));
      });
    return () => {
      live = false;
    };
  }, [key]); // paths change identity every render; key is their content

  return urls;
}
