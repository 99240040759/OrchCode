---
name: file-reading
description: "Use this skill when a file has been uploaded and you need to read or inspect its contents inside the E2B sandbox. This skill is a router: it tells you which tool/approach to use for each file type (pdf, docx, xlsx, pptx, csv, json, images, archives, ebooks) so you read the right amount the right way. Trigger when the user asks about an uploaded file or when upload_attachment_to_sandbox has placed a file in the sandbox and you need to read it."
license: Proprietary. LICENSE.txt has complete terms
---

# Reading Files in the E2B Sandbox

## Why this skill exists

When the user uploads a file, it is placed into the E2B sandbox (typically at `/home/user/<filename>`). You must go read it — it is not automatically in your context.

The naive approach — `cat /home/user/whatever` — is wrong for most files:

- On a PDF it prints binary garbage.
- On a 100MB CSV it floods your context with rows you will never use.
- On a DOCX it prints the raw ZIP bytes.

This skill tells you the right first move for each type.

## General protocol

1. **Look at the extension.** That is your dispatch key.
2. **Check size before reading.** Large files need sampling, not slurping.
   ```bash
   ls -lh /home/user/report.pdf
   ```
3. **Read just enough to answer the user's question.**
4. **If a dedicated skill exists, read it first.** The table below tells you when.

## Dispatch table

| Extension | First move | Dedicated skill |
|-----------|------------|----------------|
| `.pdf` | Content inventory (see PDF section) | `read_skill_guide` with `pdf-reading` |
| `.docx` | python-docx extract | `read_skill_guide` with `docx` |
| `.doc` (legacy) | Convert to .docx first via soffice | `read_skill_guide` with `docx` |
| `.xlsx` | openpyxl read_only | `read_skill_guide` with `xlsx` |
| `.xlsm` | openpyxl read_only (same structure) | `read_skill_guide` with `xlsx` |
| `.xls` (legacy) | `pd.read_excel(engine="xlrd")` | `read_skill_guide` with `xlsx` |
| `.pptx` | python-pptx extract | `read_skill_guide` with `pptx` |
| `.ppt` (legacy) | Convert to .pptx first via soffice | `read_skill_guide` with `pptx` |
| `.csv`, `.tsv` | pandas with `nrows` | — (below) |
| `.json`, `.jsonl` | head/Python parse | — (below) |
| `.jpg`, `.png`, `.gif`, `.webp` | PIL for dimensions; analyze visually | — (below) |
| `.zip`, `.tar`, `.tar.gz` | List contents, do **not** auto-extract | — (below) |
| `.gz` (single file) | `zcat \| head` | — (below) |
| `.epub`, `.odt` | pandoc to plain text | — (below) |
| `.rtf` | pandoc to plain text | — (below) |
| `.txt`, `.md`, `.log`, code files | size check then head/cat | — (below) |
| Unknown | Python `imghdr` or read magic bytes | — |

---

## PDF

**Never** `cat` a PDF — it prints binary garbage.

Quick first move — get page count and check if text is extractable:

```bash
pdfinfo /home/user/report.pdf
pdftotext -f 1 -l 1 /home/user/report.pdf - | head -20
```

Then peek at the text content:

```python
import subprocess
subprocess.check_call(["pip", "install", "pypdf", "-q"])
from pypdf import PdfReader
r = PdfReader("/home/user/report.pdf")
print(f"{len(r.pages)} pages")
print(r.pages[0].extract_text()[:2000])
```

For anything beyond a quick peek — figures, tables, attachments, forms, scanned PDFs, visual inspection — call `read_skill_guide` with format `pdf-reading`.

---

## DOCX / DOC

```python
import subprocess
subprocess.check_call(["pip", "install", "python-docx", "-q"])
from docx import Document
doc = Document("/home/user/memo.docx")
for p in doc.paragraphs:
    if p.text.strip():
        print(p.text)
for table in doc.tables:
    for row in table.rows:
        print([cell.text for cell in row.cells])
```

Legacy `.doc` (not `.docx`) must be converted first:
```bash
soffice --headless --convert-to docx /home/user/document.doc --outdir /home/user/
```

For editing, creating, tracked changes, or images — call `read_skill_guide` with format `docx`.

