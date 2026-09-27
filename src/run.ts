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

/** Override the per-invocation time limit, in milliseconds. */
const TIMEOUT = 'OOXML_VALIDATE_TIMEOUT_MS';

const DEFAULT_TIMEOUT_MS = 120_000;

function timeoutMs(): number {
  const raw = process.env[TIMEOUT];
  if (raw === undefined || raw === '') return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `ooxml-validate: ${TIMEOUT} must be a positive number of milliseconds, got ${raw}.`,
    );
  }
  return value;
}

/**
 * The oracle's environment. Shared with the CLI, so the command and the API run the
 * same binary under the same bounds. Each default yields to a value already set.
 */
export function childEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // The release binary is a self-contained single-file app: it extracts its bundle
    // on first run, and with no base directory set it picks one that is not always
    // writable. Defaulted here rather than left to the environment.
    DOTNET_BUNDLE_EXTRACT_BASE_DIR: process.env.DOTNET_BUNDLE_EXTRACT_BASE_DIR ?? tmpdir(),
    // A 3 GiB managed-heap ceiling, in the hex .NET expects. The oracle refuses a
    // package whose zip directory declares more than 512 MiB uncompressed, but the
    // directory can lie. Under this ceiling a package that inflates past what it
    // declared hits an OutOfMemoryException, which the oracle reports as a finding on
    // that one file; without it, the kernel's OOM-killer ends the whole batch with no
    // report. High enough that no package under the declared cap needs more.
    DOTNET_GCHeapHardLimit: process.env.DOTNET_GCHeapHardLimit ?? '0xC0000000',
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
/**
 * The child is time-bound because the queue in batch.ts holds one invocation at a
 * time: a child that never exits would leave every later caller in the process
 * waiting on it forever. Both the time limit and the stdout cap use SIGKILL — a bound
 * the child can decline by ignoring SIGTERM is not a bound.
 */
function spawnOracle(
  binary: string,
  args: readonly string[],
  stdin: string,
  subject: string,
): Promise<OracleRun> {
  const limit = timeoutMs();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {env: childEnv(), stdio: ['pipe', 'pipe', 'pipe']});

    let stdout = '';
    let stderr = '';
    let overflowed = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, limit);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      if (stdout.length + chunk.length > MAX_STDOUT) {
        overflowed = true;
        child.kill('SIGKILL');
        return;
      }
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(
            `ooxml-validate: the oracle did not finish ${subject} within ${limit} ms and was ` +
              `killed. Raise ${TIMEOUT} if that is legitimately too short.`,
          ),
        );
        return;
      }
      if (overflowed) {
        reject(new Error(`ooxml-validate: the oracle produced more than ${MAX_STDOUT} bytes.`));
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
    throw new Error('ooxml-validate: runOracle called with no paths.');
  }

  // The list goes over the wire one path per line, so a path with a line break in it
  // arrives as two paths. That is either a failure blamed on a fragment nobody
  // submitted or, worse, two real files validated in place of the one asked for.
  // Refused here, at the one place every batch passes through, rather than by
  // changing the delimiter: a line is a path is the documented contract.
  for (const path of paths) {
    if (path.includes('\n') || path.includes('\r')) {
      throw new Error(
        `ooxml-validate: path contains a line break, which --files-from cannot carry: ${JSON.stringify(path)}`,
      );
    }
  }

  const binary = await resolveValidator();

  // The format is always passed explicitly. Inheriting a default is how two consumers
  // end up validating against different rule sets.
  const args = ['--format', format, '--files-from', '-'];
  const subject =
    paths.length === 1 ? `validating ${paths[0]}` : `a batch of ${paths.length} files`;
  const {code, stdout, stderr} = await spawnOracle(binary, args, `${paths.join('\n')}\n`, subject);

  if (code !== 0 && code !== 1) {
    throw new Error(`ooxml-validate: the oracle failed (exit ${String(code)}).\n${stderr.trim()}`);
  }

  let report: ValidationReport;
  try {
    report = JSON.parse(stdout) as ValidationReport;
  } catch (cause) {
    throw new Error(
      `ooxml-validate: could not parse the output of ${binary}: ${stdout.slice(0, 500)}`,
      {cause},
    );
  }

  // A sanity check against the wrong binary, not a schema: the oracle and this package
  // ship as one version. `format` and `sdkVersion` flow into the public report, where
  // the type promises strings.
  if (
    typeof report !== 'object' ||
    report === null ||
    !Array.isArray(report.results) ||
    typeof report.format !== 'string' ||
    typeof report.sdkVersion !== 'string'
  ) {
    throw new Error(
      `ooxml-validate: ${binary} did not return a {format, sdkVersion, results} report: ` +
        stdout.slice(0, 500),
    );
  }

  return report;
}

/** The oracle's own version and the Open XML SDK it links. */
export async function oracleVersion(): Promise<{tool: string; sdkVersion: string}> {
  const binary = await resolveValidator();
  const {code, stdout, stderr} = await spawnOracle(
    binary,
    ['--version'],
    '',
    'reporting its version',
  );

  if (code !== 0) {
    throw new Error(`ooxml-validate: --version failed (exit ${String(code)}).\n${stderr.trim()}`);
  }
  // Checked as carefully as a report. This is the call people make when something is
  // already wrong, and naming the binary is what turns "bad JSON" into "that is not
  // the oracle".
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (cause) {
    throw new Error(
      `ooxml-validate: could not parse --version output from ${binary}: ${stdout.slice(0, 500)}`,
      {cause},
    );
  }
  const version = parsed as {tool?: unknown; sdkVersion?: unknown} | null;
  if (
    typeof version !== 'object' ||
    version === null ||
    typeof version.tool !== 'string' ||
    typeof version.sdkVersion !== 'string'
  ) {
    throw new Error(
      `ooxml-validate: ${binary} did not report a {tool, sdkVersion} pair: ${stdout.slice(0, 500)}`,
    );
  }
  return {tool: version.tool, sdkVersion: version.sdkVersion};
}
