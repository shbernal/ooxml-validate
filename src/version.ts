// The single version number.
//
// D10: the npm version and the binary version are the same number. Binary
// resolution fetches the GitHub release tagged with exactly this value, so there
// is no separate `binaryVersion` field to fall out of step with it — see the
// "Versioning" section of README.md.
//
// Read from package.json at runtime rather than baked in at build time, because a
// baked-in constant is a second copy: `npm version` rewrites package.json and
// nothing would rewrite the constant, so a release could ship a package claiming
// one version and fetching the binary of another. The relative depth is the same
// from `src/` and from `dist/`, so one specifier works in both the type-stripped
// dev loop and the built package.

import {readFileSync} from 'node:fs';

interface PackageManifest {
  readonly name: string;
  readonly version: string;
}

function readManifest(): PackageManifest {
  const url = new URL('../package.json', import.meta.url);
  const raw = readFileSync(url, 'utf8');
  const parsed = JSON.parse(raw) as Partial<PackageManifest>;

  if (typeof parsed.name !== 'string' || typeof parsed.version !== 'string') {
    throw new Error(`ooxml-validator: package.json at ${url.pathname} has no name/version`);
  }
  return {name: parsed.name, version: parsed.version};
}

const manifest = readManifest();

/** This package's version, and the version of the oracle binary it resolves. */
export const PACKAGE_VERSION: string = manifest.version;

/** This package's name, as published. */
export const PACKAGE_NAME: string = manifest.name;

/** The git tag, and therefore GitHub release, carrying the matching binaries. */
export const RELEASE_TAG: string = `v${manifest.version}`;
