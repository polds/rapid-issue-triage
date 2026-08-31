import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      // Scoped like the Go coverage floor (internal/config + internal/store):
      // the pure logic modules carry a real floor rather than diluting one
      // number across React components and the fetch wrapper.
      include: [
        "src/lib/utils.ts",
        "src/lib/colors.ts",
        "src/lib/linear.ts",
        "src/lib/linearfilter.ts",
        "src/lib/enrichmode.ts",
        "src/lib/labelgroups.ts",
        "src/lib/notices.ts",
      ],
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
});
