# Reading Files

## Why this skill exists

You run on the user's own machine with full filesystem and shell access. When the user references a file (by path, or as a chat attachment), you must go read it the right way — `read_file` for text/code, and type-specific approaches for binary formats.

Two things to know about attachments:
- Files the user attaches in chat are already extracted to text for you (pdf/docx/pptx/xlsx/odt/rtf via the built-in parser; everything else as UTF-8). You usually already have their content in the conversation.
- Files on disk are read with `read_file` (text) or inspected with `run_command` (binary). `read_file` supports `start_line`/`end_line` for paging large files.

The naive move — dumping a binary file as text — is wrong: a PDF or .docx is binary (a ZIP, for Office formats) and prints garbage, and a 100MB CSV floods your context.

## General protocol

1. **Look at the extension** — that is your dispatch key.
2. **Check size before reading.** `run_command` → `ls -lh <file>` (or `Get-Item <file>` on Windows PowerShell).
3. **Read just enough** to answer the question.
4. **If a dedicated skill exists, load it first** with `read_skill`.

## Dispatch table

| Extension | First move | Dedicated skill |
|-----------|------------|-----------------|
| `.txt` `.md` `.log` code | `read_file` (use start_line/end_line if large) | — |
| `.pdf` | `pdftotext` / pypdf peek | `read_skill('pdf')` |
| `.docx` | `pandoc` or python-docx | `read_skill('docx')` |
| `.xlsx` `.xlsm` | openpyxl read_only / pandas | `read_skill('xlsx')` |
| `.xls` (legacy) | `pandas.read_excel(engine="xlrd")` | `read_skill('xlsx')` |
| `.pptx` | python-pptx / markitdown | `read_skill('pptx')` |
| `.csv` `.tsv` | pandas with `nrows` | — (below) |
| `.json` `.jsonl` | `read_file` head / parse | — (below) |
| images | inspect visually; OCR if needed | — (below) |
| `.zip` `.tar` `.tar.gz` | list contents, don't auto-extract | — (below) |
| `.epub` `.odt` `.rtf` | `pandoc … -t plain` | — (below) |

Tooling note: Python (`pip`), Node (`npm`/`npx`), and CLI tools like `pandoc`, `pdftotext`, `qpdf`, `soffice`/`libreoffice` may or may not be installed. Probe with `run_command` (e.g. `pdftotext -v`) and install what you need before relying on it.

---

## CSV / TSV

Don't read these whole. Sample with pandas:
```python
import pandas as pd
df = pd.read_csv("data.csv", nrows=5)   # sep="\t" for TSV
print(df); print(df.dtypes)
```
Row count without loading: `wc -l data.csv` (or `(Get-Content data.csv).Length` on Windows). Full stats only once you know the shape: `df = pd.read_csv("data.csv"); print(df.describe())`.

## JSON / JSONL

Small files: `read_file` directly. Large/odd ones, parse:
```python
import json
data = json.load(open("data.json"))
print(type(data), len(data) if isinstance(data, list) else list(data)[:10])
```
JSONL is one object per line — read the first line and parse it to learn the shape.

## Images

Attached images are shown to you directly if the model is multimodal. For images on disk, get dimensions and OCR when needed:
```python
from PIL import Image
img = Image.open("photo.jpg"); print(img.size, img.mode)
import pytesseract; print(pytesseract.image_to_string(img))  # needs tesseract installed
```

## Archives

List first, extract only if asked.
```bash
unzip -l bundle.zip        # tar -tf bundle.tar(.gz) for tarballs
unzip -p bundle.zip path/inside/file.txt   # pull one file to stdout
```

## EPUB / ODT / RTF

Convert to plain text with pandoc:
```bash
pandoc book.epub -t plain | head -200
```

## Plain text / code / logs

`read_file` is the tool. For very large files, page with `start_line`/`end_line`, or `run_command` → `grep`/`Select-String` for specifics. For logs the tail usually matters most (`tail -200 app.log`).
