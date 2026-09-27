#!/usr/bin/env node
// The `ooxml-validate` command.
//
// A pass-through to the resolved oracle: same arguments, same stdout, same stderr,
// same exit code. Nothing is reinterpreted on the way through, so `pnpm exec
// ooxml-validate deck.pptx` in a consumer repo and the oracle run by CI are the same
// program answering the same question — which is the point of having one oracle.
//
// The only thing this layer adds is resolution: finding (and, once, downloading) the
// binary, which is exactly what a consumer should not have to do by hand.

import {spawn} from 'node:child_process';
import {constants} from 'node:os';

import {resolveValidator} from './resolve.ts';
import {childEnv} from './run.ts';

const TOOL_FAILURE = 2;

async function main(): Promise<void> {
  let binary: string;
  try {
    binary = await resolveValidator();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = TOOL_FAILURE;
    return;
  }

  const child = spawn(binary, process.argv.slice(2), {
    stdio: 'inherit',
    env: childEnv(),
  });

  // A failure to spawn can be followed by `close`; the spawn error is the answer, and
  // `close` must not overwrite it.
  let spawnFailed = false;

  child.on('error', (error: Error) => {
    spawnFailed = true;
    process.stderr.write(`ooxml-validate: could not run ${binary}: ${error.message}\n`);
    process.exitCode = TOOL_FAILURE;
  });

  child.on('close', (code, signal) => {
    if (spawnFailed) return;
    if (signal) {
      // A signalled child has no exit code. Report it the way a shell would, 128 plus
      // the signal's number, so an OOM-killed oracle reads as 137. A signal this
      // platform cannot number gives a bare 128, which no real signal exit produces.
      process.exitCode = 128 + (constants.signals[signal] ?? 0);
      return;
    }
    process.exitCode = code ?? TOOL_FAILURE;
  });
}

await main();
