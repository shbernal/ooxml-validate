// The public export surface. Every other test imports the concrete module, so without
// this a re-export dropped from src/index.ts would compile, pass, and break every
// consumer's `import {validate} from 'ooxml-validate'`.

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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

test('the README documents exactly the exported values', () => {
  // Both directions: an export nobody documented, and a documented name that is gone.
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const table = readme.slice(readme.indexOf('| Export |'));
  const rows = table.slice(0, table.indexOf('\n\n')).split('\n').slice(2);
  const documented = rows.flatMap((row) =>
    [...(row.split('|')[1] ?? '').matchAll(/`([A-Za-z_]+)/g)].map((match) => match[1]),
  );

  assert.deepEqual(documented.sort(), Object.keys(api).sort());
});
