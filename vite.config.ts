import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const host = env.TAURI_DEV_HOST || process.env.TAURI_DEV_HOST;

  return {
    plugins: [react()],

    optimizeDeps: {
      include: ["monaco-editor"],
    },

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
            if (!normalized.includes("/node_modules/")) {
              return undefined;
            }

            // Extract the canonical package name even in pnpm or nested structures
            const nmIndex = normalized.lastIndexOf("/node_modules/");
            const pathAfter = normalized.slice(nmIndex + "/node_modules/".length);
            const segments = pathAfter.split("/");
            const pkgName = segments[0].startsWith("@") && segments.length > 1
              ? `${segments[0]}/${segments[1]}`
              : segments[0];

            if (pkgName === "react" || pkgName === "react-dom") {
              return "vendor-react";
            }
            if (pkgName.startsWith("@radix-ui")) {
              return "vendor-radix";
            }
            if (pkgName.startsWith("@xterm")) {
              return "vendor-xterm";
            }
            if (pkgName === "@react-symbols/icons" || pkgName === "react-icons") {
              return "vendor-icons";
            }
            if (pkgName === "prismjs") {
              return "vendor-prism";
            }
            // Keep monaco-editor and @monaco-editor/react together to prevent circular dependency cycles
            if (pkgName === "monaco-editor" || pkgName === "@monaco-editor/react") {
              if (normalized.includes("worker")) return undefined;
              return "vendor-monaco";
            }
            if (pkgName === "pdfjs-dist") {
              if (normalized.includes("worker")) return undefined;
              return "vendor-pdf";
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
  };
});
