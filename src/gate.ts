// The CI gate.
//
// Ported from `ts-pptx`, where it was already correct, so `ts-xlsx` inherits it too.
//
// A missing validator silently skips every schema assertion a suite has, so a local
// run can be green while proving far less than it appears to. That is a reasonable
// local trade — the binary is a large download. It is never acceptable in CI, where
// obtaining it is part of the job.

import {resolveValidator} from './resolve.ts';

let noticeEmitted = false;

/**
 * Whether the oracle can be obtained — the gate every `skipIf` should be built on,
 * rather than a bare existence check.
 *
 * Under `CI`, an unobtainable binary throws. Locally it emits one notice and returns
 * false, so a green run cannot quietly be mistaken for a complete one.
 */
export async function validatorAvailable(): Promise<boolean> {
  try {
    await resolveValidator();
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    if (process.env.CI) {
      throw new Error(
        `ooxml-validate: the validator could not be obtained, and schema assertions ` +
          `must not be skipped in CI.\n${detail}`,
        {cause: error},
      );
    }

    if (!noticeEmitted) {
      noticeEmitted = true;
      // `process.stderr.write`, not `console.warn`. This typically fires while a test
      // runner is still collecting the module graph, and runners drop console output
      // emitted outside a running test — a notice nobody sees defeats the point.
      process.stderr.write(
        '\n[ooxml-validate] the validator is unavailable — schema assertions are being SKIPPED.\n' +
          '[ooxml-validate] A green run here does NOT prove schema validity.\n' +
          `[ooxml-validate] ${detail.split('\n')[0]}\n\n`,
      );
    }
    return false;
  }
}

/** Test seam: allow the one-time notice to fire again. */
export function resetNotice(): void {
  noticeEmitted = false;
}
