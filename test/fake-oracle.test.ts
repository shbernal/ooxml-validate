// The Node half — queueing, batching, spawning, report parsing, label mapping —
// driven against a scripted stand-in for the oracle, so none of it needs .NET.
//
// integration.test.ts covers the same surface against the real binary; this file is
// what makes the gate exercise it on every run. Skipped on Windows, where a script
// with a shebang is not something `spawn` can execute directly.

import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, beforeEach, describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {FILE_FORMATS} from '../src/formats.ts';
import {probeFormats} from '../src/probe.ts';
import {resetResolution} from '../src/resolve.ts';
import {oracleVersion} from '../src/run.ts';
import {validate, validateBuffer, validateBuffers} from '../src/validate.ts';

const skip = process.platform === 'win32' ? 'the fake oracle is a shebang script' : false;

const FAKE = fileURLToPath(new URL('fake-oracle.ts', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'fake-oracle-test-'));
const LOG = join(scratch, 'invocations.jsonl');

process.env.OOXML_VALIDATE_BIN = FAKE;
// A private temp root, so checking for leaked temp directories does not see the ones
// integration.test.ts is creating at the same time in another process.
process.env.TMPDIR = scratch;
process.env.FAKE_ORACLE_LOG = LOG;
delete process.env.OOXML_VALIDATE_NO_BATCH;

interface Invocation {
  readonly args: readonly string[];
  readonly paths: readonly string[];
  readonly heapLimit?: string;
}

function invocations(): Invocation[] {
  try {
    return readFileSync(LOG, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Invocation);
  } catch {
    return [];
  }
}

function mode(value: string): void {
  process.env.FAKE_ORACLE_MODE = value;
}

beforeEach(() => {
  rmSync(LOG, {force: true});
  delete process.env.FAKE_ORACLE_MODE;
  delete process.env.OOXML_VALIDATE_NO_BATCH;
  delete process.env.OOXML_VALIDATE_TIMEOUT_MS;
  resetResolution();
});

after(() => {
  rmSync(scratch, {recursive: true, force: true});
});

describe('reports', {skip}, () => {
  test('every input comes back with an explicit verdict', async () => {
    const report = await validate(['/in/clean-a.pptx', '/in/dirty-b.xlsx', '/in/clean-c.docx']);

    assert.equal(report.sdkVersion, '0.0.0');
    assert.deepEqual(
      report.results.map((r) => [r.file, r.valid]),
      [
        ['/in/clean-a.pptx', true],
        ['/in/dirty-b.xlsx', false],
        ['/in/clean-c.docx', true],
      ],
    );
  });

  test('results are correlated by path, not by the order the oracle returns them', async () => {
    mode('reverse');
    const paths = ['/in/clean-1.pptx', '/in/dirty-2.pptx', '/in/clean-3.pptx'];
    const report = await validate(paths);

    assert.deepEqual(
      report.results.map((r) => r.file),
      paths,
    );
    assert.equal(report.results[1]?.valid, false);
  });

  test('the format is always sent explicitly', async () => {
    await validate(['/in/clean.pptx']);
    await validate(['/in/clean.pptx'], {format: 'Office2010'});

    assert.deepEqual(
      invocations().map((call) => call.args),
      [
        ['--format', 'Microsoft365', '--files-from', '-'],
        ['--format', 'Office2010', '--files-from', '-'],
      ],
    );
  });

  test('the oracle runs under a managed-heap ceiling, unless one is already set', async () => {
    const original = process.env.DOTNET_GCHeapHardLimit;
    try {
      delete process.env.DOTNET_GCHeapHardLimit;
      await validate(['/in/clean-1.pptx']);
      process.env.DOTNET_GCHeapHardLimit = '0x10000000';
      await validate(['/in/clean-2.pptx']);
    } finally {
      if (original === undefined) delete process.env.DOTNET_GCHeapHardLimit;
      else process.env.DOTNET_GCHeapHardLimit = original;
    }

    assert.deepEqual(
      invocations().map((call) => call.heapLimit),
      ['0xC0000000', '0x10000000'],
    );
  });

  test('oracleVersion reads the binary’s own report', async () => {
    assert.deepEqual(await oracleVersion(), {tool: 'fake', sdkVersion: '0.0.0'});
  });
});

