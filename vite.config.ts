import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: { env: Record<string, string | undefined> };
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => {
  return {
    plugins: [react()],

    build: {
      chunkSizeWarningLimit: 10000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
              return "vendor";
            }
            if (id.includes("node_modules/@radix-ui/")) {
              return "radix";
            }
            if (id.includes("node_modules/react-markdown/") || id.includes("node_modules/remark-gfm/")) {
              return "markdown";
            }
            if (id.includes("node_modules/shiki") || id.includes("node_modules/@shikijs")) {
              return "shiki";
            }
            if (id.includes("node_modules/@xterm/")) {
              return "xterm";
            }
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
  };
});
