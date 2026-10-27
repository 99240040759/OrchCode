import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const host = env.TAURI_DEV_HOST || process.env.TAURI_DEV_HOST;

  return {
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
            if (!normalized.includes("/node_modules/")) {
              return undefined;
            }

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
            if (pkgName.startsWith("@tiptap")) {
              return "vendor-tiptap";
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
            if (pkgName === "pdfjs-dist") {
              if (normalized.includes("worker")) return undefined;
              return "vendor-pdf";
            }
            if (pkgName === "docx-preview") {
              return "vendor-docx";
            }
            if (pkgName === "pptxviewjs") {
              return "vendor-pptx";
            }
            if (pkgName === "react-markdown" || pkgName === "remark-gfm") {
              return "vendor-markdown";
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
