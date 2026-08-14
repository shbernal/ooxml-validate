# AGENTS.md

Working notes for agents and contributors in this repo. `README.md` is the
consumer-facing document; this one is about how the repo is built and what it is
easy to get wrong.

## Pre-release

This project has no GitHub release yet.

- Treat it as pre-release and free to change.
- Do not preserve backwards compatibility unless explicitly asked for.
- Do not defer to prior architecture when it conflicts with the current goal.
- Existing code, docs and plans are context, not constraints.
- Prefer the simplest coherent architecture for the current direction.

Once a release exists, compatibility and migration become real constraints and
must be evaluated before breaking changes.

## What this repo is

One shared OOXML validation oracle, used by both `~/Work/ts-pptx` and
`~/Work/ts-xlsx`. Those two repos each carried their own divergent validator
pinned to different Open XML SDK versions, so they validated against *different
rule sets*. Removing that divergence is the reason this project exists — which
means the single pin below is the point, not an implementation detail.

## Layout

```
src/          TypeScript package — binary resolution, batching, the public API
oracle/       The .NET CLI. In this repo it is the product, not a tool beside it
oracle.tests/ xunit tests for the oracle
fixtures/     Shared corpus + the committed diagnostic snapshot
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
```

`pnpm run verify` is what the pre-push hook and CI both run. There is one
definition of "everything" and it lives in `package.json`.

## Conventions

- ESM only, `"type": "module"`, Node >= 24.
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

**`DocumentFormat.OpenXml` is pinned in exactly one place, and a bump moves both
consumers' baselines at once.** That is why `oracle/packages.lock.json` +
`RestoreLockedMode` are non-optional, why this repo carries its own fixture
corpus and a committed diagnostic snapshot, and why a bump PR must show the
snapshot delta in its own diff. A bump whose snapshot change nobody read is the
failure this whole arrangement is designed to make impossible.

**Diagnostics get baselined, never suppressed.** When an SDK bump surfaces new
errors in a consumer, the answer is to record them and file them — not to filter
them out here.

## Scratch

`.tmp/` is the throwaway directory: probes, dumps, downloaded archives. Anything
there is regenerable and never committed. Do not scatter scratch files elsewhere
in the tree.
