---
doc-schema-version: 1
title: "Troubleshooting"
summary: "Observable symptoms, checks, causes, and fixes for ooxml-validate."
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

## The binary downloads locally but the same step fails in CI

**Symptom.** First use works on a laptop and fails on a runner, in the
attestation check rather than the download.

**Cause.** The archive's build provenance is verified with `gh attestation
verify`, which needs a token to query GitHub's attestation API, and the check
fails closed by design.

**Fix.** Put `GH_TOKEN: ${{ github.token }}` on the step that first resolves the
binary — see "In CI" in `README.md`. `OOXML_VALIDATE_SKIP_ATTESTATION` exists for
environments with genuinely no route to that API; reaching for it because a token
is missing trades a real supply-chain check for a saved line of YAML.

## `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`, naming a version you are not installing

**Symptom.** `pnpm add -D ooxml-validate@<new>` is refused for being too fresh,
and the version pnpm names in the error is the *older* one already installed.

**Cause.** The policy is checked against the lockfile before the new resolution
lands, so an exclusion written as `ooxml-validate@<old>` covers the version being
replaced and nothing else. Every bump then has to edit the exclusion in the same
breath, and until it does, the entry protects the wrong version.

**Fix.** Exclude by bare package name in `pnpm-workspace.yaml`. Also worth knowing
that `pnpm config get minimumReleaseAge` reports `undefined` while pnpm enforces
1440 minutes, so the policy is invisible until it fires.

## Git hooks did not install

**Symptom.** Commits and pushes run no checks.

**Check.** `git config --get core.hooksPath`.

**Cause.** If it points outside this repo, `scripts/install-hooks.ts` reports that
and deliberately leaves it alone rather than forcing lefthook's wrappers into a
machine-wide hooks directory and renaming whatever stood there.

**Fix.** Unset it, or just run `pnpm run verify` yourself before pushing. Hooks
mirror CI; CI is the actual gate.
