import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { zodFunction } from 'openai/helpers/zod';
import { execa } from 'execa';
import { rgPath } from '@vscode/ripgrep';
import { computeDiff } from './diff';
import { applyEdits } from './astEdit';
import { secureResolve } from '../lib/securePath';
const SKILLS_DIR = path.join(__dirname, 'skills');

const ReadFileParams = z.object({
  path: z.string().describe('File path relative to workspace or absolute'),
  start_line: z.coerce.number().nullable().optional().describe('1-indexed start line (inclusive)'),
  end_line: z.coerce.number().nullable().optional().describe('1-indexed end line (inclusive)'),
});
const WriteFileParams = z.object({
  path: z.string().describe('File path relative to workspace or absolute'),
  content: z.string().describe('Full file content to write'),
});
const EditFileParams = z.object({
  path: z.string().describe('File path relative to workspace or absolute'),
  replacements: z.array(z.object({
    target: z.string().describe('Exact, verbatim text to replace (must match the file character-for-character, including indentation). Must be unique — include surrounding lines if needed so it appears exactly once.'),
    replacement: z.string().describe('Text to replace the target with'),
  })).describe('List of {target, replacement} pairs'),
});
const ListDirParams = z.object({
  path: z.string().describe('Directory path relative to workspace or absolute'),
});
const RunCommandParams = z.object({
  command: z.string().describe('Shell command to execute'),
  cwd: z.string().nullable().optional().describe('Working directory (defaults to workspace root)'),
});
const SearchWebParams = z.object({
  query: z.string().describe('Search query'),
});
const ReadSkillParams = z.object({
  name: z.string().describe('Skill name: pdf, docx, xlsx, pptx, or file-reading'),
});
const GenerateImageParams = z.object({
  prompt: z.string().describe('Text description of the image to generate'),
  width: z.coerce.number().nullable().optional().describe('Image width (512-1568, snapped to 16px grid). Default 1024'),
  height: z.coerce.number().nullable().optional().describe('Image height (512-1568, snapped to 16px grid). Default 1024'),
});
const SearchWorkspaceParams = z.object({
  query: z.string().describe('Search pattern (regex supported)'),
  path: z.string().nullable().optional().describe('Subdirectory to scope search (relative to workspace)'),
  include: z.string().nullable().optional().describe('Glob pattern to filter files, e.g. "*.ts"'),
  case_sensitive: z.boolean().nullable().optional().describe('Case sensitive search. Default false'),
});

let _toolDefs: any[] | null = null;
export function buildToolDefs() {
  return _toolDefs ??= [
    zodFunction({ name: 'read_file', parameters: ReadFileParams, description: 'Read a file. Returns content. Use start_line/end_line for large files.' }),
    zodFunction({ name: 'write_file', parameters: WriteFileParams, description: 'Create or overwrite a file. Creates parent directories automatically.' }),
    zodFunction({ name: 'edit_file', parameters: EditFileParams, description: 'Edit a file by replacing exact, verbatim text. Each target must match the file character-for-character and appear exactly once — include surrounding lines to make it unique. A tree-sitter check flags edits that break syntax. Use write_file for new files or large rewrites.' }),
    zodFunction({ name: 'list_dir', parameters: ListDirParams, description: 'List directory contents. Returns name, type, and size for each entry.' }),
    zodFunction({ name: 'run_command', parameters: RunCommandParams, description: 'Run a shell command. 30s timeout, 5MB max output.' }),
    zodFunction({ name: 'search_web', parameters: SearchWebParams, description: 'Search the web. Returns top results with titles, URLs, and snippets.' }),
    zodFunction({ name: 'read_skill', parameters: ReadSkillParams, description: 'Read a skill guide for specialized tasks.' }),
    zodFunction({ name: 'generate_image', parameters: GenerateImageParams, description: 'Generate an image from a text prompt using FLUX. Returns a confirmation message on success; the image is displayed in the UI automatically.' }),
    zodFunction({ name: 'search_workspace', parameters: SearchWorkspaceParams, description: 'Search workspace files using ripgrep. Returns matching lines with file paths and line numbers.' }),
  ];
}

