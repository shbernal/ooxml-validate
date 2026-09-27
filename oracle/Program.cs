using System.IO.Compression;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;

namespace OoxmlValidate;

/// <summary>
/// Validates OOXML packages against the Open XML SDK's schema validator and reports
/// the diagnostics as JSON.
///
/// Three properties of this program are load-bearing for its consumers, and none of
/// them are obvious from the code alone:
///
///   1. <b>Exit codes carry meaning.</b> 0 = every input clean, 1 = validation errors
///      found, 2 = the tool could not run. Diagnostics go to stdout as JSON; tool
///      failures go to stderr as text, and stdout stays empty. The predecessor to this
///      program caught every exception, printed it to stdout and exited 0, which made a
///      corrupt file indistinguishable from a clean one by exit code.
///
///   2. <b>Every input file appears in the report, with an explicit `valid` flag.</b>
///      Clean files are never omitted. Consumers must not infer cleanliness from
///      absence.
///
///   3. <b>Output is deterministic.</b> Results are ordered by path and diagnostics by
///      (partUri, xpath, id, description), all ordinal. Two runs over the same inputs in
///      a different argument order produce byte-identical stdout — which is what lets a
///      committed diagnostic snapshot detect an SDK bump's effect.
/// </summary>
internal static class Program
{
    private const int Success = 0;
    private const int ValidationFailure = 1;
    private const int ToolFailure = 2;

    /// <summary>
    /// Per-file cap. A package that is broken enough to produce thousands of errors is
    /// already answered by the first few, and an uncapped run on a pathological file can
    /// spend minutes producing output nobody reads. Reaching it sets `truncated` on the
    /// result: a capped list is a prefix of the real set, and a baseline recorded from
    /// it can lose an entry on an SDK bump that fixed nothing.
    /// </summary>
    private const int MaxErrorsPerFile = 1_000;

    /// <summary>
    /// Ceiling on a package's total uncompressed size, as its zip central directory
    /// declares it. Far above any real Office document and far below what hurts: a
    /// 2 MB package whose one part inflates to 2 GB drove this process past 4 GB of RSS,
    /// which on a CI runner is the kernel's OOM-killer ending the run with no report at
    /// all rather than a finding about one file.
    /// </summary>
    private const long MaxUncompressedBytes = 512L * 1024 * 1024;

