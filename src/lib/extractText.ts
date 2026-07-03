import { createRequire } from 'node:module';


const req = createRequire(__filename);
const OFFICE: Record<string, string> = { pdf: 'pdf', docx: 'docx', pptx: 'pptx', xlsx: 'xlsx', odt: 'odt', odp: 'odp', ods: 'ods', rtf: 'rtf' };
const MAX = 200_000;
const cap = (t: string) => t.length > MAX ? t.slice(0, MAX) + '\n…[truncated]' : t;
export async function extractText(name: string, _mime: string, buffer: Buffer): Promise<string> {
  const ext = name.split('.').pop()?.toLowerCase() || '', ft = OFFICE[ext];
  if (ft) {
    try { const { OfficeConverter } = req('officeparser'); const { value } = await OfficeConverter.convert(buffer, 'md', { ocr: false, fileType: ft }); return cap(typeof value === 'string' ? value : String(value)); }
    catch (e: any) { return `[failed to parse ${name}: ${e.message}]`; }
  }
  return cap(buffer.toString('utf8'));
}
