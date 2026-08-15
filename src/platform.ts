// Platform identification, and where a downloaded binary lives.

import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

/** The .NET runtime identifiers this package publishes binaries for. */
export const SUPPORTED_PLATFORMS = [
  'linux-x64',
  'linux-arm64',
  'osx-x64',
  'osx-arm64',
  'win-x64',
] as const;

export type PlatformId = (typeof SUPPORTED_PLATFORMS)[number];

const BY_PLATFORM_ARCH: Readonly<Record<string, PlatformId>> = {
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'darwin-x64': 'osx-x64',
  'darwin-arm64': 'osx-arm64',
  'win32-x64': 'win-x64',
};

export function currentPlatform(): PlatformId | null {
  return BY_PLATFORM_ARCH[`${process.platform}-${process.arch}`] ?? null;
}

export function requirePlatform(): PlatformId {
  const platform = currentPlatform();
  if (platform) return platform;

  throw new Error(
    `ooxml-validator: no prebuilt binary for ${process.platform}-${process.arch}. ` +
      `Supported: ${SUPPORTED_PLATFORMS.join(', ')}. ` +
      'With a .NET SDK installed you can build from source instead — see the README.',
  );
}

/**
 * The executable's name inside the archive.
 *
 * The `.exe` suffix is not cosmetic: a bare extensionless path never resolves on
 * Windows, and the failure is silent — resolution reports the binary as missing and
 * validation quietly turns itself off. That exact bug is why this is a function rather
 * than a constant that someone reads once on Linux and assumes is universal.
 */
export function executableName(platform: PlatformId = requirePlatform()): string {
  return platform === 'win-x64' ? 'ooxml-validator.exe' : 'ooxml-validator';
}

/**
 * The release asset for a platform.
 *
 * `.tar.gz` on every platform, Windows included. Two reasons, both practical: tar
 * preserves the executable bit where zip does not, so no post-extraction `chmod` can
 * be forgotten; and Windows 10 1803+ ships bsdtar as `tar.exe`, so one extraction path
 * covers all five targets with no dependency and no branch.
 */
export function assetName(platform: PlatformId = requirePlatform()): string {
  return `ooxml-validator-${platform}.tar.gz`;
}

/**
 * Where downloaded binaries are cached: outside the package directory, so reinstalls
 * and multiple checkouts share one ~110 MB download instead of each paying for it.
 */
export function cacheRoot(): string {
  const override = process.env.OOXML_VALIDATOR_CACHE_DIR;
  if (override) return override;

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) return join(local, 'ooxml-validator', 'Cache');
    return join(tmpdir(), 'ooxml-validator-cache');
  }

  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg) return join(xdg, 'ooxml-validator');
  return join(homedir(), '.cache', 'ooxml-validator');
}

/** Cache location for one version on one platform. */
export function cachedBinaryPath(
  version: string,
  platform: PlatformId = requirePlatform(),
): string {
  return join(cacheRoot(), version, platform, executableName(platform));
}