describe('failures', {skip}, () => {
  test('exit 2 is an error carrying the oracle’s stderr', async () => {
    mode('exit2');
    await assert.rejects(validate(['/in/clean.pptx']), /exit 2[\s\S]*told to fail/);
  });

  test('output that is not JSON is an error naming the binary, not an empty report', async () => {
    mode('garbage');
    await assert.rejects(
      validate(['/in/clean.pptx']),
      new RegExp(`could not parse the output of ${FAKE}[\\s\\S]*this is not json`),
    );
  });

  test('a report of the wrong shape is refused, not passed on', async () => {
    mode('misshapen');
    await assert.rejects(
      validate(['/in/clean.pptx']),
      /did not return a \{format, sdkVersion, results\}/,
    );
  });

  test('oracleVersion names the binary when its output is not a version report', async () => {
    mode('garbage');
    await assert.rejects(
      oracleVersion(),
      (error: unknown) =>
        !(error instanceof SyntaxError) &&
        String(error).includes(`could not parse --version output from ${FAKE}`),
    );

    mode('misshapen');
    await assert.rejects(oracleVersion(), /did not report a \{tool, sdkVersion\} pair/);
  });

  test('a path missing from the report is an error, never a clean file', async () => {
    mode('drop');
    await assert.rejects(
      validate(['/in/clean-1.pptx', '/in/clean-2.pptx']),
      /no result for \/in\/clean-1\.pptx/,
    );
  });

  test('a result for a path nobody submitted is refused, not guessed', async () => {
    mode('rename');
    process.env.OOXML_VALIDATE_NO_BATCH = '1';
    await assert.rejects(
      validateBuffer(new Uint8Array([1]), {ext: 'pptx', label: 'mine'}),
      /which was not submitted/,
    );
  });

  test('a path with a line break is refused, and only that path', async () => {
    // Both halves name plausible files: sent as-is, the oracle would validate two
    // packages nobody asked about and the caller would get an internal error.
    const outcomes = await Promise.allSettled([
      validate(['/in/clean-1.pptx']),
      validate(['/in/a.pptx\n/in/b.pptx']),
      validate(['/in/clean-2.pptx\r']),
      validate(['/in/dirty-3.pptx']),
    ]);

    assert.deepEqual(
      outcomes.map((outcome) => outcome.status),
      ['fulfilled', 'rejected', 'rejected', 'fulfilled'],
    );
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        assert.match(String(outcome.reason), /contains a line break/);
      }
    }

    const sent = invocations().flatMap((call) => call.paths);
    assert.ok(!sent.includes('/in/a.pptx') && !sent.includes('/in/b.pptx'));
  });

  test('a child that never exits is killed, and each caller hears about its own file', async () => {
    // The fake ignores SIGTERM, so this also proves the kill is not one it can decline.
    mode('hang');
    process.env.OOXML_VALIDATE_TIMEOUT_MS = '300';

    const outcomes = await Promise.allSettled([
      validate(['/in/clean-a.pptx']),
      validate(['/in/clean-b.pptx']),
    ]);

    assert.match(
      String((outcomes[0] as PromiseRejectedResult).reason),
      /clean-a\.pptx within 300 ms/,
    );
    assert.match(
      String((outcomes[1] as PromiseRejectedResult).reason),
      /clean-b\.pptx within 300 ms/,
    );

    // And the queue is not left wedged behind it.
    mode('echo');
    const report = await validate(['/in/clean-c.pptx']);
    assert.equal(report.results[0]?.valid, true);
  });

  test('a time limit that is not a positive number is refused', async () => {
    process.env.OOXML_VALIDATE_TIMEOUT_MS = 'soon';
    await assert.rejects(validate(['/in/clean.pptx']), /must be a positive number/);
  });

  test('a failed batch is retried one file per process', async () => {
    mode('fail-batch');
    const paths = ['/in/clean-1.pptx', '/in/dirty-2.pptx', '/in/clean-3.pptx'];
    const report = await validate(paths);

    assert.deepEqual(
      report.results.map((r) => r.valid),
      [true, false, true],
    );

    const sizes = invocations().map((call) => call.paths.length);
    assert.deepEqual(sizes, [3, 1, 1, 1]);
  });
});

describe('batching', {skip}, () => {
  test('concurrent callers share invocations, capped at 32 paths each', async () => {
    const paths = Array.from({length: 100}, (_, index) => `/in/clean-${index}.pptx`);
    const results = await Promise.all(paths.map((path) => validate([path])));

    assert.equal(results.length, 100);
    const sizes = invocations().map((call) => call.paths.length);
    assert.equal(
      sizes.reduce((sum, size) => sum + size, 0),
      100,
    );
    assert.ok(Math.max(...sizes) <= 32, `a batch exceeded the cap: ${sizes.join(',')}`);
    assert.ok(sizes.length < 100, 'every request got its own process');
  });

  test('one invocation never mixes formats', async () => {
    await Promise.all([
      validate(['/in/a.pptx'], {format: 'Office2007'}),
      validate(['/in/b.pptx'], {format: 'Office2016'}),
      validate(['/in/c.pptx'], {format: 'Office2007'}),
    ]);

    const byFormat = invocations().map((call) => ({
      format: call.args[call.args.indexOf('--format') + 1],
      paths: call.paths,
    }));
    assert.deepEqual(byFormat, [
      {format: 'Office2007', paths: ['/in/a.pptx', '/in/c.pptx']},
      {format: 'Office2016', paths: ['/in/b.pptx']},
    ]);
  });
});

