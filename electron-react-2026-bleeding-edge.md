# Electron + React — Bleeding Edge Stack (June 2026)

---

## 1. Versions Right Now

| Runtime | Latest Stable | Key Deps |
|---|---|---|
| Electron | **42.x** (beta) / **41.x** (stable) | Chromium 148, Node.js 24 LTS |
| React | **19.1.x** | React Compiler ships by default |
| Node.js in Electron | **v24 LTS** | Full ESM, native fetch, built-in WebSockets |
| Vite (via electron-vite) | **6.x** | |

---

## 2. Electron — Bleeding Edge Features

### 2a. Architecture Upgrades

**WebContentsView** (replaces deprecated BrowserView since v30)
```js
// OLD — deprecated, remove it
const view = new BrowserView()

// NEW — Views API, Chromium-native
const view = new WebContentsView({ webPreferences: { ... } })
win.contentView.addChildView(view)
view.setBounds({ x: 0, y: 0, width: 800, height: 600 })
```

**BaseWindow + WebContentsView composition** — build multi-panel layouts without spawning extra BrowserWindows. Each panel is an independent WebContentsView with its own renderer. Huge for agent/dashboard UIs.

**UtilityProcess** — the missed gem. Offload CPU tasks, untrusted code, crash-prone work to a sandboxed Node.js process. Not a worker thread, not child_process — it has a built-in MessagePort channel back to main.
```js
// main process
const { utilityProcess } = require('electron')
const child = utilityProcess.fork('./heavy-task.js')
child.postMessage({ op: 'crunch', data: payload })
child.on('message', result => console.log(result))
```

**MessagePorts for zero-serialization IPC** — bypass the JSON-serialization tax. Transferable objects move without copy.
```js
// main process — direct renderer-to-renderer IPC channel
const { port1, port2 } = new MessageChannelMain()
win1.webContents.postMessage('port', null, [port1])
win2.webContents.postMessage('port', null, [port2])
// renderers now talk directly — main process not in the loop
```

### 2b. Visual / Native (Electron 36–42 additions, most devs miss these)

**`-electron-corner-smoothing`** (Electron 37+) — native squircle corners matching macOS design language. Applied as raw CSS in the renderer.
```css
.card {
  border-radius: 16px;
  -electron-corner-smoothing: system-ui; /* 60% on macOS, 0 elsewhere */
}
/* or manual control */
-electron-corner-smoothing: 80%;
```

**Window Controls Overlay** — true frameless window with native traffic-light/close buttons on Win11 + macOS. App looks native, not Electron.
```js
new BrowserWindow({
  titleBarStyle: 'hidden',
  titleBarOverlay: {
    color: '#1a1a1a',
    symbolColor: '#ffffff',
    height: 40
  }
})
```

**`nativeTheme.shouldUseDarkColorsForSystemIntegratedUI`** (v35+) — separate flag for OS-integrated UI vs. app theme. Finally lets you match title bars to system while keeping your own dark theme.

**`before-mouse-event`** (v36+) — intercept and cancel mouse events on webContents before they reach the renderer. Useful for drag regions, touch-bar-style custom inputs.



**`win.isContentProtected()`** (v36+) — query content protection state at runtime (previously write-only).

**System accent color support** (v37.1+) — `customizing system accent color` and active window border highlight. Match your chrome to the user's Windows accent.

**240 FPS cap removed for Offscreen Rendering** (v36+) — full-speed GPU capture for OSR-based video pipelines.

**`desktopCapturer.getSources` performance fix** (v36+) — no longer blocks when `thumbnails: false`. Always pass it when you only need window IDs.

### 2c. Security Defaults (non-negotiable in 2026)

```js
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,       // default true since v12
    nodeIntegration: false,       // default false
    sandbox: true,                // enable for untrusted content
    webSecurity: true,
    allowRunningInsecureContent: false,
  }
})
```

Preload script is the only bridge. Expose a typed API surface via `contextBridge`:
```js
contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('dialog:open'),
  onUpdate: (cb) => ipcRenderer.on('update', (_, v) => cb(v))
})
```

### 2d. Build Tooling

**electron-vite** — replaced webpack as the community default in mid-2025. HMR in the renderer, TypeScript first-class, 3–5× faster builds.
```
npm create @quick-start/electron@latest
```

**electron-builder** — still the packager standard. Use `--config` to point at a JS file for programmatic config. ASAR integrity on Windows (v36+) is on by default.

---

## 3. React 19 — Every Feature Worth Using in a Desktop App

### 3a. React Compiler (biggest change)

Auto-memoizes components and hooks at compile time. In most components, **delete `useMemo`, `useCallback`, and `React.memo`** — the compiler handles it.

```bash
npm install -D babel-plugin-react-compiler
# or with Vite:
npm install -D vite-plugin-react-compiler
```

Still write `useMemo` for: genuinely expensive pure computations that the compiler can't prove are stable (rare).

### 3b. New Hooks

