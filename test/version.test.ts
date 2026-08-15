import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {PACKAGE_NAME, PACKAGE_VERSION, RELEASE_TAG} from '../src/version.ts';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
};

test('the version constants track package.json', () => {
  assert.equal(PACKAGE_NAME, manifest.name);
  assert.equal(PACKAGE_VERSION, manifest.version);
});

test('the release tag is the version with a v prefix', () => {
  // D10 rests on this: binary resolution asks GitHub for exactly this tag, so a
  // mismatch here is a package that fetches some other release's binary.
  assert.equal(RELEASE_TAG, `v${manifest.version}`);
});

test('the package is the unscoped name reserved for it', () => {
  // D1. Renaming to a scope is a deliberate decision, not something that should
  // slip through in a package.json edit.
  assert.equal(PACKAGE_NAME, 'ooxml-validate');
});
