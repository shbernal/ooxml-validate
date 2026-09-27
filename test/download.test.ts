import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, describe, test} from 'node:test';

import {downloadBinary, expectedDigest} from '../src/download.ts';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

const SUMS = [
  `${DIGEST_A}  ooxml-validate-linux-x64.tar.gz`,
  `${DIGEST_B}  ooxml-validate-osx-arm64.tar.gz`,
  '',
].join('\n');

test('reads the digest for the requested asset', () => {
  assert.equal(expectedDigest(SUMS, 'ooxml-validate-linux-x64.tar.gz'), DIGEST_A);
  assert.equal(expectedDigest(SUMS, 'ooxml-validate-osx-arm64.tar.gz'), DIGEST_B);
});

test('accepts the binary-mode asterisk sha256sum writes', () => {
  const binaryMode = `${DIGEST_A} *ooxml-validate-win-x64.tar.gz\n`;
  assert.equal(expectedDigest(binaryMode, 'ooxml-validate-win-x64.tar.gz'), DIGEST_A);
});

test('an unlisted asset is a hard failure, not an unchecked pass', () => {
  // "No digest to compare against" must never resolve the same way as "the digest
  // matched" — that is the whole reason the checksum step exists.
  assert.throws(
    () => expectedDigest(SUMS, 'ooxml-validate-win-x64.tar.gz'),
    /not listed in SHA256SUMS/,
  );
});

test('a partial filename match is not a match', () => {
  // Substring matching here would let `...-x64.tar.gz` be satisfied by the digest of
  // `...-arm64.tar.gz`, which is a checksum that passes for the wrong file.
  assert.throws(() => expectedDigest(SUMS, 'linux-x64.tar.gz'), /not listed/);
});

// ---- downloadBinary, against a local release server ---------------------------
//
// Every failure case asserts what is left behind, not only that it threw: the
// promise is that a binary this package could not vouch for never reaches the cache.

const VERSION = '9.9.9';
const PLATFORM = 'linux-x64';
const ASSET = 'ooxml-validate-linux-x64.tar.gz';

const scratch = mkdtempSync(join(tmpdir(), 'download-test-'));

/** A `.tar.gz` holding one executable file under `name`. */
function archive(name: string): Uint8Array {
  const directory = mkdtempSync(join(scratch, 'archive-'));
  mkdirSync(join(directory, 'content'));
  writeFileSync(join(directory, 'content', name), '#!/bin/sh\necho fake\n', {mode: 0o755});
  // Relative paths with cwd, for the same reason src/download.ts extracts that way.
  execFileSync('tar', ['-czf', 'out.tar.gz', '-C', 'content', name], {cwd: directory});
  return new Uint8Array(readFileSync(join(directory, 'out.tar.gz')));
}

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

interface Release {
  readonly archive?: Uint8Array;
  readonly sums?: string;
}

/**
 * Serves one release. Asset URLs answer with a redirect, as GitHub's do, so the real
 * fetch's redirect handling is part of what is exercised.
 */
