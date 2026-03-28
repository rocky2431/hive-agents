---
name: XLSX Processor
description: "Open, create, read, analyze, edit, or validate Excel/spreadsheet files (.xlsx, .xlsm, .csv, .tsv). Use when the user asks to create, build, modify, analyze, read, validate, or format any Excel spreadsheet, financial model, pivot table, or tabular data file. Covers: creating new xlsx from scratch, reading and analyzing existing files, editing existing xlsx with zero format loss, formula handling, and applying professional financial formatting standards. Triggers on 'spreadsheet', 'Excel', '.xlsx', '.csv', 'pivot table', 'financial model', 'formula', or any request to produce tabular data in Excel format."
license: MIT
metadata:
  version: "2.0"
  category: productivity
  sources:
    - ECMA-376 Office Open XML File Formats
---

# XLSX Processor

Handle the request directly. Do NOT spawn sub-agents. Always write the output file the user requests.

Uses **openpyxl** (read/edit existing) + **XlsxWriter** (create new) -- no raw XML manipulation required.

## Task Routing

| Task | Library | Section |
|------|---------|---------|
| **READ** -- analyze existing data | openpyxl + optional pandas | [Read/Analyze](#read--analyze-existing-data) |
| **CREATE** -- new xlsx from scratch | XlsxWriter | [Create](#create--new-spreadsheet-from-scratch) |
| **EDIT** -- modify existing xlsx | openpyxl | [Edit](#edit--modify-existing-spreadsheet) |
| **VALIDATE** -- check formulas | openpyxl | [Validate](#validate--check-formulas) |

---

## READ -- Analyze Existing Data

### Quick structure discovery with openpyxl

```python
import openpyxl

wb = openpyxl.load_workbook("input.xlsx", data_only=True)
for sheet_name in wb.sheetnames:
    ws = wb[sheet_name]
    print(f"Sheet: {sheet_name} ({ws.max_row} rows x {ws.max_column} cols)")
    # Print header row
    headers = [cell.value for cell in ws[1]]
    print(f"  Headers: {headers}")
    # Print first 3 data rows
    for row in ws.iter_rows(min_row=2, max_row=min(4, ws.max_row), values_only=True):
        print(f"  {list(row)}")
```

### Deep analysis with pandas

```python
import pandas as pd

# Read all sheets
xlsx = pd.ExcelFile("input.xlsx")
for sheet_name in xlsx.sheet_names:
    df = pd.read_excel(xlsx, sheet_name=sheet_name)
    print(f"\n=== {sheet_name} ===")
    print(f"Shape: {df.shape}")
    print(f"Columns: {list(df.columns)}")
    print(f"Dtypes:\n{df.dtypes}")
    print(f"\nSummary:\n{df.describe()}")
```

**Formatting rule**: When the user specifies decimal places (e.g. "2 decimal places"), apply that format to ALL numeric values -- use `f'{v:.2f}'` on every number. Never output `12875` when `12875.00` is required.

**Aggregation rule**: Always compute sums/means/counts directly from the DataFrame column -- e.g. `df['Revenue'].sum()`. Never re-derive column values before aggregation.

---

## CREATE -- New Spreadsheet from Scratch

Use **XlsxWriter** for creating new spreadsheets -- it has superior formatting support and writes clean files.

### Basic creation

```python
import xlsxwriter

wb = xlsxwriter.Workbook("output.xlsx")
ws = wb.add_worksheet("Revenue")

# -- Define formats --
header_fmt = wb.add_format({
    "bold": True,
    "font_name": "Liberation Sans",
    "font_size": 11,
    "font_color": "#FFFFFF",
    "bg_color": "#2D5F8A",
    "border": 1,
    "align": "center",
    "valign": "vcenter",
    "text_wrap": True,
})

body_fmt = wb.add_format({
    "font_name": "Liberation Sans",
    "font_size": 10,
    "border": 1,
    "align": "left",
    "valign": "vcenter",
})

number_fmt = wb.add_format({
    "font_name": "Liberation Sans",
    "font_size": 10,
    "border": 1,
    "num_format": "#,##0",
    "align": "right",
})

currency_fmt = wb.add_format({
    "font_name": "Liberation Sans",
    "font_size": 10,
    "border": 1,
    "num_format": "$#,##0.00",
    "align": "right",
})

percent_fmt = wb.add_format({
    "font_name": "Liberation Sans",
    "font_size": 10,
    "border": 1,
    "num_format": "0.0%",
    "align": "right",
})

total_fmt = wb.add_format({
    "bold": True,
    "font_name": "Liberation Sans",
    "font_size": 10,
    "border": 1,
    "top": 2,  # thick top border for totals
    "num_format": "$#,##0.00",
    "align": "right",
})

# -- Financial color standard formats --
input_fmt = wb.add_format({  # Blue = hard-coded input
    "font_name": "Liberation Sans",
    "font_size": 10,
    "font_color": "#0000FF",
    "border": 1,
    "num_format": "#,##0",
})

formula_fmt = wb.add_format({  # Black = formula
    "font_name": "Liberation Sans",
    "font_size": 10,
    "font_color": "#000000",
    "border": 1,
    "num_format": "#,##0",
})

xref_fmt = wb.add_format({  # Green = cross-sheet reference
    "font_name": "Liberation Sans",
    "font_size": 10,
    "font_color": "#00B050",
    "border": 1,
    "num_format": "#,##0",
})

# -- Write headers --
headers = ["Quarter", "Revenue", "Costs", "Profit", "Margin"]
for col, header in enumerate(headers):
    ws.write(0, col, header, header_fmt)

# -- Write data --
data = [
    ["Q1", 120000, 80000],
    ["Q2", 145000, 95000],
    ["Q3", 132000, 88000],
    ["Q4", 178000, 102000],
]

for row_idx, (quarter, revenue, costs) in enumerate(data, start=1):
    ws.write(row_idx, 0, quarter, body_fmt)
    ws.write(row_idx, 1, revenue, input_fmt)      # Blue: hard-coded input
    ws.write(row_idx, 2, costs, input_fmt)         # Blue: hard-coded input
    ws.write_formula(row_idx, 3, f"=B{row_idx+1}-C{row_idx+1}", formula_fmt)  # Black: formula
    ws.write_formula(row_idx, 4, f"=D{row_idx+1}/B{row_idx+1}", percent_fmt)  # Percentage

# -- Totals row --
last_data_row = len(data)
total_row = last_data_row + 1
ws.write(total_row, 0, "Total", wb.add_format({"bold": True, "font_name": "Liberation Sans", "border": 1, "top": 2}))
ws.write_formula(total_row, 1, f"=SUM(B2:B{last_data_row+1})", total_fmt)
ws.write_formula(total_row, 2, f"=SUM(C2:C{last_data_row+1})", total_fmt)
ws.write_formula(total_row, 3, f"=SUM(D2:D{last_data_row+1})", total_fmt)
ws.write_formula(total_row, 4, f"=D{total_row+1}/B{total_row+1}", percent_fmt)

# -- Column widths --
ws.set_column("A:A", 12)
ws.set_column("B:D", 15)
ws.set_column("E:E", 12)

# -- Freeze header row --
ws.freeze_panes(1, 0)

# -- Auto-filter --
ws.autofilter(0, 0, total_row, len(headers) - 1)

wb.close()
print("Created output.xlsx")
```

### Adding charts with XlsxWriter

```python
chart = wb.add_chart({"type": "column"})
chart.add_series({
    "name": "Revenue",
    "categories": f"=Revenue!$A$2:$A${last_data_row+1}",
    "values": f"=Revenue!$B$2:$B${last_data_row+1}",
    "fill": {"color": "#2D5F8A"},
})
chart.add_series({
    "name": "Costs",
    "categories": f"=Revenue!$A$2:$A${last_data_row+1}",
    "values": f"=Revenue!$C$2:$C${last_data_row+1}",
    "fill": {"color": "#6B9AC4"},
})
chart.set_title({"name": "Revenue vs Costs"})
chart.set_x_axis({"name": "Quarter"})
chart.set_y_axis({"name": "Amount ($)", "num_format": "$#,##0"})
chart.set_size({"width": 600, "height": 350})
ws.insert_chart("A8", chart)
```

### Conditional formatting

```python
# Color scale (green to red)
ws.conditional_format(f"E2:E{last_data_row+1}", {
    "type": "3_color_scale",
    "min_color": "#FF6B6B",
    "mid_color": "#FFEB3B",
    "max_color": "#4CAF50",
})

# Data bars
ws.conditional_format(f"B2:B{last_data_row+1}", {
    "type": "data_bar",
    "bar_color": "#2D5F8A",
})

# Icon sets
ws.conditional_format(f"D2:D{last_data_row+1}", {
    "type": "icon_set",
    "icon_style": "3_arrows",
})
```

### Multi-sheet workbook

```python
# Add a summary sheet that references data sheets
summary = wb.add_worksheet("Summary")
summary.write(0, 0, "Sheet", header_fmt)
summary.write(0, 1, "Total Revenue", header_fmt)

# Cross-sheet formula (green font for cross-sheet references)
summary.write(1, 0, "Revenue", body_fmt)
summary.write_formula(1, 1, "=Revenue!B6", xref_fmt)
```

---

## EDIT -- Modify Existing Spreadsheet

Use **openpyxl** for editing -- it preserves existing formatting, formulas, and features.

### Basic editing

```python
import openpyxl

wb = openpyxl.load_workbook("input.xlsx")
ws = wb.active

# Read a cell
val = ws["B2"].value
print(f"B2 = {val}")

# Write to a cell (preserves formatting)
ws["B2"] = 150000

# Write a formula
ws["D2"] = "=B2-C2"

# Add a new row
new_row = ws.max_row + 1
ws.cell(row=new_row, column=1, value="Q5")
ws.cell(row=new_row, column=2, value=190000)
ws.cell(row=new_row, column=3, value=110000)
ws.cell(row=new_row, column=4, value=f"=B{new_row}-C{new_row}")

wb.save("output.xlsx")
```

### Formatting with openpyxl

```python
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, numbers

# Font
ws["A1"].font = Font(name="Liberation Sans", size=11, bold=True, color="FFFFFF")

# Fill (background color)
ws["A1"].fill = PatternFill(start_color="2D5F8A", end_color="2D5F8A", fill_type="solid")

# Alignment
ws["A1"].alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

# Border
thin_border = Border(
    left=Side(style="thin"),
    right=Side(style="thin"),
    top=Side(style="thin"),
    bottom=Side(style="thin"),
)
ws["A1"].border = thin_border

# Number format
ws["B2"].number_format = "#,##0.00"
ws["C2"].number_format = "$#,##0"
ws["D2"].number_format = "0.0%"

# Column width
ws.column_dimensions["A"].width = 15
ws.column_dimensions["B"].width = 18

# Row height
ws.row_dimensions[1].height = 25
```

### Adding a new sheet

```python
ws2 = wb.create_sheet("Analysis")
ws2["A1"] = "Summary"

# Copy data from another sheet
for row in wb["Revenue"].iter_rows(min_row=1, max_row=5, values_only=False):
    for cell in row:
        ws2.cell(row=cell.row, column=cell.column, value=cell.value)
```

### Merge cells

```python
ws.merge_cells("A1:D1")
ws["A1"] = "Quarterly Financial Report"
ws["A1"].alignment = Alignment(horizontal="center")
```

---

## VALIDATE -- Check Formulas

```python
import openpyxl

wb = openpyxl.load_workbook("input.xlsx")

for sheet_name in wb.sheetnames:
    ws = wb[sheet_name]
    print(f"\n=== {sheet_name} ===")
    formula_count = 0
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and cell.value.startswith("="):
                formula_count += 1
                print(f"  {cell.coordinate}: {cell.value}")
    print(f"  Total formulas: {formula_count}")
```

### Verify formula results (load computed values)

```python
# data_only=True loads the cached computed values (not the formulas)
wb_values = openpyxl.load_workbook("input.xlsx", data_only=True)
wb_formulas = openpyxl.load_workbook("input.xlsx")

ws_v = wb_values.active
ws_f = wb_formulas.active

for row in ws_f.iter_rows():
    for cell in row:
        if isinstance(cell.value, str) and cell.value.startswith("="):
            computed = ws_v[cell.coordinate].value
            print(f"  {cell.coordinate}: {cell.value} = {computed}")
```

---

## Financial Color Standard

| Cell Role | Font Color | Hex Code | When to use |
|-----------|-----------|----------|-------------|
| Hard-coded input / assumption | Blue | `0000FF` | Numbers typed directly (not computed) |
| Formula / computed result | Black | `000000` | Any cell with a formula |
| Cross-sheet reference formula | Green | `00B050` | Formulas referencing other sheets |

Apply these consistently in every financial model.

---

## Key Rules

1. **Formula-First**: Every calculated cell MUST use an Excel formula, not a hardcoded number
2. **CREATE uses XlsxWriter**: Superior formatting, charts, conditional formatting
3. **EDIT uses openpyxl**: Preserves existing formatting and features
4. **Always produce the output file** -- this is the #1 priority
5. **Financial color coding**: Blue for inputs, black for formulas, green for cross-sheet
6. **Never mix libraries**: Do not open the same file with both XlsxWriter and openpyxl
7. **XlsxWriter is write-only**: It cannot read existing files -- use openpyxl for that
8. **Freeze panes**: Always freeze the header row in data-heavy sheets
9. **Column widths**: Set appropriate widths for readability -- do not leave default narrow columns

---

## Common Patterns

### CSV to XLSX conversion

```python
import csv
import xlsxwriter

with open("input.csv", "r") as f:
    reader = csv.reader(f)
    rows = list(reader)

wb = xlsxwriter.Workbook("output.xlsx")
ws = wb.add_worksheet()

header_fmt = wb.add_format({"bold": True, "bg_color": "#2D5F8A", "font_color": "#FFFFFF", "border": 1})
body_fmt = wb.add_format({"border": 1})

for col, header in enumerate(rows[0]):
    ws.write(0, col, header, header_fmt)

for row_idx, row in enumerate(rows[1:], start=1):
    for col, val in enumerate(row):
        # Try to write as number
        try:
            ws.write_number(row_idx, col, float(val), body_fmt)
        except (ValueError, TypeError):
            ws.write(row_idx, col, val, body_fmt)

ws.freeze_panes(1, 0)
ws.autofilter(0, 0, len(rows) - 1, len(rows[0]) - 1)
wb.close()
```

### Pandas DataFrame to styled XLSX

```python
import pandas as pd

df = pd.DataFrame({
    "Product": ["Widget A", "Widget B", "Widget C"],
    "Revenue": [120000, 145000, 132000],
    "Growth": [0.12, 0.21, -0.09],
})

with pd.ExcelWriter("output.xlsx", engine="xlsxwriter") as writer:
    df.to_excel(writer, sheet_name="Products", index=False)
    wb = writer.book
    ws = writer.sheets["Products"]

    # Apply formatting
    currency_fmt = wb.add_format({"num_format": "$#,##0", "border": 1})
    percent_fmt = wb.add_format({"num_format": "0.0%", "border": 1})

    ws.set_column("B:B", 15, currency_fmt)
    ws.set_column("C:C", 12, percent_fmt)
    ws.freeze_panes(1, 0)
```

---

## Dependencies

- `pip install openpyxl` -- read and edit existing XLSX files
- `pip install XlsxWriter` -- create new XLSX files with rich formatting
- `pip install pandas` -- optional, for data analysis

No raw XML manipulation required.
