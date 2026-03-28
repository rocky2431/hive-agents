---
name: PDF Generator
description: >
  Use this skill when visual quality and design identity matter for a PDF.
  CREATE (generate from scratch): "make a PDF", "generate a report", "write a proposal",
  "create a resume", "beautiful PDF", "professional document", "cover page",
  "polished PDF", "client-ready document".
  FILL (complete form fields): "fill in the form", "fill out this PDF",
  "complete the form fields", "write values into PDF", "what fields does this PDF have".
  REFORMAT (apply design to an existing doc): "reformat this document", "apply our style",
  "convert this Markdown/text to PDF", "make this doc look good", "re-style this PDF".
  This skill uses a token-based design system: color, typography, and spacing are derived
  from the document type and flow through every page. The output is print-ready.
  Prefer this skill when appearance matters, not just when any PDF output is needed.
license: MIT
metadata:
  version: "2.0"
  category: document-generation
---

# minimax-pdf

Three tasks. One skill. Pure Python (reportlab + pypdf + pdfplumber + Pillow).

## Read the Design System section before any CREATE or REFORMAT work.

---

## Route table

| User intent | Route | Method |
|---|---|---|
| Generate a new PDF from scratch | **CREATE** | `palette.py` then `render_cover.py` then `render_body.py` then `merge.py` |
| Fill / complete form fields in an existing PDF | **FILL** | `fill_inspect.py` then `fill_write.py` |
| Reformat / re-style an existing document | **REFORMAT** | Parse source to content.json then CREATE pipeline |

**Rule:** when in doubt between CREATE and REFORMAT, ask whether the user has an existing document to start from. If yes then REFORMAT. If no then CREATE.

---

## Route A: CREATE

Full pipeline -- content then design tokens then cover then body then merged PDF.

### Shell orchestrator

```bash
bash scripts/make.sh run \
  --title "Q3 Strategy Review" --type proposal \
  --author "Strategy Team" --date "October 2025" \
  --accent "#2D5F8A" \
  --content content.json --out report.pdf
```

### Step-by-step with execute_code

```python
# Step 1: Generate palette
import sys, os
sys.path.insert(0, os.path.join(SKILL_DIR, "scripts"))
from palette import generate_palette

tokens = generate_palette("proposal", accent="#2D5F8A")
```

```python
# Step 2: Render cover (reportlab canvas -- no HTML, no browser)
from render_cover import render_cover

render_cover(tokens, "cover.pdf",
    title="Q3 Strategy Review",
    author="Strategy Team",
    date_text="October 2025")
```

```python
# Step 3: Render body (reportlab platypus)
from render_body import render_body

render_body(tokens, "content.json", "body.pdf")
```

```python
# Step 4: Merge cover + body
from merge import merge_pdfs

merge_pdfs(["cover.pdf", "body.pdf"], "report.pdf")
```

**Doc types:** `report` / `proposal` / `resume` / `portfolio` / `academic` / `general` / `minimal` / `stripe` / `diagonal` / `frame` / `editorial` / `magazine` / `darkroom` / `terminal` / `poster`

| Type | Cover pattern | Visual identity |
|---|---|---|
| `report` | `fullbleed` | Dark bg, dot grid, serif title |
| `proposal` | `split` | Left panel + right geometric, modern sans |
| `resume` | `typographic` | Oversized first-word, serif display |
| `portfolio` | `atmospheric` | Near-black, radial glow, elegant serif |
| `academic` | `typographic` | Light bg, classical serif |
| `general` | `fullbleed` | Dark slate, clean sans |
| `minimal` | `minimal` | White + single 8px accent bar, elegant serif |
| `stripe` | `stripe` | 3 bold horizontal color bands, condensed sans |
| `diagonal` | `diagonal` | Angled cut, dark/light halves, modern sans |
| `frame` | `frame` | Inset border, corner ornaments, serif |
| `editorial` | `editorial` | Ghost letter, all-caps title, condensed sans |
| `magazine` | `magazine` | Warm cream bg, centered stack, hero image, serif |
| `darkroom` | `darkroom` | Navy bg, centered stack, grayscale image, serif |
| `terminal` | `terminal` | Near-black, grid lines, monospace, neon green |
| `poster` | `poster` | White bg, thick sidebar, oversized title, condensed sans |

