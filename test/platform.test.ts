import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  assetName,
  cachedBinaryPath,
  cacheRoot,
  executableName,
  SUPPORTED_PLATFORMS,
} from '../src/platform.ts';

test('the Windows executable carries its .exe suffix', () => {
  // A bare extensionless path never resolves on Windows, and the failure is silent:
  // resolution reports the binary as missing and validation turns itself off. This
  // assertion exists because that bug is invisible to anyone developing on Linux.
  assert.equal(executableName('win-x64'), 'ooxml-validator.exe');

  for (const platform of SUPPORTED_PLATFORMS) {
    if (platform === 'win-x64') continue;
    assert.equal(executableName(platform), 'ooxml-validator');
  }
});

test('every supported platform has a distinct asset name', () => {
  const assets = SUPPORTED_PLATFORMS.map((platform) => assetName(platform));
  assert.equal(new Set(assets).size, SUPPORTED_PLATFORMS.length);
  for (const asset of assets) assert.match(asset, /\.tar\.gz$/);
});

test('the cache is keyed by version and platform, outside the package', () => {
  // Outside the package directory on purpose: reinstalls and multiple checkouts share
  // one ~110 MB download rather than each paying for it.
  const a = cachedBinaryPath('1.2.3', 'linux-x64');
  const b = cachedBinaryPath('1.2.4', 'linux-x64');
  const c = cachedBinaryPath('1.2.3', 'osx-arm64');

  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.ok(a.startsWith(cacheRoot()));
  assert.ok(a.includes('1.2.3'));
  assert.ok(!a.includes('node_modules'));
});

test('the cache directory honours an explicit override', () => {
  const original = process.env.OOXML_VALIDATOR_CACHE_DIR;
  try {
    process.env.OOXML_VALIDATOR_CACHE_DIR = '/tmp/somewhere-else';
    assert.equal(cacheRoot(), '/tmp/somewhere-else');
  } finally {
    if (original === undefined) delete process.env.OOXML_VALIDATOR_CACHE_DIR;
    else process.env.OOXML_VALIDATOR_CACHE_DIR = original;
  }
});
