/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly TAURI_DEV_HOST?: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
