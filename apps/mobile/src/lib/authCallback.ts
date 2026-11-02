// Reads the result of a browser sign-in (Google, or Apple on Android) from the
// redirect back into the app: quest://auth/callback?code=... or ?error=...
export type AuthCallback = { kind: "code"; code: string } | { kind: "error"; message: string } | { kind: "none" };

export function parseAuthCallback(url: string): AuthCallback {
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1).split("#")[0] ?? "" : "";
  const fragment = url.includes("#") ? url.slice(url.indexOf("#") + 1) : "";
  const params = new Map<string, string>();
  for (const part of `${query}&${fragment}`.split("&")) {
    if (!part) continue;
    const [k, v = ""] = part.split("=");
    if (k) params.set(decodeURIComponent(k), decodeURIComponent(v.replace(/\+/g, " ")));
  }
  const error = params.get("error_description") ?? params.get("error");
  if (error) return { kind: "error", message: error };
  const code = params.get("code");
  if (code) return { kind: "code", code };
  return { kind: "none" };
}
