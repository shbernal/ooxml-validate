import assert from 'node:assert/strict';
import {test} from 'node:test';

import {expectedDigest} from '../src/download.ts';

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
