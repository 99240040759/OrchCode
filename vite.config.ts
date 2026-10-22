import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
          const idx = normalized.indexOf("node_modules/");
          if (idx === -1) return undefined;
          const pkg = normalized.slice(idx + 13);

          if (pkg.startsWith("react/") || pkg.startsWith("react-dom/")) return "react";
          if (pkg.startsWith("@radix-ui/")) return "radix";
          if (pkg.startsWith("@xterm/")) return "xterm";
          if (pkg.startsWith("@react-symbols/")) return "symbols";
          if (pkg.startsWith("react-icons/")) return "icons";
          if (pkg.startsWith("prismjs/")) return "prism";
          if (pkg.startsWith("monaco-editor/")) {
            if (pkg.includes("worker")) return undefined;
            return "monaco";
          }
          if (pkg.startsWith("@monaco-editor/")) return "monaco-react";
          if (pkg.startsWith("react-pdf/") || pkg.startsWith("pdfjs-dist/")) {
            if (pkg.includes("worker")) return undefined;
            return "pdf";
          }
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