Cover extras (pass to `render_cover()`):
- `abstract` -- abstract text block on the cover (magazine/darkroom)
- `cover_image` -- hero image path (magazine, darkroom, poster)

**Color overrides -- always choose these based on document content:**
- `accent` -- override the accent color; `accent_lt` is auto-derived by lightening toward white
- `cover_bg` -- override the cover background color

**Accent color selection guidance:**

You have creative authority over the accent color. Pick it from the document's semantic context -- title, industry, purpose, audience -- not from generic "safe" choices.

| Context | Suggested accent range |
|---|---|
| Legal / compliance / finance | Deep navy `#1C3A5E`, charcoal `#2E3440`, slate `#3D4C5E` |
| Healthcare / medical | Teal-green `#2A6B5A`, cool green `#3A7D6A` |
| Technology / engineering | Steel blue `#2D5F8A`, indigo `#3D4F8A` |
| Environmental / sustainability | Forest `#2E5E3A`, olive `#4A5E2A` |
| Creative / arts / culture | Burgundy `#6B2A35`, plum `#5A2A6B`, terracotta `#8A3A2A` |
| Academic / research | Deep teal `#2A5A6B`, library blue `#2A4A6B` |
| Corporate / neutral | Slate `#3D4A5A`, graphite `#444C56` |
| Luxury / premium | Warm black `#1A1208`, deep bronze `#4A3820` |

**Rule:** choose a color that a thoughtful designer would select for this specific document. Muted, desaturated tones work best; avoid vivid primaries.

**content.json block types:**

| Block | Usage | Key fields |
|---|---|---|
| `h1` | Section heading + accent rule | `text` |
| `h2` | Subsection heading | `text` |
| `h3` | Sub-subsection (bold) | `text` |
| `body` | Justified paragraph; supports `<b>` `<i>` markup | `text` |
| `bullet` | Unordered list item | `text` |
| `numbered` | Ordered list item -- counter auto-resets on non-numbered blocks | `text` |
| `callout` | Highlighted insight box with accent left bar | `text` |
| `table` | Data table -- accent header, alternating row tints | `headers`, `rows`, `col_widths`?, `caption`? |
| `image` | Embedded image scaled to column width | `path`/`src`, `caption`? |
| `figure` | Image with auto-numbered "Figure N:" caption | `path`/`src`, `caption`? |
| `code` | Monospace code block with accent left border | `text`, `language`? |
| `math` | Display math -- LaTeX syntax via matplotlib mathtext | `text`, `label`?, `caption`? |
| `chart` | Bar / line / pie chart rendered with matplotlib | `chart_type`, `labels`, `datasets`, `title`?, `x_label`?, `y_label`?, `caption`?, `figure`? |
| `flowchart` | Process diagram with nodes + edges via matplotlib | `nodes`, `edges`, `caption`?, `figure`? |
| `bibliography` | Numbered reference list with hanging indent | `items` [{id, text}], `title`? |
| `divider` | Accent-colored full-width rule | -- |
| `caption` | Small muted label | `text` |
| `pagebreak` | Force a new page | -- |
| `spacer` | Vertical whitespace | `pt` (default 12) |

**chart / flowchart / bibliography schemas:**
```json
{"type":"chart","chart_type":"bar","labels":["Q1","Q2","Q3","Q4"],
 "datasets":[{"label":"Revenue","values":[120,145,132,178]}],"caption":"Q results"}

{"type":"flowchart",
 "nodes":[{"id":"s","label":"Start","shape":"oval"},
          {"id":"p","label":"Process","shape":"rect"},
          {"id":"d","label":"Valid?","shape":"diamond"},
          {"id":"e","label":"End","shape":"oval"}],
 "edges":[{"from":"s","to":"p"},{"from":"p","to":"d"},
          {"from":"d","to":"e","label":"Yes"},{"from":"d","to":"p","label":"No"}]}

{"type":"bibliography","items":[
  {"id":"1","text":"Author (Year). Title. Publisher."}]}
```

---

## Route B: FILL

Fill form fields in an existing PDF without altering layout or design.

