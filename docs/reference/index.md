---
doc-schema-version: 1
title: "Reference"
summary: "Stable commands, configuration, APIs, and generated references for ooxml-validator."
read_when:
  - Looking up command, config, or API details
  - Adding a reference page
  - Verifying docs against exported contracts
doc_type: "reference"
---

# Reference

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Installs deps and the git hooks. |
| `pnpm run verify` | Lint + typecheck + tests. The gate. |
| `pnpm run lint` / `lint:fix` | Biome, over `src/`, `scripts/`, `test/`. |
| `pnpm run typecheck` | `tsc --noEmit`, source and harness configs. |
| `pnpm test` | `node --test`. Oracle-dependent tests skip without a binary. |
| `pnpm run test:integration` | Builds the oracle, then runs the whole suite against it. |
| `pnpm run build` | Emits `dist/`. |
| `pnpm run oracle:build` | `dotnet build`. Needs an SDK matching `global.json`. |
| `pnpm run oracle:test` | `dotnet test`. |
| `pnpm run docs:check` | Validates docs frontmatter and navigation. |

## Exit codes

Part of the contract, not an implementation detail.

| Code | Meaning |
|---|---|
| `0` | Every input validated clean. |
| `1` | Validation errors were found. |
| `2` | The tool could not run — bad arguments, unreadable file, crash. |

Diagnostics go to stdout as JSON. Tool failures go to stderr as text.

## Environment

| Variable | Effect |
|---|---|
| `OOXML_VALIDATOR_BIN` | Use this binary instead of resolving one. |
| `OOXML_VALIDATOR_NO_BATCH` | Disable batching, so a failure pins to one input. |
| `OOXML_VALIDATOR_CACHE_DIR` | Override the download cache location. |
| `OOXML_VALIDATOR_NO_DOWNLOAD` | Never fetch; fail if not already cached. |
| `OOXML_VALIDATOR_FROM_SOURCE` | Build the oracle from source. Needs an SDK and a checkout. |
| `OOXML_VALIDATOR_SKIP_ATTESTATION` | Accept the checksum alone when provenance cannot be verified. |
| `OOXML_VALIDATOR_UPDATE_SNAPSHOT` | Re-record the fixture diagnostic snapshot. |
| `CI` | Makes an unobtainable binary a hard error rather than a one-line notice. |
| `DOTNET_BUNDLE_EXTRACT_BASE_DIR` | Where the single-file binary self-extracts. Defaulted by the package. |

## Binary resolution

Order: `OOXML_VALIDATOR_BIN` → cached download → download → source build (opt-in)
→ fail with an actionable message.

Nothing happens at install time. A package that reaches the network from a
`postinstall` hook is hostile in CI and unusable offline, so the first call that
needs the validator is the one that pays for it. The download is verified twice —
SHA-256 against `SHA256SUMS`, and GitHub build provenance via
`gh attestation verify` — and the cache is written only after both pass, so a
binary present in the cache is a binary that was verified.

Provenance verification **fails closed**: if `gh` is absent or cannot reach the
attestation API, resolution throws rather than falling back to the checksum
alone. "Could not check" and "checked and it was fine" must not produce the same
outcome. `OOXML_VALIDATOR_SKIP_ATTESTATION` is the documented way out.

Archives are `.tar.gz` on every platform, Windows included: tar preserves the
executable bit that zip loses, and Windows 10 1803+ ships `tar.exe`, so one
extraction path covers all five targets with no dependency.

## Conformance targets

`FILE_FORMATS` lists the Open XML SDK's conformance targets. `FILE_FORMAT` is the
package's pinned default, `Microsoft365` — the strongest available check, never
inherited from a CLI or SDK default. See [Architecture](../architecture.md).

## Version constants

`PACKAGE_NAME`, `PACKAGE_VERSION`, `RELEASE_TAG` — read from `package.json` at
runtime, never baked in. `RELEASE_TAG` is the GitHub release binary resolution
asks for, so it and `PACKAGE_VERSION` are the same number by construction.

## Report shape

Frozen by the oracle and documented in full in `README.md`. In short:
`{format, sdkVersion, results[{file, valid, errors[{id, type, description,
partUri, xpath}]}]}`.

Every input file appears with an explicit `valid` flag; clean files are not
omitted. `file` is echoed verbatim. Output is deterministic. Diagnostics are
capped at 1000 per file. `type` is one of `Schema`, `Semantic`,
`MarkupCompatibility`, `Package`.

The TypeScript `ValidationReport` / `ValidationResult` / `ValidationDiagnostic`
types mirror this exactly and land with the Node package.

Until 1.0 this shape may change. Every change gets a CHANGELOG entry and a
version bump.

## Oracle CLI

```
ooxml-validator [--format <FileFormatVersions>] [--files-from <path|->] [<file> ...]
ooxml-validator --version
```

`--files-from` reads newline-delimited paths, `-` meaning stdin, and composes
with explicit path arguments. `--version` prints `{tool, sdkVersion}` as JSON.
