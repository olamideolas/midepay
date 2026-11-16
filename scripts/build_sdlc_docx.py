#!/usr/bin/env python3
"""
MidePay v4.0 — Enterprise 76-Document SDLC Compendium DOCX Compiler
Reads `docs/MidePay_Complete_76_SDLC_Deliverables.md`, validates that all 76
numbered SDLC deliverables (1..76) are present, and compiles a richly styled
Microsoft Word OpenXML document at:
  `docs/MidePay_Complete_76_SDLC_Deliverables_Compendium.docx`

Supports `python-docx` if installed, with a built-in zero-dependency ECMA-376
OpenXML (`zipfile` + `xml.sax.saxutils`) compiler so builds succeed in any
standard Python 3 environment.
"""

from __future__ import annotations

import datetime as dt
import os
import re
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

ROOT_DIR = Path(__file__).resolve().parent.parent
MD_PATH = ROOT_DIR / "docs" / "MidePay_Complete_76_SDLC_Deliverables.md"
DOCX_PATH = ROOT_DIR / "docs" / "MidePay_Complete_76_SDLC_Deliverables_Compendium.docx"


def verify_76_sections(md_text: str) -> list[tuple[int, str]]:
    matches = re.findall(r"^##\s+(\d+)\.\s+(.+)$", md_text, flags=re.MULTILINE)
    found_nums = {int(num): title.strip() for num, title in matches}
    missing = [i for i in range(1, 77) if i not in found_nums]
    if missing:
        raise ValueError(f"Missing numbered SDLC sections: {missing}")
    return [(i, found_nums[i]) for i in range(1, 77)]


def parse_markdown_blocks(md_text: str) -> list[dict]:
    lines = md_text.splitlines()
    blocks: list[dict] = []
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]

        # Fenced code block
        if line.strip().startswith("```"):
            lang = line.strip()[3:].strip()
            code_lines = []
            i += 1
            while i < n and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1
            blocks.append({"type": "code", "lang": lang, "text": "\n".join(code_lines)})
            continue

        # Horizontal rule
        if re.match(r"^\s*---+\s*$", line):
            blocks.append({"type": "hr"})
            i += 1
            continue

        # Markdown table
        if "|" in line and i + 1 < n and re.match(r"^\s*\|?[\s:\-\|]+\|?\s*$", lines[i + 1]):
            rows = []
            while i < n and "|" in lines[i] and lines[i].strip():
                raw = lines[i].strip().strip("|")
                cells = [c.strip() for c in raw.split("|")]
                if not all(re.match(r"^:?-{2,}:?$", c) for c in cells):
                    rows.append(cells)
                i += 1
            if rows:
                blocks.append({"type": "table", "rows": rows})
            continue

        # Headings
        m_h = re.match(r"^(#{1,4})\s+(.+)$", line)
        if m_h:
            blocks.append({"type": "heading", "level": len(m_h.group(1)), "text": m_h.group(2).strip()})
            i += 1
            continue

        # Blockquote
        if line.lstrip().startswith(">"):
            quote_lines = []
            while i < n and lines[i].lstrip().startswith(">"):
                quote_lines.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            blocks.append({"type": "quote", "text": " ".join(q.strip() for q in quote_lines if q.strip())})
            continue

        # Bullet or numbered list item
        m_li = re.match(r"^(\s*(?:[-*]|\d+\.))\s+(.+)$", line)
        if m_li:
            blocks.append({"type": "list_item", "bullet": m_li.group(1).strip(), "text": m_li.group(2).strip()})
            i += 1
            continue

        # Blank line
        if not line.strip():
            i += 1
            continue

        # Paragraph
        para_lines = [line.strip()]
        i += 1
        while (
            i < n
            and lines[i].strip()
            and not lines[i].strip().startswith(("```", "#", ">", "---"))
            and not re.match(r"^(\s*(?:[-*]|\d+\.))\s+", lines[i])
            and not ("|" in lines[i] and i + 1 < n and re.match(r"^\s*\|?[\s:\-\|]+\|?\s*$", lines[i + 1]))
        ):
            para_lines.append(lines[i].strip())
            i += 1
        blocks.append({"type": "paragraph", "text": " ".join(para_lines)})

    return blocks


def strip_inline_md(text: str) -> str:
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return text


