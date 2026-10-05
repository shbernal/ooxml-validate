# AGENTS.md

Working notes for agents and contributors in this repo. `README.md` is the
consumer-facing document; this one is about how the repo is built and what it is
easy to get wrong.

## Pre-1.0

The project is released (GitHub Releases + npm) but pre-1.0. The README promises
no frozen contract before 1.0: the JSON report shape, the exit codes and the
TypeScript types may change.

- Breaking changes are allowed, but never quietly: each one gets a CHANGELOG
  entry and a version bump.
- Do not add compatibility shims or deprecation paths unless explicitly asked.
- Do not defer to prior architecture when it conflicts with the current goal.
- Existing code, docs and plans are context, not constraints.
- Prefer the simplest coherent architecture for the current direction.

## Releasing

1. Set `version` in `package.json`, move `[Unreleased]` in `CHANGELOG.md` under
   the new version, commit as `chore: release X.Y.Z`.
2. `git tag vX.Y.Z && git push origin main vX.Y.Z`.

The tag triggers `.github/workflows/publish.yml`: the lock-file and snapshot
gate, five platform binaries, a GitHub Release with `SHA256SUMS` and provenance,
then the npm publish. A hyphenated tag (`v0.1.0-rc.1`) is a pre-release and goes
to npm under `next`. Rehearse without writing anything with
`gh workflow run publish.yml -f tag=vX.Y.Z -f dry_run=true`.

The tag must equal `package.json`'s version or the build fails. Never rename
`publish.yml`: npm's trusted-publisher config names the file, and a rename
surfaces as a misleading 404 on the next publish.

## What this repo is

One shared OOXML validation oracle. Projects that each carry their own validator
wrapper drift onto different Open XML SDK versions and end up validating against
*different rule sets*. Removing that divergence is the reason this project
exists — which means the single pin below is the point, not an implementation
detail.

This is a public repo, independent of any project that consumes it. Do not name
specific consumers in code, docs, comments or commit messages; say "consumers".

## Layout

```
src/          TypeScript package — binary resolution, batching, the public API
oracle/       The .NET CLI. In this repo it is the product, not a tool beside it
oracle.tests/ xunit tests for the oracle
fixtures/     Shared corpus + the committed diagnostic snapshot
docs/         Architecture, the SDK pin, reference, troubleshooting
test/         Node tests for the TS half
scripts/      Repo tooling
```

## Commands

```sh
pnpm install           # also installs git hooks (lefthook)
pnpm run verify        # lint + typecheck + test — the gate
pnpm run lint          # biome
pnpm run typecheck     # tsc --noEmit, src and harness
pnpm test              # node --test
pnpm run build         # tsc -> dist/
pnpm run oracle:build  # dotnet build (needs an SDK)
pnpm run oracle:test   # dotnet test
pnpm run oracle:snapshot   # re-record fixtures/diagnostics.snapshot.json
pnpm run test:integration  # build the oracle, run the Node suite against it
```

`pnpm run verify` is the Node gate: the pre-push hook runs it, and so does CI's
`node` job, so it has one definition, in `package.json`. CI also has jobs the
hook cannot mirror: `oracle` (locked restore, xunit, snapshot), `integration`
(Node suite against a source-built oracle) and `released` (download and verify
the published binary for the current version).

## Conventions

- ESM only, `"type": "module"`, Node >= 24. `@types/node` is held at the same
  major as that floor (a Renovate rule enforces it), so `tsc` rejects APIs a
  supported runtime lacks. `engines.node`, `.nvmrc` and the `@types/node` major
  move together or not at all.
- Node 24 runs the `.ts` sources directly via type-stripping, so there is **no
  build step in the dev loop**. Relative imports therefore carry a `.ts`
  extension; `rewriteRelativeImportExtensions` turns them into `.js` on the way
  into `dist/`. `erasableSyntaxOnly` is on so tsc rejects the syntax
  type-stripping cannot handle (enums, namespaces, parameter properties) at the
  gate rather than at runtime.
- Biome owns formatting and linting for `src/`, `scripts/`, `test/`. The C# half
  follows .NET convention via `.editorconfig`.
- `author` metadata is `shbernal`.

## Things that are easy to get wrong

**The report contract is explicit, never inferential.** Every input file appears
in the report with a `valid` flag. Never write code — here or in a consumer —
that treats an absent entry as a clean file.

**Exit codes carry meaning: `0` clean, `1` errors found, `2` could not run.** The
failure mode this replaces is a validator that caught every exception, printed it
to stdout and exited `0`, making a corrupt file indistinguishable from a clean
one. Do not catch broadly and return success.

**The oracle echoes the path it was given.** It does not know about labels,
aliases or handles. `validateBuffer` writes a temp file, so the path in the
report is one the caller never saw; the *package* keeps a temp-path → handle map
and rewrites `file` before returning. Correlation is by path, never by array
position — results are ordered by the oracle, not by submission order.

**The npm version and the binary version are one number.** See README. If you
change one, change the other.

**`DocumentFormat.OpenXml` is pinned in exactly one place, and a bump moves every
consumer's baseline at once.** That is why `oracle/packages.lock.json` and
the `--locked-mode` restores in CI and the release are non-optional, why this repo carries its own fixture
corpus and a committed diagnostic snapshot, and why a bump PR must show the
snapshot delta in its own diff. A bump whose snapshot change nobody read is the
failure this whole arrangement is designed to make impossible.

**The gate has no oracle, so the Node half is tested against a fake one.**
`test/fake-oracle.ts` is an executable script that speaks the CLI contract and is
selected through `OOXML_VALIDATE_BIN`; `FAKE_ORACLE_MODE` scripts its failures.
Code in `src/` that only the real-oracle suites reach is code the pre-push hook
never runs — give it a fake-oracle test. The script must keep its executable bit.

**Diagnostics get baselined, never suppressed.** When an SDK bump surfaces new
errors in a consumer, the answer is to record them and file them — not to filter
them out here.

## Scratch

`.tmp/` is the throwaway directory: probes, dumps, downloaded archives. Anything
there is regenerable and never committed. Do not scatter scratch files elsewhere
in the tree.
