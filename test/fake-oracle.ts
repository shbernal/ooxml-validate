#!/usr/bin/env node
// A stand-in for the oracle binary, so the Node half can be driven without .NET.
//
// Speaks the same CLI contract — `--format <f> --files-from -`, one JSON report on
// stdout, exit 0/1/2 — and is pointed at through OOXML_VALIDATE_BIN like any other
// build. The behaviour is picked per test through the environment, which the package
// passes through to the child untouched:
//
//   FAKE_ORACLE_MODE  echo (default) — a result for every path; `dirty` in the path
//                                      makes it invalid
//                     exit2          — refuse to run
//                     garbage        — print something that is not JSON
//                     misshapen      — valid JSON of the wrong shape: a numeric
//                                      sdkVersion, or a version report with no
//                                      sdkVersion
//                     drop           — leave the first path out of the report
//                     rename         — report every path under a name nobody sent
//                     reverse        — report in the opposite order to the input
//                     fail-batch     — exit 2 when given more than one path
//                     hang           — never exit, and ignore SIGTERM
//                     regress        — like echo, but a `dirty` path is clean at
//                                      Microsoft365, so its error count drops as the
//                                      target rises
//                     strict         — like echo, but exit 2 on a path that does not
//                                      exist or is not .pptx/.xlsx/.docx, as the
//                                      real oracle does
//   FAKE_ORACLE_SIGNAL if set, the process sends itself this signal instead
//   FAKE_ORACLE_DELAY_MS if set, wait this long before reporting
//   FAKE_ORACLE_LOG   if set, one JSON line per invocation is appended here, stamped
//                     with the time it started

import {appendFileSync, existsSync, readFileSync} from 'node:fs';

const args = process.argv.slice(2);

const mode = process.env.FAKE_ORACLE_MODE ?? 'echo';

if (args.includes('--version')) {
  if (mode === 'garbage') process.stdout.write('this is not json\n');
  else if (mode === 'misshapen') process.stdout.write(`${JSON.stringify({tool: 'fake'})}\n`);
  else process.stdout.write(`${JSON.stringify({tool: 'fake', sdkVersion: '0.0.0'})}\n`);
  process.exit(0);
}

const format = args.includes('--format')
  ? (args[args.indexOf('--format') + 1] as string)
  : 'Microsoft365';
const paths = args.filter(
  (arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'),
);
if (args.includes('--files-from')) {
  paths.push(
    ...readFileSync(0, 'utf8')
      .split('\n')
      .filter((line) => line !== ''),
  );
}
if (process.env.FAKE_ORACLE_LOG) {
  const heapLimit = process.env.DOTNET_GCHeapHardLimit;
  const startedAt = Date.now();
  appendFileSync(
    process.env.FAKE_ORACLE_LOG,
    `${JSON.stringify({args, paths, heapLimit, startedAt})}\n`,
  );
}

function refuse(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

if (process.env.FAKE_ORACLE_SIGNAL) {
  process.kill(process.pid, process.env.FAKE_ORACLE_SIGNAL as NodeJS.Signals);
  setInterval(() => {}, 60_000);
} else if (mode === 'hang') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 60_000);
} else if (process.env.FAKE_ORACLE_DELAY_MS) {
  setTimeout(report, Number(process.env.FAKE_ORACLE_DELAY_MS));
} else {
  report();
}

function report(): void {
  if (mode === 'exit2') refuse('fake oracle: told to fail');
  if (mode === 'strict') {
    for (const path of paths) {
      if (!/\.(pptx|xlsx|docx)$/.test(path)) refuse(`Unsupported file extension: ${path}`);
      if (!existsSync(path)) refuse(`File does not exist: ${path}`);
    }
  }
  if (mode === 'fail-batch' && paths.length > 1) refuse('fake oracle: batch refused');
  if (mode === 'garbage') {
    process.stdout.write('this is not json\n');
    process.exit(0);
  }
  if (mode === 'misshapen') {
    process.stdout.write(
      `${JSON.stringify({format: 'Microsoft365', sdkVersion: 3, results: []})}\n`,
    );
    process.exit(0);
  }

  let reported = paths;
  if (mode === 'drop') reported = paths.slice(1);
  if (mode === 'rename') reported = paths.map((path) => `${path}.unsubmitted`);
  if (mode === 'reverse') reported = [...paths].reverse();

  const dirty = (file: string): boolean =>
    file.includes('dirty') && !(mode === 'regress' && format === 'Microsoft365');

  const results = reported.map((file) =>
    dirty(file)
      ? {
          file,
          valid: false,
          truncated: false,
          errors: [
            {
              id: 'Sch_Fake',
              type: 'Schema',
              description: 'fake diagnostic',
              partUri: '/fake.xml',
              xpath: '/fake[1]',
            },
          ],
        }
      : {file, valid: true, truncated: false, errors: []},
  );

  process.stdout.write(`${JSON.stringify({format, sdkVersion: '0.0.0', results})}\n`);
  process.exit(results.some((result) => !result.valid) ? 1 : 0);
}
