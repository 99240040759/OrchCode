import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: { env: Record<string, string | undefined> };
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],

  worker: {
    format: "es",
  },

  build: {
    target: "esnext",
    sourcemap: false,
    minify: "esbuild",
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (!normalized.includes("node_modules")) return undefined;
          if (normalized.includes("node_modules/react/") || normalized.includes("node_modules/react-dom/")) {
            return "react";
          }
          if (normalized.includes("node_modules/@radix-ui/")) return "radix";
          if (normalized.includes("node_modules/@xterm/")) return "xterm";
          if (normalized.includes("node_modules/@react-symbols/")) return "symbols";
          if (normalized.includes("node_modules/react-icons/")) return "icons";
          if (normalized.includes("node_modules/prismjs/")) return "prism";
          if (normalized.includes("node_modules/monaco-editor/")) {
            if (normalized.includes("worker")) return undefined;
            return "monaco";
          }
          if (normalized.includes("node_modules/@monaco-editor/")) return "monaco-react";
          return undefined;
        },
      },
    },
  },

  clearScreen: false,
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
      ignored: ["**/src-tauri/**"],
    },
  },
});
