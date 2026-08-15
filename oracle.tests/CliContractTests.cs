using System.Text.Json;

namespace OoxmlValidate.Tests;

/// <summary>
/// The CLI's observable contract: exit codes, which stream carries what, path echo,
/// extension dispatch, batching input, and determinism.
///
/// These are asserted here rather than only through the npm package because two consumer
/// repos build their validation gates on them. A break that surfaces two layers away, as
/// a confusing test failure in a repo about spreadsheets, is a break that costs an hour
/// to locate — and only gets caught at all for the paths that package happens to exercise.
/// </summary>
public sealed class CliContractTests
{
    // ---- exit codes, and which stream carries what -------------------------------

    [Fact]
    public void CleanInput_ExitsZero_WithReportOnStdout()
    {
        var result = Cli.Run(Fixtures.Path_(Fixtures.CleanPptx));

        Assert.Equal(0, result.ExitCode);
        Assert.Equal(string.Empty, result.Stderr);

        var report = Report.Parse(result.Stdout);
        Assert.True(report.Results.Single().Valid);
    }

    [Fact]
    public void ValidationErrors_ExitOne_AndStillReportOnStdout()
    {
        var result = Cli.Run(Fixtures.Path_(Fixtures.DirtyPptx));

        Assert.Equal(1, result.ExitCode);
        Assert.Equal(string.Empty, result.Stderr);

        var single = Report.Parse(result.Stdout).Results.Single();
        Assert.False(single.Valid);
        Assert.NotEmpty(single.Errors);
    }

    // Space-separated rather than a string[] per case: InlineData's parameter is
    // object[], so a nested array is not a constant expression the compiler will accept.
    // None of these arguments contain a space.
    [Theory]
    [InlineData("")]
    [InlineData("--format")]
    [InlineData("--format NotAVersion x.pptx")]
    [InlineData("--files-from")]
    [InlineData("--nonsense")]
    [InlineData("--")]
    public void ArgumentErrors_ExitTwo_WithNothingOnStdout(string commandLine)
    {
        var args = commandLine.Split(' ', StringSplitOptions.RemoveEmptyEntries);

        var result = Cli.Run(args);

        Assert.Equal(2, result.ExitCode);
        Assert.NotEqual(string.Empty, result.Stderr);

        // Never half a JSON document. A consumer that checks the exit code before
        // parsing must never find a truncated report waiting for it.
        Assert.Equal(string.Empty, result.Stdout);
    }

    [Fact]
    public void MissingFile_ExitsTwo_NotOne()
    {
        // A path that names nothing readable is a tool failure, not a finding about a
        // document — unlike a file that exists and will not open. Collapsing the two is
        // how "never actually checked" becomes indistinguishable from "clean".
        var result = Cli.Run(Fixtures.Path_("does-not-exist.pptx"));

        Assert.Equal(2, result.ExitCode);
        Assert.Equal(string.Empty, result.Stdout);
        Assert.Contains("does not exist", result.Stderr, StringComparison.Ordinal);
    }

    [Fact]
    public void Directory_ExitsTwo()
    {
        // A directory whose name ends in an accepted extension passes the extension
        // check, so this is the case that would otherwise reach the SDK and come back as
        // a PackageOpenError — a finding about a document that is not a document.
        using var temp = new TempDirectory();
        var directory = Path.Combine(temp.Path, "looks-like-a-deck.pptx");
        System.IO.Directory.CreateDirectory(directory);

        var result = Cli.Run(directory);

        Assert.Equal(2, result.ExitCode);
        Assert.Equal(string.Empty, result.Stdout);
    }

    [Fact]
    public void UnsupportedExtension_ExitsTwo_AndNamesTheAcceptedSet()
    {
        using var temp = new TempDirectory();
        var notOoxml = temp.WriteText("notes.txt", "hello");

        var result = Cli.Run(notOoxml);

        Assert.Equal(2, result.ExitCode);
        Assert.Equal(string.Empty, result.Stdout);
        Assert.Contains(".pptx", result.Stderr, StringComparison.Ordinal);
        Assert.Contains(".xlsx", result.Stderr, StringComparison.Ordinal);
        Assert.Contains(".docx", result.Stderr, StringComparison.Ordinal);
    }

    // ---- `--` ends the options -----------------------------------------------------

