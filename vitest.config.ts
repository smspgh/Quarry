import { defineConfig } from "vitest/config";

// Frontend unit tests for the pure helpers (the Rust engine has its own `cargo test`).
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
