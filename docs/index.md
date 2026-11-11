---
doc-schema-version: 1
title: "ooxml-validate"
summary: "Start here for the purpose, setup, and main workflows in ooxml-validate."
read_when:
  - Getting oriented in this project
  - Updating the main project overview
doc_type: "overview"
---

# ooxml-validate

One shared OOXML validation oracle: a .NET CLI wrapping Microsoft's Open XML SDK
schema validator, plus a Node package that resolves, runs and batches it.

## What This Project Does

It validates `.pptx` / `.xlsx` / `.docx` packages against the Open XML SDK's
schema validator and reports the diagnostics as JSON.

It exists because projects that each carry their own validator wrapper drift onto
*different* Open XML SDK versions, and so validate their output against different
rule sets. This repo is the single place
that pin lives. Everything else here follows from that: the fixture corpus, the
committed diagnostic snapshot, and the guardrail on bumping the SDK.

It does **not** own: fixing the defects it surfaces (that belongs to whichever
consumer wrote the bad markup), rendering, repair, or any opinion about whether a
document is *good* — only whether it is schema-valid.

## Quickstart

```sh
pnpm install
pnpm run verify
```

`verify` is lint + typecheck + tests, and needs no .NET SDK. The .NET half does:

```sh
pnpm run oracle:build
pnpm run oracle:test
```

The SDK version is pinned in `global.json`; install a matching one before
touching `oracle/`.

## Main Workflows

| Task | Start at |
|---|---|
| Understand the layout and the invariants | [Architecture](architecture.md) |
| Bump `DocumentFormat.OpenXml` | [The SDK pin](sdk-pin.md) |
| Look up the report shape, exit codes, env vars | [Reference](reference/index.md) |
| Diagnose a failure | [Troubleshooting](troubleshooting.md) |
| Cut a release | "Releasing" in `AGENTS.md` |

## Verification

```sh
pnpm run verify
```

That is the same command the pre-push hook and CI's `node` job run. CI also
gates the .NET half and the two halves together; see `.github/workflows/ci.yml`.
