// Fetching a release binary, and refusing to use one we cannot vouch for.
//
// Two independent checks, guarding different things:
//
//   * The SHA-256 checksum proves the bytes arrived intact. It proves nothing about
//     where they came from — SHA256SUMS lives in the same GitHub Release as the
//     archives, so whoever could rewrite one could rewrite the other.
//   * The build provenance attestation proves the archive was produced by this repo's
//     release workflow. That is the check that would survive a tampered release.
//
// Either failing is fatal and the cache is not written. A binary this package cannot
// vouch for is worse than no binary: it silently becomes the authority on whether
// every document a consumer produces is valid.

import {execFile as execFileCallback} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {promisify} from 'node:util';
import type {PlatformId} from './platform.ts';
import {assetName, cachedBinaryPath, executableName, requirePlatform} from './platform.ts';

const execFile = promisify(execFileCallback);

const REPO = 'shbernal/ooxml-validate';
const RELEASE_BASE = `https://github.com/${REPO}/releases/download`;

/**
 * Escape hatch for the attestation check, for environments with no route to GitHub's
 * attestation API and no `gh`. Documented rather than silent: skipping is a decision
 * someone makes, not a default that quietly degrades.
 */
const SKIP_ATTESTATION = 'OOXML_VALIDATE_SKIP_ATTESTATION';

export interface DownloadOptions {
  readonly version: string;
  readonly platform?: PlatformId;
  /** Called with human-readable progress notes. Defaults to writing to stderr. */
  readonly onProgress?: (message: string) => void;
}

function defaultProgress(message: string): void {
  process.stderr.write(`[ooxml-validate] ${message}\n`);
}

async function fetchOrThrow(url: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new Error(`ooxml-validate: could not reach ${url}: ${String(cause)}`, {cause});
  }
  if (!response.ok) {
    throw new Error(
      `ooxml-validate: ${url} returned ${response.status} ${response.statusText}. ` +
        'If this is a 404, the release for this package version may not exist yet.',
    );
  }
  return response;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Pulls the expected digest for one asset out of a `sha256sum`-format file.
 *
 * A missing entry is a hard failure rather than "nothing to check against". The
 * whole point of the file is that every asset is in it.
 */
export function expectedDigest(sha256sums: string, asset: string): string {
  for (const line of sha256sums.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (match && match[2] === asset) return match[1] as string;
  }
  throw new Error(
    `ooxml-validate: ${asset} is not listed in SHA256SUMS. Refusing to use an ` +
      'archive with nothing to check it against.',
  );
}

/**
 * Verifies the archive's build provenance with `gh attestation verify`.
 *
 * Fails closed. If `gh` is absent, too old, or cannot reach the attestation API, this
 * throws — the same as a mismatch — because "could not check" and "checked and it was
 * fine" must never produce the same outcome. The escape hatch is an explicit env var.
 */
async function verifyAttestation(
  archivePath: string,
  onProgress: (m: string) => void,
): Promise<void> {
  if (process.env[SKIP_ATTESTATION]) {
    onProgress(`provenance check skipped via ${SKIP_ATTESTATION}`);
    return;
  }

  try {
    await execFile('gh', ['attestation', 'verify', archivePath, '--repo', REPO], {
      env: process.env,
    });
    onProgress('provenance verified');
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `ooxml-validate: could not verify the build provenance of ${archivePath}.\n` +
        `${detail}\n\n` +
        'The checksum proves the download was not truncated; this check proves the archive ' +
        `came from ${REPO}'s release workflow, and it is the one that matters if the release ` +
        'itself were tampered with.\n\n' +
        'Install the GitHub CLI (https://cli.github.com) and authenticate, or — if this ' +
        `environment genuinely cannot reach GitHub's attestation API — set ` +
        `${SKIP_ATTESTATION}=1 to accept the checksum alone.`,
      {cause},
    );
  }
}

/**
 * Extracts a `.tar.gz` with the system `tar`.
 *
 * No dependency and no branch per platform: GNU tar, bsdtar and Windows' bundled
 * `tar.exe` all handle this, and tar preserves the executable bit that zip loses.
 *
 * **Relative paths, with `cwd` doing the work — not a stylistic choice.** Given an
 * absolute Windows path, GNU tar reads the drive letter as an `rsh` host spec and
 * tries to connect to a machine called `C`:
 *
 *     tar (child): Cannot connect to C: resolve failed
 *
 * Windows ships bsdtar, which is fine with drive letters, but Git for Windows puts
 * its GNU tar earlier on PATH — so which one answers is not something this code gets
 * to decide. Relative names have no colon to misread, and every tar accepts them.
 */
