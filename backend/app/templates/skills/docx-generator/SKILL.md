---
name: DOCX Generator
license: MIT
metadata:
  version: "2.0"
  category: document-processing
  sources:
    - "ECMA-376 Office Open XML File Formats"
    - "GB/T 9704-2012 Layout Standard for Official Documents"
description: >
  Professional DOCX document creation, editing, and formatting using python-docx.
  Three pipelines: (A) create new documents from scratch, (B) fill/edit content in existing
  documents, (C) apply template formatting.
  MUST use this skill whenever the user wants to produce, modify, or format a Word document --
  including when they say "write a report", "draft a proposal", "make a contract",
  "fill in this form", "reformat to match this template", or any task whose final output
  is a .docx file. Even if the user doesn't mention "docx" explicitly, if the task
  implies a printable/formal document, use this skill.
triggers:
  - Word
  - docx
  - document
  - Word document
  - report
  - contract
  - formatting
  - template
---

# minimax-docx

Create, edit, and format DOCX documents using **python-docx only** -- no .NET, no OpenXML SDK, no C#.

## Pipeline routing

Route by checking: does the user have an input .docx file?

```
User task
+-- No input file --> Pipeline A: CREATE
|   signals: "write", "create", "draft", "generate", "new", "make a report/proposal/memo"
|
+-- Has input .docx
    +-- Replace/fill/modify content --> Pipeline B: FILL-EDIT
    |   signals: "fill in", "replace", "update", "change text", "add section", "edit"
    |
    +-- Reformat/apply style/template --> Pipeline C: FORMAT-APPLY
        signals: "reformat", "apply template", "restyle", "match this format"
```

---

## Pipeline A: CREATE -- New Document from Scratch

### Step 1: Create document with page setup

```python
from docx import Document
from docx.shared import Inches, Pt, Cm, RGBColor, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_ORIENT

doc = Document()

# Page setup (A4)
section = doc.sections[0]
section.page_width = Cm(21.0)
section.page_height = Cm(29.7)
section.top_margin = Cm(2.54)
section.bottom_margin = Cm(2.54)
section.left_margin = Cm(3.18)
section.right_margin = Cm(3.18)

# For landscape:
# section.orientation = WD_ORIENT.LANDSCAPE
# section.page_width, section.page_height = section.page_height, section.page_width
```

### Step 2: Define styles

```python
from docx.enum.style import WD_STYLE_TYPE

# -- Heading styles --
for level, (size, color, spacing_before, spacing_after) in enumerate([
    (Pt(22), RGBColor(0x1A, 0x1A, 0x2E), Pt(24), Pt(10)),  # Heading 1
    (Pt(16), RGBColor(0x1A, 0x1A, 0x2E), Pt(18), Pt(8)),   # Heading 2
    (Pt(13), RGBColor(0x1A, 0x1A, 0x2E), Pt(12), Pt(6)),   # Heading 3
], start=1):
    style = doc.styles[f"Heading {level}"]
    font = style.font
    font.name = "Liberation Sans"
    font.size = size
    font.bold = True
    font.color.rgb = color
    pf = style.paragraph_format
    pf.space_before = spacing_before
    pf.space_after = spacing_after
    pf.keep_with_next = True
    # OutlineLevel for TOC and navigation
    pf.outline_level = level - 1

# -- Body style --
style = doc.styles["Normal"]
style.font.name = "Liberation Sans"
style.font.size = Pt(10.5)
style.font.color.rgb = RGBColor(0x33, 0x33, 0x33)
style.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
style.paragraph_format.line_spacing = 1.15
style.paragraph_format.space_after = Pt(6)

# -- CJK font assignment --
# python-docx sets the Latin font via font.name; for CJK, set the East Asian font:
from docx.oxml.ns import qn
rpr = style.element.get_or_add_rPr()
rFonts = rpr.get_or_add_rFonts()
rFonts.set(qn("w:eastAsia"), "Noto Sans CJK SC")
```

### Step 3: Add content