```python
import sys, os
sys.path.insert(0, os.path.join(SKILL_DIR, "scripts"))

# Step 1: inspect fields
from fill_inspect import inspect_fields

fields = inspect_fields("form.pdf")
for f in fields:
    print(f"  {f['name']} ({f['type']}): {f.get('value', '')}")
```

```python
# Step 2: fill fields
from fill_write import fill_fields

fill_fields("form.pdf", "filled.pdf", {
    "FirstName": "Jane",
    "Agree": "true",
    "Country": "US",
})
```

| Field type | Value format |
|---|---|
| `text` | Any string |
| `checkbox` | `"true"` or `"false"` |
| `dropdown` | Must match a choice value from inspect output |
| `radio` | Must match a radio value |

Always run `inspect_fields()` first to get exact field names.

---

## Route C: REFORMAT

Parse an existing document then run the CREATE pipeline.

**Supported input formats:** `.md` `.txt` `.pdf` `.json`

For `.pdf` input, use pdfplumber to extract text:
```python
import pdfplumber, json

blocks = []
with pdfplumber.open("source.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        if text:
            for para in text.split("\n\n"):
                para = para.strip()
                if not para:
                    continue
                blocks.append({"type": "body", "text": para})

with open("content.json", "w") as f:
    json.dump(blocks, f, ensure_ascii=False, indent=2)
```

For `.md` or `.txt`, parse headings (`# ` as h1, `## ` as h2), bullet lines (`- ` as bullet), and everything else as body blocks.

Then run the full CREATE pipeline on the generated content.json.

---

## Design System

### Fonts

| Role | Font | Path |
|---|---|---|
| CJK (Chinese/Japanese/Korean) | Noto Sans CJK | `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc` |
| English body / sans | Liberation Sans | `/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf` |
| English bold | Liberation Sans Bold | `/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf` |
| English italic | Liberation Sans Italic | `/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf` |
| Monospace | Liberation Mono | `/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf` |

### Typography Scale

| Element | Font | Size (pt) | Leading (pt) | Color |
|---|---|---|---|---|
| h1 | LiberationSans-Bold | 22 | 28 | tokens["heading"] |
| h2 | LiberationSans-Bold | 16 | 22 | tokens["heading"] |
| h3 | LiberationSans-Bold | 13 | 18 | tokens["heading"] |
| body | LiberationSans / NotoSansCJK | 10.5 | 15 | tokens["text"] |
| bullet | same as body | 10.5 | 15 | tokens["text"] |
| callout | LiberationSans | 10 | 14 | tokens["text"] |
| code | LiberationMono | 9 | 13 | tokens["text"] |
| caption | LiberationSans | 8.5 | 12 | tokens["muted"] |

### Page Layout

| Parameter | Value |
|---|---|
| Page size | A4 (595.27 x 841.89 pt) |
| Top margin | 72 pt (1 inch) |
| Bottom margin | 60 pt |
| Left margin | 65 pt |
| Right margin | 55 pt |
| Column width | 475.27 pt (page width - margins) |
| Page number | Bottom-center, 8pt, muted color |

---

## Environment

All scripts are in the `scripts/` subdirectory. They require:

| Library | Purpose | Install |
|---|---|---|
| `reportlab` | PDF creation (cover + body) | `pip install reportlab` |
| `pypdf` | Merge, fill forms, read metadata | `pip install pypdf` |
| `pdfplumber` | Extract text/tables from existing PDFs | `pip install pdfplumber` |
| `Pillow` | Image processing for embedded images | `pip install Pillow` |
| `matplotlib` | Charts, flowcharts, math rendering | `pip install matplotlib` |

No Node.js, Playwright, or Chromium required.

## Script Reference

| Script | Purpose |
|---|---|
| `scripts/palette.py` | Generate design tokens (colors, fonts, spacing) from doc type |
| `scripts/render_cover.py` | Render cover page with reportlab canvas |
| `scripts/render_body.py` | Render body pages from content.json with reportlab platypus |
| `scripts/merge.py` | Merge multiple PDFs with pypdf |
| `scripts/fill_inspect.py` | List form fields in an existing PDF |
| `scripts/fill_write.py` | Fill form fields in an existing PDF |
| `scripts/make.sh` | Orchestrator shell script for full pipeline |