    [Fact]
    public void DoubleDash_EndsTheOptions_AndTheFileAfterItIsValidatedNormally()
    {
        // Consumers reach this program through a package script, and `pnpm run
        // validate:ooxml -- book.xlsx` forwards the separator verbatim. Rejecting it made
        // the habitual spelling the broken one, and the alternative — a wrapper script per
        // repo to shift it off — is the divergence this oracle exists to remove.
        var path = Fixtures.Path_(Fixtures.CleanXlsx);

        var result = Cli.Run("--", path);

        Assert.Equal(0, result.ExitCode);
        Assert.Equal(string.Empty, result.Stderr);

        var single = Report.Parse(result.Stdout).Results.Single();
        Assert.True(single.Valid);
        Assert.Equal(path, single.File);
    }

    [Fact]
    public void DoubleDash_LeavesEarlierOptionsAlone()
    {
        var result = Cli.Run("--format", "Office2013", "--", Fixtures.Path_(Fixtures.CleanPptx));

        Assert.Equal(0, result.ExitCode);
        Assert.Equal("Office2013", Report.Parse(result.Stdout).Format);
    }

    [Fact]
    public void AfterDoubleDash_AnOptionLookalikeIsAPath()
    {
        // The half of the contract that makes `--` worth having: what follows is a path
        // even when it is spelled like a flag. `--version` here must not print a version.
        var result = Cli.Run("--", "--version");

        Assert.Equal(2, result.ExitCode);
        Assert.Equal(string.Empty, result.Stdout);
        Assert.Contains("Unsupported file extension", result.Stderr, StringComparison.Ordinal);
    }

    // ---- a bad package is a finding, not a tool failure ---------------------------

    [Fact]
    public void CorruptPackage_IsADiagnostic_NotACrash()
    {
        var result = Cli.Run(Fixtures.Path_(Fixtures.CorruptPptx));

        Assert.Equal(1, result.ExitCode);
        Assert.Equal(string.Empty, result.Stderr);

        var single = Report.Parse(result.Stdout).Results.Single();
        Assert.False(single.Valid);
        Assert.Equal("PackageOpenError", single.Errors.Single().Id);
        Assert.Equal("Package", single.Errors.Single().Type);
    }

    [Fact]
    public void CorruptPackage_DoesNotLoseItsNeighbours()
    {
        // The reason a bad package becomes a diagnostic rather than an exception: with
        // batches of up to 32, letting one truncated file discard 31 good results would
        // make batching a liability rather than an optimisation.
        var result = Cli.Run(
            Fixtures.Path_(Fixtures.CleanPptx),
            Fixtures.Path_(Fixtures.CorruptPptx),
            Fixtures.Path_(Fixtures.CleanXlsx));

        Assert.Equal(1, result.ExitCode);

        var report = Report.Parse(result.Stdout);
        Assert.Equal(3, report.Results.Count);
        Assert.Equal(2, report.Results.Count(r => r.Valid));
        Assert.Single(report.Results, r => !r.Valid);
    }

    // ---- every input appears, with an explicit flag --------------------------------

    [Fact]
    public void CleanFilesAreReported_NotOmitted()
    {
        // The predecessor omitted clean files, so consumers inferred cleanliness from
        // absence. This test is the whole reason that inference is gone.
        var result = Cli.Run(
            Fixtures.Path_(Fixtures.CleanPptx),
            Fixtures.Path_(Fixtures.CleanXlsx),
            Fixtures.Path_(Fixtures.CleanDocx));

        Assert.Equal(0, result.ExitCode);

        var report = Report.Parse(result.Stdout);
        Assert.Equal(3, report.Results.Count);
        Assert.All(report.Results, r => Assert.True(r.Valid));
        Assert.All(report.Results, r => Assert.Empty(r.Errors));
    }

    // ---- extension dispatch ---------------------------------------------------------

