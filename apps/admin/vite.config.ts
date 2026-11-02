import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The admin site (A11): staff only, on the same Supabase backend.
export default defineConfig({ plugins: [react()] });