```python
# Title
title = doc.add_heading("Document Title", level=0)
title.alignment = WD_ALIGN_PARAGRAPH.CENTER

# Headings
doc.add_heading("Introduction", level=1)

# Body paragraphs
p = doc.add_paragraph("This is the main body text with ")
p.add_run("bold emphasis").bold = True
p.add_run(" and ")
p.add_run("italic text").italic = True
p.add_run(".")

# Bullet list
doc.add_paragraph("First point", style="List Bullet")
doc.add_paragraph("Second point", style="List Bullet")
doc.add_paragraph("Third point", style="List Bullet")

# Numbered list
doc.add_paragraph("Step one", style="List Number")
doc.add_paragraph("Step two", style="List Number")

# Block quote / callout
callout = doc.add_paragraph()
callout.style = doc.styles["Normal"]
callout_pf = callout.paragraph_format
callout_pf.left_indent = Cm(1.0)
# Add left border via XML (accent-colored bar)
from docx.oxml import OxmlElement
pPr = callout._element.get_or_add_pPr()
pBdr = OxmlElement("w:pBdr")
left_border = OxmlElement("w:left")
left_border.set(qn("w:val"), "single")
left_border.set(qn("w:sz"), "24")  # 3pt
left_border.set(qn("w:space"), "8")
left_border.set(qn("w:color"), "2D5F8A")
pBdr.append(left_border)
pPr.append(pBdr)
callout.add_run("This is a callout block with an accent-colored left border.")
```

### Step 4: Add tables

```python
# Table with header row
headers = ["Quarter", "Revenue", "Growth"]
data = [["Q1", "$120K", "12%"], ["Q2", "$145K", "21%"], ["Q3", "$132K", "-9%"]]

table = doc.add_table(rows=1, cols=len(headers))
table.style = "Table Grid"
table.alignment = WD_TABLE_ALIGNMENT.CENTER

# Header row
for i, header in enumerate(headers):
    cell = table.rows[0].cells[i]
    cell.text = header
    # Style header
    p = cell.paragraphs[0]
    p.runs[0].bold = True
    p.runs[0].font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    p.runs[0].font.size = Pt(10)
    p.runs[0].font.name = "Liberation Sans"
    # Header background
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    shading = OxmlElement("w:shd")
    shading.set(qn("w:val"), "clear")
    shading.set(qn("w:color"), "auto")
    shading.set(qn("w:fill"), "2D5F8A")
    cell._element.get_or_add_tcPr().append(shading)

# Data rows
for row_data in data:
    row = table.add_row()
    for i, val in enumerate(row_data):
        row.cells[i].text = val
        p = row.cells[i].paragraphs[0]
        for run in p.runs:
            run.font.size = Pt(10)
            run.font.name = "Liberation Sans"

# Set column widths
for i, width in enumerate([Cm(4), Cm(4), Cm(4)]):
    for row in table.rows:
        row.cells[i].width = width
```

### Step 5: Add images

```python
# Inline image
doc.add_picture("chart.png", width=Inches(5.5))

# Image with caption
doc.add_picture("diagram.png", width=Inches(4.0))
caption = doc.add_paragraph("Figure 1: System Architecture")
caption.alignment = WD_ALIGN_PARAGRAPH.CENTER
caption.style.font.size = Pt(9)
caption.style.font.color.rgb = RGBColor(0x88, 0x88, 0x88)
```

### Step 6: Headers, footers, and page numbers

```python
section = doc.sections[0]

# Header
header = section.header
header.is_linked_to_previous = False
hp = header.paragraphs[0]
hp.text = "Company Name"
hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
hp.runs[0].font.size = Pt(8)
hp.runs[0].font.color.rgb = RGBColor(0x88, 0x88, 0x88)

# Footer with page number
footer = section.footer
footer.is_linked_to_previous = False
fp = footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.CENTER

# Add page number field
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
run = fp.add_run()
fldChar1 = OxmlElement("w:fldChar")
fldChar1.set(qn("w:fldCharType"), "begin")
run._element.append(fldChar1)

run2 = fp.add_run()
instrText = OxmlElement("w:instrText")
instrText.set(qn("xml:space"), "preserve")
instrText.text = " PAGE "
run2._element.append(instrText)

run3 = fp.add_run()
fldChar2 = OxmlElement("w:fldChar")
fldChar2.set(qn("w:fldCharType"), "end")
run3._element.append(fldChar2)
```

