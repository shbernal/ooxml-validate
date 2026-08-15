// Batching.
//
// The oracle is a ~110 MB self-contained .NET single-file app. Measured on the release
// build: ~0.3–0.4 s of startup, then only ~9 ms per additional package, and ~55 MB of
// RSS regardless of how many files it is given. Validating one package per process
// therefore paid the startup and the memory once per package — and, because callers
// typically spawn from inside concurrent tests, the process count scaled with the
// runner's concurrency times its worker pool. That product, not the work itself, is
// what put the memory ceiling out of the project's hands and into the host's core
// count.
//
// This queue is a dataloader: requests accumulate while an invocation is in flight and
// go out as one batch when it returns. It is self-tuning — under load batches grow,
// when idle the delay is a single timer tick — and it holds this process to at most
// ONE oracle child at a time, so validator memory is ~55 MB flat rather than ~55 MB per
// concurrent caller.

import {FILE_FORMAT} from './formats.ts';
import {runOracle} from './run.ts';
import type {FileFormat, ValidationReport, ValidationResult} from './types.ts';

/**
 * Bypass the queue and validate one file per process. For pinning a batch failure to a
 * single input by hand.
 */
const NO_BATCH = 'OOXML_VALIDATE_NO_BATCH';

/**
 * Caps stdout size and the length of one file list, not memory — the oracle's RSS does
 * not grow meaningfully with file count.
 */
const MAX_BATCH = 32;

export interface BatchedResult {
  readonly result: ValidationResult;
  readonly sdkVersion: string;
  readonly format: FileFormat;
}

interface QueueItem {
  readonly path: string;
  readonly format: FileFormat;
  readonly resolve: (value: BatchedResult) => void;
  readonly reject: (reason: Error) => void;
}

let queue: QueueItem[] = [];
let flushScheduled = false;
let inFlight = false;

function scheduleFlush(): void {
  // While an invocation is in flight, new work simply accumulates; the flush that is
  // running re-arms this on its way out. That is what keeps the child count at one
  // without needing a semaphore.
  if (flushScheduled || inFlight) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    void flush();
  }, 0);
}

async function flush(): Promise<void> {
  if (inFlight || queue.length === 0) return;
  inFlight = true;

  // The format is an argument to the whole invocation, so one batch is only ever one
  // format; anything else waits for the next round.
  const head = queue[0] as QueueItem;
  const {format} = head;

  const batch: QueueItem[] = [];
  const deferred: QueueItem[] = [];
  for (const item of queue) {
    if (item.format === format && batch.length < MAX_BATCH) batch.push(item);
    else deferred.push(item);
  }
  queue = deferred;

  try {
    await runBatch(batch, format);
  } finally {
    inFlight = false;
    if (queue.length > 0) scheduleFlush();
  }
}

async function runBatch(batch: readonly QueueItem[], format: FileFormat): Promise<void> {
  let report: ValidationReport;
  try {
    report = await runOracle(
      batch.map((item) => item.path),
      format,
    );
  } catch {
    // One bad input must not become 32 indistinguishable failures. Re-run the batch one
    // file per process so the error lands on the request that caused it and its
    // neighbours still get real verdicts. This costs a slow path only on a failure that
    // would otherwise have been unattributable.
    //
    // The batch-level error is deliberately dropped: it describes an invocation
    // covering 32 files, so it can only be less specific than what the retry is about
    // to produce for each of them.
    await Promise.all(
      batch.map(async (item) => {
        try {
          const single = await runOracle([item.path], format);
          const result = single.results[0];
          if (!result) {
            item.reject(new Error(`ooxml-validate: no result for ${item.path}.`));
            return;
          }
          item.resolve({result, sdkVersion: single.sdkVersion, format: single.format});
        } catch (individual) {
          item.reject(individual instanceof Error ? individual : new Error(String(individual)));
        }
      }),
    );
    return;
  }

  // Keyed by path, never by position. Results are ordered by the oracle, not by
  // submission — and with every input present and explicitly flagged there is nothing
  // to infer from an absence, so a missing entry is a real internal error rather than
  // a file that happened to be clean.
  const byPath = new Map(report.results.map((result) => [result.file, result]));

  for (const item of batch) {
    const result = byPath.get(item.path);
    if (result) {
      item.resolve({result, sdkVersion: report.sdkVersion, format: report.format});
    } else {
      item.reject(
        new Error(
          `ooxml-validate: the oracle returned no result for ${item.path}. ` +
            'Every input file must appear in the report; this is a bug in the oracle ' +
            'or in this package, not a clean file.',
        ),
      );
    }
  }
}

/**
 * Queues one path for validation. Resolves with that path's result once the batch it
 * lands in comes back.
 */
export function enqueue(path: string, format: FileFormat = FILE_FORMAT): Promise<BatchedResult> {
  if (process.env[NO_BATCH]) {
    return runOracle([path], format).then((report) => {
      const result = report.results[0];
      if (!result) throw new Error(`ooxml-validate: no result for ${path}.`);
      return {result, sdkVersion: report.sdkVersion, format: report.format};
    });
  }

  return new Promise<BatchedResult>((resolve, reject) => {
    queue.push({path, format, resolve, reject});
    scheduleFlush();
  });
}
