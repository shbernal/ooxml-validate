// The `ooxml-validate` command, run as a process against the fake oracle. Its promise
// is transparency — same stdout, same stderr, same exit code as the oracle — so what
// is asserted is what a shell would see.

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const FAKE = fileURLToPath(new URL('fake-oracle.ts', import.meta.url));

function run(args: readonly string[], env: Record<string, string>) {
  const {OOXML_VALIDATE_BIN: _, FAKE_ORACLE_MODE: __, ...inherited} = process.env;
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    input: '',
    env: {...inherited, OOXML_VALIDATE_BIN: FAKE, ...env},
  });
}

describe('the ooxml-validate command', {skip: process.platform === 'win32' && 'shebang'}, () => {
  test('passes the oracle’s report and exit code through', () => {
    const clean = run(['/in/clean.pptx'], {});
    assert.equal(clean.status, 0);
    assert.equal(JSON.parse(clean.stdout).results[0].file, '/in/clean.pptx');

    const dirty = run(['/in/dirty.pptx'], {});
    assert.equal(dirty.status, 1);

    const failed = run(['/in/clean.pptx'], {FAKE_ORACLE_MODE: 'exit2'});
    assert.equal(failed.status, 2);
    assert.match(failed.stderr, /told to fail/);
    assert.equal(failed.stdout, '');
  });

  test('a signalled oracle exits 128 plus the signal’s number, as a shell reports it', () => {
    assert.equal(run(['/in/clean.pptx'], {FAKE_ORACLE_SIGNAL: 'SIGKILL'}).status, 137);
    assert.equal(run(['/in/clean.pptx'], {FAKE_ORACLE_SIGNAL: 'SIGTERM'}).status, 143);
  });

  test('an oracle that cannot be resolved exits 2 with the reason', () => {
    const result = run(['/in/clean.pptx'], {OOXML_VALIDATE_BIN: '/nonexistent/ooxml-validate'});
    assert.equal(result.status, 2);
    assert.match(result.stderr, /not an executable file/);
  });
});
