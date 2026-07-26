import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

declare const process: { env: Record<string, string | undefined> };
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // Allows @import "~monaco-editor/..." in CSS to resolve correctly in production
      "~monaco-editor": path.resolve(__dirname, "node_modules/monaco-editor"),
    },
  },


  worker: {
    format: "es",
  },

  build: {
    target: "esnext",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
            return "react";
          }
          if (id.includes("node_modules/@radix-ui/")) return "radix";
          if (id.includes("node_modules/react-markdown/") || id.includes("node_modules/remark-")) {
            return "markdown";
          }
          if (id.includes("node_modules/@xterm/")) return "xterm";
          if (id.includes("node_modules/@shikijs/langs/")) return undefined;
          if (id.includes("node_modules/shiki") || id.includes("node_modules/@shikijs/")) {
            return "shiki";
          }
          if (id.includes("node_modules/monaco-editor/")) {
            if (id.includes("worker")) return undefined;
            return "monaco";
          }
          if (id.includes("node_modules/@monaco-editor/")) return "monaco-react";
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