const PARAM_SCHEMAS: Record<string, z.ZodType> = {
  read_file: ReadFileParams, write_file: WriteFileParams, edit_file: EditFileParams,
  list_dir: ListDirParams, run_command: RunCommandParams, search_web: SearchWebParams,
  read_skill: ReadSkillParams, generate_image: GenerateImageParams, search_workspace: SearchWorkspaceParams,
};
export function parseToolArgs(name: string, rawArgs: string): Record<string, any> {
  const schema = PARAM_SCHEMAS[name];
  if (!schema) throw new Error(`Unknown tool: ${name}`);
  return schema.parse(JSON.parse(rawArgs)) as Record<string, any>;
}
// ── Execution ────────────────────────────────────────────────────────────────
const MAX_BUFFER = 5 * 1024 * 1024;
type GcpConfig = { gcpBase: string; jwt: string; anonKey: string };
export async function executeTool(name: string, rawArgs: string | Record<string, any>, workspacePath: string | null, sessionDir: string | null, gcpConfig?: GcpConfig, signal?: AbortSignal): Promise<{ result: string; meta: Record<string, any> }> {
  const args = typeof rawArgs === 'string' ? parseToolArgs(name, rawArgs) : rawArgs;
  const cwd = workspacePath || process.cwd();
  // Home mode: unrestricted. Workspace mode: sandbox to the workspace root AND the session dir (for plans/notes).
  const resolvePath = (p: string) => {
    if (!workspacePath) return path.isAbsolute(p) ? p : path.join(cwd, p);
    for (const root of [workspacePath, sessionDir].filter(Boolean) as string[]) { try { return secureResolve(root, p); } catch { /* try next root */ } }
    throw new Error('Access Denied: path escapes the workspace and session directory');
  };
  switch (name) {
    case 'read_file': {
      const { path: fp, start_line, end_line } = args as z.infer<typeof ReadFileParams>;
      const resolved = resolvePath(fp);
      const raw = readFileSync(resolved, 'utf8');
      const lines = raw.split('\n'), total = lines.length;
      const sl = start_line ?? 1, el = end_line ?? total;
      return { result: lines.slice(sl - 1, el).join('\n'), meta: { startLine: sl, endLine: Math.min(el, total), totalLines: total, path: fp } };
    }
    case 'write_file': {
      const { path: fp, content } = args as z.infer<typeof WriteFileParams>;
      const resolved = resolvePath(fp);
      mkdirSync(path.dirname(resolved), { recursive: true });
      let existed: string | null = null;
      try { existed = readFileSync(resolved, 'utf8'); } catch { /* new file */ }
      writeFileSync(resolved, content, 'utf8');
      const diff = computeDiff(existed || '', content);
      // Model gets a concise confirmation; full original/modified live in meta for the UI diff viewer only.
      return { result: `${existed ? 'Overwrote' : 'Created'} ${fp} (+${diff.added}/-${diff.removed}, ${content.split('\n').length} lines).`, meta: { path: fp, original: existed || '', modified: content, diffAdded: diff.added, diffRemoved: diff.removed, isNew: !existed } };
    }
    case 'edit_file': {
      const { path: fp, replacements } = args as z.infer<typeof EditFileParams>;
      const resolved = resolvePath(fp);
      const original = readFileSync(resolved, 'utf8');
      const { content, warnings } = await applyEdits(resolved, original, replacements);
      writeFileSync(resolved, content, 'utf8');
      const diff = computeDiff(original, content);
      const warnNote = warnings.length ? ` Warning: ${warnings.join(' ')}` : '';
      // Model gets a concise confirmation; full original/modified live in meta for the UI diff viewer only.
      return { result: `Edited ${fp} (+${diff.added}/-${diff.removed}, ${replacements.length} replacement${replacements.length === 1 ? '' : 's'}).${warnNote}`, meta: { path: fp, original, modified: content, diffAdded: diff.added, diffRemoved: diff.removed, warnings: warnings.length ? warnings : undefined } };
    }
    case 'list_dir': {
      const { path: fp } = args as z.infer<typeof ListDirParams>;
      const resolved = resolvePath(fp);
      const entries = readdirSync(resolved, { withFileTypes: true });
      const list = entries.map(e => ({ name: e.name, isDir: e.isDirectory(), size: e.isFile() ? statSync(path.join(resolved, e.name)).size : undefined }));
      return { result: JSON.stringify(list), meta: { path: fp, count: list.length } };
    }
    case 'run_command': {
      const { command, cwd: cmdCwd } = args as z.infer<typeof RunCommandParams>;
      const shell = process.platform === 'win32' ? 'powershell.exe' : true;
      const result = await execa(command, { shell, cwd: cmdCwd ? resolvePath(cmdCwd) : cwd, timeout: 30_000, maxBuffer: MAX_BUFFER, cancelSignal: signal, reject: false });
      const out = [result.stdout, result.stderr].filter(Boolean).join('\n');
      const note = result.timedOut ? '\n[timed out after 30s]' : '';
      return { result: (out || '(no output)') + note, meta: { command, exitCode: result.exitCode, timedOut: result.timedOut || undefined } };
    }
    case 'search_web': {
      const { query } = args as z.infer<typeof SearchWebParams>;
      if (!gcpConfig) throw new Error('gcpConfig required for search_web');
      const res = await fetch(`${gcpConfig.gcpBase}/tavily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': gcpConfig.anonKey, 'Authorization': `Bearer ${gcpConfig.jwt}` },
        body: JSON.stringify({ query, maxResults: 5 }),
        signal,
      });
      if (!res.ok) throw new Error(`Web search failed: ${res.status} ${await res.text()}`);
      const data = await res.json() as any;
      const parts: string[] = [];
      if (data.answer) parts.push(`Answer: ${data.answer}`);
      if (data.results?.length) for (const r of data.results) parts.push(`[${r.title}](${r.url})\n${r.content?.slice(0, 300) || ''}`);
      return { result: parts.join('\n\n') || 'No results found', meta: { query, resultCount: data.results?.length || 0 } };
    }
    case 'read_skill': {
      const { name: skillName } = args as z.infer<typeof ReadSkillParams>;
      const skillPath = path.join(SKILLS_DIR, `${skillName}.md`);
      if (!existsSync(skillPath)) throw new Error(`Skill not found: ${skillName}. Available: pdf, docx, xlsx, pptx, file-reading`);
      return { result: readFileSync(skillPath, 'utf8'), meta: { skill: skillName } };
    }
    case 'generate_image': {
      const { prompt, width, height } = args as z.infer<typeof GenerateImageParams>;
      if (!gcpConfig) throw new Error('gcpConfig required for generate_image');
      // Clamp to the documented 512–1568 range and snap to the 16px grid the model expects.
      const snap = (v: number | null | undefined, def: number) => Math.max(512, Math.min(1568, Math.round((v || def) / 16) * 16));
      const w = snap(width, 1024), h = snap(height, 1024);
      const res = await fetch(`${gcpConfig.gcpBase}/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': gcpConfig.anonKey, 'Authorization': `Bearer ${gcpConfig.jwt}` },
        body: JSON.stringify({ prompt, width: w, height: h }),
        signal,
      });
      if (!res.ok) throw new Error(`Image generation failed: ${res.status} ${await res.text()}`);
      const data = await res.json() as any;
      // NVIDIA FLUX returns {artifacts: [{base64: "...", ...}]}
      const b64 = data.artifacts?.[0]?.base64 || data.data?.[0]?.b64_json || '';
      if (!b64) throw new Error('No image data in response');
      const dataUrl = `data:image/png;base64,${b64}`;
      // Agent-generated artifacts live in the session directory, never the user's workspace.
      let savedPath: string | null = null;
      if (sessionDir) {
        const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image';
        const dir = path.join(sessionDir, 'images');
        mkdirSync(dir, { recursive: true });
        savedPath = path.join(dir, `${slug}-${Date.now().toString(36)}.png`);
        writeFileSync(savedPath, Buffer.from(b64, 'base64'));
      }
      return { result: `Image generated (${w}x${h}px)${savedPath ? `, saved to ${savedPath}` : ''}. Prompt: "${prompt}".`, meta: { dataUrl, prompt, width: w, height: h, path: savedPath || undefined } };
    }
    case 'search_workspace': {
      const { query, path: subPath, include, case_sensitive } = args as z.infer<typeof SearchWorkspaceParams>;
      const searchDir = subPath ? resolvePath(subPath) : cwd;
      const rgArgs = ['--json', '--max-count', '50', '--max-filesize', '1M'];
      if (!case_sensitive) rgArgs.push('-i');
      if (include) rgArgs.push('-g', include);
      rgArgs.push('--', query, searchDir);
      const result = await execa(rgPath, rgArgs, { timeout: 15_000, maxBuffer: MAX_BUFFER, reject: false, cancelSignal: signal });
      const lines = (result.stdout || '').split('\n').filter(Boolean);
      const matches: Array<{ file: string; line: number; text: string }> = [];
      for (const line of lines) {
        try {
          const j = JSON.parse(line);
          if (j.type === 'match') {
            const rel = path.relative(cwd, j.data.path.text);
            matches.push({ file: rel, line: j.data.line_number, text: j.data.lines.text.trim() });
          }
        } catch {}
      }
      return { result: JSON.stringify(matches), meta: { query, matchCount: matches.length, searchDir: subPath || '.' } };
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
