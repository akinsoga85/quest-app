import type { Database } from "@quest/contract";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { chunkedStorage } from "./chunkedStorage";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// False until .env is filled in; screens show a setup hint instead of failing.
export const supabaseConfigured = Boolean(url && anonKey);

// Where parent invite links point (the parent consent page, built in A8).
export const PARENT_SITE_URL = process.env.EXPO_PUBLIC_PARENT_SITE_URL || "https://parents.example.com";
// Shown before buying Plus (the stores require both links).
export const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL || `${PARENT_SITE_URL}/terms`;
export const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL || `${PARENT_SITE_URL}/privacy`;

// Typed against the generated schema: a wrong table or column fails to compile.
// Sessions live in the iOS Keychain / Android Keystore via expo-secure-store.
// PKCE keeps browser sign-ins (Google, Apple on Android) safe from interception.
export const supabase = createClient<Database>(url || "http://127.0.0.1:54321", anonKey || "anon-key-not-set", {
  auth: {
    storage: chunkedStorage(SecureStore),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: "pkce",
  },
});
