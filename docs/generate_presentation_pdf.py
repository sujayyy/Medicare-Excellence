from pathlib import Path
import textwrap

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "presentation-guide.md"
TARGET = ROOT / "Medicare-Excellence-Presentation-Guide.pdf"

PAGE_WIDTH = 612
PAGE_HEIGHT = 792
MARGIN_X = 54
MARGIN_TOP = 60
MARGIN_BOTTOM = 54
FONT_SIZE = 11
LINE_HEIGHT = 16
CHARS_PER_LINE = 92


def escape_pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_lines(markdown_text: str):
    lines = []
    for raw in markdown_text.splitlines():
        stripped = raw.rstrip()
        if not stripped:
            lines.append(("", FONT_SIZE))
            continue
        if stripped.startswith("### "):
            for item in textwrap.wrap(stripped[4:].strip(), width=CHARS_PER_LINE):
                lines.append((item, 12))
            lines.append(("", FONT_SIZE))
            continue
        if stripped.startswith("## "):
            for item in textwrap.wrap(stripped[3:].strip(), width=CHARS_PER_LINE):
                lines.append((item, 14))
            lines.append(("", FONT_SIZE))
            continue
        if stripped.startswith("# "):
            for item in textwrap.wrap(stripped[2:].strip(), width=CHARS_PER_LINE):
                lines.append((item, 17))
            lines.append(("", FONT_SIZE))
            continue

        bullet_prefix = ""
        content = stripped
        if stripped.startswith("- "):
            bullet_prefix = "- "
            content = stripped[2:].strip()
        wrapped = textwrap.wrap(content, width=CHARS_PER_LINE - (2 if bullet_prefix else 0)) or [""]
        for i, item in enumerate(wrapped):
            prefix = bullet_prefix if i == 0 else ("  " if bullet_prefix else "")
            lines.append((f"{prefix}{item}", FONT_SIZE))
    return lines


def paginate(lines):
    pages = []
    current = []
    remaining = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM
    for line, size in lines:
        needed = LINE_HEIGHT if size <= 12 else LINE_HEIGHT + 2
        if needed > remaining and current:
            pages.append(current)
            current = []
            remaining = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM
        current.append((line, size))
        remaining -= needed
    if current:
        pages.append(current)
    return pages


def create_pdf():
    pages = paginate(build_lines(SOURCE.read_text(encoding="utf-8")))
    objects = []

    def add_object(content: str):
        objects.append(content)
        return len(objects)

    font_obj = add_object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_ids = []
    content_ids = []

    for page_lines in pages:
        parts = ["BT", f"/F1 {FONT_SIZE} Tf", f"54 732 Td"]
        current_size = FONT_SIZE
        first = True
        for line, size in page_lines:
            if not first:
                parts.append(f"0 -{LINE_HEIGHT if size <= 12 else LINE_HEIGHT + 2} Td")
            first = False
            if size != current_size:
                parts.append(f"/F1 {size} Tf")
                current_size = size
            parts.append(f"({escape_pdf_text(line)}) Tj")
        parts.append("ET")
        stream = "\n".join(parts)
        content_id = add_object(f"<< /Length {len(stream.encode('utf-8'))} >>\nstream\n{stream}\nendstream")
        content_ids.append(content_id)
        page_ids.append(None)

    pages_obj_id_placeholder = len(objects) + 1
    for idx, content_id in enumerate(content_ids):
        page_ids[idx] = add_object(
            f"<< /Type /Page /Parent {pages_obj_id_placeholder} 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] /Resources << /Font << /F1 {font_obj} 0 R >> >> /Contents {content_id} 0 R >>"
        )

    kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
    pages_obj_id = add_object(f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>")
    catalog_id = add_object(f"<< /Type /Catalog /Pages {pages_obj_id} 0 R >>")

    pdf_parts = ["%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"]
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(sum(len(part.encode("utf-8")) for part in pdf_parts))
        pdf_parts.append(f"{index} 0 obj\n{obj}\nendobj\n")

    xref_offset = sum(len(part.encode("utf-8")) for part in pdf_parts)
    pdf_parts.append(f"xref\n0 {len(objects) + 1}\n")
    pdf_parts.append("0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf_parts.append(f"{offset:010d} 00000 n \n")
    pdf_parts.append(f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n")
    TARGET.write_bytes("".join(pdf_parts).encode("utf-8"))


if __name__ == "__main__":
    create_pdf()
