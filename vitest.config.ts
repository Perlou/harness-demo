import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist", "runs"],
    testTimeout: 10_000,
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts", "harness/contracts/**/*.ts"],
      exclude: ["src/cli/**", "**/*.test.ts"],
    },
  },
  resolve: {
    alias: {
      "@harness": new URL("./harness", import.meta.url).pathname,
      "@src": new URL("./src", import.meta.url).pathname,
    },
  },
})
