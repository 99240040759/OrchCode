# PPTX creation, editing, and analysis

A `.pptx` is a ZIP of XML. You work on the user's machine: `run_command` (node, python, zip/unzip, soffice/libreoffice, pdftoppm), `read_file`/`write_file`, `edit_file`. Install as needed (`npm install -g pptxgenjs`, `pip install python-pptx "markitdown[pptx]"`).

| Task | Approach |
|------|----------|
| Read / analyze | `python -m markitdown deck.pptx` or python-pptx |
| Create from scratch | pptxgenjs (below) |
| Edit existing | unzip → edit XML with `edit_file` → rezip (below) |

## Reading

```bash
python -m markitdown deck.pptx        # text extraction
```
```python
from pptx import Presentation
prs = Presentation("deck.pptx")
for i, slide in enumerate(prs.slides, 1):
    print(f"## Slide {i}")
    for sh in slide.shapes:
        if sh.has_text_frame:
            for p in sh.text_frame.paragraphs:
                if p.text.strip(): print(p.text)
```

## Creating from scratch (pptxgenjs)

```javascript
const pptxgen = require("pptxgenjs");
const p = new pptxgen();
p.defineLayout({ name: "W", width: 13.333, height: 7.5 });  // 16:9
p.layout = "W";
const slide = p.addSlide();
slide.background = { color: "1E2761" };
slide.addText("Title", { x: 0.6, y: 0.5, w: 12, h: 1, fontSize: 40, bold: true, color: "FFFFFF", fontFace: "Georgia" });
slide.addText("Body", { x: 0.6, y: 2, w: 6, h: 4, fontSize: 16, color: "CADCFC", align: "left" });
p.writeFile({ fileName: "out.pptx" });
```
Run with `node make-deck.js`.

## Editing existing — unzip → edit → rezip

```bash
mkdir -p unpacked && unzip -o deck.pptx -d unpacked     # slides in unpacked/ppt/slides/slideN.xml
# edit slide XML with edit_file, then:
cd unpacked && zip -r -X ../out.pptx '[Content_Types].xml' _rels ppt docProps && cd ..
```

## Design — don't make boring slides

Every slide needs a visual element (image, chart, icon, or shape); plain title+bullets is forgettable.

- **Pick a bold, content-informed palette.** One color dominates (60–70%), 1–2 supporting tones, one sharp accent. Don't default to blue.
- **Dark/light sandwich:** dark title + conclusion slides, light content — or commit to dark throughout.
- **Commit to one motif** (rounded image frames, icons in colored circles, a thick single-side border) and repeat it.

Sample palettes (Primary / Secondary / Accent): Midnight Executive `1E2761`/`CADCFC`/`FFFFFF` · Forest & Moss `2C5F2D`/`97BC62`/`F5F5F5` · Coral Energy `F96167`/`F9E795`/`2F3C7E` · Warm Terracotta `B85042`/`E7E8D1`/`A7BEAE` · Charcoal Minimal `36454F`/`F2F2F2`/`212121` · Teal Trust `028090`/`00A896`/`02C39A` · Berry & Cream `6D2E46`/`A26769`/`ECE2D0`.

Layouts: two-column (text + visual), icon+text rows, 2×2/2×3 grids, half-bleed image with overlay. Data: large stat callouts (60–72pt numbers), before/after comparison columns, numbered timelines.

Typography: pair a header font with personality (Georgia, Cambria, Trebuchet MS, Palatino) with a clean body font (Calibri, Arial). Sizes: title 36–44pt bold, section header 20–24pt bold, body 14–16pt, captions 10–12pt. Margins ≥0.5"; 0.3–0.5" between blocks; leave breathing room.

Avoid: repeating one layout; centered body text (center titles only); weak size contrast; defaulting to blue; styling one slide and leaving the rest plain; text-only slides; low-contrast text/icons. **Never put an accent line under a title** — it's a hallmark of AI slides; use whitespace instead.

## QA (required)

Assume there are problems and hunt for them. The first render is rarely right.

**Content QA** — extract text and check for missing content, typos, wrong order, and leftover placeholders:
```bash
python -m markitdown out.pptx
python -m markitdown out.pptx | grep -iE "xxxx|lorem|ipsum|placeholder"
```
Fix anything grep finds before declaring done.

**Visual QA** — render to images so the result can be inspected (by you if the model is vision-capable, otherwise present them to the user):
```bash
soffice --headless --convert-to pdf out.pptx
pdftoppm -jpeg -r 150 out.pdf slide        # → slide-01.jpg, slide-02.jpg, …
```
Look for: overlapping elements, text overflow/cut-off, decorative lines sized for one-line titles that wrapped, footers colliding with content, gaps <0.3" or uneven, margins <0.5" from edges, misaligned columns, low-contrast text/icons, over-wrapped narrow text boxes, leftover placeholders. Then: list issues → fix → re-render affected slides → repeat until a full pass is clean. Don't declare success until at least one fix-and-verify cycle.

## Dependencies
`pip install "markitdown[pptx]" python-pptx Pillow` · `npm install -g pptxgenjs` · LibreOffice/`soffice` (PDF) · poppler `pdftoppm` (images).
