import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  build: {
    rolldownOptions: {
      onLog(level, log, handler) {
        // web-tree-sitter (pulled in by prettier-plugin-java for the built-in Java formatter) calls
        // eval() only for grammar modules that export `__start_em_asm` / `__em_js__` symbols. The
        // Java grammar it ships doesn't, so those lines never run, and the app's CSP (no
        // 'unsafe-eval') would block them anyway: formatting would fail with a CSP error rather than
        // run unchecked code. Checked 2026-10-27; re-check after updating prettier-plugin-java.
        if (log.code === "EVAL" && `${log.id ?? ""} ${log.message}`.includes("web-tree-sitter")) return;
        handler(level, log);
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
