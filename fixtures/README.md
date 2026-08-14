# The fixture corpus

Seven small OOXML packages and one committed snapshot of the diagnostics they
produce. This is the SDK-bump guardrail — see [docs/sdk-pin.md](../docs/sdk-pin.md)
for what it is guarding against and what a bump PR has to do.

It exists to detect **movement**, not to prove correctness. Small and boring is
the goal: three clean packages, three broken in exactly one known way each, and
one that is not a package at all.

| File | Kind | What it is |
|---|---|---|
| `clean.pptx` | Presentation | Valid. From `ts-pptx`'s `test/read/fixtures/empty.pptx`. |
| `clean.xlsx` | Spreadsheet | Valid. From `ts-xlsx`'s `cells-without-r-attribute-imply-position` corpus fixture. |
| `clean.docx` | Wordprocessing | Valid. Generated — a minimal three-part Word package. |
| `dirty.pptx` | Presentation | `clean.pptx` with one undeclared attribute on the slide root → `Sch_UndeclaredAttribute`. |
| `dirty.xlsx` | Spreadsheet | From `ts-xlsx`'s `streaming-read-applies-date-format` corpus fixture → three `Sem_AttributeValueDataTypeDetailed`. |
| `dirty.docx` | Wordprocessing | `clean.docx` with one undeclared attribute on a paragraph → `Sch_UndeclaredAttribute`. |
| `corrupt.pptx` | — | Not a zip at all. Exercises `PackageOpenError`, and that a bad package is a *finding* (exit 1) rather than a tool failure (exit 2). |

Between them they cover all three document types, both `Schema` and `Semantic`
diagnostics, and the package-open path — which is the spread that makes a moved
diagnostic show up somewhere.

**Each broken fixture is broken in exactly one way, on purpose.** A fixture with
a dozen unrelated problems produces a snapshot diff nobody can read, and an
unreadable diff gets approved.

## The snapshot

`diagnostics.snapshot.json` is the full report over the corpus at the pinned
format and SDK version. It is literally what the CLI prints from inside this
directory:

```sh
ooxml-validator clean.docx clean.pptx clean.xlsx corrupt.pptx dirty.docx dirty.pptx dirty.xlsx
```

The header carries `format` and `sdkVersion`, so any diff is attributable to a
specific bump.

`DiagnosticSnapshotTests` regenerates and compares it on every test run. To
re-record after a deliberate change:

```sh
OOXML_VALIDATOR_UPDATE_SNAPSHOT=1 dotnet test oracle.tests/OoxmlValidator.Tests.csproj
```

Then **read the diff before committing it**. Re-recording without reading it is
the same as not having the test.

## Changing the corpus

Don't, casually. These packages are inputs to a comparison across SDK versions,
so their value comes from being frozen — a corpus that drifts cannot tell you
whether the SDK moved or the fixtures did.

`scripts/make-fixtures.py` records how each file was made and can rebuild them,
but it only runs where `~/Work/ts-pptx` and `~/Work/ts-xlsx` are checked out, and
running it is never required. The committed binaries are the corpus. If you do
change it, change the snapshot in the same commit and say why.