    private const string Usage =
        "Usage: ooxml-validate [--format <FileFormatVersions>] [--files-from <path|->] [--] [<file> ...]\n" +
        "       ooxml-validate --version";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        WriteIndented = true,
    };

    public static int Main(string[] args)
    {
        try
        {
            var options = CliOptions.Parse(args);

            if (options.ShowVersion)
            {
                Write(new VersionReport(ToolVersion(), SdkVersion()));
                return Success;
            }

            var results = options.Files
                .Select(file => ValidateFile(file, options.Format))
                .OrderBy(result => result.File, StringComparer.Ordinal)
                .ToArray();

            Write(new ValidationReport(options.Format.ToString(), SdkVersion(), results));
            return results.All(result => result.Valid) ? Success : ValidationFailure;
        }
        catch (CliException exception)
        {
            Console.Error.WriteLine(exception.Message);
            Console.Error.WriteLine(Usage);
            return ToolFailure;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"OOXML validator failed: {exception.Message}");
            return ToolFailure;
        }
    }

    /// <summary>
    /// Serialize fully, then write once. Not a style preference: a streaming serializer
    /// that throws mid-document would leave half a JSON object on stdout alongside a
    /// non-zero exit code, and a consumer that trusts the exit code before parsing would
    /// see a truncated report rather than no report.
    /// </summary>
    private static void Write<T>(T payload)
    {
        var json = JsonSerializer.Serialize(payload, JsonOptions);
        Console.Out.WriteLine(json);
    }

    private static FileValidationResult ValidateFile(string file, FileFormatVersions format)
    {
        try
        {
            if (DeclaredTooLarge(file) is { } declared)
            {
                var error = new ValidationDiagnostic(
                    "PackageTooLarge",
                    "Limit",
                    $"The package declares {declared} bytes uncompressed; the limit is " +
                    $"{MaxUncompressedBytes}. It was not opened.",
                    null,
                    null);
                return new FileValidationResult(file, false, false, [error]);
            }

            using var document = OpenDocument(file);
            // One past the cap, so "stopped at the cap" and "found exactly the cap" are
            // distinguishable. The extra diagnostic is only a witness and is dropped.
            var validator = new OpenXmlValidator(format) { MaxNumberOfErrors = MaxErrorsPerFile + 1 };
            var found = validator.Validate(document)
                .Select(ToDiagnostic)
                .OrderBy(error => error.PartUri, StringComparer.Ordinal)
                .ThenBy(error => error.XPath, StringComparer.Ordinal)
                .ThenBy(error => error.Id, StringComparer.Ordinal)
                .ThenBy(error => error.Description, StringComparer.Ordinal)
                .ToArray();
            var truncated = found.Length > MaxErrorsPerFile;
            var errors = truncated ? found[..MaxErrorsPerFile] : found;

            return new FileValidationResult(file, errors.Length == 0, truncated, errors);
        }
        catch (CliException)
        {
            // A CliException means the tool was used wrongly, which is exit 2 wherever it
            // is thrown. Caught below it would become a finding about the file, exit 1.
            // Parse rejects unsupported extensions before any file is opened, so nothing
            // throws one here today; this keeps the type's meaning if that changes.
            throw;
        }
        catch (Exception exception)
        {
            // A package that will not open is a finding about that package, not a
            // failure of the tool: it becomes a diagnostic on that file and the rest of
            // the batch is still validated and still reported. This is why a corrupt
            // input yields exit 1 rather than exit 2 — the tool ran fine, the file is
            // bad. Losing 31 good results because the 32nd was truncated would make
            // batching a liability.
            var error = new ValidationDiagnostic(
                "PackageOpenError",
                "Package",
                exception.Message,
                null,
                null);
            return new FileValidationResult(file, false, false, [error]);
        }
    }

    /// <summary>
    /// The package's declared uncompressed size, if it exceeds
    /// <see cref="MaxUncompressedBytes"/>; otherwise null.
    ///
    /// Reads only the central directory, so it costs nothing on an honest package. The
    /// directory is written by whoever made the file and can understate the truth; this
    /// is the cheap filter for the ordinary case, and the GC heap limit the npm package
    /// sets on this process is what bounds a package that lies. A file that is not a
    /// readable zip at all is left to the SDK, whose own error is the finding the
    /// diagnostic snapshot records for it.
    /// </summary>
    private static long? DeclaredTooLarge(string file)
    {
        try
        {
            using var archive = ZipFile.OpenRead(file);
            long total = 0;
            foreach (var entry in archive.Entries)
            {
                // Saturating: the sizes are the file's own claims, and a sum that
                // overflowed into a negative would wave the package through.
                total = entry.Length > long.MaxValue - total ? long.MaxValue : total + entry.Length;
            }

            return total > MaxUncompressedBytes ? total : null;
        }
        catch (Exception exception) when (exception is InvalidDataException or IOException)
        {
            return null;
        }
    }

    private static OpenXmlPackage OpenDocument(string file)
    {
        var kind = DocumentKinds.Classify(file)
            ?? throw new CliException($"Unsupported file extension: {file}");

        return kind switch
        {
            DocumentKind.Spreadsheet => SpreadsheetDocument.Open(file, false),
            DocumentKind.Presentation => PresentationDocument.Open(file, false),
            DocumentKind.Wordprocessing => WordprocessingDocument.Open(file, false),
            _ => throw new CliException($"Unsupported file extension: {file}"),
        };
    }

    private static ValidationDiagnostic ToDiagnostic(ValidationErrorInfo error)
    {
        return new ValidationDiagnostic(
            error.Id ?? "UnknownValidationError",
            error.ErrorType.ToString(),
            error.Description ?? "OpenXmlValidator returned no description.",
            error.Part?.Uri.ToString() ?? error.Path?.PartUri?.ToString(),
            error.Path?.XPath);
    }

    private static string ToolVersion() => InformationalVersion(typeof(Program).Assembly);

    /// <summary>
    /// The Open XML SDK version actually loaded, read off the assembly that defines the
    /// validator rather than off the csproj. It is recorded in every report so a
    /// baseline diff is always attributable to a specific SDK bump — and reading it from
    /// the running assembly means it cannot disagree with the code that produced the
    /// diagnostics, which a build-time constant could.
    /// </summary>
    private static string SdkVersion() => InformationalVersion(typeof(OpenXmlValidator).Assembly);

    private static string InformationalVersion(Assembly assembly)
    {
        var informational = assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion;

        if (!string.IsNullOrEmpty(informational))
        {
            // SourceLink appends "+<commit sha>"; the package version is the part before it.
            var plus = informational.IndexOf('+', StringComparison.Ordinal);
            return plus >= 0 ? informational[..plus] : informational;
        }

        return assembly.GetName().Version?.ToString() ?? "unknown";
    }
}