async function extract(directory: string, archive: string, into: string): Promise<void> {
  try {
    await execFile('tar', ['-xzf', archive, '-C', into], {cwd: directory});
  } catch (cause) {
    throw new Error(
      `ooxml-validate: could not extract ${archive}. ` +
        'This needs `tar` on PATH (bundled with Windows 10 1803 and later).',
      {cause},
    );
  }
}

/**
 * Makes a freshly-extracted binary runnable on macOS.
 *
 * Downloaded binaries carry quarantine attributes, and an unsigned binary does not run
 * at all on Apple Silicon. Both steps are best-effort: an ad-hoc signature is not a
 * security control, it is what the loader insists on before it will start the process.
 */
async function prepareMacOsBinary(
  binaryPath: string,
  onProgress: (m: string) => void,
): Promise<void> {
  if (process.platform !== 'darwin') return;

  for (const attribute of ['com.apple.quarantine', 'com.apple.provenance']) {
    try {
      await execFile('xattr', ['-d', attribute, binaryPath]);
    } catch {
      // Absent attribute is the common case; nothing to do.
    }
  }

  try {
    await execFile('codesign', ['--force', '--sign', '-', binaryPath]);
  } catch {
    onProgress('codesign failed; the binary may not run on Apple Silicon');
  }
}

/**
 * Downloads, verifies and caches the oracle binary for one version, returning its path.
 *
 * Everything happens in a temp directory and is moved into place only once both checks
 * pass, so a failure can never leave a half-written or unverified binary in the cache
 * for the next run to find and trust.
 */
export async function downloadBinary(options: DownloadOptions): Promise<string> {
  const platform = options.platform ?? requirePlatform();
  const onProgress = options.onProgress ?? defaultProgress;
  const {version} = options;

  const asset = assetName(platform);
  const tag = `v${version}`;
  const target = cachedBinaryPath(version, platform);

  const staging = await mkdtemp(join(tmpdir(), 'ooxml-validate-dl-'));
  try {
    onProgress(`fetching ${asset} ${tag} (~40 MB, once per version)`);

    const [archiveResponse, sumsResponse] = await Promise.all([
      fetchOrThrow(`${RELEASE_BASE}/${tag}/${asset}`),
      fetchOrThrow(`${RELEASE_BASE}/${tag}/SHA256SUMS`),
    ]);

    const archiveBytes = new Uint8Array(await archiveResponse.arrayBuffer());
    const sums = await sumsResponse.text();

    const expected = expectedDigest(sums, asset);
    const actual = sha256(archiveBytes);
    if (actual !== expected) {
      throw new Error(
        `ooxml-validate: checksum mismatch for ${asset}.\n` +
          `  expected ${expected}\n  actual   ${actual}\n` +
          'The download is corrupt or the release has changed. Nothing was cached.',
      );
    }
    onProgress('checksum ok');

    const archivePath = join(staging, asset);
    await writeFile(archivePath, archiveBytes);

    await verifyAttestation(archivePath, onProgress);

    const extractedInto = join(staging, 'unpacked');
    await mkdir(extractedInto, {recursive: true});
    await extract(staging, asset, 'unpacked');

    const extractedBinary = join(extractedInto, executableName(platform));
    try {
      await stat(extractedBinary);
    } catch (cause) {
      throw new Error(`ooxml-validate: ${asset} did not contain ${executableName(platform)}.`, {
        cause,
      });
    }

    await prepareMacOsBinary(extractedBinary, onProgress);

    // Move into the cache last, and only now. Anything that reaches this point has
    // passed both checks, so a binary present in the cache is a binary that was
    // verified — a reader of the cache never has to wonder how it got there.
    await mkdir(dirname(target), {recursive: true});
    await rename(extractedBinary, target).catch(async (cause: unknown) => {
      // rename fails across filesystems, which tmpdir and the cache often are.
      if ((cause as NodeJS.ErrnoException)?.code !== 'EXDEV') throw cause;
      await writeFile(target, await readFile(extractedBinary), {mode: 0o755});
    });

    onProgress(`cached at ${target}`);
    return target;
  } finally {
    await rm(staging, {recursive: true, force: true});
  }
}
