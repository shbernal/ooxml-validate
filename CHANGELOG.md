# Changelog

All notable changes to `ooxml-validator` are recorded here.

Before 1.0 the JSON report shape, the exit codes and the TypeScript types may
change. Every such change appears here, with a version bump — it will not happen
quietly. Pin accordingly if you depend on the report shape.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- An `ooxml-validator` CLI.