    [Theory]
    [InlineData(Fixtures.CleanXlsx, ".xlsx")]
    [InlineData(Fixtures.CleanXlsx, ".xlsm")]
    [InlineData(Fixtures.CleanXlsx, ".xltx")]
    [InlineData(Fixtures.CleanXlsx, ".xltm")]
    [InlineData(Fixtures.CleanXlsx, ".xlam")]
    [InlineData(Fixtures.CleanPptx, ".pptx")]
    [InlineData(Fixtures.CleanPptx, ".pptm")]
    [InlineData(Fixtures.CleanPptx, ".potx")]
    [InlineData(Fixtures.CleanPptx, ".potm")]
    [InlineData(Fixtures.CleanPptx, ".ppsx")]
    [InlineData(Fixtures.CleanPptx, ".ppsm")]
    [InlineData(Fixtures.CleanPptx, ".ppam")]
    [InlineData(Fixtures.CleanDocx, ".docx")]
    [InlineData(Fixtures.CleanDocx, ".docm")]
    [InlineData(Fixtures.CleanDocx, ".dotx")]
    [InlineData(Fixtures.CleanDocx, ".dotm")]
    public void EveryAcceptedExtension_OpensWithTheRightDocumentType(string fixture, string extension)
    {
        using var temp = new TempDirectory();
        var renamed = temp.CopyFixture(fixture, $"sample{extension}");

        var result = Cli.Run(renamed);

        Assert.Equal(0, result.ExitCode);
        Assert.True(Report.Parse(result.Stdout).Results.Single().Valid);
    }

    [Fact]
    public void DispatchIsByExtension_NotByContent()
    {
        // A presentation named .xlsx is opened as a spreadsheet and fails to open. That
        // is the correct, legible outcome: extension is the only signal available before
        // opening, and this test is what proves the dispatch table is actually consulted
        // rather than the SDK sniffing its way to the right answer regardless.
        using var temp = new TempDirectory();
        var misnamed = temp.CopyFixture(Fixtures.CleanPptx, "presentation-in-disguise.xlsx");

        var result = Cli.Run(misnamed);

        Assert.Equal(1, result.ExitCode);
        Assert.Equal("PackageOpenError", Report.Parse(result.Stdout).Results.Single().Errors.Single().Id);
    }

    // ---- path echo ------------------------------------------------------------------

    [Fact]
    public void PathsAreEchoedVerbatim_NotResolved()
    {
        // Callers validating in-memory content write temp files and hold their own
        // temp-path to handle map. Resolving or canonicalizing here would silently break
        // that map — the results would be correct and unattributable.
        var result = Cli.RunIn(Fixtures.Directory, Fixtures.CleanPptx);

        Assert.Equal(0, result.ExitCode);
        Assert.Equal(Fixtures.CleanPptx, Report.Parse(result.Stdout).Results.Single().File);
    }

    [Fact]
    public void DuplicatePaths_CollapseToOneResult()
    {
        // Consumers key the report by path. Two entries under one key would give them a
        // colliding map and no way to tell which result belonged to which submission.
        var path = Fixtures.Path_(Fixtures.CleanPptx);
        var result = Cli.Run(path, path, path);

        Assert.Equal(0, result.ExitCode);
        Assert.Single(Report.Parse(result.Stdout).Results);
    }

    // ---- determinism ------------------------------------------------------------------

    [Fact]
    public void OutputIsByteIdentical_RegardlessOfArgumentOrder()
    {
        // What makes the committed diagnostic snapshot able to detect an SDK bump's
        // effect: any difference in the output is a difference in the diagnostics, never
        // an artefact of how the batch happened to be assembled.
        var pptx = Fixtures.Path_(Fixtures.CleanPptx);
        var xlsx = Fixtures.Path_(Fixtures.DirtyXlsx);
        var docx = Fixtures.Path_(Fixtures.CleanDocx);

        var first = Cli.Run(pptx, xlsx, docx);
        var second = Cli.Run(docx, pptx, xlsx);
        var third = Cli.Run(xlsx, docx, pptx);

        Assert.Equal(first.Stdout, second.Stdout);
        Assert.Equal(first.Stdout, third.Stdout);
        Assert.Equal(first.ExitCode, second.ExitCode);
        Assert.Equal(first.ExitCode, third.ExitCode);
    }

    // ---- --files-from ------------------------------------------------------------------

    [Fact]
    public void FilesFrom_ReadsAList()
    {
        using var temp = new TempDirectory();
        var list = temp.WriteText(
            "batch.txt",
            $"{Fixtures.Path_(Fixtures.CleanPptx)}\n{Fixtures.Path_(Fixtures.CleanXlsx)}\n");

        var result = Cli.Run("--files-from", list);

        Assert.Equal(0, result.ExitCode);
        Assert.Equal(2, Report.Parse(result.Stdout).Results.Count);
    }

