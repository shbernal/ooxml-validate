// End-to-end against a real oracle binary.
//
// Skipped unless OOXML_VALIDATOR_BIN points at one, because the `node` CI job
// deliberately installs no .NET SDK — that job exists to prove the TypeScript half
// needs none. The `integration` job has both and sets the variable, so these are never
// silently skipped where they ought to run.
//
// Build one locally with: pnpm run oracle:build

import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {FILE_FORMAT} from '../src/formats.ts';
import {probeFormats} from '../src/probe.ts';
import {oracleVersion} from '../src/run.ts';
import {validate, validateBuffer, validateBuffers} from '../src/validate.ts';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = join(REPO_ROOT, 'fixtures');

const fixture = (name: string): string => join(FIXTURES, name);
const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(fixture(name)));

const ORACLE = process.env.OOXML_VALIDATOR_BIN;
const skip = ORACLE ? false : 'set OOXML_VALIDATOR_BIN (pnpm run oracle:build) to run these';

/** Temp directories this package creates while validating buffers. */
function strayTempDirs(): string[] {
  return readdirSync(tmpdir()).filter((entry) => entry.startsWith('ooxml-validator-'));
}

describe('validate', {skip}, () => {
  test('reports every input, including the clean ones', async () => {
    const report = await validate([
      fixture('clean.pptx'),
      fixture('clean.xlsx'),
      fixture('clean.docx'),
      fixture('dirty.pptx'),
    ]);

    assert.equal(report.results.length, 4);
    assert.equal(report.format, FILE_FORMAT);
    assert.match(report.sdkVersion, /^\d+\.\d+\.\d+$/);

    const byFile = new Map(report.results.map((r) => [r.file, r]));
    assert.equal(byFile.get(fixture('clean.pptx'))?.valid, true);
    assert.equal(byFile.get(fixture('dirty.pptx'))?.valid, false);
  });

  test('echoes paths back exactly as given', async () => {
    const report = await validate([fixture('clean.pptx')]);
    assert.equal(report.results[0]?.file, fixture('clean.pptx'));
  });

  test('a corrupt package is a diagnostic, and its neighbours still get verdicts', async () => {
    const report = await validate([
      fixture('clean.xlsx'),
      fixture('corrupt.pptx'),
      fixture('clean.docx'),
    ]);

    assert.equal(report.results.length, 3);
    const corrupt = report.results.find((r) => r.file.endsWith('corrupt.pptx'));
    assert.equal(corrupt?.valid, false);
    assert.equal(corrupt?.errors[0]?.id, 'PackageOpenError');
    assert.equal(report.results.filter((r) => r.valid).length, 2);
  });

  test('an empty request is not an error', async () => {
    const report = await validate([]);
    assert.deepEqual(report.results, []);
  });

  test('diagnostics carry the fields consumers key on', async () => {
    const report = await validate([fixture('dirty.pptx')]);
    const diagnostic = report.results[0]?.errors[0];

    assert.ok(diagnostic);
    assert.equal(typeof diagnostic.id, 'string');
    assert.equal(typeof diagnostic.type, 'string');
    assert.equal(typeof diagnostic.description, 'string');
    assert.ok('partUri' in diagnostic);
    assert.ok('xpath' in diagnostic);
  });
});

describe('validateBuffer', {skip}, () => {
  test('returns the caller’s label, never the temp path', async () => {
    const result = await validateBuffer(bytes('clean.pptx'), {ext: 'pptx', label: 'slide deck #1'});

    assert.equal(result.file, 'slide deck #1');
    assert.equal(result.valid, true);
  });

  test('accepts an extension with or without the dot', async () => {
    const withDot = await validateBuffer(bytes('clean.xlsx'), {ext: '.xlsx', label: 'a'});
    const without = await validateBuffer(bytes('clean.xlsx'), {ext: 'xlsx', label: 'b'});

    assert.equal(withDot.valid, true);
    assert.equal(without.valid, true);
  });

  test('an invalid buffer reports its diagnostics under the label', async () => {
    const result = await validateBuffer(bytes('dirty.docx'), {
      ext: 'docx',
      label: 'generated.docx',
    });

    assert.equal(result.file, 'generated.docx');
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });
});

