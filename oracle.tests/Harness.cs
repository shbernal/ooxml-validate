using System.Reflection;
using OoxmlValidator;

// Every test in this assembly drives Program.Main in-process, which means redirecting
// Console.Out / Console.Error / Console.In — process-global state. Two tests doing that
// concurrently would interleave each other's output and fail at random. Running the CLI
// out-of-process instead would make the tests independent, but at ~0.3 s of startup each
// it would also make them slow enough that people stop running them.
[assembly: CollectionBehavior(DisableTestParallelization = true)]

namespace OoxmlValidator.Tests;

internal sealed record CliResult(int ExitCode, string Stdout, string Stderr);

internal static class Cli
{
    /// <summary>
    /// Runs the CLI's entry point in-process and captures what it wrote where.
    ///
    /// Argument-level, deliberately: which stream carries what, and what the exit code
    /// is, are the contract two consumer repos build their gates on. Testing the pieces
    /// underneath would leave exactly that surface unasserted.
    /// </summary>
    public static CliResult Run(params string[] args) => RunWithStdin(null, args);

    public static CliResult RunWithStdin(string? stdin, params string[] args)
    {
        var stdout = new StringWriter();
        var stderr = new StringWriter();

        var originalOut = Console.Out;
        var originalError = Console.Error;
        var originalIn = Console.In;

        try
        {
            Console.SetOut(stdout);
            Console.SetError(stderr);
            if (stdin is not null)
            {
                Console.SetIn(new StringReader(stdin));
            }

            var exitCode = Program.Main(args);
            return new CliResult(exitCode, stdout.ToString(), stderr.ToString());
        }
        finally
        {
            Console.SetOut(originalOut);
            Console.SetError(originalError);
            Console.SetIn(originalIn);
        }
    }

    /// <summary>
    /// Runs the CLI with the working directory set to <paramref name="directory"/>, so
    /// bare filenames resolve there and the report echoes bare filenames back.
    ///
    /// The working directory is process-global too; this is only safe because test
    /// parallelization is disabled for the assembly (see the attribute above).
    /// </summary>
    public static CliResult RunIn(string directory, params string[] args)
    {
        var original = Directory.GetCurrentDirectory();
        try
        {
            Directory.SetCurrentDirectory(directory);
            return Run(args);
        }
        finally
        {
            Directory.SetCurrentDirectory(original);
        }
    }
}

internal static class Fixtures
{
    /// <summary>Repo root, baked in at compile time by the csproj.</summary>
    public static string RepositoryRoot { get; } =
        typeof(Fixtures).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .Single(attribute => attribute.Key == "RepositoryRoot")
            .Value
        ?? throw new InvalidOperationException("RepositoryRoot assembly metadata is empty.");

    public static string Directory { get; } = Path.Combine(RepositoryRoot, "fixtures");

    public static string Path_(string name) => Path.Combine(Directory, name);

    public const string CleanPptx = "clean.pptx";
    public const string DirtyPptx = "dirty.pptx";
    public const string CleanXlsx = "clean.xlsx";
    public const string DirtyXlsx = "dirty.xlsx";
    public const string CleanDocx = "clean.docx";
    public const string DirtyDocx = "dirty.docx";
    public const string CorruptPptx = "corrupt.pptx";
}

/// <summary>
/// A throwaway directory, removed when the test finishes. Several tests need to give a
/// fixture a different extension, or write a --files-from list, without touching the
/// committed corpus.
/// </summary>
internal sealed class TempDirectory : IDisposable
{
    public string Path { get; }

    public TempDirectory()
    {
        Path = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(),
            "ooxml-validator-tests",
            Guid.NewGuid().ToString("n"));
        System.IO.Directory.CreateDirectory(Path);
    }

    /// <summary>Copies a committed fixture in under a new name, returning the new path.</summary>
    public string CopyFixture(string fixture, string newName)
    {
        var target = System.IO.Path.Combine(Path, newName);
        File.Copy(Fixtures.Path_(fixture), target);
        return target;
    }

    public string WriteText(string name, string contents)
    {
        var target = System.IO.Path.Combine(Path, name);
        File.WriteAllText(target, contents);
        return target;
    }

    public void Dispose()
    {
        try
        {
            System.IO.Directory.Delete(Path, recursive: true);
        }
        catch (IOException)
        {
            // A leaked temp directory is not worth failing a green test run over.
        }
    }
}