async function serve(release: Release): Promise<{base: string; close: () => Promise<void>}> {
  const server = createServer((request, response) => {
    const url = request.url ?? '';
    const prefix = `/releases/v${VERSION}/`;
    if (url.startsWith(prefix)) {
      response.writeHead(302, {location: `/blob/${url.slice(prefix.length)}`}).end();
      return;
    }
    if (url === `/blob/${ASSET}` && release.archive) {
      response.writeHead(200).end(release.archive);
      return;
    }
    if (url === '/blob/SHA256SUMS' && release.sums !== undefined) {
      response.writeHead(200).end(release.sums);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}/releases`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Every file under a directory, recursively; empty if it does not exist. */
function filesUnder(directory: string): string[] {
  try {
    return readdirSync(directory, {recursive: true, withFileTypes: true})
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
  } catch {
    return [];
  }
}

async function download(
  release: Release,
  env: Record<string, string | undefined> = {},
): Promise<{cache: string; outcome: Promise<string>}> {
  const cache = mkdtempSync(join(scratch, 'cache-'));
  const saved = {...process.env};
  Object.assign(process.env, {
    OOXML_VALIDATE_CACHE_DIR: cache,
    OOXML_VALIDATE_SKIP_ATTESTATION: '1',
    TMPDIR: scratch,
  });
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const server = await serve(release);
  const outcome = downloadBinary({
    version: VERSION,
    platform: PLATFORM,
    releaseBase: server.base,
    onProgress: () => {},
  });
  // Settle before restoring the environment and closing the server; hand the
  // caller the settled promise to assert on.
  await outcome.catch(() => {});
  await server.close();
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
  return {cache, outcome};
}

/** Staging directories downloadBinary makes under the temp root. */
const staging = (): string[] =>
  readdirSync(scratch).filter((entry) => entry.startsWith('ooxml-validate-dl-'));

describe('downloadBinary', {skip: process.platform === 'win32' && 'needs a POSIX tar'}, () => {
  after(() => {
    rmSync(scratch, {recursive: true, force: true});
  });

  test('a verified archive is cached, executable, at the versioned path', async () => {
    const bytes = archive('ooxml-validate');
    const {cache, outcome} = await download({archive: bytes, sums: `${digest(bytes)}  ${ASSET}\n`});

    const path = await outcome;
    assert.equal(path, join(cache, VERSION, PLATFORM, 'ooxml-validate'));
    accessSync(path, constants.X_OK);
    assert.deepEqual(staging(), []);
  });

  test('a checksum mismatch throws and caches nothing', async () => {
    const bytes = archive('ooxml-validate');
    const {cache, outcome} = await download({
      archive: bytes,
      sums: `${'0'.repeat(64)}  ${ASSET}\n`,
    });

    await assert.rejects(outcome, /checksum mismatch/);
    assert.deepEqual(filesUnder(cache), []);
    assert.deepEqual(staging(), []);
  });

  test('an asset missing from SHA256SUMS throws and caches nothing', async () => {
    const bytes = archive('ooxml-validate');
    const {cache, outcome} = await download({
      archive: bytes,
      sums: `${digest(bytes)}  other.tar.gz\n`,
    });

    await assert.rejects(outcome, /not listed in SHA256SUMS/);
    assert.deepEqual(filesUnder(cache), []);
  });

  test('a missing archive or SHA256SUMS throws and caches nothing', async () => {
    const bytes = archive('ooxml-validate');

    const noArchive = await download({sums: `${digest(bytes)}  ${ASSET}\n`});
    await assert.rejects(noArchive.outcome, new RegExp(`${ASSET} returned 404`));
    assert.deepEqual(filesUnder(noArchive.cache), []);

    const noSums = await download({archive: bytes});
    await assert.rejects(noSums.outcome, /SHA256SUMS returned 404/);
    assert.deepEqual(filesUnder(noSums.cache), []);
  });

  test('an unreachable host throws and caches nothing', async () => {
    const cache = mkdtempSync(join(scratch, 'cache-'));
    process.env.OOXML_VALIDATE_CACHE_DIR = cache;
    try {
      await assert.rejects(
        downloadBinary({
          version: VERSION,
          platform: PLATFORM,
          releaseBase: 'http://127.0.0.1:1/releases',
          onProgress: () => {},
        }),
        /could not reach/,
      );
    } finally {
      delete process.env.OOXML_VALIDATE_CACHE_DIR;
    }
    assert.deepEqual(filesUnder(cache), []);
  });

  test('an archive without the executable throws and caches nothing', async () => {
    const bytes = archive('something-else');
    const {cache, outcome} = await download({archive: bytes, sums: `${digest(bytes)}  ${ASSET}\n`});

    await assert.rejects(outcome, /did not contain ooxml-validate/);
    assert.deepEqual(filesUnder(cache), []);
  });

  test('an archive tar cannot read throws and caches nothing', async () => {
    const bytes = new TextEncoder().encode('not a tarball');
    const {cache, outcome} = await download({archive: bytes, sums: `${digest(bytes)}  ${ASSET}\n`});

    await assert.rejects(outcome, /could not extract/);
    assert.deepEqual(filesUnder(cache), []);
  });

  test('provenance that cannot be checked fails closed, before extraction', async () => {
    // No `gh` on PATH, and no escape hatch. "Could not check" must not resolve the
    // way "checked and fine" does. The archive is also unreadable to tar, so an error
    // about extraction here would mean it reached tar unverified.
    const bytes = new TextEncoder().encode('not a tarball');
    const {cache, outcome} = await download(
      {archive: bytes, sums: `${digest(bytes)}  ${ASSET}\n`},
      {OOXML_VALIDATE_SKIP_ATTESTATION: undefined, PATH: mkdtempSync(join(scratch, 'empty-path-'))},
    );

    await assert.rejects(outcome, /could not verify the build provenance/);
    assert.deepEqual(filesUnder(cache), []);
    assert.deepEqual(staging(), []);
  });
});