internal enum DocumentKind
{
    Spreadsheet,
    Presentation,
    Wordprocessing,
}

internal static class DocumentKinds
{
    /// <summary>
    /// Which SDK document type opens a given path, by extension. Extension is the only
    /// signal available before opening, and opening with the wrong type fails in ways
    /// that read as corruption rather than as a mismatch.
    /// </summary>
    private static readonly Dictionary<string, DocumentKind> ByExtension =
        new(StringComparer.OrdinalIgnoreCase)
        {
            [".xlsx"] = DocumentKind.Spreadsheet,
            [".xlsm"] = DocumentKind.Spreadsheet,
            [".xltx"] = DocumentKind.Spreadsheet,
            [".xltm"] = DocumentKind.Spreadsheet,
            [".xlam"] = DocumentKind.Spreadsheet,

            [".pptx"] = DocumentKind.Presentation,
            [".pptm"] = DocumentKind.Presentation,
            [".potx"] = DocumentKind.Presentation,
            [".potm"] = DocumentKind.Presentation,
            [".ppsx"] = DocumentKind.Presentation,
            [".ppsm"] = DocumentKind.Presentation,
            [".ppam"] = DocumentKind.Presentation,

            [".docx"] = DocumentKind.Wordprocessing,
            [".docm"] = DocumentKind.Wordprocessing,
            [".dotx"] = DocumentKind.Wordprocessing,
            [".dotm"] = DocumentKind.Wordprocessing,
        };

    public static readonly string Accepted =
        string.Join(" ", ByExtension.Keys.OrderBy(extension => extension, StringComparer.Ordinal));

    public static DocumentKind? Classify(string file)
    {
        var extension = Path.GetExtension(file);
        return ByExtension.TryGetValue(extension, out var kind) ? kind : null;
    }
}

internal sealed record VersionReport(string Tool, string SdkVersion);

internal sealed record ValidationReport(
    string Format,
    string SdkVersion,
    IReadOnlyList<FileValidationResult> Results);

internal sealed record FileValidationResult(
    string File,
    bool Valid,
    bool Truncated,
    IReadOnlyList<ValidationDiagnostic> Errors);

internal sealed record ValidationDiagnostic(
    string Id,
    string Type,
    string Description,
    string? PartUri,
    [property: JsonPropertyName("xpath")] string? XPath);

internal sealed record CliOptions(FileFormatVersions Format, IReadOnlyList<string> Files, bool ShowVersion)
{
    /// <summary>
    /// Microsoft 365 is the default because it is the <i>strongest</i> check, not merely
    /// the newest. The SDK's per-version schemas differ in how much markup they model, so
    /// an older target skips newer constructs rather than rejecting them — error count is
    /// monotonically non-decreasing as the target rises, and validating lower can only
    /// lose coverage. The npm package passes this explicitly anyway; a default that a
    /// caller silently inherits is how two consumers end up validating against different
    /// rule sets, which is the defect this whole project exists to remove.
    /// </summary>
    private const FileFormatVersions DefaultFormat = FileFormatVersions.Microsoft365;