describe('validateBuffers', {skip}, () => {
  test('maps every result back to the right caller, with mixed kinds', async () => {
    // Deliberately interleaved and of different document types, so a mapping that
    // silently fell back to array position would still have to get the *kinds* right
    // by luck to pass.
    const inputs = [
      {bytes: bytes('clean.pptx'), ext: 'pptx', label: 'deck-clean'},
      {bytes: bytes('dirty.xlsx'), ext: 'xlsx', label: 'book-dirty'},
      {bytes: bytes('clean.docx'), ext: 'docx', label: 'doc-clean'},
      {bytes: bytes('dirty.pptx'), ext: 'pptx', label: 'deck-dirty'},
      {bytes: bytes('clean.xlsx'), ext: 'xlsx', label: 'book-clean'},
    ];

    const results = await validateBuffers(inputs);
    const byLabel = new Map(results.map((r) => [r.file, r]));

    assert.equal(results.length, inputs.length);
    assert.equal(byLabel.get('deck-clean')?.valid, true);
    assert.equal(byLabel.get('book-dirty')?.valid, false);
    assert.equal(byLabel.get('doc-clean')?.valid, true);
    assert.equal(byLabel.get('deck-dirty')?.valid, false);
    assert.equal(byLabel.get('book-clean')?.valid, true);
  });

  test('duplicate labels still get their own results', async () => {
    // Uniqueness of temp paths, not of labels, is what the mapping depends on.
    const results = await validateBuffers([
      {bytes: bytes('clean.xlsx'), ext: 'xlsx', label: 'same'},
      {bytes: bytes('dirty.xlsx'), ext: 'xlsx', label: 'same'},
    ]);

    assert.equal(results.length, 2);
    assert.deepEqual(results.map((r) => r.valid).sort(), [false, true]);
  });

  test('unlabelled buffers get distinct generated handles', async () => {
    const results = await validateBuffers([
      {bytes: bytes('clean.xlsx'), ext: 'xlsx'},
      {bytes: bytes('clean.xlsx'), ext: 'xlsx'},
    ]);

    assert.equal(new Set(results.map((r) => r.file)).size, 2);
  });

  test('leaves no temp files behind', async () => {
    const before = strayTempDirs();
    await validateBuffers([
      {bytes: bytes('clean.xlsx'), ext: 'xlsx', label: 'a'},
      {bytes: bytes('corrupt.pptx'), ext: 'pptx', label: 'b'},
    ]);
    const after = strayTempDirs();

    assert.deepEqual(
      after.filter((d) => !before.includes(d)),
      [],
    );
  });

  test('cleans up even when the batch contains something unopenable', async () => {
    const before = strayTempDirs();
    await validateBuffers([{bytes: new Uint8Array([1, 2, 3]), ext: 'pptx', label: 'junk'}]);
    assert.deepEqual(
      strayTempDirs().filter((d) => !before.includes(d)),
      [],
    );
  });

  test('an empty batch is a no-op', async () => {
    assert.deepEqual(await validateBuffers([]), []);
  });
});

describe('batching', {skip}, () => {
  test('300 interleaved buffers all map back correctly', async () => {
    // Well past MAX_BATCH (32), so this spans many invocations. Every label is
    // distinct and encodes its own expected verdict, so a single mis-mapped result
    // fails the assertion rather than hiding in the aggregate.
    const clean = bytes('clean.xlsx');
    const dirty = bytes('dirty.xlsx');

    const inputs = Array.from({length: 300}, (_, index) => ({
      bytes: index % 3 === 0 ? dirty : clean,
      ext: 'xlsx',
      label: `${index % 3 === 0 ? 'dirty' : 'clean'}-${index}`,
    }));

    const results = await validateBuffers(inputs);
    assert.equal(results.length, 300);

    for (const result of results) {
      const expected = result.file.startsWith('clean-');
      assert.equal(result.valid, expected, `${result.file} came back as valid=${result.valid}`);
    }

    assert.equal(new Set(results.map((r) => r.file)).size, 300);
  });

  test('concurrent callers share batches rather than each spawning a child', async () => {
    // The queue is a dataloader: work submitted while an invocation is in flight
    // accumulates and goes out as one batch. What this asserts is the observable
    // consequence — many concurrent calls still all resolve correctly — since the
    // child count itself is not visible from here.
    const results = await Promise.all(
      Array.from({length: 40}, (_, index) =>
        validateBuffer(bytes('clean.xlsx'), {ext: 'xlsx', label: `concurrent-${index}`}),
      ),
    );

    assert.equal(results.length, 40);
    assert.ok(results.every((r) => r.valid));
    assert.equal(new Set(results.map((r) => r.file)).size, 40);
  });
});

describe('oracleVersion', {skip}, () => {
  test('reports the tool and the Open XML SDK it links', async () => {
    const version = await oracleVersion();
    assert.equal(typeof version.tool, 'string');
    assert.match(version.sdkVersion, /^\d+\.\d+\.\d+$/);
  });
});

describe('probeFormats', {skip}, () => {
  test('error count never decreases as the conformance target rises', async () => {
    // The executable form of why FILE_FORMAT is Microsoft365. The SDK's per-version
    // schemas differ in how much markup they model, so an older target skips newer
    // constructs rather than rejecting them. If this ever failed, validating at the
    // newest target would be losing coverage rather than maximising it, and the
    // pinned default would be wrong.
    const report = await probeFormats([
      fixture('clean.pptx'),
      fixture('dirty.pptx'),
      fixture('dirty.xlsx'),
      fixture('dirty.docx'),
    ]);

    const offenders = report.rows.filter((row) => row.regresses);
    assert.deepEqual(
      offenders.map((row) => ({file: row.file, counts: row.counts})),
      [],
      'error count decreased as the conformance target rose',
    );
    assert.equal(report.violated, false);
  });
});

describe('the fixture corpus', () => {
  test('is present', () => {
    // Not skipped: if the corpus went missing, every skipped test above would look
    // like an absent oracle rather than an absent corpus.
    for (const name of ['clean.pptx', 'clean.xlsx', 'clean.docx', 'dirty.pptx', 'corrupt.pptx']) {
      assert.ok(existsSync(fixture(name)), `missing fixture: ${name}`);
    }
  });
});
