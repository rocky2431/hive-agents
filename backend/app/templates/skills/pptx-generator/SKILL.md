---
name: PPTX Generator
description: "Generate, edit, and read PowerPoint presentations using python-pptx. Create from scratch (cover, TOC, content, section divider, summary slides), edit existing PPTX, or extract text. Triggers: PPT, PPTX, PowerPoint, presentation, slide, deck, slides."
license: MIT
metadata:
  version: "2.0"
  category: productivity
---

# PPTX Generator & Editor

## Overview

This skill handles all PowerPoint tasks using **python-pptx only** -- no Node.js, no PptxGenJS. It covers: reading/analyzing existing presentations, editing existing decks, and creating presentations from scratch with a complete design system (color palettes, fonts, style recipes).

## Quick Reference

| Task | Approach |
|------|----------|
| Read/analyze content | `python-pptx` text extraction (see below) |
| Edit existing PPTX | Load with `python-pptx`, modify, save |
| Create from scratch | Build slides with `python-pptx` API |

| Item | Value |
|------|-------|
| **Dimensions** | 10" x 5.625" (16:9 widescreen) |
| **Unit** | Inches via `pptx.util.Inches()`, points via `pptx.util.Pt()` |
| **Colors** | `RGBColor(0xFF, 0x00, 0x00)` or `RGBColor.from_string("FF0000")` |
| **English font** | Liberation Sans (fallback: Arial) |
| **Chinese font** | Noto Sans CJK |
| **CJK font path** | `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc` |
| **Theme keys** | `primary`, `secondary`, `accent`, `light`, `bg` |

---

## Reading Content

```python
from pptx import Presentation

prs = Presentation("input.pptx")
for i, slide in enumerate(prs.slides, 1):
    print(f"--- Slide {i} ---")
    for shape in slide.shapes:
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                print(para.text)
        if shape.has_table:
            table = shape.table
            for row in table.rows:
                print(" | ".join(cell.text for cell in row.cells))
```

---

## Creating from Scratch -- Workflow

### Step 1: Research & Requirements

Understand user requirements -- topic, audience, purpose, tone, content depth.

### Step 2: Select Color Palette

Choose a palette matching the topic and audience:

| Palette | primary | secondary | accent | light | bg | Best for |
|---------|---------|-----------|--------|-------|----|----------|
| Corporate Navy | 1B2A4A | 3D5A80 | 6B9AC4 | B8D4E8 | F0F4F8 | Business, finance |
| Forest | 1A3C2A | 2D6A4F | 52B788 | B7E4C7 | F0F7F4 | Environment, health |
| Warm Sunset | 3D1C02 | 8B4513 | D4763B | F0C987 | FFF8F0 | Creative, culture |
| Deep Indigo | 1A1B3A | 2E3060 | 6366F1 | A5B4FC | F0F0FF | Technology, data |
| Slate Modern | 1E293B | 334155 | 64748B | CBD5E1 | F8FAFC | Neutral, minimal |
| Ruby | 3B0A0A | 7F1D1D | DC2626 | FCA5A5 | FFF1F2 | Urgency, impact |

### Step 3: Plan Slide Outline

Classify every slide as one of these 5 page types:

| Type | Purpose | Visual treatment |
|------|---------|-----------------|
| **Cover** | Title slide | Full-bleed bg color, centered title, subtitle, decorative shapes |
| **TOC** | Table of contents | Numbered section list, accent highlights |
| **Section Divider** | Section opener | Large section number + title, accent bg or shape |
| **Content** | Main body | Title bar + body area with text/charts/tables/images |
| **Summary** | Closing slide | Key takeaways, contact info, call to action |

### Step 4: Generate Slides

Create one Python file per slide or build all slides in a single script. Each slide uses the `python-pptx` API.

**Complete slide creation example:**

