#!/usr/bin/env python3
"""Build the fixture corpus in fixtures/.

The committed binaries under fixtures/ are the corpus. This script is how they
were made, kept so the provenance of each one is checkable rather than folklore —
it is not part of any build, and running it is not required to work on this repo.

It will not run outside Santiago's machine: two of the six packages are copied
from ~/Work/ts-pptx and ~/Work/ts-xlsx. That is fine. The corpus exists to detect
*movement* in the Open XML SDK's diagnostics between versions, which requires the
inputs to be frozen; a corpus regenerated from whatever those repos contain today
would defeat its own purpose. If you need to change the corpus, change it
deliberately and re-record the snapshot in the same commit.

Everything generated here is byte-deterministic: fixed zip timestamps, fixed
entry order, no compression-level surprises. Two runs produce identical files.

Usage:  python3 scripts/make-fixtures.py
"""

from __future__ import annotations

import shutil
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FIXTURES = REPO / "fixtures"

# Fixed timestamp for every zip entry. Any constant works; 1980-01-01 is the
# earliest a zip can represent, so it is the conventional "no time here" value.
FIXED_TIME = (1980, 1, 1, 0, 0, 0)

TS_PPTX = Path.home() / "Work/ts-pptx"
TS_XLSX = Path.home() / "Work/ts-xlsx"

# Copied verbatim from the consumer repos. Both are Santiago's own fixtures.
COPIES = [
    (TS_PPTX / "test/read/fixtures/empty.pptx", "clean.pptx"),
    (TS_XLSX / "test/corpus/fixtures/cells-without-r-attribute-imply-position/sample.xlsx", "clean.xlsx"),
    (TS_XLSX / "test/corpus/fixtures/streaming-read-applies-date-format/sample.xlsx", "dirty.xlsx"),
]

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""

DOCUMENT_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p{paragraph_attributes}><w:r><w:t>ooxml-validate fixture</w:t></w:r></w:p>
<w:sectPr/>
</w:body>
</w:document>
"""

# The one thing wrong with dirty.docx. `w:bogus` is not in the wordprocessingml
# schema, so the validator raises Sch_UndeclaredAttribute and nothing else — the
# package is otherwise a well-formed, openable Word document. A fixture that is
# broken in exactly one known way is what makes a snapshot diff readable.
DIRTY_DOCX_ATTRIBUTE = ' w:bogus="1"'

# Deliberately not a zip at all, so OpenXmlPackage.Open throws and the CLI turns
# that into a PackageOpenError diagnostic rather than a crash. Plain ASCII so the
# file is greppable and its diff is legible if it ever changes.
CORRUPT_BYTES = b"This is not an OOXML package. It exists to be rejected.\n"


def write_zip(target: Path, entries: list[tuple[str, bytes]]) -> None:
    """Write a zip with fixed timestamps, so output is byte-deterministic."""
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries:
            info = zipfile.ZipInfo(name, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, data)


def make_docx(target: Path, paragraph_attributes: str) -> None:
    document = DOCUMENT_XML.format(paragraph_attributes=paragraph_attributes)
    write_zip(
        target,
        [
            ("[Content_Types].xml", CONTENT_TYPES.encode()),
            ("_rels/.rels", ROOT_RELS.encode()),
            ("word/document.xml", document.encode()),
        ],
    )


def make_dirty_pptx(source: Path, target: Path) -> None:
    """clean.pptx with one undeclared attribute added to the slide root.

    Rezipped rather than patched in place, so the output is deterministic; entry
    order is preserved from the source so the two packages stay comparable.
    """
    with zipfile.ZipFile(source) as archive:
        entries = [(item.filename, archive.read(item.filename)) for item in archive.infolist()]

    slide = "ppt/slides/slide1.xml"
    patched = []
    found = False
    for name, data in entries:
        if name == slide:
            text = data.decode("utf-8")
            marker = "<p:sld "
            if marker not in text:
                raise SystemExit(f"{source}: no {marker!r} in {slide}; the fixture changed shape")
            text = text.replace(marker, '<p:sld bogus="1" ', 1)
            data = text.encode("utf-8")
            found = True
        patched.append((name, data))

    if not found:
        raise SystemExit(f"{source}: no {slide} to patch; the fixture changed shape")

    write_zip(target, patched)


def main() -> int:
    FIXTURES.mkdir(exist_ok=True)

    missing = [source for source, _ in COPIES if not source.is_file()]
    if missing:
        for source in missing:
            print(f"missing source fixture: {source}", file=sys.stderr)
        print(
            "\nThis script only runs where the consumer repos are checked out. The "
            "committed fixtures are the corpus; nothing here needs regenerating.",
            file=sys.stderr,
        )
        return 1

    for source, name in COPIES:
        shutil.copyfile(source, FIXTURES / name)
        print(f"copied  {name:14s} <- {source}")

    make_dirty_pptx(FIXTURES / "clean.pptx", FIXTURES / "dirty.pptx")
    print(f"patched {'dirty.pptx':14s} <- clean.pptx + undeclared attribute")

    make_docx(FIXTURES / "clean.docx", "")
    print(f"built   {'clean.docx':14s}")

    make_docx(FIXTURES / "dirty.docx", DIRTY_DOCX_ATTRIBUTE)
    print(f"built   {'dirty.docx':14s} (undeclared attribute)")

    (FIXTURES / "corrupt.pptx").write_bytes(CORRUPT_BYTES)
    print(f"built   {'corrupt.pptx':14s} (not a zip)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
