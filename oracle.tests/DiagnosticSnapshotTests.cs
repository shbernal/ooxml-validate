namespace OoxmlValidator.Tests;

/// <summary>
/// The SDK-bump guardrail.
///
/// This repo is the only place `DocumentFormat.OpenXml` is pinned, which means a bump
/// here moves what *both* consumer repos consider a passing build — with nothing in the
/// bump's own diff to show it. Without this test the sequence is: Renovate opens a bump,
/// CI is green because nothing here asserts anything about diagnostics, it releases, and
/// the delta surfaces weeks later as a red build in a consumer repo inside a PR about
/// something else, where the cheap way out is to baseline it away and get on with the
/// real work. That is how a genuine writer defect gets silently accepted.
///
/// So: the committed snapshot is the full report over the fixture corpus, and a bump PR
/// carries its own delta. The reviewer sees which diagnostics appeared and disappeared
/// while the SDK change is the only thing on screen.
///
/// To re-record after a deliberate change:
///
///     OOXML_VALIDATOR_UPDATE_SNAPSHOT=1 dotnet test oracle.tests/OoxmlValidator.Tests.csproj
///
/// then read the diff before committing it. Re-recording without reading it is the same
/// as not having this test.
/// </summary>
public sealed class DiagnosticSnapshotTests
{
    private const string SnapshotName = "diagnostics.snapshot.json";
    private const string UpdateVariable = "OOXML_VALIDATOR_UPDATE_SNAPSHOT";

    /// <summary>
    /// The corpus, named explicitly rather than globbed. A glob would quietly shrink the
    /// guardrail if a fixture were ever deleted, and quietly change the snapshot if one
    /// were added — both without a word in the diff about the corpus itself.
    /// </summary>
    private static readonly string[] Corpus =
    [
        Fixtures.CleanDocx,
        Fixtures.CleanPptx,
        Fixtures.CleanXlsx,
        Fixtures.CorruptPptx,
        Fixtures.DirtyDocx,
        Fixtures.DirtyPptx,
        Fixtures.DirtyXlsx,
    ];

    [Fact]
    public void DiagnosticsOverTheCorpusMatchTheCommittedSnapshot()
    {
        // Run from inside fixtures/ with bare filenames, so the report echoes bare
        // filenames and the snapshot is identical on every machine. This is also exactly
        // what `ooxml-validator *` prints from that directory, so a human can reproduce
        // the snapshot by hand without knowing anything about this test.
        var result = Cli.RunIn(Fixtures.Directory, Corpus);

        Assert.Equal(string.Empty, result.Stderr);
        Assert.Equal(1, result.ExitCode); // the corpus deliberately contains invalid packages

        var snapshotPath = Path.Combine(Fixtures.Directory, SnapshotName);
        var actual = Normalize(result.Stdout);

        if (Environment.GetEnvironmentVariable(UpdateVariable) is not null)
        {
            File.WriteAllText(snapshotPath, actual);
            return;
        }

        Assert.True(
            File.Exists(snapshotPath),
            $"No committed snapshot at {snapshotPath}. Record one with "
                + $"{UpdateVariable}=1 dotnet test, then read the result before committing it.");

        var expected = Normalize(File.ReadAllText(snapshotPath));

        Assert.True(
            expected == actual,
            "The diagnostics over the fixture corpus have moved.\n\n"
                + "If this is an Open XML SDK bump, that is what this test is for: every changed "
                + "diagnostic needs a verdict — a real defect in a consumer's writer, or a "
                + "stricter/changed rule — recorded in the PR. See docs/sdk-pin.md.\n\n"
                + $"Re-record with: {UpdateVariable}=1 dotnet test oracle.tests/OoxmlValidator.Tests.csproj");
    }

    [Fact]
    public void EveryCorpusFixtureExists()
    {
        // The snapshot test would otherwise report a missing fixture as a moved
        // diagnostic, which sends the reader looking at the SDK instead of at the corpus.
        foreach (var fixture in Corpus)
        {
            Assert.True(
                File.Exists(Fixtures.Path_(fixture)),
                $"Missing corpus fixture: {fixture}. See fixtures/README.md.");
        }
    }

    /// <summary>Line endings only — the content itself is already deterministic.</summary>
    private static string Normalize(string text) =>
        text.ReplaceLineEndings("\n").TrimEnd() + "\n";
}
