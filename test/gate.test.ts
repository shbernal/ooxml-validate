import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';

import {resetNotice, validatorAvailable} from '../src/gate.ts';
import {resetResolution} from '../src/resolve.ts';

/**
 * Runs `body` with the given environment, restoring everything afterwards and
 * resetting the module-level memoization the gate and the resolver both hold.
 */
async function withEnv(
  overrides: Record<string, string | undefined>,
  body: () => Promise<void>,
): Promise<void> {
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    original[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetResolution();
  resetNotice();
  try {
    await body();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetResolution();
    resetNotice();
  }
}

afterEach(() => {
  resetResolution();
  resetNotice();
});

test('an unobtainable validator is a hard failure under CI', async () => {
  // A silently-skipped schema suite is green while proving nothing. Locally that is a
  // reasonable trade for a large download; in CI, obtaining the binary is part of the
  // job, so it never is.
  await withEnv({CI: '1', OOXML_VALIDATE_BIN: '/nonexistent/ooxml-validate'}, async () => {
    await assert.rejects(validatorAvailable(), /must not be skipped in CI/);
  });
});

test('locally it warns once on stderr and returns false', async () => {
  await withEnv({CI: undefined, OOXML_VALIDATE_BIN: '/nonexistent/ooxml-validate'}, async () => {
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    // biome-ignore lint/suspicious/noExplicitAny: replacing a stream method for capture
    (process.stderr as any).write = (chunk: string) => {
      written.push(String(chunk));
      return true;
    };

    try {
      assert.equal(await validatorAvailable(), false);
      assert.equal(await validatorAvailable(), false);
      assert.equal(await validatorAvailable(), false);
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: restoring the captured method
      (process.stderr as any).write = original;
    }

    const notices = written.filter((line) => line.includes('being SKIPPED'));
    assert.equal(notices.length, 1, 'the notice must be emitted exactly once');

    // process.stderr.write, not console.warn: this typically fires while a runner is
    // still collecting the module graph, and runners drop console output emitted
    // outside a running test.
    assert.ok(written.some((line) => line.includes('does NOT prove schema validity')));
  });
});

test('an override pointing at a non-executable is rejected, not ignored', async () => {
  await withEnv({CI: undefined, OOXML_VALIDATE_BIN: '/nonexistent/ooxml-validate'}, async () => {
    const {resolveValidator} = await import('../src/resolve.ts');
    await assert.rejects(resolveValidator(), /not an executable file/);
  });
});

test('a failed resolution is not memoized', async () => {
  // Resolution failures are very often a transient network problem. Caching the
  // rejection would make every later call in a long-lived process keep failing for a
  // reason that stopped being true minutes ago.
  await withEnv({CI: undefined, OOXML_VALIDATE_BIN: '/nonexistent/one'}, async () => {
    const {resolveValidator} = await import('../src/resolve.ts');
    await assert.rejects(resolveValidator(), /nonexistent\/one/);

    process.env.OOXML_VALIDATE_BIN = '/nonexistent/two';
    await assert.rejects(resolveValidator(), /nonexistent\/two/);
  });
});
