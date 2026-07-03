import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs';
import path from 'node:path';

const STRIP: Record<string, string[]> = {
  'node-pty': ['src', 'deps', 'prebuilds', 'third_party', 'node-addon-api', 'scripts', 'binding.gyp'],
  'better-sqlite3': ['src', 'deps', 'prebuilds', 'node-addon-api', 'binding.gyp'],
};

const config: ForgeConfig = {
  packagerConfig: {
    asar: { unpack: '{**/*.node,**/*.wasm,**/node-pty/build/Release/spawn-helper,**/node-pty/build/Release/winpty*,**/ripgrep-*/bin/rg,**/ripgrep-*/bin/rg.exe}' },
    icon: './logo',
  },
  hooks: {
    packageAfterCopy: async (_config, buildPath, _electronVersion, platform, arch) => {
      const nmRoot = path.join(process.cwd(), 'node_modules');
      const copied = new Set<string>();
      const inject = (mod: string) => {
        if (copied.has(mod)) return;
        const src = path.join(nmRoot, mod);
        if (!fs.existsSync(src)) return;
        copied.add(mod);
        const dest = path.join(buildPath, 'node_modules', mod);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(src, dest, { recursive: true });
        for (const entry of (STRIP[mod] ?? [])) {
          const p = path.join(dest, entry);
          if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
        }
        
        try { const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')); for (const dep of Object.keys(pkg.dependencies ?? {})) inject(dep); } catch {  }
        console.log(`[forge] Injected ${mod}`);
      };
      for (const mod of ['node-pty', 'better-sqlite3', 'bindings', 'file-uri-to-path', 'web-tree-sitter', 'tree-sitter-wasms', 'officeparser']) inject(mod);
      // Inject the JS resolver and only the binary package matching the target platform+arch.
      // e.g. darwin/x64 → @vscode/ripgrep-darwin-x64 (not arm64, not win32-x64)
      inject('@vscode/ripgrep');
      inject(`@vscode/ripgrep-${platform}-${arch}`);
    },
  },
  makers: [
    new MakerSquirrel({ name: 'OrchCode', authors: 'Sameer', description: 'AI-powered coding assistant', setupIcon: './logo.ico' }),
    new MakerDMG({ overwrite: true }, ['darwin']),
    new MakerZIP({}, ['linux']),
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
      [FuseV1Options.EnableCookieEncryption]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
export default config;
