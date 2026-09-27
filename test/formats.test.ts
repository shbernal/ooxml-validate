import assert from 'node:assert/strict';
import {test} from 'node:test';

import {FILE_FORMAT, FILE_FORMATS, isFileFormat} from '../src/formats.ts';

test('isFileFormat accepts exactly the conformance targets', () => {
  for (const format of FILE_FORMATS) assert.equal(isFileFormat(format), true);

  // Case matters: the oracle parses case-insensitively, but the type is the exact
  // spelling, and a guard that let 'microsoft365' through would lie about it.
  for (const value of ['microsoft365', 'Office2003', '', 'Microsoft365 ']) {
    assert.equal(isFileFormat(value), false, value);
  }
});

test('the pinned default is the newest target', () => {
  assert.equal(FILE_FORMAT, FILE_FORMATS.at(-1));
});
