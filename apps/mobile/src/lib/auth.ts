import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { parseAuthCallback } from "./authCallback";
import { supabase } from "./supabase";

WebBrowser.maybeCompleteAuthSession();

// Add this to the Supabase project's allowed redirect URLs.
export const AUTH_REDIRECT = Linking.createURL("auth/callback");

// iOS: Apple's own sheet. No name or email is requested: the app doesn't need them.
// The nonce ties the Apple token to this sign-in so it can't be replayed.
export async function signInWithAppleNative(): Promise<boolean> {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({ requestedScopes: [], nonce: hashedNonce });
  } catch (e) {
    if ((e as { code?: string }).code === "ERR_REQUEST_CANCELED") return false;
    throw e;
  }
  if (!credential.identityToken) throw new Error("Apple didn't return a sign-in token.");
  const { error } = await supabase.auth.signInWithIdToken({ provider: "apple", token: credential.identityToken, nonce: rawNonce });
  if (error) throw error;
  return true;
}

// Google on both platforms, and Apple on Android: the provider's page in a
// secure browser sheet, returning a one-time code. Returns false if cancelled.
export async function signInWithBrowser(provider: "google" | "apple"): Promise<boolean> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, AUTH_REDIRECT);
  if (result.type !== "success") return false;
  const callback = parseAuthCallback(result.url);
  if (callback.kind === "error") throw new Error(callback.message);
  if (callback.kind !== "code") throw new Error("Sign-in didn't finish. Please try again.");
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(callback.code);
  if (exchangeError) throw exchangeError;
  return true;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
