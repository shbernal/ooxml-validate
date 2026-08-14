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
| `pnpm test` | `node --test`. |
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
| `CI` | Makes a missing binary a hard error rather than a one-line notice. |
| `DOTNET_BUNDLE_EXTRACT_BASE_DIR` | Where the single-file binary self-extracts. Defaulted by the package. |

## Conformance targets

`FILE_FORMATS` lists the Open XML SDK's conformance targets. `FILE_FORMAT` is the
package's pinned default, `Microsoft365` — the strongest available check, never
inherited from a CLI or SDK default. See [Architecture](../architecture.md).

## Version constants

`PACKAGE_NAME`, `PACKAGE_VERSION`, `RELEASE_TAG` — read from `package.json` at
runtime, never baked in. `RELEASE_TAG` is the GitHub release binary resolution
asks for, so it and `PACKAGE_VERSION` are the same number by construction.

## Report shape

Every input file appears with an explicit `valid` flag; clean files are not
omitted. The full JSON schema and the `ValidationReport` / `ValidationResult` /
`ValidationDiagnostic` types land with the oracle and are documented here then.

Until 1.0 this shape may change. Every change gets a CHANGELOG entry and a
version bump.
