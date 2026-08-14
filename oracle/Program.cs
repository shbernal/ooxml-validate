using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;

namespace OoxmlValidator;

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
    /// spend minutes producing output nobody reads.
    /// </summary>
    private const int MaxErrorsPerFile = 1_000;

    private const string Usage =
        "Usage: ooxml-validator [--format <FileFormatVersions>] [--files-from <path|->] [<file> ...]\n" +
        "       ooxml-validator --version";

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
            using var document = OpenDocument(file);
            var validator = new OpenXmlValidator(format) { MaxNumberOfErrors = MaxErrorsPerFile };
            var errors = validator.Validate(document)
                .Select(ToDiagnostic)
                .OrderBy(error => error.PartUri, StringComparer.Ordinal)
                .ThenBy(error => error.XPath, StringComparer.Ordinal)
                .ThenBy(error => error.Id, StringComparer.Ordinal)
                .ThenBy(error => error.Description, StringComparer.Ordinal)
                .ToArray();

            return new FileValidationResult(file, errors.Length == 0, errors);
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
            return new FileValidationResult(file, false, [error]);
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

        for (var index = 0; index < arguments.Count; index += 1)
        {
            var argument = arguments[index];

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
