// Finding the oracle binary.
//
// Order: explicit override → cached download → download → source build (opt-in) →
// fail with something actionable.
//
// Nothing here runs at install time. A package that reaches the network from a
// `postinstall` hook is hostile in CI and unusable offline, so the first call that
// actually needs the validator is the one that pays for it.

import {execFile as execFileCallback} from 'node:child_process';
import {access, constants} from 'node:fs/promises';
import {dirname, join, resolve as resolvePath} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {downloadBinary} from './download.ts';
import {
  cachedBinaryPath,
  currentPlatform,
  executableName,
  SUPPORTED_PLATFORMS,
} from './platform.ts';
import {PACKAGE_VERSION} from './version.ts';

const execFile = promisify(execFileCallback);

/** Point at another build, for bisecting a suspected oracle regression. */
const BIN_OVERRIDE = 'OOXML_VALIDATE_BIN';

/** Opt in to building the oracle from source. Requires a .NET SDK and a checkout. */
const FROM_SOURCE = 'OOXML_VALIDATE_FROM_SOURCE';

/** Turn the lazy download off, for environments that must never reach the network. */
const NO_DOWNLOAD = 'OOXML_VALIDATE_NO_DOWNLOAD';

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The package root, whether running from `src/` under Node's type-stripping or from
 * the built `dist/`. Both sit one level below the root, so one specifier works.
 */
function packageRoot(): string {
  return resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * Builds the oracle from source.
 *
 * This path exists for people editing the oracle, not for normal use — the published
 * tarball does not contain `oracle/`, so it only ever resolves inside a checkout of
 * this repo. Opt-in via {@link FROM_SOURCE} rather than automatic: silently preferring
 * a locally-built binary over the pinned release would mean a consumer's results
 * depended on whether the machine happened to have a .NET SDK.
 */
async function buildFromSource(): Promise<string | null> {
  const project = join(packageRoot(), 'oracle', 'OoxmlValidate.csproj');
  try {
    await access(project);
  } catch {
    return null;
  }

  const output = join(packageRoot(), 'oracle', 'bin', 'Release', 'net10.0', executableName());

  if (await isExecutable(output)) return output;

  process.stderr.write('[ooxml-validate] building the oracle from source\n');
  try {
    await execFile('dotnet', ['build', project, '-c', 'Release'], {maxBuffer: 32 * 1024 * 1024});
  } catch (cause) {
    throw new Error(
      `ooxml-validate: ${FROM_SOURCE} is set but \`dotnet build\` failed. ` +
        'A .NET SDK matching global.json is required for this path.',
      {cause},
    );
  }

  return (await isExecutable(output)) ? output : null;
}

let resolved: Promise<string> | null = null;

/**
 * Resolves the oracle binary, downloading it once if needed. Cached for the process,
 * including the download, so concurrent callers share one fetch rather than racing.
 */
export function resolveValidator(): Promise<string> {
  resolved ??= resolveOnce().catch((error: unknown) => {
    // Do not memoize a failure. A missing binary is very often a transient network
    // problem, and caching the rejection would make every later call in a long-lived
    // process fail for a reason that stopped being true minutes ago.
    resolved = null;
    throw error;
  });
  return resolved;
}

async function resolveOnce(): Promise<string> {
  const override = process.env[BIN_OVERRIDE];
  if (override) {
    if (await isExecutable(override)) return override;
    throw new Error(
      `ooxml-validate: ${BIN_OVERRIDE} is set to ${override}, which is not an executable file.`,
    );
  }

  const platform = currentPlatform();

  if (platform) {
    const cached = cachedBinaryPath(PACKAGE_VERSION, platform);
    if (await isExecutable(cached)) return cached;
  }

  if (process.env[FROM_SOURCE]) {
    const built = await buildFromSource();
    if (built) return built;
    throw new Error(
      `ooxml-validate: ${FROM_SOURCE} is set but no oracle project was found. ` +
        'That path only works inside a checkout of shbernal/ooxml-validate.',
    );
  }

  if (!platform) {
    throw new Error(
      `ooxml-validate: no prebuilt binary for ${process.platform}-${process.arch} ` +
        `(supported: ${SUPPORTED_PLATFORMS.join(', ')}). ` +
        `Build from source with ${FROM_SOURCE}=1 inside a checkout, or set ${BIN_OVERRIDE}.`,
    );
  }

  if (process.env[NO_DOWNLOAD]) {
    throw new Error(
      `ooxml-validate: no cached binary for ${PACKAGE_VERSION} on ${platform}, and ` +
        `${NO_DOWNLOAD} forbids fetching one. Expected it at ` +
        `${cachedBinaryPath(PACKAGE_VERSION, platform)}.`,
    );
  }

  return downloadBinary({version: PACKAGE_VERSION, platform});
}

/** The resolved path, or `null` if the binary cannot be obtained. Never throws. */
export async function validatorPath(): Promise<string | null> {
  try {
    return await resolveValidator();
  } catch {
    return null;
  }
}

/** Test seam: forget the memoized resolution. */
export function resetResolution(): void {
  resolved = null;
}
