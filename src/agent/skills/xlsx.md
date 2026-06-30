# XLSX creation, editing, and analysis

You work on the user's machine: `run_command` for Python/CLI, `read_file`/`write_file` for files. Install as needed (`pip install openpyxl pandas`). The deliverable must be a spreadsheet file.

## Output requirements

- **Professional font** (Arial / Times New Roman) unless the user/template says otherwise.
- **Zero formula errors** — every model ships with no `#REF!`, `#DIV/0!`, `#VALUE!`, `#N/A`, `#NAME?`.
- **Preserve existing templates** — match their format/conventions exactly; their conventions override these defaults.

## Financial model standards (unless template/user differs)

Color coding: **blue** (RGB 0,0,255) hardcoded inputs; **black** formulas/calculations; **green** (0,128,0) links to other sheets in the same workbook; **red** (255,0,0) links to other files; **yellow fill** (255,255,0) key assumptions.

Number formats: years as text ("2024"); currency `$#,##0` with units in headers ("Revenue ($mm)"); zeros shown as "-" (`$#,##0;($#,##0);-`); percentages `0.0%`; valuation multiples `0.0x`; negatives in parentheses.

Formulas: put every assumption (growth, margin, multiple) in its own cell and reference it — `=B5*(1+$B$6)`, never `=B5*1.05`. Document hardcodes in an adjacent cell/comment: "Source: [System], [Date], [Reference], [URL]".

## Reading / analyzing

```python
import pandas as pd
df = pd.read_excel("file.xlsx")                       # first sheet
sheets = pd.read_excel("file.xlsx", sheet_name=None)  # dict of all sheets
print(df.head()); print(df.info()); print(df.describe())
```
For formulas/formatting use openpyxl with `read_only=True` (avoids loading the whole workbook):
```python
from openpyxl import load_workbook
wb = load_workbook("data.xlsx", read_only=True)
print(wb.sheetnames)
for row in wb.active.iter_rows(max_row=5, values_only=True): print(row)
```
Legacy `.xls`: `pd.read_excel("old.xls", engine="xlrd")`.

## CRITICAL: use Excel formulas, not Python-computed constants

The sheet must stay live. Write `sheet['B10'] = '=SUM(B2:B9)'`, not a Python-summed number. Same for growth rates, averages, ratios, totals — always a formula referencing source cells.

## Creating

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
wb = Workbook(); ws = wb.active
ws['A1'] = 'Hello'; ws.append(['Row', 'of', 'data'])
ws['B2'] = '=SUM(A1:A10)'
ws['A1'].font = Font(bold=True, color='FF0000')
ws['A1'].fill = PatternFill('solid', start_color='FFFF00')
ws.column_dimensions['A'].width = 20
wb.save('output.xlsx')
```

## Editing (preserves formulas & formatting)

```python
from openpyxl import load_workbook
wb = load_workbook("existing.xlsx")     # do NOT use data_only=True when saving — it discards formulas permanently
ws = wb["Sheet1"]
ws['A1'] = 'New Value'; ws.insert_rows(2); ws.delete_cols(3)
wb.save("modified.xlsx")
```

## Recalculate + verify (MANDATORY when you wrote formulas)

openpyxl writes formula strings but does not compute their values. To produce computed values and catch errors, round-trip through LibreOffice (which recalculates on load), then scan every cell:
```bash
# Recalculate by opening & re-saving via headless LibreOffice
libreoffice --headless --calc --convert-to xlsx --outdir out/ model.xlsx
```
```python
# Scan the recalculated file for Excel error strings
from openpyxl import load_workbook
wb = load_workbook("out/model.xlsx", data_only=True)
errs = ["#REF!", "#DIV/0!", "#VALUE!", "#N/A", "#NAME?"]
bad = [(s, c.coordinate, c.value) for s in wb.sheetnames for r in wb[s].iter_rows() for c in r
       if isinstance(c.value, str) and c.value in errs]
print("errors:", bad or "none")
```
If LibreOffice isn't available, verify references manually with the checklist below; fix any error and re-scan.

## Verification checklist

- Test 2–3 sample references before building the full model.
- Watch column mapping (Excel col 64 = "BL") and 1-indexed rows (DataFrame row 5 = Excel row 6).
- Check denominators before `/` (#DIV/0!), verify every reference exists (#REF!), use `Sheet1!A1` for cross-sheet links.
- Handle nulls (`pd.notna()`); test zero/negative/large edge cases.

## Notes
- pandas for analysis/bulk; openpyxl for formulas/formatting.
- openpyxl is 1-based (row=1, column=1 → A1). For large files use `read_only`/`write_only`.
- In generated Python keep it minimal; in the spreadsheet itself, comment complex formulas and document hardcode sources.