### Step 7: Save

```python
doc.save("output.docx")
print("Saved output.docx")
```

---

## Pipeline B: FILL-EDIT -- Modify Existing Documents

```python
from docx import Document

doc = Document("input.docx")

# Replace text (preserving formatting)
for para in doc.paragraphs:
    for run in para.runs:
        if "{{COMPANY_NAME}}" in run.text:
            run.text = run.text.replace("{{COMPANY_NAME}}", "Acme Corp")

# Fill table cells
for table in doc.tables:
    for row in table.rows:
        for cell in row.cells:
            if "{{PLACEHOLDER}}" in cell.text:
                for para in cell.paragraphs:
                    for run in para.runs:
                        run.text = run.text.replace("{{PLACEHOLDER}}", "Filled Value")

# Add a new section
doc.add_page_break()
doc.add_heading("New Section", level=1)
doc.add_paragraph("Content for the new section.")

doc.save("output.docx")
```

**Important:** When editing, always iterate through `runs` to preserve formatting. Do not replace `paragraph.text` directly as it strips all formatting.

---

## Pipeline C: FORMAT-APPLY -- Apply Template Styling

```python
from docx import Document

# Open source document
source = Document("source.docx")

# Open template for style reference
template = Document("template.docx")

# Copy styles from template
# Strategy: create new doc from template, then paste content
output = Document("template.docx")

# Clear template body content
for para in output.paragraphs:
    p_element = para._element
    p_element.getparent().remove(p_element)

# Re-add content from source with template styles
for para in source.paragraphs:
    new_para = output.add_paragraph()
    new_para.style = para.style
    for run in para.runs:
        new_run = new_para.add_run(run.text)
        # Apply template style fonts (not source formatting)

output.save("formatted.docx")
```

---

## Aesthetic Recipes

| Recipe | Body Font | Heading Font | Body Size | H1 Size | Line Spacing | Margins |
|--------|-----------|-------------|-----------|---------|-------------|---------|
| Corporate Modern | Liberation Sans | Liberation Sans Bold | 10.5pt | 22pt | 1.15 | 2.54cm |
| Academic Thesis | Liberation Sans | Liberation Sans Bold | 12pt | 16pt | 2.0 | 2.54cm / 3.18cm |
| Executive Brief | Liberation Sans | Liberation Sans Bold | 11pt | 18pt | 1.25 | 2.0cm |
| Minimal | Liberation Sans | Liberation Sans Bold | 10pt | 20pt | 1.3 | 3.0cm |
| Chinese Official (GB/T 9704) | Noto Sans CJK SC | Noto Sans CJK SC | 16pt (3 hao) | 22pt (2 hao) | Fixed 29pt | 3.7cm / 2.6cm |

---

## Critical Rules

1. **CJK font** -- Set East Asian font via `rFonts.set(qn("w:eastAsia"), "Noto Sans CJK SC")` on run properties
2. **Font path** -- CJK: `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`; English: `/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf`
3. **Heading OutlineLevel** -- Always set `paragraph_format.outline_level` on heading styles for TOC to work
4. **Font size units** -- Use `Pt()` for points. Internal OOXML uses half-points (`w:sz="24"` = 12pt)
5. **Margin/spacing units** -- Use `Cm()` or `Inches()`. Internal OOXML uses DXA (1 inch = 1440 DXA)
6. **Preserve formatting on edit** -- Iterate `para.runs`, never assign `para.text` directly
7. **Table cell must have paragraph** -- Every `<w:tc>` must contain at least one `<w:p>`
8. **Section break** -- `doc.add_section(WD_ORIENT.PORTRAIT)` adds a new section with page break

---

## Dependencies

- `pip install python-docx` -- all DOCX operations
- `pip install Pillow` -- image handling

No .NET, no OpenXML SDK, no C# required.
