# Changelog

All notable changes to `ooxml-validate` are recorded here.

Before 1.0 the JSON report shape, the exit codes and the TypeScript types may
change. Every such change appears here, with a version bump — it will not happen
quietly. Pin accordingly if you depend on the report shape.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Report shape:** every result carries `truncated`, `true` when the
  1000-per-file diagnostic cap dropped some. A file at the cap and a file with
  forty thousand diagnostics used to be indistinguishable, and a capped list
  baselined as complete loses entries on SDK bumps that fixed nothing. The
  diagnostic snapshot gains `"truncated": false` on every entry and nothing else.

### Added

- `OOXML_VALIDATE_TIMEOUT_MS` bounds each oracle invocation (default two
  minutes). A child that runs past it is killed with SIGKILL and the call rejects
  with an error naming the file.
- A package whose zip directory declares more than 512 MiB uncompressed is
  refused without being opened, with a `PackageTooLarge` diagnostic of the new
  type `Limit`. A 2 MB package inflating to 2 GB used to drive the oracle past
  4 GB of RSS.
- The oracle now runs under a 3 GiB managed-heap ceiling, from both the API and
  the `ooxml-validate` command. A package that inflates past what it declares
  fails as a `PackageOpenError` on that one file rather than getting the whole
  process OOM-killed. An existing `DOTNET_GCHeapHardLimit` is respected.

### Fixed

- `probeFormats` given the same path twice returned one row with two counts per
  format, so `counts` no longer lined up with `formats`. Repeated paths now
  collapse to one row, and a result for a path that was not submitted is an error
  rather than silently dropped.
- `validateBuffers` no longer deletes its temp files while some of its inputs are
  still queued. When one input failed, its siblings' files used to vanish before
  they were read, failing the batch they shared with other callers and sending
  everyone in it through the slow one-file-per-process retry.
- An oracle process that never exited used to hang its caller and every later
  call in the same Node process, since the queue runs one invocation at a time.
  It is now killed at the time limit, and the queue carries on. The stdout cap
  also kills with SIGKILL now, so a child ignoring SIGTERM cannot outlast it.
- `validate()` rejects a path containing a line break with an error naming it.
  The path list travels one path per line, so such a path used to arrive as two:
  either a failure blamed on a fragment nobody submitted, or two other files
  validated in its place. The other files in the same batch are unaffected.

## [0.0.3] — 2026-08-15

### Fixed

- A bare `--` now ends the options rather than failing with `Unknown option: --`.
  Everything after it is treated as a path, even if it is spelled like a flag.
  Package managers forward the separator when the CLI is run through a script, so
  `pnpm run validate:ooxml -- book.xlsx` — the habitual spelling — used to be the
  one that did not work. The alternative was a wrapper script in every consumer
  repo to shift it off, which is the divergence this package exists to remove.

## [0.0.2] — 2026-08-15

No functional change; the code is identical to 0.0.1.

It exists to exercise the automated release path end to end, which 0.0.1 could
not: npm's trusted publishing needs the package to already exist on the registry
before a publisher can be configured for it, so the first publish had to be a
manual one. This is the first release cut entirely by the workflow — binaries,
checksums, provenance and the npm publish.

## [0.0.1] — 2026-08-15

First release. Deliberately a small version number: the contract is not frozen,
and this exists so the download, checksum and attestation paths get exercised by
a real install rather than by a local link.

### Added

- The .NET oracle: validates `.pptx`, `.xlsx`, `.docx` and their macro-enabled and
  template variants against the Open XML SDK's schema validator, pinned to
  `DocumentFormat.OpenXml` 3.5.1 on `net10.0`.
- Exit codes `0` clean / `1` errors found / `2` could not run, with diagnostics on
  stdout as JSON and tool failures on stderr.
- `--files-from <path|->` for batching without hitting `ARG_MAX`, and `--version`
  reporting both the tool and the Open XML SDK it links.
- The Node package: `validate`, `validateBuffer`, `validateBuffers`,
  `validatorAvailable`, `probeFormats`, `oracleVersion`, `FILE_FORMAT` /
  `FILE_FORMATS`, and the report types.
- Lazy binary resolution with checksum and GitHub build provenance verification,
  a shared cache outside the package directory, and an opt-in source build.
- Batching that holds the process to one validator child at a time.
- An `ooxml-validate` CLI.
