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
//                     drop           — leave the first path out of the report
//                     rename         — report every path under a name nobody sent
//                     reverse        — report in the opposite order to the input
//                     fail-batch     — exit 2 when given more than one path
//   FAKE_ORACLE_LOG   if set, one JSON line per invocation is appended here

import {appendFileSync, readFileSync} from 'node:fs';

const args = process.argv.slice(2);

if (args.includes('--version')) {
  process.stdout.write(`${JSON.stringify({tool: 'fake', sdkVersion: '0.0.0'})}\n`);
  process.exit(0);
}

const format = args[args.indexOf('--format') + 1] ?? 'Microsoft365';
const paths = readFileSync(0, 'utf8')
  .split('\n')
  .filter((line) => line !== '');
const mode = process.env.FAKE_ORACLE_MODE ?? 'echo';

if (process.env.FAKE_ORACLE_LOG) {
  appendFileSync(process.env.FAKE_ORACLE_LOG, `${JSON.stringify({args, paths})}\n`);
}

function refuse(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

if (mode === 'exit2') refuse('fake oracle: told to fail');
if (mode === 'fail-batch' && paths.length > 1) refuse('fake oracle: batch refused');
if (mode === 'garbage') {
  process.stdout.write('this is not json\n');
  process.exit(0);
}

let reported = paths;
if (mode === 'drop') reported = paths.slice(1);
if (mode === 'rename') reported = paths.map((path) => `${path}.unsubmitted`);
if (mode === 'reverse') reported = [...paths].reverse();

const results = reported.map((file) =>
  file.includes('dirty')
    ? {
        file,
        valid: false,
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
    : {file, valid: true, errors: []},
);

process.stdout.write(`${JSON.stringify({format, sdkVersion: '0.0.0', results})}\n`);
process.exit(results.some((result) => !result.valid) ? 1 : 0);
