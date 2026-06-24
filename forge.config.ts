import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs';
import path from 'node:path';

const NATIVE_MODULES = ['node-pty', 'better-sqlite3', '@vscode/ripgrep'];

const config: ForgeConfig = {
  packagerConfig: {
    asar: { unpack: '**/*.node' },
  },
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      for (const mod of NATIVE_MODULES) {
        const src = path.join(process.cwd(), 'node_modules', mod);
        if (!fs.existsSync(src)) continue;
        const dest = path.join(buildPath, 'node_modules', mod);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(src, dest, { recursive: true });
        console.log(`[forge] Injected ${mod}`);
      }
    },
  },
  makers: [
    new MakerSquirrel({ name: 'OrchCode', authors: 'Sameer', description: 'AI-powered coding assistant' }),
    new MakerDMG({ overwrite: true }, ['darwin']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
        { entry: 'src/agent/worker.ts', config: 'vite.main.config.ts', target: 'main' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
export default config;
