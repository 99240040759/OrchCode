# DOCX creation, editing, and analysis

A `.docx` is a ZIP archive of XML files. You work on the user's machine with `run_command` (zip/unzip, pandoc, soffice/libreoffice, node), `read_file`/`write_file`, and `edit_file` for surgical XML changes. Probe and install tools as needed (`npm install -g docx`, `pip install python-docx`).

| Task | Approach |
|------|----------|
| Read / analyze | `pandoc file.docx -o out.md` or python-docx |
| Create new | `docx` npm package (below) |
| Edit existing | unzip → edit XML with `edit_file` → rezip (below) |

## Reading

```bash
pandoc --track-changes=all document.docx -o output.md   # text incl. tracked changes
```
```python
from docx import Document
doc = Document("memo.docx")
for p in doc.paragraphs:
    if p.text.strip(): print(p.text)
for t in doc.tables:
    for row in t.rows: print([c.text for c in row.cells])
```
Legacy `.doc`: convert first — `soffice --headless --convert-to docx document.doc`.

---

## Creating new documents (docx npm package)

```javascript
const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
        Header, Footer, AlignmentType, PageOrientation, LevelFormat, ExternalHyperlink,
        InternalHyperlink, Bookmark, FootnoteReferenceRun, TabStopType, TabStopPosition,
        Column, SectionType, TableOfContents, HeadingLevel, BorderStyle, WidthType,
        ShadingType, PageNumber, PageBreak } = require('docx');
const doc = new Document({ sections: [{ children: [/* content */] }] });
Packer.toBuffer(doc).then(b => fs.writeFileSync("doc.docx", b));
```
Run it with `node make-doc.js`.

### Page size — docx defaults to A4; set US Letter explicitly
```javascript
sections: [{
  properties: { page: { size: { width: 12240, height: 15840 },  // 8.5"×11" in DXA (1440 = 1")
    margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
  children: [/* … */]
}]
```
Letter content width with 1" margins = 9360 DXA. **Landscape:** pass portrait dims and set `orientation: PageOrientation.LANDSCAPE` — docx swaps internally.

### Styles — override built-in headings (use exact IDs)
```javascript
styles: {
  default: { document: { run: { font: "Arial", size: 24 } } },     // 12pt
  paragraphStyles: [
    { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
      run: { size: 32, bold: true, font: "Arial" },
      paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 } },  // outlineLevel required for TOC
  ]
}
```

### Lists — never hand-type bullets
```javascript
numbering: { config: [
  { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•",
      alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
]}
// then: new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Item")] })
```
Same `reference` continues numbering; a new `reference` restarts it.

### Tables — set BOTH table and cell widths (DXA, never PERCENTAGE)
```javascript
const b = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [4680, 4680],                       // must sum to table width
  rows: [ new TableRow({ children: [
    new TableCell({ borders: { top: b, bottom: b, left: b, right: b },
      width: { size: 4680, type: WidthType.DXA },
      shading: { fill: "D5E8F0", type: ShadingType.CLEAR },   // CLEAR, never SOLID (SOLID = black)
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun("Cell")] })] }) ] }) ]
})
```

### Images (`type` is required)
```javascript
new Paragraph({ children: [ new ImageRun({ type: "png", data: fs.readFileSync("img.png"),
  transformation: { width: 200, height: 150 },
  altText: { title: "T", description: "D", name: "N" } }) ] })
```

### Page breaks, hyperlinks, footnotes, tab stops
- Break: `new Paragraph({ children: [new PageBreak()] })` or `pageBreakBefore: true`.
- External link: `new ExternalHyperlink({ children: [new TextRun({ text: "x", style: "Hyperlink" })], link: "https://…" })`.
- Internal: `Bookmark` at the target + `InternalHyperlink({ anchor: "id", … })`.
- Footnotes: `footnotes: { 1: { children: [new Paragraph("Source…")] } }` + `new FootnoteReferenceRun(1)`.
- Right-align on a line: `tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }]` with `"\t"` in the run.

### Multi-column / TOC / headers
- Columns: section `properties.column = { count: 2, space: 720, equalWidth: true, separate: true }`.
- TOC: `new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-3" })` — headings must use `HeadingLevel` only.
- Header/footer: section `headers`/`footers` with `Header`/`Footer`; page number via `PageNumber.CURRENT`.

### Critical rules
- Set page size explicitly (Letter = 12240×15840). • Never use `\n` — use separate Paragraphs. • Never hand-type bullets — use `LevelFormat.BULLET`. • `PageBreak` must be inside a Paragraph. • `ImageRun` requires `type`. • Tables: DXA only, `columnWidths` + cell `width` must match and sum. • Use `ShadingType.CLEAR`. • Never use tables as horizontal rules — use a paragraph bottom border. • TOC needs `HeadingLevel` + `outlineLevel`.

---

## Editing existing documents — unzip → edit → rezip

### 1. Unzip
```bash
mkdir -p unpacked && unzip -o document.docx -d unpacked
```
The body is `unpacked/word/document.xml` (plus `header*.xml`, `footer*.xml`, `footnotes.xml`).

### 2. Edit the XML with `edit_file`
Make exact, verbatim replacements in the XML files. **Use smart-quote entities for new text:** `&#x2018;`=' `&#x2019;`=' `&#x201C;`=" `&#x201D;`=". Add `xml:space="preserve"` to any `<w:t>` with leading/trailing spaces. In `<w:pPr>` the element order is `<w:pStyle>`, `<w:numPr>`, `<w:spacing>`, `<w:ind>`, `<w:jc>`, `<w:rPr>` last.

### 3. Rezip
```bash
cd unpacked && zip -r -X ../output.docx '[Content_Types].xml' _rels word docProps && cd ..
```
Then validate by reopening: `pandoc output.docx -o /dev/null` (or `soffice --headless --convert-to pdf output.docx` and inspect).

### Tracked changes (author "Orch Code" unless the user names another)
Insertion:
```xml
<w:ins w:id="1" w:author="Orch Code" w:date="2025-01-01T00:00:00Z"><w:r><w:t>added</w:t></w:r></w:ins>
```
Deletion (use `<w:delText>` not `<w:t>`):
```xml
<w:del w:id="2" w:author="Orch Code" w:date="2025-01-01T00:00:00Z"><w:r><w:delText>removed</w:delText></w:r></w:del>
```
Replace the whole `<w:r>…</w:r>` block; copy the original `<w:rPr>` into the new runs to keep formatting. When deleting an entire paragraph, also mark its paragraph mark: add `<w:del .../>` inside `<w:pPr><w:rPr>` so accepting doesn't leave an empty line.

### Images in raw XML
1. Put the file in `word/media/`. 2. Add a `<Relationship>` in `word/_rels/document.xml.rels`. 3. Add a `<Default Extension="png" ContentType="image/png"/>` in `[Content_Types].xml`. 4. Reference it with a `<w:drawing>`/`<wp:inline>`/`<a:blip r:embed="rIdN"/>` block (EMUs: 914400 = 1 inch).

## Dependencies
pandoc (extract), `docx` npm (create), LibreOffice/`soffice` (PDF + legacy convert), poppler `pdftoppm` (render to image for QA).