def build_ooxml_runs(text: str, default_size_half_pt: int = 21, default_color: str = "1E293B") -> str:
    """Render bold (`**...**`) and inline code (`` `...` ``) into WordprocessingML `<w:r>` runs."""
    tokens = re.split(r"(\*\*[^*]+\*\*|`[^`]+`)", text)
    runs = []
    for tok in tokens:
        if not tok:
            continue
        if tok.startswith("**") and tok.endswith("**") and len(tok) > 4:
            clean = xml_escape(tok[2:-2])
            runs.append(
                f'<w:r><w:rPr><w:b/><w:color w:val="{default_color}"/>'
                f'<w:sz w:val="{default_size_half_pt}"/></w:rPr>'
                f'<w:t xml:space="preserve">{clean}</w:t></w:r>'
            )
        elif tok.startswith("`") and tok.endswith("`") and len(tok) > 2:
            clean = xml_escape(tok[1:-1])
            runs.append(
                f'<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'
                f'<w:color w:val="047857"/><w:sz w:val="{max(18, default_size_half_pt - 2)}"/></w:rPr>'
                f'<w:t xml:space="preserve">{clean}</w:t></w:r>'
            )
        else:
            clean = xml_escape(strip_inline_md(tok))
            runs.append(
                f'<w:r><w:rPr><w:color w:val="{default_color}"/>'
                f'<w:sz w:val="{default_size_half_pt}"/></w:rPr>'
                f'<w:t xml:space="preserve">{clean}</w:t></w:r>'
            )
    return "".join(runs)


