import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/mobile/src/**/*.test.ts", "apps/parent/src/**/*.test.ts", "apps/admin/src/**/*.test.ts"],
  },
});
