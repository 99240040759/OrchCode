# PDF Processing Guide

You run on the user's machine. Use `run_command` for CLI tools and Python/Node scripts, `read_file`/`write_file` for files. Probe for a tool before using it (e.g. `pdftotext -v`, `python -c "import pypdf"`) and install what's missing (`pip install pypdf pdfplumber reportlab`, or system tools via the platform package manager). Never dump a PDF as text directly — it's binary.

## Quick peek (is the text extractable?)

```bash
pdftotext -f 1 -l 1 input.pdf - | head -20   # poppler; prints first page text
```
```python
from pypdf import PdfReader
r = PdfReader("input.pdf")
print(len(r.pages), "pages")
print(r.pages[0].extract_text()[:2000])
```
If `pdftotext` yields little/no text, it's likely scanned → use OCR (below).

## Extract text & tables (pdfplumber)

```python
import pdfplumber
with pdfplumber.open("doc.pdf") as pdf:
    for page in pdf.pages:
        print(page.extract_text())
        for table in page.extract_tables():
            for row in table: print(row)
```
Export tables to Excel:
```python
import pandas as pd, pdfplumber
frames = []
with pdfplumber.open("doc.pdf") as pdf:
    for page in pdf.pages:
        for t in page.extract_tables():
            if t: frames.append(pd.DataFrame(t[1:], columns=t[0]))
if frames: pd.concat(frames, ignore_index=True).to_excel("tables.xlsx", index=False)
```

## Merge / split / rotate (pypdf)

```python
from pypdf import PdfReader, PdfWriter
w = PdfWriter()
for f in ["a.pdf", "b.pdf"]:
    for p in PdfReader(f).pages: w.add_page(p)
with open("merged.pdf", "wb") as out: w.write(out)
```
Split one page per file: iterate `PdfReader(...).pages`, add each to its own `PdfWriter`. Rotate: `page.rotate(90)` before adding.

## Create PDFs (reportlab)

```python
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet
doc = SimpleDocTemplate("report.pdf", pagesize=letter); s = getSampleStyleSheet()
story = [Paragraph("Title", s['Title']), Spacer(1, 12), Paragraph("Body "*40, s['Normal']), PageBreak()]
doc.build(story)
```
**Never use Unicode sub/superscript characters** (₂, ²) in reportlab — the built-in fonts lack the glyphs and render black boxes. Use markup in Paragraphs: `H<sub>2</sub>O`, `x<super>2</super>`.

## OCR scanned PDFs

```python
from pdf2image import convert_from_path   # needs poppler
import pytesseract                         # needs tesseract
text = "".join(pytesseract.image_to_string(img) for img in convert_from_path("scanned.pdf"))
print(text)
```

## Watermark / encrypt (pypdf)

- Watermark: `page.merge_page(PdfReader("watermark.pdf").pages[0])` for each page, then write.
- Password: `writer.encrypt("userpw", "ownerpw")` before writing.

## Command-line tools

```bash
pdftotext -layout input.pdf out.txt          # preserve layout
pdftotext -f 1 -l 5 input.pdf out.txt         # pages 1–5
qpdf --empty --pages a.pdf b.pdf -- merged.pdf
qpdf input.pdf --pages . 1-5 -- first5.pdf
qpdf --password=PW --decrypt enc.pdf dec.pdf
pdfimages -j input.pdf prefix                 # extract images
```

## Quick reference

| Task | Best tool |
|------|-----------|
| Extract text / tables | pdfplumber |
| Merge / split / rotate / encrypt | pypdf or qpdf |
| Create | reportlab |
| OCR scanned | pdf2image + pytesseract |
| Extract images | pdfimages |