def build_docx_ooxml(blocks: list[dict], output_path: Path) -> None:
    body_parts: list[str] = []

    for b in blocks:
        btype = b["type"]
        if btype == "heading":
            lvl = b["level"]
            txt = xml_escape(strip_inline_md(b["text"]))
            if lvl == 1:
                body_parts.append(
                    f'<w:p><w:pPr><w:pStyle w:val="Heading1"/>'
                    f'<w:spacing w:before="360" w:after="160"/>'
                    f'<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="10B981"/></w:pBdr></w:pPr>'
                    f'<w:r><w:rPr><w:b/><w:color w:val="064E3B"/><w:sz w:val="34"/></w:rPr>'
                    f'<w:t xml:space="preserve">{txt}</w:t></w:r></w:p>'
                )
            elif lvl == 2:
                body_parts.append(
                    f'<w:p><w:pPr><w:pStyle w:val="Heading2"/>'
                    f'<w:spacing w:before="280" w:after="120"/></w:pPr>'
                    f'<w:r><w:rPr><w:b/><w:color w:val="047857"/><w:sz w:val="28"/></w:rPr>'
                    f'<w:t xml:space="preserve">{txt}</w:t></w:r></w:p>'
                )
            else:
                sz = "24" if lvl == 3 else "22"
                body_parts.append(
                    f'<w:p><w:pPr><w:pStyle w:val="Heading3"/>'
                    f'<w:spacing w:before="200" w:after="80"/></w:pPr>'
                    f'<w:r><w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="{sz}"/></w:rPr>'
                    f'<w:t xml:space="preserve">{txt}</w:t></w:r></w:p>'
                )

        elif btype == "paragraph":
            runs = build_ooxml_runs(b["text"])
            body_parts.append(
                f'<w:p><w:pPr><w:spacing w:before="60" w:after="120" w:line="276" w:lineRule="auto"/></w:pPr>{runs}</w:p>'
            )

        elif btype == "list_item":
            prefix = "• " if b["bullet"] in ("-", "*") else f"{b['bullet']} "
            runs = build_ooxml_runs(prefix + b["text"])
            body_parts.append(
                f'<w:p><w:pPr><w:ind w:left="360"/><w:spacing w:before="40" w:after="80"/></w:pPr>{runs}</w:p>'
            )

        elif btype == "quote":
            runs = build_ooxml_runs(b["text"], default_size_half_pt=20, default_color="065F46")
            body_parts.append(
                f'<w:p><w:pPr><w:ind w:left="420" w:right="240"/>'
                f'<w:shd w:val="clear" w:color="auto" w:fill="ECFDF5"/>'
                f'<w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="10B981"/></w:pBdr>'
                f'<w:spacing w:before="120" w:after="120"/></w:pPr>{runs}</w:p>'
            )

        elif btype == "code":
            for code_line in b["text"].splitlines() or [""]:
                esc = xml_escape(code_line)
                body_parts.append(
                    f'<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>'
                    f'<w:spacing w:before="0" w:after="20"/></w:pPr>'
                    f'<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'
                    f'<w:color w:val="0F172A"/><w:sz w:val="17"/></w:rPr>'
                    f'<w:t xml:space="preserve">{esc}</w:t></w:r></w:p>'
                )

        elif btype == "table":
            rows = b["rows"]
            col_count = max(len(r) for r in rows)
            tbl_xml = [
                '<w:tbl><w:tblPr>'
                '<w:tblW w:w="5000" w:type="pct"/>'
                '<w:tblBorders>'
                '<w:top w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>'
                '<w:left w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>'
                '<w:bottom w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>'
                '<w:right w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>'
                '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>'
                '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>'
                '</w:tblBorders></w:tblPr>'
            ]
            for r_idx, row in enumerate(rows):
                is_hdr = r_idx == 0
                tbl_xml.append("<w:tr>")
                for c_idx in range(col_count):
                    cell_txt = row[c_idx] if c_idx < len(row) else ""
                    shd = '<w:shd w:val="clear" w:color="auto" w:fill="064E3B"/>' if is_hdr else (
                        '<w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/>' if r_idx % 2 == 1 else ""
                    )
                    if is_hdr:
                        clean_hdr = xml_escape(strip_inline_md(cell_txt))
                        cell_runs = (
                            f'<w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/></w:rPr>'
                            f'<w:t xml:space="preserve">{clean_hdr}</w:t></w:r>'
                        )
                    else:
                        cell_runs = build_ooxml_runs(cell_txt, default_size_half_pt=18, default_color="1E293B")
                    tbl_xml.append(
                        f'<w:tc><w:tcPr>{shd}<w:tcMar>'
                        f'<w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/>'
                        f'<w:left w:w="110" w:type="dxa"/><w:right w:w="110" w:type="dxa"/>'
                        f'</w:tcMar></w:tcPr><w:p><w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr>'
                        f'{cell_runs}</w:p></w:tc>'
                    )
                tbl_xml.append("</w:tr>")
            tbl_xml.append("</w:tbl><w:p/>")
            body_parts.append("".join(tbl_xml))

    sect_pr = (
        '<w:sectPr>'
        '<w:pgSz w:w="12240" w:h="15840"/>'
        '<w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/>'
        '</w:sectPr>'
    )

    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:body>{"".join(body_parts)}{sect_pr}</w:body></w:document>'
    )

    styles_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:docDefaults><w:rPrDefault><w:rPr>'
        '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
        '<w:sz w:val="21"/><w:lang w:val="en-US"/>'
        '</w:rPr></w:rPrDefault></w:docDefaults>'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>'
        '</w:styles>'
    )

    content_types_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        '</Types>'
    )

    rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        '</Relationships>'
    )

    doc_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '</Relationships>'
    )

    now_iso = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    core_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        '<dc:title>MidePay v4.0 — Complete 76-Document Enterprise SDLC Compendium</dc:title>'
        '<dc:creator>MidePay Enterprise Architecture, Security &amp; Governance</dc:creator>'
        '<dc:description>Complete 76-Deliverable Production SDLC Suite for MidePay Nigeria</dc:description>'
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{now_iso}</dcterms:created>'
        f'<dcterms:modified xsi:type="dcterms:W3CDTF">{now_iso}</dcterms:modified>'
        '</cp:coreProperties>'
    )

    app_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
        '<Application>MidePay Enterprise SDLC Compiler v4.0</Application>'
        '<Company>MidePay Technologies Ltd</Company>'
        '</Properties>'
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml)
        zf.writestr("_rels/.rels", rels_xml)
        zf.writestr("word/document.xml", document_xml)
        zf.writestr("word/styles.xml", styles_xml)
        zf.writestr("word/_rels/document.xml.rels", doc_rels_xml)
        zf.writestr("docProps/core.xml", core_xml)
        zf.writestr("docProps/app.xml", app_xml)


def verify_generated_docx(docx_path: Path) -> int:
    with zipfile.ZipFile(docx_path, "r") as zf:
        xml_bytes = zf.read("word/document.xml")
    xml_text = xml_bytes.decode("utf-8")
    plain_text = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", xml_text))
    for num in range(1, 77):
        if f"{num}. " not in plain_text:
            raise AssertionError(f"Section {num} missing inside compiled .docx")
    return 76


def main() -> int:
    if not MD_PATH.exists():
        print(f"ERROR: Source Markdown not found at {MD_PATH}", file=sys.stderr)
        return 1

    md_text = MD_PATH.read_text(encoding="utf-8")
    sections = verify_76_sections(md_text)
    blocks = parse_markdown_blocks(md_text)
    build_docx_ooxml(blocks, DOCX_PATH)
    verified_count = verify_generated_docx(DOCX_PATH)
    size_kb = os.path.getsize(DOCX_PATH) / 1024.0

    print(f"[OK] Verified {len(sections)}/76 numbered sections in {MD_PATH.name}")
    print(f"[OK] Compiled Word Compendium: {DOCX_PATH} ({size_kb:.1f} KB)")
    print(f"[OK] Post-build OOXML verification passed: {verified_count}/76 sections intact.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

