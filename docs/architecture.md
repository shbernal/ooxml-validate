---
doc-schema-version: 1
title: "Architecture"
summary: "How ooxml-validate is structured and where major responsibilities live."
read_when:
  - Changing module boundaries
  - Explaining architecture or ownership decisions
  - Reviewing whether a new feature belongs in the current structure
doc_type: "architecture"
---

# Architecture

Two halves that meet at a JSON report and a set of exit codes.

## Responsibilities

| Directory | Owns |
|---|---|
| `oracle/` | The .NET CLI. Takes paths, emits the JSON report, sets the exit code. In this repo it is the product, not a tool beside it. |
| `oracle.tests/` | xunit tests for the oracle's contract. |
| `src/` | The Node package: binary resolution, batching, buffer/temp-file handling, the public TypeScript API. |
| `fixtures/` | The shared corpus and the committed diagnostic snapshot. |
| `test/` | Node tests for the TypeScript half. |
| `scripts/` | Repo tooling — hooks, docs. |

## Boundaries

**The oracle is dumb about identity.** It echoes the path it was given, and
nothing else. It has no notion of labels, aliases or caller handles. When
`validateBuffer` writes an in-memory package to a temp file, the report comes
back naming that temp path — a path the caller has never seen — and the
*package*, not the oracle, rewrites it via a `Map<tempPath, handle>` held for the
lifetime of the call.

This boundary is deliberate. A label channel in the CLI contract would exist
solely for one consumer's in-memory decks, and every future transport would have
to honour it. Keeping it in the package means one meaning for `file` on the wire.

**Correlation is by path, never by position.** Results come back ordered by the
oracle, not by submission order. A result whose path is not in the map is a hard
internal error, not an entry to drop quietly.

**Every input appears in the report, with an explicit `valid` flag.** Clean files
are not omitted. The predecessor this replaces omitted them, so consumers
inferred cleanliness from absence — safe only as long as an empirical property of
that tool's directory mode held. Explicit is strictly better; do not reintroduce
the inference anywhere.

**Exit codes distinguish "clean" from "never checked":** `0` all clean, `1`
validation errors found, `2` the tool could not run. Diagnostics go to stdout as
JSON, tool failures to stderr as text. The failure this replaces caught every
exception, printed it to stdout, and exited `0`.

**Conformance target is pinned by the package, never inherited.** Microsoft 365,
which is the strongest check available — the SDK's per-version schemas differ in
how much markup they model, so an older target skips newer constructs rather than
rejecting them, and error count is monotonically non-decreasing as the target
rises. Validating lower can only lose coverage.

**One version number.** The npm version *is* the binary version. See the
"Versioning" section of `README.md`.

**Distribution is prebuilt binaries with a source-build fallback.** Consumers get
a self-contained binary downloaded on first use — never on `postinstall`, which
would make the package hostile in CI and offline. The source-build path exists
for people editing the oracle, not for normal use.

## Data And Control Flow

```
caller ──▶ validate() / validateBuffer(s)()
              │
              ├─ resolve binary:  env override → cache → source build → fail
              ├─ batch:           queue drains through --files-from, MAX_BATCH=32,
              │                   at most one child process per Node process
              ├─ spawn oracle ──▶ JSON report on stdout, exit 0/1/2
              └─ rewrite `file` through the temp-path map, return
```

## Extension Points

- `FILE_FORMATS` — validate against a different conformance target.
- `OOXML_VALIDATE_BIN` — point at another build, for bisecting.
- `OOXML_VALIDATE_NO_BATCH` — pin a failure to a single input.

## Deliberately Not Here

**A long-lived server mode.** Batching already amortizes the ~0.40 s process
startup. A persistent NDJSON process would remove it entirely, but adds a
protocol, a lifecycle and crash recovery. Deferred, not rejected.
