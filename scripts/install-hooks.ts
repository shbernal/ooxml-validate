// Installs the lefthook git hooks declared in lefthook.yml. Run automatically by
// package.json's `prepare` script on every `pnpm install`.
//
// Three things this does that `lefthook install` alone does not:
//
//  1. It is a no-op outside a git work tree, so `npm pack`, a CI `--frozen-lockfile`
//     install from a tarball, or a vendored checkout does not fail on a missing .git.
//  2. It steps around a `core.hooksPath` that points outside this repo. Some people
//     route hooks through a global directory; lefthook would either fail or silently
//     write hooks nothing reads. Report it and move on rather than fighting it.
//  3. It runs lefthook's own bin entry directly instead of through `pnpm exec`,
//     which re-verifies the whole dependency tree before the tool sees an argument.
//
// Failure here is never fatal: hooks are a convenience that mirrors CI, and CI is the
// actual gate. A contributor with no hooks still gets caught on the PR.

import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {relative, resolve} from 'node:path';

const require = createRequire(import.meta.url);

function note(message: string): void {
  process.stderr.write(`install-hooks: ${message}\n`);
}

function gitConfig(key: string): string | undefined {
  try {
    return execFileSync('git', ['config', '--get', key], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function main(): void {
  if (process.env.LEFTHOOK === '0') {
    note('LEFTHOOK=0, skipping.');
    return;
  }

  let repoRoot: string;
  try {
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    note('not a git work tree, skipping.');
    return;
  }

  const hooksPath = gitConfig('core.hooksPath');
  if (hooksPath) {
    const outside = relative(repoRoot, resolve(repoRoot, hooksPath)).startsWith('..');
    if (outside) {
      note(
        `core.hooksPath is set to ${hooksPath}, outside this repo — leaving it alone. ` +
          'Run `pnpm run verify` yourself, or unset it to get the hooks.',
      );
      return;
    }
  }

  // lefthook's `bin` entry from its own package.json — the file the .bin shim is
  // generated from and would have run, so this is the published contract rather
  // than a reach into the package's internals.
  let lefthookBin: string;
  try {
    const pkgPath = require.resolve('lefthook/package.json');
    const pkg = require('lefthook/package.json') as {bin?: string | Record<string, string>};
    const binField = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.lefthook;
    if (!binField) throw new Error('lefthook package.json has no usable `bin` entry');
    lefthookBin = resolve(pkgPath, '..', binField);
  } catch (error) {
    note(`could not resolve lefthook (${String(error)}); skipping hook install.`);
    return;
  }

  if (!existsSync(lefthookBin)) {
    note(`lefthook bin missing at ${lefthookBin}; skipping hook install.`);
    return;
  }

  try {
    execFileSync(process.execPath, [lefthookBin, 'install'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  } catch (error) {
    note(`lefthook install failed (${String(error)}); hooks not installed.`);
  }
}

main();