    public static CliOptions Parse(IReadOnlyList<string> arguments)
    {
        var format = DefaultFormat;
        var showVersion = false;
        var files = new List<string>();
        var endOfOptions = false;

        for (var index = 0; index < arguments.Count; index += 1)
        {
            var argument = arguments[index];

            if (endOfOptions)
            {
                files.Add(argument);
                continue;
            }

            if (argument == "--")
            {
                // Everything after this is a path, whatever it looks like. Consumers reach
                // this program through a package script, and `pnpm run validate:ooxml --
                // book.xlsx` forwards the separator verbatim — so the habitual spelling was
                // the one that failed with "Unknown option: --". A per-repo wrapper that
                // shifted it off is exactly the divergence this oracle exists to remove.
                // It also makes a file genuinely named like an option addressable.
                endOfOptions = true;
                continue;
            }

            if (argument == "--version")
            {
                showVersion = true;
                continue;
            }

            if (argument == "--format")
            {
                var value = ValueFor(arguments, index, "--format");
                if (!Enum.TryParse(value, true, out format) || !Enum.IsDefined(format))
                {
                    // Enum.TryParse also accepts raw numbers and flag combinations, so
                    // IsDefined is what rejects `--format 999` and `--format
                    // Office2007,Office2010` rather than validating against a schema
                    // nobody asked for.
                    throw new CliException($"Unsupported file format version: {value}");
                }

                index += 1;
                continue;
            }

            if (argument == "--files-from")
            {
                var source = ValueFor(arguments, index, "--files-from");
                files.AddRange(ReadList(source));
                index += 1;
                continue;
            }

            if (argument.StartsWith('-'))
            {
                throw new CliException($"Unknown option: {argument}");
            }

            files.Add(argument);
        }

        if (showVersion)
        {
            return new CliOptions(format, [], true);
        }

        // Exact-string duplicates collapse to one entry. Consumers key the report by
        // path, so emitting the same path twice would hand them a map with a colliding
        // key and no way to tell which result belonged to which submission. Two
        // different spellings of the same file stay two entries — see the note on
        // verbatim echo below.
        var unique = files.Distinct(StringComparer.Ordinal).ToArray();

        if (unique.Length == 0)
        {
            throw new CliException("At least one input file is required.");
        }

        foreach (var file in unique)
        {
            if (DocumentKinds.Classify(file) is null)
            {
                throw new CliException(
                    $"Unsupported file extension: {file}. Accepted: {DocumentKinds.Accepted}");
            }

            if (!File.Exists(file))
            {
                // Also the answer for a directory, which File.Exists reports as absent.
                // A path that names nothing readable is a tool failure (exit 2), not a
                // validation finding — unlike a file that exists and will not open,
                // which is a finding about that file.
                throw new CliException($"File does not exist: {file}");
            }
        }

        return new CliOptions(format, unique, false);
    }

    /// <summary>
    /// Paths are recorded exactly as given — not resolved, not canonicalized, not
    /// relabelled — and the report echoes them back the same way.
    ///
    /// This keeps the oracle dumb about identity, which is the point. Callers validating
    /// in-memory content write temp files and hold their own temp-path → handle map; if
    /// this program rewrote paths, that map would silently stop matching. There is
    /// deliberately no alias or label channel in --files-from either: a line is a path,
    /// and `file` has exactly one meaning on the wire.
    /// </summary>
    private static IEnumerable<string> ReadList(string source)
    {
        string text;
        try
        {
            text = source == "-" ? Console.In.ReadToEnd() : File.ReadAllText(source);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            throw new CliException($"Could not read --files-from {source}: {exception.Message}");
        }

        foreach (var raw in text.Split('\n'))
        {
            // Strip only a trailing CR, so a list written on Windows works. Nothing else
            // is trimmed: leading and trailing spaces are legal in a filename, and
            // quietly trimming them would turn a findable file into "does not exist".
            var line = raw.EndsWith('\r') ? raw[..^1] : raw;
            if (line.Length > 0)
            {
                yield return line;
            }
        }
    }

    private static string ValueFor(IReadOnlyList<string> arguments, int index, string option)
    {
        if (index + 1 >= arguments.Count)
        {
            throw new CliException($"{option} requires a value.");
        }

        return arguments[index + 1];
    }
}

internal sealed class CliException(string message) : Exception(message);