```python
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# -- Theme --
theme = {
    "primary": RGBColor(0x1B, 0x2A, 0x4A),
    "secondary": RGBColor(0x3D, 0x5A, 0x80),
    "accent": RGBColor(0x6B, 0x9A, 0xC4),
    "light": RGBColor(0xB8, 0xD4, 0xE8),
    "bg": RGBColor(0xF0, 0xF4, 0xF8),
}

prs = Presentation()
prs.slide_width = Inches(10)
prs.slide_height = Inches(5.625)

# ============================================================
# SLIDE 1: Cover
# ============================================================
slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank layout

# Full background
bg_shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(10), Inches(5.625))
bg_shape.fill.solid()
bg_shape.fill.fore_color.rgb = theme["primary"]
bg_shape.line.fill.background()

# Decorative accent circle
circle = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(7.5), Inches(-1), Inches(4), Inches(4))
circle.fill.solid()
circle.fill.fore_color.rgb = theme["accent"]
circle.fill.fore_color.brightness = 0.0
circle.line.fill.background()
# Set transparency via alpha
from pptx.oxml.ns import qn
solidFill = circle.fill._fill
solidFill.find(qn("a:solidFill")).find(qn("a:srgbClr")).set("val", "6B9AC4")

# Title
txBox = slide.shapes.add_textbox(Inches(0.8), Inches(1.8), Inches(8.4), Inches(1.5))
tf = txBox.text_frame
tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "Presentation Title"
p.font.size = Pt(44)
p.font.bold = True
p.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
p.font.name = "Liberation Sans"
p.alignment = PP_ALIGN.CENTER

# Subtitle
p2 = tf.add_paragraph()
p2.text = "Subtitle or tagline"
p2.font.size = Pt(18)
p2.font.color.rgb = theme["light"]
p2.font.name = "Liberation Sans"
p2.alignment = PP_ALIGN.CENTER

# ============================================================
# SLIDE 2: Content slide with text
# ============================================================
slide2 = prs.slides.add_slide(prs.slide_layouts[6])

# Title bar
title_bar = slide2.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(10), Inches(1.0))
title_bar.fill.solid()
title_bar.fill.fore_color.rgb = theme["primary"]
title_bar.line.fill.background()

title_box = slide2.shapes.add_textbox(Inches(0.5), Inches(0.15), Inches(9), Inches(0.7))
tf = title_box.text_frame
p = tf.paragraphs[0]
p.text = "Section Title"
p.font.size = Pt(28)
p.font.bold = True
p.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
p.font.name = "Liberation Sans"

# Body content
body_box = slide2.shapes.add_textbox(Inches(0.5), Inches(1.3), Inches(9), Inches(3.8))
tf = body_box.text_frame
tf.word_wrap = True

bullet_points = [
    "First key point with supporting detail",
    "Second key point with data reference",
    "Third key point with actionable insight",
]
for i, point in enumerate(bullet_points):
    p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
    p.text = point
    p.font.size = Pt(16)
    p.font.color.rgb = theme["secondary"]
    p.font.name = "Liberation Sans"
    p.space_after = Pt(12)
    p.level = 0

# Page number badge
page_shape = slide2.shapes.add_shape(MSO_SHAPE.OVAL, Inches(9.3), Inches(5.1), Inches(0.4), Inches(0.4))
page_shape.fill.solid()
page_shape.fill.fore_color.rgb = theme["accent"]
page_shape.line.fill.background()
page_shape.text_frame.paragraphs[0].text = "2"
page_shape.text_frame.paragraphs[0].font.size = Pt(12)
page_shape.text_frame.paragraphs[0].font.bold = True
page_shape.text_frame.paragraphs[0].font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
page_shape.text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER
page_shape.text_frame.paragraphs[0].font.name = "Liberation Sans"

# ============================================================
# Save
# ============================================================
prs.save("presentation.pptx")
print("Saved presentation.pptx")
```

### Step 5: Adding Charts

```python
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE

chart_data = CategoryChartData()
chart_data.categories = ["Q1", "Q2", "Q3", "Q4"]
chart_data.add_series("Revenue", (120, 145, 132, 178))
chart_data.add_series("Costs", (80, 95, 88, 102))

chart_frame = slide.shapes.add_chart(
    XL_CHART_TYPE.COLUMN_CLUSTERED,
    Inches(0.5), Inches(1.5), Inches(9), Inches(3.5),
    chart_data,
)
chart = chart_frame.chart
chart.has_legend = True
chart.legend.include_in_layout = False

# Style the chart
plot = chart.plots[0]
series = plot.series[0]
series.format.fill.solid()
series.format.fill.fore_color.rgb = theme["accent"]
```

### Step 6: Adding Tables

