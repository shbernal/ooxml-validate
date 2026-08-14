# ooxml-validator

Validate OOXML documents — `.pptx`, `.xlsx`, `.docx` and friends — against
Microsoft's [Open XML SDK][sdk] schema validator, from Node.

```js
import {validate, validateBuffer} from 'ooxml-validator';

const report = await validate(['deck.pptx', 'book.xlsx']);
for (const result of report.results) {
  if (!result.valid) console.error(result.file, result.diagnostics);
}
```

The schema validator itself is .NET. This package ships a small self-contained
CLI around it and downloads the right prebuilt binary for your platform on first
use, so **consumers do not need a .NET SDK installed**.

- **Package**: `ooxml-validator` on npm (unscoped).
- **Repo**: `shbernal/ooxml-validate`. The name mismatch is deliberate.

## Install

```sh
pnpm add -D ooxml-validator
```

Nothing is downloaded at install time. The first call that actually needs the
validator fetches a ~110 MB self-contained binary into
`~/.cache/ooxml-validator/<version>/`, verifies its checksum and its GitHub build
provenance attestation, and reuses it from then on. Reinstalls and multiple
checkouts share one cache entry.

Supported platforms: `linux-x64`, `linux-arm64`, `osx-x64`, `osx-arm64`,
`win-x64`.

## Use

As a library:

| Export | What it does |
|---|---|
| `validate(paths, opts?)` | Validate files on disk. |
| `validateBuffer(buf, {ext, format})` | Validate an in-memory package. |
| `validateBuffers(bufs, opts?)` | Batch form of the above. |
| `validatorAvailable()` | Whether the binary can be resolved. |
| `FILE_FORMATS` / `FILE_FORMAT` | Conformance targets, and the pinned default. |

As a CLI:

```sh
pnpm exec ooxml-validator deck.pptx
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

**Every input file appears in the report**, each with an explicit `valid` flag.
Clean files are not omitted. Do not write code that infers cleanliness from
absence.

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
| `OOXML_VALIDATOR_BIN` | Use this binary instead of resolving one. For bisecting against another build. |
| `OOXML_VALIDATOR_NO_BATCH` | Disable batching, so a failure pins to one input. |
| `CI` | Makes a missing binary a hard error instead of a one-line notice. |

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