---

## XLSX / XLS / Spreadsheets

```python
import subprocess
subprocess.check_call(["pip", "install", "openpyxl", "-q"])
from openpyxl import load_workbook
wb = load_workbook("/home/user/data.xlsx", read_only=True)
print("Sheets:", wb.sheetnames)
ws = wb.active
for row in ws.iter_rows(max_row=5, values_only=True):
    print(row)
```

`read_only=True` is important — without it, openpyxl loads the entire workbook into memory.

**Legacy `.xls`** — openpyxl raises `InvalidFileException`. Use:
```python
import pandas as pd
df = pd.read_excel("/home/user/old.xls", engine="xlrd", nrows=5)
print(df)
```

For formulas, formatting, charts, editing, or creating — call `read_skill_guide` with format `xlsx`.

---

## PPTX

```python
import subprocess
subprocess.check_call(["pip", "install", "python-pptx", "-q"])
from pptx import Presentation
prs = Presentation("/home/user/deck.pptx")
for i, slide in enumerate(prs.slides, 1):
    print(f"\n## Slide {i}")
    for shape in slide.shapes:
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                if para.text.strip():
                    print(para.text)
```

For creating, editing, or anything beyond reading — call `read_skill_guide` with format `pptx`.

---

## CSV / TSV

**Do not** `cat` these blindly. Use pandas with `nrows`:

```python
import pandas as pd
df = pd.read_csv("/home/user/data.csv", nrows=5)
print(df)
print()
print(df.dtypes)
```

Approximate row count without loading:
```bash
wc -l /home/user/data.csv
```

Full analysis only after you know the shape:
```python
df = pd.read_csv("/home/user/data.csv")
print(df.describe())
```

TSV: same, with `sep="\t"`.

---

## JSON / JSONL

```python
import json

# Regular JSON
with open("/home/user/data.json") as f:
    data = json.load(f)
print(type(data))
if isinstance(data, list):
    print(f"Array of {len(data)} items")
    print(data[:2])
elif isinstance(data, dict):
    print("Keys:", list(data.keys())[:10])
```

JSONL (one object per line):
```python
with open("/home/user/data.jsonl") as f:
    lines = f.readlines()
print(f"{len(lines)} records")
print(json.loads(lines[0]))  # First record
```

---

## Images (JPG / PNG / GIF / WEBP)

```python
import subprocess
subprocess.check_call(["pip", "install", "Pillow", "-q"])
from PIL import Image
img = Image.open("/home/user/photo.jpg")
print(img.size, img.mode, img.format)
```

For OCR on an image:
```python
subprocess.check_call(["pip", "install", "pytesseract", "-q"])
import pytesseract
print(pytesseract.image_to_string(img))
```

---

## Archives (ZIP / TAR / TAR.GZ)

**List first. Extract only if the user explicitly asks.**

```bash
unzip -l /home/user/bundle.zip
tar -tf /home/user/bundle.tar
```

GNU tar auto-detects compression — `-tf` works on `.tar`, `.tar.gz`, `.tar.bz2`, `.tar.xz`.

If the user wants one file from inside:
```bash
unzip -p /home/user/bundle.zip path/inside/file.txt
```

**Standalone `.gz`** (not a tar):
```bash
zcat /home/user/data.json.gz | head -50
```

---

## EPUB / ODT

```bash
# Convert to plain text for reading
pandoc /home/user/book.epub -t plain | head -200
pandoc /home/user/doc.odt -t plain | head -200
```

---

## RTF

```bash
pandoc /home/user/notes.rtf -t plain | head -200
```

---

## Plain text / code / logs

Check the size first:
```bash
wc -c /home/user/app.log
```

- **Under ~20KB**: `cat` is fine.
- **Over ~20KB**: `head -100` and `tail -100` to orient, then `grep` for specifics.

For log files, the user almost always cares about the end:
```bash
tail -200 /home/user/app.log
```

---

## Unknown extension

```python
with open("/home/user/mystery.bin", "rb") as f:
    magic = f.read(16)
print(magic.hex())
# %PDF = PDF, PK = ZIP/DOCX/XLSX/PPTX, \xD0\xCF = old Office format
```
