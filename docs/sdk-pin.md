---
doc-schema-version: 1
title: "The SDK pin"
summary: "Why DocumentFormat.OpenXml is pinned in one place, and what a bump requires."
read_when:
  - Bumping DocumentFormat.OpenXml or the .NET target
  - Reviewing a Renovate PR labelled baseline-moving
  - Wondering why the fixture corpus and diagnostic snapshot are committed
doc_type: "reference"
---

# The SDK pin

## The pin

| | Value | Where |
|---|---|---|
| .NET target | `net10.0` | `oracle/OoxmlValidator.csproj` |
| SDK toolchain | `10.0.100` | `global.json` |
| `DocumentFormat.OpenXml` | see the csproj | `oracle/OoxmlValidator.csproj` |
| Transitive closure | locked | `oracle/packages.lock.json` + `RestoreLockedMode` |

`RestoreLockedMode` is not optional. Without it the lock file is a suggestion,
and a transitive bump can move the validation baseline with nothing in any diff
to show for it.

## Why it is centralized

Before this repo, `ts-pptx` and `ts-xlsx` each carried their own validator: one
on Open XML SDK 3.2.0, the other on 3.5.1. They therefore validated their output
against *different rule sets*, which is the defect this project exists to remove.

Centralizing the pin also centralizes the blast radius. A bump here silently
moves both consumers' baselines at once. That is the trade, and the rest of this
page is how the trade is made safe.

## What a bump requires

The corpus and the snapshot in `fixtures/` exist for exactly this. They make the
effect of a bump visible in the bump's own diff instead of surfacing weeks later
as a mystery failure in a consumer repo.

1. Bump the version in `oracle/OoxmlValidator.csproj`.
2. Regenerate `oracle/packages.lock.json`.
3. Regenerate the diagnostic snapshot over `fixtures/`.
4. **Read the snapshot delta.** Every changed diagnostic needs a verdict: a real
   defect in a consumer's writer, or a stricter/changed rule. Record the verdict
   in the PR.
5. Merge only once the delta is accounted for.

CI runs steps 3 and 5's check; step 4 is a human. Renovate labels these PRs
`baseline-moving` and never groups or automerges them, so they cannot ride along
in a batch nobody reads closely.

## The rule that is not negotiable

**Diagnostics get baselined, never suppressed.** When a bump surfaces new errors
in a consumer, the answer is to record them and file them against that consumer —
never to filter them out here. A validator with an exclusion list is a validator
that will eventually be wrong in the direction nobody checks.

Fixing the surfaced defects is separate work on the consumer's own schedule. The
bump does not wait for it.
