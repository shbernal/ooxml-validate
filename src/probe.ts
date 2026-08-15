// The conformance-target probe.
//
// This is the executable form of the claim FILE_FORMAT rests on: the Open XML SDK's
// per-version schemas differ in how much markup they *model*, so an older target skips
// newer constructs rather than rejecting them, and error count is therefore
// monotonically non-decreasing as the target rises. If that were false anywhere, then
// validating at Microsoft365 could miss something an older target catches, and the
// pinned default would be losing coverage instead of maximising it.
//
// It lives in this package rather than in one consumer so both inherit it, and so the
// claim is re-checkable against every future SDK bump rather than being a measurement
// somebody took once.

import {FILE_FORMATS} from './formats.ts';
import type {FileFormat} from './types.ts';
import {validate} from './validate.ts';

export interface ProbeRow {
  readonly file: string;
  /** Error count at each entry of {@link FILE_FORMATS}, in the same order. */
  readonly counts: readonly number[];
  /**
   * True when the count drops as the target version rises — which would contradict
   * monotonicity, and would mean the pinned default is blind to something an older
   * target sees.
   */
  readonly regresses: boolean;
}

export interface ProbeReport {
  readonly formats: readonly FileFormat[];
  readonly rows: readonly ProbeRow[];
  /** True when any row regresses. */
  readonly violated: boolean;
}

/**
 * Validates each path at every conformance target and reports the error counts.
 *
 * Runs the targets in sequence rather than concurrently: the batcher groups by format
 * and holds one child at a time, so interleaving formats would just produce many small
 * batches instead of a few large ones.
 */
export async function probeFormats(paths: readonly string[]): Promise<ProbeReport> {
  const countsByFile = new Map<string, number[]>(paths.map((path) => [path, []]));

  for (const format of FILE_FORMATS) {
    const report = await validate(paths, {format});
    for (const result of report.results) {
      countsByFile.get(result.file)?.push(result.errors.length);
    }
  }

  const rows: ProbeRow[] = [...countsByFile].map(([file, counts]) => ({
    file,
    counts,
    regresses: counts.some((count, index) => index > 0 && count < (counts[index - 1] as number)),
  }));

  return {
    formats: FILE_FORMATS,
    rows,
    violated: rows.some((row) => row.regresses),
  };
}
