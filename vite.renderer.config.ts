import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';
export default defineConfig({
  plugins: [
    react({ babel: { presets: [reactCompilerPreset()] } } as any),
    tailwindcss(),
    (monacoEditorPlugin as any)({}),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
