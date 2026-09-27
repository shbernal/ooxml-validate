// The public validation API.

import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {type BatchedResult, enqueue} from './batch.ts';
import {FILE_FORMAT} from './formats.ts';
import type {
  BufferInput,
  FileFormat,
  ValidateOptions,
  ValidationReport,
  ValidationResult,
} from './types.ts';

/**
 * Validates files on disk.
 *
 * Every input appears in the returned report with an explicit `valid` flag, and `file`
 * is whatever you passed in — relative stays relative.
 */
export async function validate(
  paths: readonly string[],
  options: ValidateOptions = {},
): Promise<ValidationReport> {
  const format = options.format ?? FILE_FORMAT;

  if (paths.length === 0) {
    // An empty request is not an error, but it has no oracle run to take a header
    // from. Report what was asked for rather than inventing an SDK version.
    return {format, sdkVersion: '', results: []};
  }

  const batched = await Promise.all(paths.map((path) => enqueue(path, format)));

  return {
    format,
    sdkVersion: batched[0]?.sdkVersion ?? '',
    results: batched.map((entry) => entry.result),
  };
}

/**
 * `ext` becomes part of a temp filename, so anything but a bare extension could put
 * the caller's bytes outside the temp directory — beyond the cleanup, onto whatever
 * file is there. Refused rather than sanitized: the oracle picks the document type by
 * extension, so a quietly rewritten one would change which diagnostics come back.
 * A shape check, not the oracle's list, so it stays right when the oracle adds one.
 */
function normalizeExtension(ext: string): string {
  const normalized = ext.startsWith('.') ? ext : `.${ext}`;
  if (!/^\.[A-Za-z0-9]+$/.test(normalized)) {
    throw new TypeError(
      `ooxml-validate: ext must be a bare file extension such as 'pptx', got ${JSON.stringify(ext)}`,
    );
  }
  return normalized;
}

/**
 * Validates one in-memory package.
 *
 * The oracle only reads files, so the bytes are written to a temp file, and the
 * temp path — which the caller has never seen — is rewritten back to the caller's own
 * `label` before returning. See {@link validateBuffers} for how that mapping works and
 * why it lives here rather than in the oracle.
 */
export async function validateBuffer(
  bytes: Uint8Array,
  input: Omit<BufferInput, 'bytes'> & ValidateOptions,
): Promise<ValidationResult> {
  const results = await validateBuffers(
    [{bytes, ext: input.ext, ...(input.label === undefined ? {} : {label: input.label})}],
    input.format === undefined ? {} : {format: input.format},
  );

  // validateBuffers returns exactly one result per input or throws; this cannot be
  // undefined, and asserting it is cheaper than pretending the API is nullable.
  return results[0] as ValidationResult;
}

/**
 * Validates several in-memory packages, in one batch.
 *
 * **Identity.** The oracle echoes back the path it was given and knows nothing about
 * labels — deliberately, because a label channel in the CLI contract would exist
 * solely for in-memory callers and every future transport would have to honour it. So
 * this function holds a `tempPath → label` map for the lifetime of the call and
 * rewrites `file` on the way out. That map is the *only* correlation mechanism: it
 * never falls back to array position, because results are ordered by the oracle rather
 * than by submission.
 *
 * Temp files are unique per buffer even within one batch, and cleanup happens in a
 * `finally` that runs only once every input has settled, so an oracle crash mid-batch
 * cannot leak them and one input's failure cannot delete files its siblings are still
 * waiting to have read.
 */
export async function validateBuffers(
  inputs: readonly BufferInput[],
  options: ValidateOptions = {},
): Promise<ValidationResult[]> {
  if (inputs.length === 0) return [];

  const format: FileFormat = options.format ?? FILE_FORMAT;
  // Every extension is checked before anything is written.
  const extensions = inputs.map((input) => normalizeExtension(input.ext));
  const directory = await mkdtemp(join(tmpdir(), 'ooxml-validate-'));

  try {
    const identities = new Map<string, string>();

    const written = await Promise.all(
      inputs.map(async (input, index) => {
        // Index-prefixed so two buffers with the same label still get distinct paths.
        // The index is for uniqueness only — nothing reads it back.
        const path = join(directory, `${String(index).padStart(5, '0')}${extensions[index]}`);
        await writeFile(path, input.bytes);
        identities.set(path, input.label ?? `buffer:${index}`);
        return path;
      }),
    );

    // allSettled, not all: the directory is removed in the `finally` below, and
    // Promise.all would reach it on the first rejection while sibling inputs are still
    // queued or in flight. Their files would vanish under them, and the batch they
    // share with other callers would fail on "does not exist". The first rejection is
    // still what the caller sees; it just waits until nothing reads the files.
    const settled = await Promise.allSettled(written.map((path) => enqueue(path, format)));
    const failure = settled.find((entry) => entry.status === 'rejected');
    if (failure) throw failure.reason;
    const batched = settled.map((entry) => (entry as PromiseFulfilledResult<BatchedResult>).value);

    return batched.map((entry) => {
      const label = identities.get(entry.result.file);
      if (label === undefined) {
        // The oracle echoes paths verbatim, so this can only mean it returned a path
        // nobody submitted. Silently dropping it, or guessing by position, would turn
        // a contract violation into a wrong answer about someone's document.
        throw new Error(
          `ooxml-validate: got a result for ${entry.result.file}, which was not submitted. ` +
            'Refusing to guess which input it belongs to.',
        );
      }
      return {...entry.result, file: label};
    });
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}
