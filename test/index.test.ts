// The public export surface. Every other test imports the concrete module, so without
// this a re-export dropped from src/index.ts would compile, pass, and break every
// consumer's `import {validate} from 'ooxml-validate'`.

import assert from 'node:assert/strict';
import {test} from 'node:test';

import * as api from '../src/index.ts';

test('exports every public value', () => {
  const expected: Record<string, string> = {
    FILE_FORMAT: 'string',
    FILE_FORMATS: 'object',
    isFileFormat: 'function',
    validatorAvailable: 'function',
    cacheRoot: 'function',
    currentPlatform: 'function',
    SUPPORTED_PLATFORMS: 'object',
    probeFormats: 'function',
    resolveValidator: 'function',
    validatorPath: 'function',
    oracleVersion: 'function',
    validate: 'function',
    validateBuffer: 'function',
    validateBuffers: 'function',
    PACKAGE_NAME: 'string',
    PACKAGE_VERSION: 'string',
    RELEASE_TAG: 'string',
  };

  const actual = Object.fromEntries(
    Object.entries(api).map(([name, value]) => [name, typeof value]),
  );
  assert.deepEqual(actual, expected);
});