**`use()`** — consume promises or context anywhere, including inside conditionals and loops. The signal that Suspense is now a first-class pattern.
```jsx
import { use, Suspense } from 'react'

function Profile({ promise }) {
  const user = use(promise)   // suspends here if pending
  return <h1>{user.name}</h1>
}

// wrap in Suspense
<Suspense fallback={<Skeleton />}>
  <Profile promise={fetchUser(id)} />
</Suspense>
```

**`useActionState(action, initialState)`** — replaces the `useState + loading + error` trio for any async operation.
```jsx
const [state, dispatch, isPending] = useActionState(
  async (prev, formData) => {
    const result = await saveSettings(formData)
    return result
  },
  null
)
```

**`useFormStatus()`** — reads submission state from the nearest parent form. Eliminates prop drilling for submit buttons.
```jsx
import { useFormStatus } from 'react-dom'
function SaveButton() {
  const { pending } = useFormStatus()
  return <button disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>


### 3c. Document Metadata (native, no react-helmet)
```jsx
function Page() {
  return (
    <>
      <title>My App — Settings</title>
      <meta name="description" content="Configure your workspace" />
      <link rel="stylesheet" href="/theme.css" precedence="default" />
    </>
  )
}
```

### 3d. Ref as a Prop (no more forwardRef)
```jsx
// React 19 — ref is just a prop
function Input({ ref, ...props }) {
  return <input ref={ref} {...props} />
}
```

### 3e. Error Boundary improvements
`onCaughtError` / `onUncaughtError` callbacks on `<ErrorBoundary>` — finally first-class without class components.

---

## 4. Raw CSS — 2026 Production-Ready Techniques

### 4a. Cascade Layers — the architecture backbone
```css
@layer reset, base, tokens, components, utilities;

@layer tokens {
  :root {
    --color-surface: oklch(98% 0 0);
    --color-text: oklch(15% 0 0);
    --radius-card: 14px;
  }
}

@layer components {
  .card { border-radius: var(--radius-card); }
}
```
No more specificity wars. Utilities always win. Library styles stay in their own layer.

### 4b. Native Nesting (no preprocessor needed)
```css
.panel {
  padding: 1rem;
  background: var(--color-surface);

  & .title {
    font-size: 1.125rem;
    font-weight: 500;
  }

  &:hover {
    background: var(--color-surface-hover);
  }

  @media (prefers-color-scheme: dark) {
    background: oklch(12% 0 0);
  }
}
```

### 4c. Container Queries — component-aware responsive
```css
.sidebar { container-type: inline-size; container-name: sidebar; }

@container sidebar (min-width: 280px) {
  .nav-item { flex-direction: row; }
}

/* style queries — respond to CSS variable values */
@container style(--density: compact) {
  .row { padding: 4px 8px; }
}
```

### 4d. `:has()` — the parent selector
```css
/* highlight card when its input is focused */
.field-group:has(input:focus) {
  border-color: var(--color-accent);
}

/* sidebar layout when nav has items */
.layout:has(.nav-item) {
  grid-template-columns: 240px 1fr;
}

/* empty state */
.list:not(:has(li)) .empty-hint { display: block; }
```

### 4e. `@property` — typed, animatable CSS variables
```css
@property --progress {
  syntax: '<number>';
  inherits: false;
  initial-value: 0;
}

.progress-ring {
  transition: --progress 0.4s ease;
}

/* oklch angles animate smoothly with @property */
@property --hue {
  syntax: '<angle>';
  inherits: true;
  initial-value: 220deg;
}
```

### 4f. `@starting-style` — enter animations, zero JS
```css
.toast {
  transition: opacity 0.2s, transform 0.2s;
  opacity: 1;
  transform: translateY(0);
}

