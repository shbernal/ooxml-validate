---
doc-schema-version: 1
title: "Troubleshooting"
summary: "Observable symptoms, checks, causes, and fixes for ooxml-validator."
read_when:
  - Debugging a user-visible failure
  - Adding recovery guidance
  - Explaining known failure signatures
doc_type: "troubleshooting"
---

# Troubleshooting

Add a signature here the first time it costs someone more than a few minutes.

## `dotnet` commands fail or target the wrong SDK

**Symptom.** `pnpm run oracle:build` reports a missing SDK, or resolves a version
other than the one in `global.json`.

**Check.** `dotnet --list-sdks`. A .NET *runtime* is not an SDK; having the
runtime installed is enough to run the built binary and not enough to build it.

**Fix.** Install an SDK satisfying `global.json` (`10.0.100`, rolling forward on
feature band). The TypeScript half — `pnpm run verify` — needs no SDK at all, so
this only blocks work inside `oracle/`.

## A restore changes `packages.lock.json`

**Symptom.** `dotnet build` or `dotnet restore` rewrites the lock file.

**Cause.** `RestoreLockedMode` was bypassed, or a dependency version changed.

**Fix.** Do not commit the rewrite on its own. A moved lock file moves the
validation baseline for every consumer — it belongs in a deliberate bump with the
diagnostic snapshot delta beside it. See [The SDK pin](sdk-pin.md).

## Git hooks did not install

**Symptom.** Commits and pushes run no checks.

**Check.** `git config --get core.hooksPath`.

**Cause.** If it points outside this repo, `scripts/install-hooks.ts` reports that
and deliberately leaves it alone rather than forcing lefthook's wrappers into a
machine-wide hooks directory and renaming whatever stood there.

**Fix.** Unset it, or just run `pnpm run verify` yourself before pushing. Hooks
mirror CI; CI is the actual gate.
