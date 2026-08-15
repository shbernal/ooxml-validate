# ooxml-validate

Validate OOXML documents — `.pptx`, `.xlsx`, `.docx` and friends — against
Microsoft's [Open XML SDK][sdk] schema validator, from Node.

```js
import {validate, validateBuffer} from 'ooxml-validate';

const report = await validate(['deck.pptx', 'book.xlsx']);
for (const result of report.results) {
  if (!result.valid) console.error(result.file, result.diagnostics);
}
```

The schema validator itself is .NET. This package ships a small self-contained
CLI around it and downloads the right prebuilt binary for your platform on first
use, so **consumers do not need a .NET SDK installed**.

- **Package**: `ooxml-validate` on npm (unscoped).
- **Repo**: `shbernal/ooxml-validate`. The name mismatch is deliberate.

## Install

```sh
pnpm add -D ooxml-validate
```

Nothing is downloaded at install time. The first call that actually needs the
validator fetches a self-contained binary (~42 MB compressed, ~110 MB on disk)
into `~/.cache/ooxml-validate/<version>/`, verifies its checksum and its GitHub
build provenance attestation, and reuses it from then on. Reinstalls and multiple
checkouts share one cache entry.

Supported platforms: `linux-x64`, `linux-arm64`, `osx-x64`, `osx-arm64`,
`win-x64`.

## Use

As a library:

| Export | What it does |
|---|---|
| `validate(paths, opts?)` | Validate files on disk. |
| `validateBuffer(bytes, {ext, label?, format?})` | Validate an in-memory package. |
| `validateBuffers(inputs, opts?)` | Batch form of the above. |
| `validatorAvailable()` | Whether the binary can be resolved. Throws under `CI`. |
| `probeFormats(paths)` | Error counts at every conformance target. |
| `oracleVersion()` | The oracle's version and the Open XML SDK it links. |
| `FILE_FORMATS` / `FILE_FORMAT` | Conformance targets, and the pinned default. |

Validating in-memory packages needs no temp-file bookkeeping from you:

```js
const results = await validateBuffers([
  {bytes: deck, ext: 'pptx', label: 'quarterly-review'},
  {bytes: book, ext: 'xlsx', label: 'figures'},
]);
// results[].file is 'quarterly-review' / 'figures', never a temp path.
```

The bytes go to temp files (the oracle only reads files), and the temp path is
mapped back to your `label` before you see it. Correlation is by that map alone,
never by array position — so results stay attributable however the oracle orders
them. Temp files are cleaned up even if a batch crashes.

Calls made while an invocation is in flight are coalesced into the next batch,
which holds the process to **one validator child at a time** regardless of how
many callers there are. That matters: the binary costs ~0.3 s of startup and
~55 MB of RSS, and one child per call multiplies both by your test runner's
concurrency.

As a CLI:

```sh
pnpm exec ooxml-validate deck.pptx
```

Exit codes are meaningful and are part of the contract:

| Code | Meaning |
|---|---|
| `0` | Every input validated clean. |
| `1` | Validation errors were found. |
| `2` | The tool could not run — bad arguments, unreadable file, crash. |

Diagnostics go to stdout as JSON; tool failures go to stderr as text. A file that
could not be opened is a `2`, never a `0` — the distinction between "clean" and
"never actually checked" is the whole point of the exit codes.

### The report

```jsonc
{
  "format": "Microsoft365",   // the conformance target that was applied
  "sdkVersion": "3.5.1",      // the Open XML SDK actually loaded
  "results": [
    {
      "file": "deck.pptx",    // echoed back exactly as given
      "valid": false,
      "errors": [
        {
          "id": "Sch_UndeclaredAttribute",
          "type": "Schema",   // Schema | Semantic | MarkupCompatibility | Package
          "description": "The 'bogus' attribute is not declared.",
          "partUri": "/ppt/slides/slide1.xml",  // null when unattributable
          "xpath": "/p:sld[1]"                  // null when unattributable
        }
      ]
    }
  ]
}
```

Four properties of this output that consumers may rely on:

**Every input file appears, each with an explicit `valid` flag.** Clean files are
not omitted. Do not write code that infers cleanliness from absence.