@starting-style {
  .toast {
    opacity: 0;
    transform: translateY(8px);
  }
}
```

### 4g. Scroll-driven animations — replaces 45KB scroll libraries
```css
@keyframes fade-in {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

.section {
  animation: fade-in linear both;
  animation-timeline: view();
  animation-range: entry 0% entry 30%;
}

/* progress bar tied to scroll */
.scroll-indicator {
  animation: grow-x linear;
  animation-timeline: scroll(root block);
}
```

### 4h. View Transitions — page-to-page animation, native
```css
::view-transition-old(root) { animation: slide-out 0.2s ease; }
::view-transition-new(root) { animation: slide-in 0.2s ease; }

/* name specific elements for shared-element transitions */
.hero-image { view-transition-name: hero; }
```
```js
document.startViewTransition(() => {
  setRoute(next)
})
```

### 4i. OKLCH color — perceptually uniform, great for design tokens
```css
:root {
  --accent: oklch(65% 0.2 250);           /* base */
  --accent-light: oklch(85% 0.12 250);    /* hover tint */
  --accent-dark: oklch(45% 0.25 250);     /* pressed */
}

/* mix colors natively */
.muted-accent { color: color-mix(in oklch, var(--accent) 40%, white); }
```

### 4j. CSS Anchor Positioning — tooltip/popover without JS coords
```css
.trigger { anchor-name: --btn; }

.tooltip {
  position: absolute;
  position-anchor: --btn;
  top: anchor(bottom);
  left: anchor(center);
  translate: -50% 8px;

  @position-try --fallback-top {
    top: auto;
    bottom: anchor(top);
    translate: -50% -8px;
  }
}
```

### 4k. `text-wrap: balance` and `pretty`
```css
h1, h2, h3 { text-wrap: balance; }   /* even line lengths in headings */
p           { text-wrap: pretty; }   /* no orphaned last word */
```

### 4l. Logical properties (RTL-ready by default)
```css
.card {
  padding-block: 1rem;       /* top + bottom */
  padding-inline: 1.25rem;   /* left + right (flips in RTL) */
  margin-inline-start: auto; /* replaces margin-left: auto */
  border-inline-start: 2px solid var(--accent);
}
```

---

## 5. Packages — No Tailwind, Maximum Performance

### 5a. Build

| Package | Purpose | Notes |
|---|---|---|
| `electron-vite` | Build tool | HMR, TS first-class, replaces CRA/webpack |
| `vite-plugin-react-compiler` | Enable React Compiler | Set `target: 'es2022'` |
| `electron-builder` | Packager + auto-updater | NSIS, DMG, AppImage |
| `@electron/notarize` | macOS notarization | Required for Gatekeeper |


| Package | Purpose | Notes |
|---|---|---|
| `jotai` | Atomic state | Bottom-up, great for editor state |
| `@tanstack/query` | Server/async state | Still essential even in Electron |

### 5e. Data & Tables

| Package | Purpose | Notes |
|---|---|---|
| `@tanstack/react-table` | Headless table | Virtual + sort + filter built-in |
| `@tanstack/react-virtual` | Virtual scrolling | Rows, grids, dynamic height |
| `react-virtuoso` | Virtual list | Easiest API, handles reverse scroll |

### 5f. Forms

| Package | Purpose | Notes |
|---|---|---|
| `react-hook-form` | Form state | Zero re-renders on input |
| `zod` | Schema validation | Pair with `@hookform/resolvers/zod` |




| Package | Purpose | Notes |
|---|---|---|
| `recharts` | Chart library | React-native, SVG |
| `d3` | Low-level dataviz | Full control, pair with React for rendering |
| `uplot` | Ultra-fast line charts | Canvas, <50KB, handles 1M+ points |

---

## 6. Niche Native Features Everyone Misses

### IPC via MessagePort (renderer ↔ renderer, no main hop)
Most apps route everything through main. You don't have to. Create a MessageChannelMain, hand each port to its renderer, and they communicate directly at full speed.

### UtilityProcess for AI / heavy compute
Don't block main. Don't crash renderer. Spawn a UtilityProcess for Ollama sidecar management, SQLite heavy queries, or file parsing. It gets a full Node.js environment and a MessagePort.

### `protocol.handle` — custom scheme for assets
Replace `file://` path hacks with a clean custom scheme. Works with `fetch()`, `<img>`, and CSS `url()` natively.
```js
protocol.handle('app', (request) => {
  const url = new URL(request.url)
  return net.fetch('file://' + path.join(__dirname, url.pathname))
})
```

### `net.fetch` in main process
The main process now has a `net.fetch` that routes through Chromium's network stack (respects proxies, cookies, certs). Don't use Node's `https` for anything that should behave like a browser request.

### SharedArrayBuffer + Atomics in renderer
Enabled by default in Electron (unlike browsers that require COOP/COEP headers). Use for zero-copy data sharing between renderer and worker threads — audio buffers, canvas pixel data, WASM memory.

### WebGPU for compute (not just rendering)
Production-ready in Electron 32+. Run ML inference, image processing, or shader-based data transforms in the renderer without a sidecar.
```js
const adapter = await navigator.gpu.requestAdapter()
const device = await adapter.requestDevice()
// compute pipeline here
```

### `app.commandLine.appendSwitch` for GPU tuning
```js
// enable high-performance GPU on hybrid laptops
app.commandLine.appendSwitch('force_high_performance_gpu')
// disable GPU process sandbox for debugging only
app.commandLine.appendSwitch('disable-gpu-sandbox')
```

### `powerMonitor` for background throttling
```js
const { powerMonitor } = require('electron')
powerMonitor.on('on-battery', () => throttleBackgroundWork())
powerMonitor.on('on-ac', () => resumeNormalWork())
powerMonitor.on('lock-screen', () => pauseAllPolling())
```

### `nativeTheme` reactive theming
```js
nativeTheme.on('updated', () => {
  win.webContents.send('theme-changed', {
    dark: nativeTheme.shouldUseDarkColors,
    systemUI: nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
  })
})
```

### `session.setSpellCheckerDictionaryDownloadURL` + custom dictionaries
Build product-specific vocabulary into spellcheck — missed by almost everyone building document editors.

### `webContents.setWindowOpenHandler` — control `window.open`
```js
win.webContents.setWindowOpenHandler(({ url }) => {
  if (url.startsWith('https://internal.app')) return { action: 'allow' }
  shell.openExternal(url)
  return { action: 'deny' }
})
```

### `desktopCapturer` without thumbnails — fast window list
```js
// without this flag it captures every window at full res
const sources = await desktopCapturer.getSources({
  types: ['window', 'screen'],
  thumbnailSize: { width: 0, height: 0 }  // skip thumbnail GPU work
})
```
