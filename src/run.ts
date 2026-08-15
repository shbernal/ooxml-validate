// Spawning the oracle and turning its output into a report.

import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';

import {FILE_FORMAT} from './formats.ts';
import {resolveValidator} from './resolve.ts';
import type {FileFormat, ValidationReport} from './types.ts';

/**
 * The oracle emits one JSON object for a whole batch, and a batch can be large. This
 * cap is far above anything a real corpus produces; it exists so a runaway cannot eat
 * the process, not as a limit anyone should reach.
 */
const MAX_STDOUT = 128 * 1024 * 1024;

function childEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // The release binary is a self-contained single-file app: it extracts its bundle
    // on first run, and with no base directory set it picks one that is not always
    // writable. Defaulted here rather than left to the environment.
    DOTNET_BUNDLE_EXTRACT_BASE_DIR: process.env.DOTNET_BUNDLE_EXTRACT_BASE_DIR ?? tmpdir(),
  };
}

interface OracleRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the oracle with the file list on stdin.
 *
 * Written against `spawn` rather than `execFile` because the list has to be piped in:
 * `--files-from -` is the whole reason a batch of any interesting size does not hit
 * ARG_MAX, and that failure would surface as an exec error the oracle never sees and
 * cannot explain.
 */
function spawnOracle(binary: string, args: readonly string[], stdin: string): Promise<OracleRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {env: childEnv(), stdio: ['pipe', 'pipe', 'pipe']});

    let stdout = '';
    let stderr = '';
    let overflowed = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      if (stdout.length + chunk.length > MAX_STDOUT) {
        overflowed = true;
        child.kill();
        return;
      }
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (overflowed) {
        reject(new Error(`ooxml-validator: the oracle produced more than ${MAX_STDOUT} bytes.`));
        return;
      }
      resolve({code, stdout, stderr});
    });

    // EPIPE here means the child exited before reading the list — an argument error,
    // say. Its exit code and stderr are the real answer, so let `close` report them
    // rather than drowning it in a write failure.
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

/**
 * Runs the oracle over a batch of paths and returns its report.
 *
 * Exit 1 means validation errors were found. That is an ordinary outcome and still
 * carries a full report on stdout — the only thing distinguishing it from exit 0 is
 * what is *in* the report. Exit 2 means the tool could not run, and then stdout is
 * empty by contract, so there is nothing to salvage and stderr is the answer.
 */
export async function runOracle(
  paths: readonly string[],
  format: FileFormat = FILE_FORMAT,
): Promise<ValidationReport> {
  if (paths.length === 0) {
    throw new Error('ooxml-validator: runOracle called with no paths.');
  }

  const binary = await resolveValidator();

  // The format is always passed explicitly. Inheriting a default is how two consumers
  // end up validating against different rule sets.
  const args = ['--format', format, '--files-from', '-'];
  const {code, stdout, stderr} = await spawnOracle(binary, args, `${paths.join('\n')}\n`);

  if (code !== 0 && code !== 1) {
    throw new Error(`ooxml-validator: the oracle failed (exit ${String(code)}).\n${stderr.trim()}`);
  }

  let report: ValidationReport;
  try {
    report = JSON.parse(stdout) as ValidationReport;
  } catch (cause) {
    throw new Error(
      `ooxml-validator: could not parse the oracle's output: ${stdout.slice(0, 500)}`,
      {cause},
    );
  }

  if (!Array.isArray(report.results)) {
    throw new Error(
      `ooxml-validator: the oracle returned no results array: ${stdout.slice(0, 500)}`,
    );
  }

  return report;
}

/** The oracle's own version and the Open XML SDK it links. */
export async function oracleVersion(): Promise<{tool: string; sdkVersion: string}> {
  const binary = await resolveValidator();
  const {code, stdout, stderr} = await spawnOracle(binary, ['--version'], '');

  if (code !== 0) {
    throw new Error(`ooxml-validator: --version failed (exit ${String(code)}).\n${stderr.trim()}`);
  }
  return JSON.parse(stdout) as {tool: string; sdkVersion: string};
}
