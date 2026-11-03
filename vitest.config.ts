import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  resolve: {
    // Mirror the tsconfig "@/*" → "src/*" path alias so tests import like the app.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // The browser extension ships plain ES modules (no build step); its pure
    // helpers are unit-tested here alongside the app's.
    include: ["src/**/*.test.ts", "extension/**/*.test.ts"],
  },
});