**`file` is echoed verbatim** — not resolved, not canonicalized, not relabelled.
If you pass a relative path you get that relative path back. Callers validating
in-memory content therefore own their own temp-path → handle mapping; the CLI has
no label or alias channel, so `file` has exactly one meaning.

**Output is deterministic.** Results are ordered by path, diagnostics by
`(partUri, xpath, id, description)`, all ordinal. The same inputs in a different
argument order produce byte-identical stdout.

**A package that will not open is a finding, not a crash.** It becomes a
`PackageOpenError` diagnostic on that file, the rest of the batch is still
validated, and the exit code is `1`. A path that names nothing readable is a
different thing entirely and exits `2`.

Errors are capped at 1000 per file.

### Batching

Pass `--files-from <path>` to read newline-delimited paths from a file, or
`--files-from -` to read them from stdin. It composes with explicit path
arguments. This is how large corpora are validated without hitting `ARG_MAX`;
duplicate paths collapse to one result.

### Conformance target

Validation runs against **Microsoft 365** conformance by default, pinned by this
package rather than inherited from any CLI or SDK default.

That is the *strongest* available check, not merely the newest. The SDK's
per-version schemas differ in how much markup they model, so an older target
skips newer constructs rather than rejecting them — error count is monotonically
non-decreasing as the target version rises, and validating lower can only lose
coverage. Override with `FILE_FORMATS` if you specifically need to know how an
older Office version sees a document.

## Environment

| Variable | Effect |
|---|---|
| `OOXML_VALIDATE_BIN` | Use this binary instead of resolving one. For bisecting against another build. |
| `OOXML_VALIDATE_NO_BATCH` | Disable batching, so a failure pins to one input. |
| `OOXML_VALIDATE_CACHE_DIR` | Override where downloaded binaries are cached. |
| `OOXML_VALIDATE_NO_DOWNLOAD` | Never fetch; fail if the binary is not already cached. |
| `OOXML_VALIDATE_FROM_SOURCE` | Build the oracle from source. Needs a .NET SDK and a checkout of this repo. |
| `OOXML_VALIDATE_SKIP_ATTESTATION` | Accept the checksum alone when provenance cannot be verified. |
| `CI` | Makes an unobtainable binary a hard error instead of a one-line notice. |

`validatorAvailable()` is the gate to build `skipIf` on. Under `CI` an
unobtainable binary throws, because a silently-skipped schema suite is green
while proving nothing and obtaining the binary is part of the job. Locally it
writes one notice to stderr and returns `false`.

## Versioning

**The npm version and the binary version are the same number, deliberately.**
The package always fetches the binary release matching its own version; there is
no separate `binaryVersion` field and no resolution matrix. The cost is real — a
TypeScript-only fix re-releases five binaries, and a rebuilt binary forces an npm
bump — and it is accepted in exchange for never having a package and a binary
that disagree about the report contract.

This is exactly the kind of invariant that quietly stops being true. If a
`binaryVersion` split ever happens it will be a deliberate, documented change,
not drift.

## Project status

Public, supported, issues open and triaged.

What is **not** promised before 1.0 is a frozen contract: the JSON report shape,
the exit codes and the TypeScript types may change. Every such change gets a
CHANGELOG entry and a version bump — it will not happen quietly — but pin
accordingly if you depend on the report shape.

## Verify a checkout

```sh
pnpm install
pnpm run verify        # lint + typecheck + tests
```

The .NET half needs an SDK (see `global.json`) and has its own gates:

```sh
pnpm run oracle:build
pnpm run oracle:test
```

## Prior art

The .NET validator wraps Microsoft's MIT-licensed [Open XML SDK][sdk], which
does the actual schema validation.

Credit to [`mikeebowen/OOXML-Validator`][prior] for prior art in this space, and
for working out several of the platform-install details a self-contained .NET
binary needs. This project is an independent implementation on its own path — no
code is shared, the report contract and exit-code behaviour differ on purpose,
and it is not a fork, successor or drop-in replacement.

## License

MIT

[sdk]: https://github.com/dotnet/Open-XML-SDK
[prior]: https://github.com/mikeebowen/OOXML-Validator
