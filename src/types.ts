// The report contract, mirroring the oracle's output exactly.
//
// These types are the single declaration both consumer repos assert against. Before
// this package existed each kept its own private copy, which is how they drifted onto
// different Open XML SDK versions without anyone noticing.

/**
 * A conformance target. The Open XML SDK's schemas differ per version in how much
 * markup they model, so this is a coverage axis, not a strictness dial — see
 * {@link FILE_FORMATS}.
 */
export type FileFormat =
  | 'Office2007'
  | 'Office2010'
  | 'Office2013'
  | 'Office2016'
  | 'Office2019'
  | 'Office2021'
  | 'Microsoft365';

/** What kind of problem a diagnostic describes. */
export type DiagnosticType =
  /** The markup does not match the schema. */
  | 'Schema'
  /** The markup matches the schema but violates a rule the schema cannot express. */
  | 'Semantic'
  /** An `mc:` markup-compatibility construct is malformed. */
  | 'MarkupCompatibility'
  /** The package itself could not be opened or is structurally wrong. */
  | 'Package';

export interface ValidationDiagnostic {
  /**
   * The SDK's identifier, e.g. `Sch_UndeclaredAttribute`. Package-open failures use
   * the synthetic id `PackageOpenError`.
   */
  readonly id: string;
  readonly type: DiagnosticType;
  readonly description: string;
  /** The part within the package, e.g. `/ppt/slides/slide1.xml`. Null when unattributable. */
  readonly partUri: string | null;
  /** Location within the part. Null when unattributable. */
  readonly xpath: string | null;
}

export interface ValidationResult {
  /**
   * The path as given. For {@link validateBuffer} results this is the caller's own
   * handle or label, substituted for the temp path the oracle actually saw.
   */
  readonly file: string;
  readonly valid: boolean;
  /** Empty when {@link valid}. Capped at 1000 per file by the oracle. */
  readonly errors: readonly ValidationDiagnostic[];
}

export interface ValidationReport {
  /** The conformance target that was applied. */
  readonly format: FileFormat;
  /** The Open XML SDK the oracle actually loaded, e.g. `3.5.1`. */
  readonly sdkVersion: string;
  /**
   * One entry per input file, always. Clean files are present with `valid: true`
   * rather than omitted — never infer cleanliness from absence.
   */
  readonly results: readonly ValidationResult[];
}

export interface ValidateOptions {
  /** Defaults to {@link FILE_FORMAT}. Always sent explicitly to the oracle. */
  readonly format?: FileFormat;
}

/** One in-memory package to validate. */
export interface BufferInput {
  readonly bytes: Uint8Array;
  /**
   * The file extension, with or without the leading dot. The oracle dispatches on it
   * to choose a document type, so it must match the package's real kind.
   */
  readonly ext: string;
  /**
   * What to call this input in the returned result's `file`. Defaults to a generated
   * handle. Correlation is by this value, never by array position.
   */
  readonly label?: string;
}
