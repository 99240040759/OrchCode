import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { zodFunction } from 'openai/helpers/zod';
import { execa } from 'execa';
import { rgPath } from '@vscode/ripgrep';
import { computeDiff } from './diff';
const SKILLS_DIR = path.join(__dirname, '..', 'src', 'agent', 'skills');
const SKILLS_DIR_ALT = path.join(__dirname, 'skills');
// ── Zod schemas for tool parameters ──────────────────────────────────────────
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
    target: z.string().describe('Exact string to find (must match verbatim)'),
    replacement: z.string().describe('String to replace it with'),
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
// ── Tool definitions via OpenAI SDK's zodFunction ────────────────────────────
export function buildToolDefs() {
  return [
    zodFunction({ name: 'read_file', parameters: ReadFileParams, description: 'Read a file. Returns content. Use start_line/end_line for large files.' }),
    zodFunction({ name: 'write_file', parameters: WriteFileParams, description: 'Create or overwrite a file. Creates parent directories automatically.' }),
    zodFunction({ name: 'edit_file', parameters: EditFileParams, description: 'Edit a file by replacing exact text matches. Each replacement replaces ALL occurrences.' }),
    zodFunction({ name: 'list_dir', parameters: ListDirParams, description: 'List directory contents. Returns name, type, and size for each entry.' }),
    zodFunction({ name: 'run_command', parameters: RunCommandParams, description: 'Run a shell command. 30s timeout, 5MB max output.' }),
    zodFunction({ name: 'search_web', parameters: SearchWebParams, description: 'Search the web. Returns top results with titles, URLs, and snippets.' }),
    zodFunction({ name: 'read_skill', parameters: ReadSkillParams, description: 'Read a skill guide for specialized tasks.' }),
    zodFunction({ name: 'generate_image', parameters: GenerateImageParams, description: 'Generate an image from a text prompt using FLUX. Returns a confirmation message on success; the image is displayed in the UI automatically.' }),
    zodFunction({ name: 'search_workspace', parameters: SearchWorkspaceParams, description: 'Search workspace files using ripgrep. Returns matching lines with file paths and line numbers.' }),
  ];
}
// ── Schema map for runtime arg parsing ───────────────────────────────────────
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
const CMD_TIMEOUT = 30_000;
type GcpConfig = { gcpBase: string; jwt: string; anonKey: string };
export async function executeTool(name: string, args: Record<string, any>, workspacePath: string | null, gcpConfig?: GcpConfig): Promise<{ result: string; meta: Record<string, any> }> {
  const cwd = workspacePath || process.cwd();
  const resolvePath = (p: string) => { const fp = path.isAbsolute(p) ? p : path.join(cwd, p); if (workspacePath && path.relative(workspacePath, fp).startsWith('..')) throw new Error('Access Denied'); return fp; };
  switch (name) {
    case 'read_file': {
      const { path: fp, start_line, end_line } = ReadFileParams.parse(args);
      const resolved = resolvePath(fp);
      const raw = readFileSync(resolved, 'utf8');
      const lines = raw.split('\n'), total = lines.length;
      const sl = start_line ?? 1, el = end_line ?? total;
      return { result: lines.slice(sl - 1, el).join('\n'), meta: { startLine: sl, endLine: Math.min(el, total), totalLines: total, path: fp } };
    }
    case 'write_file': {
      const { path: fp, content } = WriteFileParams.parse(args);
      const resolved = resolvePath(fp);
      mkdirSync(path.dirname(resolved), { recursive: true });
      let existed: string | null = null;
      try { existed = readFileSync(resolved, 'utf8'); } catch {}
      writeFileSync(resolved, content, 'utf8');
      const diff = computeDiff(existed || '', content);
      return { result: JSON.stringify({ original: existed || '', modified: content }), meta: { path: fp, diffAdded: diff.added, diffRemoved: diff.removed, isNew: !existed } };
    }
    case 'edit_file': {
      const { path: fp, replacements } = EditFileParams.parse(args);
      const resolved = resolvePath(fp);
      const original = readFileSync(resolved, 'utf8');
      let content = original;
      for (const r of replacements) {
        if (!content.includes(r.target)) throw new Error(`Target string not found in file: "${r.target.slice(0, 80)}..."`);
        content = content.replaceAll(r.target, r.replacement);
      }
      writeFileSync(resolved, content, 'utf8');
      const diff = computeDiff(original, content);
      return { result: JSON.stringify({ original, modified: content }), meta: { path: fp, diffAdded: diff.added, diffRemoved: diff.removed } };
    }
    case 'list_dir': {
      const { path: fp } = ListDirParams.parse(args);
      const resolved = resolvePath(fp);
      const entries = readdirSync(resolved, { withFileTypes: true });
      const list = entries.map(e => ({ name: e.name, isDir: e.isDirectory(), size: e.isFile() ? statSync(path.join(resolved, e.name)).size : undefined }));
      return { result: JSON.stringify(list), meta: { path: fp, count: list.length } };
    }
    case 'run_command': {
      const { command, cwd: cmdCwd } = RunCommandParams.parse(args);
      const result = await execa(command, { shell: true, cwd: cmdCwd ? resolvePath(cmdCwd) : cwd, timeout: CMD_TIMEOUT, maxBuffer: MAX_BUFFER });
      const out = [result.stdout, result.stderr].filter(Boolean).join('\n');
      return { result: out || '(no output)', meta: { command, exitCode: result.exitCode } };
    }
    case 'search_web': {
      const { query } = SearchWebParams.parse(args);
      if (!gcpConfig) throw new Error('gcpConfig required for search_web');
      const res = await fetch(`${gcpConfig.gcpBase}/tavily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': gcpConfig.anonKey, 'Authorization': `Bearer ${gcpConfig.jwt}` },
        body: JSON.stringify({ query, maxResults: 5 }),
      });
      if (!res.ok) throw new Error(`Web search failed: ${res.status} ${await res.text()}`);
      const data = await res.json() as any;
      const parts: string[] = [];
      if (data.answer) parts.push(`Answer: ${data.answer}`);
      if (data.results?.length) for (const r of data.results) parts.push(`[${r.title}](${r.url})\n${r.content?.slice(0, 300) || ''}`);
      return { result: parts.join('\n\n') || 'No results found', meta: { query, resultCount: data.results?.length || 0 } };
    }
    case 'read_skill': {
      const { name: skillName } = ReadSkillParams.parse(args);
      let skillPath = path.join(SKILLS_DIR, `${skillName}.md`);
      if (!existsSync(skillPath)) skillPath = path.join(SKILLS_DIR_ALT, `${skillName}.md`);
      if (!existsSync(skillPath)) throw new Error(`Skill not found: ${skillName}. Available: pdf, docx, xlsx, pptx, file-reading`);
      return { result: readFileSync(skillPath, 'utf8'), meta: { skill: skillName } };
    }
    case 'generate_image': {
      const { prompt, width, height } = GenerateImageParams.parse(args);
      if (!gcpConfig) throw new Error('gcpConfig required for generate_image');
      const res = await fetch(`${gcpConfig.gcpBase}/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': gcpConfig.anonKey, 'Authorization': `Bearer ${gcpConfig.jwt}` },
        body: JSON.stringify({ prompt, width: width || 1024, height: height || 1024 }),
      });
      if (!res.ok) throw new Error(`Image generation failed: ${res.status} ${await res.text()}`);
      const data = await res.json() as any;
      // NVIDIA FLUX returns {artifacts: [{base64: "...", ...}]}
      const b64 = data.artifacts?.[0]?.base64 || data.data?.[0]?.b64_json || '';
      if (!b64) throw new Error('No image data in response');
      const dataUrl = `data:image/png;base64,${b64}`;
      return { result: `Image generated successfully. Prompt: "${prompt}". Dimensions: ${width || 1024}x${height || 1024}px.`, meta: { dataUrl, prompt, width: width || 1024, height: height || 1024 } };
    }
    case 'search_workspace': {
      const { query, path: subPath, include, case_sensitive } = SearchWorkspaceParams.parse(args);
      const searchDir = subPath ? resolvePath(subPath) : cwd;
      const rgArgs = ['--json', '--max-count', '50', '--max-filesize', '1M'];
      if (!case_sensitive) rgArgs.push('-i');
      if (include) rgArgs.push('-g', include);
      rgArgs.push('--', query, searchDir);
      const result = await execa(rgPath, rgArgs, { timeout: 15_000, maxBuffer: MAX_BUFFER, reject: false });
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