    [Fact]
    public void FilesFrom_TreatsDashAsStdin_AndComposesWithExplicitPaths()
    {
        var result = Cli.RunWithStdin(
            $"{Fixtures.Path_(Fixtures.CleanXlsx)}\n",
            "--files-from",
            "-",
            Fixtures.Path_(Fixtures.CleanPptx));

        Assert.Equal(0, result.ExitCode);
        Assert.Equal(2, Report.Parse(result.Stdout).Results.Count);
    }

    [Fact]
    public void FilesFrom_ToleratesCrlfAndBlankLines()
    {
        using var temp = new TempDirectory();
        var list = temp.WriteText(
            "batch.txt",
            $"\r\n{Fixtures.Path_(Fixtures.CleanPptx)}\r\n\r\n{Fixtures.Path_(Fixtures.CleanXlsx)}\r\n");

        var result = Cli.Run("--files-from", list);

        Assert.Equal(0, result.ExitCode);
        Assert.Equal(2, Report.Parse(result.Stdout).Results.Count);
    }

    [Fact]
    public void FilesFrom_UnreadableList_ExitsTwo()
    {
        var result = Cli.Run("--files-from", Fixtures.Path_("no-such-list.txt"));

        Assert.Equal(2, result.ExitCode);
        Assert.Equal(string.Empty, result.Stdout);
    }

    [Fact]
    public void FilesFrom_HandlesMoreFilesThanArgvWouldHold()
    {
        // The reason --files-from exists at all: batching a large corpus through argv
        // hits ARG_MAX, and the failure is an exec error rather than anything this
        // program could report.
        using var temp = new TempDirectory();
        var paths = Enumerable.Range(0, 400)
            .Select(index => temp.CopyFixture(Fixtures.CleanXlsx, $"copy-{index:0000}.xlsx"));
        var list = temp.WriteText("batch.txt", string.Join('\n', paths));

        var result = Cli.Run("--files-from", list);

        Assert.Equal(0, result.ExitCode);
        Assert.Equal(400, Report.Parse(result.Stdout).Results.Count);
    }

    // ---- --format and --version ---------------------------------------------------------

    [Fact]
    public void DefaultFormatIsMicrosoft365()
    {
        // Never inherited from the SDK, whose own default is Office2007. Microsoft 365 is
        // the strongest check: older targets model less markup and so skip newer
        // constructs rather than rejecting them.
        var result = Cli.Run(Fixtures.Path_(Fixtures.CleanPptx));

        Assert.Equal("Microsoft365", Report.Parse(result.Stdout).Format);
    }

    [Fact]
    public void FormatIsHonoured_AndEchoedInTheReport()
    {
        var result = Cli.Run("--format", "Office2013", Fixtures.Path_(Fixtures.CleanPptx));

        Assert.Equal(0, result.ExitCode);
        Assert.Equal("Office2013", Report.Parse(result.Stdout).Format);
    }

    [Fact]
    public void FormatRejectsNumbersAndFlagCombinations()
    {
        // Enum.TryParse accepts both. Without the IsDefined check they would silently
        // become some other conformance target, or none.
        Assert.Equal(2, Cli.Run("--format", "999", Fixtures.Path_(Fixtures.CleanPptx)).ExitCode);
        Assert.Equal(
            2,
            Cli.Run("--format", "Office2007,Office2010", Fixtures.Path_(Fixtures.CleanPptx)).ExitCode);
    }

    [Fact]
    public void Version_ReportsBothVersions_AndNeedsNoInput()
    {
        var result = Cli.Run("--version");

        Assert.Equal(0, result.ExitCode);

        using var document = JsonDocument.Parse(result.Stdout);
        Assert.False(string.IsNullOrWhiteSpace(document.RootElement.GetProperty("tool").GetString()));

        // Recorded so a moved baseline is always attributable to a specific SDK bump.
        var sdk = document.RootElement.GetProperty("sdkVersion").GetString();
        Assert.False(string.IsNullOrWhiteSpace(sdk));
    }

    [Fact]
    public void EveryReportCarriesTheSdkVersion()
    {
        var result = Cli.Run(Fixtures.Path_(Fixtures.CleanPptx));

        Assert.False(string.IsNullOrWhiteSpace(Report.Parse(result.Stdout).SdkVersion));
    }
}
