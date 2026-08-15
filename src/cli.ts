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
import {tmpdir} from 'node:os';

import {resolveValidator} from './resolve.ts';

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
    env: {
      ...process.env,
      DOTNET_BUNDLE_EXTRACT_BASE_DIR: process.env.DOTNET_BUNDLE_EXTRACT_BASE_DIR ?? tmpdir(),
    },
  });

  child.on('error', (error: Error) => {
    process.stderr.write(`ooxml-validate: could not run ${binary}: ${error.message}\n`);
    process.exitCode = TOOL_FAILURE;
  });

  child.on('close', (code, signal) => {
    // A signalled child has no exit code. Report it the way a shell would, so a
    // killed oracle is distinguishable from one that decided to exit.
    process.exitCode = signal ? 128 + 1 : (code ?? TOOL_FAILURE);
  });
}

await main();
