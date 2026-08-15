// The package's public face.

export {FILE_FORMAT, FILE_FORMATS, isFileFormat} from './formats.ts';
export {validatorAvailable} from './gate.ts';
export type {PlatformId} from './platform.ts';
export {
  cacheRoot,
  currentPlatform,
  SUPPORTED_PLATFORMS,
} from './platform.ts';
export type {ProbeReport, ProbeRow} from './probe.ts';
export {probeFormats} from './probe.ts';
export {resolveValidator, validatorPath} from './resolve.ts';
export {oracleVersion} from './run.ts';
export type {
  BufferInput,
  DiagnosticType,
  FileFormat,
  ValidateOptions,
  ValidationDiagnostic,
  ValidationReport,
  ValidationResult,
} from './types.ts';
export {validate, validateBuffer, validateBuffers} from './validate.ts';
export {PACKAGE_NAME, PACKAGE_VERSION, RELEASE_TAG} from './version.ts';
