import { createSignal, onMount, onCleanup, For, Show, createResource } from 'solid-js';
import { watch } from '@tauri-apps/plugin-fs';
import { workspaceListFilesByPath } from '../api';
import { workspacePath } from '../store';
import { VsFolder, VsFolderOpened, VsSymbolFile, VsMarkdown, VsGear, VsLock, VsSymbolNamespace, VsDatabase } from 'solid-icons/vs';
import {
  SiTypescript, SiJavascript, SiRust, SiPython, SiCss, SiHtml5, SiJson,
  SiFlutter, SiDart, SiKotlin, SiSwift, SiGo, SiVuedotjs, SiSvelte,
  SiPhp, SiRuby, SiCplusplus, SiDotnet, SiGraphql,
  SiGnubash, SiLua, SiR, SiDocker, SiPrisma, SiNginx, SiGit,
  SiYaml, SiToml, SiWebassembly, SiSass, SiLess,
} from 'solid-icons/si';
interface TreeNode { name: string; path: string; isDir: boolean; children?: TreeNode[] }
function buildTree(files: string[], root: string): TreeNode[] {
  const map = new Map<string, TreeNode>(); const roots: TreeNode[] = [];
  for (const f of files) {
    const parts = f.split('/'); let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const fp = cur + '/' + parts[i];
      if (!map.has(fp)) {
        const node: TreeNode = { name: parts[i], path: fp, isDir: i < parts.length - 1, children: i < parts.length - 1 ? [] : undefined };
        map.set(fp, node);
        if (i === 0) roots.push(node); else map.get(cur)?.children?.push(node);
      }
      cur = fp;
    }
  }
  function sort(nodes: TreeNode[]): TreeNode[] {
    nodes.sort((a, b) => { if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; return a.name.localeCompare(b.name); });
    nodes.forEach(n => { if (n.children) sort(n.children); }); return nodes;
  }
  return sort(roots);
}
export function fileIcon(name: string, size = 13) {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const lower = name.toLowerCase();
  const s = 13;
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return <SiDocker size={s} color="#2496ed"/>;
  if (lower === '.gitignore' || lower === '.gitattributes') return <SiGit size={s} color="#f05032"/>;
  if (lower === '.env' || lower.startsWith('.env.')) return <VsGear size={s} color="#ecc94b"/>;
  if (lower === 'package.json' || lower === 'package-lock.json') return <SiJson size={s} color="#cb3837"/>;
  if (lower === 'tsconfig.json' || lower.startsWith('tsconfig')) return <SiTypescript size={s} color="#3178c6"/>;
  if (lower === 'cargo.toml' || lower === 'cargo.lock') return <SiRust size={s} color="#ce422b"/>;
  if (lower.includes('lock')) return <VsLock size={s} color="#a0aec0"/>;
  switch (ext) {
    case 'ts': case 'tsx': case 'mts': case 'cts': return <SiTypescript size={s} color="#3178c6"/>;
    case 'js': case 'jsx': case 'mjs': case 'cjs': return <SiJavascript size={s} color="#f7df1e"/>;
    case 'css': return <SiCss size={s} color="#1572b6"/>;
    case 'scss': return <SiSass size={s} color="#cc6699"/>;
    case 'less': return <SiLess size={s} color="#1d365d"/>;
    case 'html': case 'htm': return <SiHtml5 size={s} color="#e34f26"/>;
    case 'vue': return <SiVuedotjs size={s} color="#42b883"/>;
    case 'svelte': return <SiSvelte size={s} color="#ff3e00"/>;
    case 'json': case 'json5': return <SiJson size={s} color="#fbc02d"/>;
    case 'yaml': case 'yml': return <SiYaml size={s} color="#cc1018"/>;
    case 'toml': return <SiToml size={s} color="#9c4221"/>;
    case 'sql': return <VsDatabase size={s} color="#336791"/>;
    case 'graphql': case 'gql': return <SiGraphql size={s} color="#e535ab"/>;
    case 'prisma': return <SiPrisma size={s} color="#2d3748"/>;
    case 'md': case 'mdx': return <VsMarkdown size={s} color="#519aba"/>;
    case 'rs': return <SiRust size={s} color="#ce422b"/>;
    case 'cpp': case 'cc': case 'hpp': case 'h': case 'c': return <SiCplusplus size={s} color="#00599c"/>;
    case 'cs': return <SiDotnet size={s} color="#512bd4"/>;
    case 'kt': case 'kts': return <SiKotlin size={s} color="#7f52ff"/>;
    case 'swift': return <SiSwift size={s} color="#f05138"/>;
    case 'go': return <SiGo size={s} color="#00add8"/>;
    case 'py': case 'pyw': return <SiPython size={s} color="#3776ab"/>;
    case 'rb': return <SiRuby size={s} color="#cc342d"/>;
    case 'php': return <SiPhp size={s} color="#777bb4"/>;
    case 'lua': return <SiLua size={s} color="#000080"/>;
    case 'r': return <SiR size={s} color="#276dc3"/>;
    case 'dart': return <SiDart size={s} color="#0175c2"/>;
    case 'sh': case 'bash': case 'zsh': return <SiGnubash size={s} color="#4eaa25"/>;
    case 'wasm': return <SiWebassembly size={s} color="#654ff0"/>;
    case 'xml': case 'svg': return <VsSymbolNamespace size={s} color="#f97316"/>;
    default: return <VsSymbolFile size={s} color="#9ca3af"/>;
  }
}
function TreeItem(props: { node: TreeNode; depth: number; onSelect?: (path: string) => void }) {
  const [open, setOpen] = createSignal(false);
  return (<div>
    <div class="ft-item" onClick={() => { if (props.node.isDir) setOpen(o => !o); else props.onSelect?.(props.node.path); }}>
      <span class="ft-indent" style={`width:${props.depth * 12}px`}/>
      <span class="ft-icon">{props.node.isDir ? (open() ? <VsFolderOpened size={13} color="#dcb67a"/> : <VsFolder size={13} color="#dcb67a"/>) : fileIcon(props.node.name)}</span>
      <span class="ft-name">{props.node.name}</span>
    </div>
    <Show when={props.node.isDir && open()}><For each={props.node.children ?? []}>{c => <TreeItem node={c} depth={props.depth + 1} onSelect={props.onSelect}/>}</For></Show>
  </div>);
}
export default function FileTree(props: { onSelect?: (path: string) => void }) {
  const [files, { refetch }] = createResource(workspacePath, wp => wp ? workspaceListFilesByPath(wp) : Promise.resolve([]));
  let unwatch: (() => void) | null = null;
  onMount(() => {
    const wp = workspacePath();
    if (!wp) return;
    watch(wp, () => refetch(), { recursive: true }).then(fn => { unwatch = fn; }).catch(() => {});
  });
  onCleanup(() => { unwatch?.(); });
  const root = () => (workspacePath() ?? '').replace(/\\/g, '/');
  const tree = () => buildTree(files() ?? [], root());
  return (
    <div class="file-tree">
      <Show when={files.loading}><div class="ft-loading"><div class="spinner"/></div></Show>
      <Show when={!files.loading && (files() ?? []).length === 0}><div class="ft-empty">No workspace open</div></Show>
      <For each={tree()}>{n => <TreeItem node={n} depth={0} onSelect={props.onSelect}/>}</For>
    </div>
  );
}
