using System.Text.Json;
using System.Text.Json.Serialization;

namespace OoxmlValidator.Tests;

/// <summary>
/// The report shape, redeclared here rather than reused from the CLI's own records.
///
/// That duplication is the point. These types are the contract as a consumer sees it —
/// property names included — so a rename on the CLI side that a shared type would have
/// carried along silently fails here instead, which is where it should fail.
/// </summary>
internal sealed record Report(
    string Format,
    string SdkVersion,
    IReadOnlyList<ReportResult> Results)
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
    };

    public static Report Parse(string stdout) =>
        JsonSerializer.Deserialize<Report>(stdout, Options)
        ?? throw new InvalidOperationException($"report did not parse: {stdout}");
}

internal sealed record ReportResult(
    string File,
    bool Valid,
    IReadOnlyList<ReportDiagnostic> Errors);

internal sealed record ReportDiagnostic(
    string Id,
    string Type,
    string Description,
    string? PartUri,
    [property: JsonPropertyName("xpath")] string? XPath);