```python
rows, cols = 4, 3
table_shape = slide.shapes.add_table(rows, cols, Inches(0.5), Inches(1.5), Inches(9), Inches(2.5))
table = table_shape.table

# Set column widths
table.columns[0].width = Inches(3)
table.columns[1].width = Inches(3)
table.columns[2].width = Inches(3)

# Header row
headers = ["Category", "Value", "Change"]
for i, header in enumerate(headers):
    cell = table.cell(0, i)
    cell.text = header
    cell.fill.solid()
    cell.fill.fore_color.rgb = theme["primary"]
    p = cell.text_frame.paragraphs[0]
    p.font.bold = True
    p.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    p.font.size = Pt(12)
    p.font.name = "Liberation Sans"

# Data rows
data = [
    ["Revenue", "$1.2M", "+15%"],
    ["Users", "50,000", "+22%"],
    ["Retention", "85%", "+3%"],
]
for r, row_data in enumerate(data, 1):
    for c, val in enumerate(row_data):
        cell = table.cell(r, c)
        cell.text = val
        p = cell.text_frame.paragraphs[0]
        p.font.size = Pt(11)
        p.font.name = "Liberation Sans"
        p.font.color.rgb = theme["secondary"]
        # Alternating row color
        if r % 2 == 0:
            cell.fill.solid()
            cell.fill.fore_color.rgb = theme["bg"]
```

### Step 7: Adding Images

```python
# From file
slide.shapes.add_picture("chart.png", Inches(0.5), Inches(1.5), Inches(4.5), Inches(3))

# From URL (download first)
import urllib.request
urllib.request.urlretrieve("https://example.com/image.png", "temp_image.png")
slide.shapes.add_picture("temp_image.png", Inches(5), Inches(1.5), Inches(4.5), Inches(3))
```

---

## Page Number Badge (REQUIRED)

All slides **except Cover Page** MUST include a page number badge in the bottom-right corner.

- **Position**: x: 9.3", y: 5.1"
- Show current number only (e.g. `3` or `03`), NOT "3/12"
- Use palette colors, keep subtle

### Circle Badge (Default)

```python
page_shape = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(9.3), Inches(5.1), Inches(0.4), Inches(0.4))
page_shape.fill.solid()
page_shape.fill.fore_color.rgb = theme["accent"]
page_shape.line.fill.background()
p = page_shape.text_frame.paragraphs[0]
p.text = "3"
p.font.size = Pt(12)
p.font.bold = True
p.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
p.alignment = PP_ALIGN.CENTER
p.font.name = "Liberation Sans"
```

### Pill Badge

```python
page_shape = slide.shapes.add_shape(
    MSO_SHAPE.ROUNDED_RECTANGLE, Inches(9.1), Inches(5.15), Inches(0.6), Inches(0.35))
page_shape.fill.solid()
page_shape.fill.fore_color.rgb = theme["accent"]
page_shape.line.fill.background()
p = page_shape.text_frame.paragraphs[0]
p.text = "03"
p.font.size = Pt(11)
p.font.bold = True
p.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
p.alignment = PP_ALIGN.CENTER
p.font.name = "Liberation Sans"
```

---

## Editing Existing Presentations

```python
from pptx import Presentation

prs = Presentation("existing.pptx")

# Modify a specific slide
slide = prs.slides[0]  # 0-indexed

# Find and update text
for shape in slide.shapes:
    if shape.has_text_frame:
        for para in shape.text_frame.paragraphs:
            if "OLD_TEXT" in para.text:
                for run in para.runs:
                    run.text = run.text.replace("OLD_TEXT", "NEW_TEXT")

# Add a new slide
new_slide = prs.slides.add_slide(prs.slide_layouts[6])

prs.save("modified.pptx")
```

---

## Common Pitfalls

1. **Always use blank layout** (`slide_layouts[6]`) for full creative control
2. **Set `line.fill.background()`** on shapes to remove default borders
3. **Use `word_wrap = True`** on text frames to prevent text overflow
4. **Font name must match exactly** -- "Liberation Sans" not "LiberationSans"
5. **Charts require `CategoryChartData`** -- do not build chart XML manually
6. **Table cell text** is set via `cell.text`, formatting via `cell.text_frame.paragraphs[0].font`
7. **Slide dimensions** must be set before adding slides: `prs.slide_width = Inches(10)`
8. **RGBColor** takes 3 int args `RGBColor(0xFF, 0x00, 0x00)` or a string `RGBColor.from_string("FF0000")`

---

## Dependencies

- `pip install python-pptx` -- all PPTX operations
- `pip install Pillow` -- image processing (auto-installed with python-pptx)

No Node.js or npm packages required.
