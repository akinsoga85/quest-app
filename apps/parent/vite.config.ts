import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The parent page (A8): a small web app on the same Supabase backend.
export default defineConfig({ plugins: [react()] });
