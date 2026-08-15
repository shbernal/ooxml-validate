import type {FileFormat} from './types.ts';

/**
 * Every conformance target the oracle accepts, **oldest first**. The order is load
 * bearing: {@link probeFormats} reads it as the coverage axis and flags any fixture
 * whose error count decreases along it.
 */
export const FILE_FORMATS: readonly FileFormat[] = [
  'Office2007',
  'Office2010',
  'Office2013',
  'Office2016',
  'Office2019',
  'Office2021',
  'Microsoft365',
];

/**
 * The target this package validates against, pinned here rather than inherited from
 * anything.
 *
 * Two upstream defaults are in play and they disagree: the Open XML SDK's
 * `new OpenXmlValidator()` defaults to `Office2007`, while the wrapper this project
 * replaces defaulted to `Microsoft365`. Inheriting either meant a consumer's
 * conformance bar was whatever its pinned dependency happened to choose, and could
 * move silently on a bump.
 *
 * `Microsoft365` is also the *strongest* available check, not merely the newest. The
 * SDK's per-version schemas differ only in how much markup they model: an older
 * version does not reject newer constructs, it skips them. Measured in `ts-pptx`: a
 * chartEx deck reports 0 errors at Office2007/2010/2013 and 4 at Office2016+ — the
 * older runs are blind, not permissive — while a corrupted core `<p:sp>` attribute is
 * caught identically at every version. Error count is therefore monotonically
 * non-decreasing in version, so validating anywhere below `Microsoft365` can only lose
 * coverage. {@link probeFormats} is the executable form of that claim.
 */
export const FILE_FORMAT: FileFormat = 'Microsoft365';

export function isFileFormat(value: string): value is FileFormat {
  return (FILE_FORMATS as readonly string[]).includes(value);
}