describe('buffers', {skip}, () => {
  test('results carry the caller’s labels, never the temp paths', async () => {
    const results = await validateBuffers([
      {bytes: new Uint8Array([1]), ext: 'pptx', label: 'deck'},
      {bytes: new Uint8Array([2]), ext: '.xlsx', label: 'book'},
      {bytes: new Uint8Array([3]), ext: 'docx'},
    ]);

    assert.deepEqual(
      results.map((r) => r.file),
      ['deck', 'book', 'buffer:2'],
    );

    const sent = invocations().flatMap((call) => call.paths);
    assert.ok(sent[0]?.endsWith('.pptx'));
    assert.ok(sent[1]?.endsWith('.xlsx'));
    assert.ok(sent[2]?.endsWith('.docx'));
  });

  test('one input failing does not delete files its siblings are still queued on', async () => {
    // 40 inputs make two batches. The first fails as a whole on input 0, is retried
    // one by one, and input 0's rejection arrives while the second batch is still
    // queued. That batch must still find its files.
    mode('strict');
    const inputs = Array.from({length: 40}, (_, index) => ({
      bytes: new Uint8Array([index]),
      ext: index === 0 ? 'bin' : 'pptx',
    }));

    await assert.rejects(validateBuffers(inputs), /Unsupported file extension/);

    const sizes = invocations().map((call) => call.paths.length);
    assert.deepEqual(sizes, [32, ...Array.from({length: 32}, () => 1), 8]);
  });

  test('an ext that is not a bare extension is refused before anything is written', async () => {
    const escaped = join(scratch, 'escaped.pptx');
    for (const ext of ['../../escaped.pptx', './../../escaped.pptx', '/abs.pptx', 'pp tx', '']) {
      await assert.rejects(
        validateBuffers([
          {bytes: new Uint8Array([1]), ext: 'pptx'},
          {bytes: new Uint8Array([2]), ext},
        ]),
        (error: unknown) => error instanceof TypeError && /bare file extension/.test(String(error)),
      );
    }

    assert.equal(existsSync(escaped), false);
    assert.deepEqual(invocations(), []);
    assert.deepEqual(
      readdirSync(scratch).filter((entry) => entry.startsWith('ooxml-validate-')),
      [],
    );
  });

  test('temp files are removed, on success and on failure', async () => {
    const stray = (): string[] =>
      readdirSync(scratch).filter((entry) => entry.startsWith('ooxml-validate-'));
    const before = stray();

    await validateBuffers([{bytes: new Uint8Array([1]), ext: 'pptx'}]);
    mode('exit2');
    await assert.rejects(validateBuffers([{bytes: new Uint8Array([1]), ext: 'pptx'}]));

    assert.deepEqual(
      stray().filter((entry) => !before.includes(entry)),
      [],
    );
  });
});

describe('probeFormats', {skip}, () => {
  test('validates at every conformance target, oldest first', async () => {
    const report = await probeFormats(['/in/dirty.pptx']);

    assert.deepEqual(report.formats, FILE_FORMATS);
    assert.deepEqual(report.rows, [
      {file: '/in/dirty.pptx', counts: FILE_FORMATS.map(() => 1), regresses: false},
    ]);
    assert.equal(report.violated, false);
  });

  test('a repeated path is one row, with one count per format', async () => {
    const report = await probeFormats(['/in/dirty.pptx', '/in/clean.pptx', '/in/dirty.pptx']);

    assert.deepEqual(
      report.rows.map((row) => [row.file, row.counts.length]),
      [
        ['/in/dirty.pptx', FILE_FORMATS.length],
        ['/in/clean.pptx', FILE_FORMATS.length],
      ],
    );
  });

  test('an error count that drops as the target rises is flagged', async () => {
    mode('regress');
    const report = await probeFormats(['/in/dirty.pptx', '/in/clean.pptx']);

    assert.deepEqual(
      report.rows.map((row) => [row.file, row.regresses]),
      [
        ['/in/dirty.pptx', true],
        ['/in/clean.pptx', false],
      ],
    );
    assert.equal(report.violated, true);
  });
});
