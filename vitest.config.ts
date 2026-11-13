import { defineConfig } from "vitest/config";

// Frontend tests: pure helpers, and components rendered with src/__tests__/helpers/render.tsx
// (the Rust engine has its own `cargo test`). Only *.test.ts(x) files are tests; helpers/ is not.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
