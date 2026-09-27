using System.IO.Compression;

namespace OoxmlValidate.Tests;

/// <summary>
/// The oracle parses untrusted XML, and what keeps entity expansion and external-entity
/// resolution out of reach is DTD processing being off. That is a default inside
/// DocumentFormat.OpenXml, not a choice made anywhere in this repo — so an SDK bump, a
/// package-level check written against a plain XmlDocument, or a leniency change could
/// each turn it on with nothing else noticing. These tests pin it.
///
/// The documents are built here rather than committed: fixtures/ is the corpus behind
/// the diagnostic snapshot, and these are attacks, not documents.
/// </summary>
public sealed class XmlHardeningTests
{
    private const string Slide = "ppt/slides/slide1.xml";

    [Fact]
    public void EntityExpansion_IsRefused_AsAFinding()
    {
        // Nine levels of tenfold expansion: ~10^9 characters if the DTD were honoured.
        const string dtd =
            "<!DOCTYPE p:sld [" +
            "<!ENTITY l0 \"lol\">" +
            "<!ENTITY l1 \"&l0;&l0;&l0;&l0;&l0;&l0;&l0;&l0;&l0;&l0;\">" +
            "<!ENTITY l2 \"&l1;&l1;&l1;&l1;&l1;&l1;&l1;&l1;&l1;&l1;\">" +
            "<!ENTITY l3 \"&l2;&l2;&l2;&l2;&l2;&l2;&l2;&l2;&l2;&l2;\">" +
            "<!ENTITY l4 \"&l3;&l3;&l3;&l3;&l3;&l3;&l3;&l3;&l3;&l3;\">" +
            "<!ENTITY l5 \"&l4;&l4;&l4;&l4;&l4;&l4;&l4;&l4;&l4;&l4;\">" +
            "<!ENTITY l6 \"&l5;&l5;&l5;&l5;&l5;&l5;&l5;&l5;&l5;&l5;\">" +
            "<!ENTITY l7 \"&l6;&l6;&l6;&l6;&l6;&l6;&l6;&l6;&l6;&l6;\">" +
            "<!ENTITY l8 \"&l7;&l7;&l7;&l7;&l7;&l7;&l7;&l7;&l7;&l7;\">" +
            "<!ENTITY l9 \"&l8;&l8;&l8;&l8;&l8;&l8;&l8;&l8;&l8;&l8;\">" +
            "]>";

        using var temp = new TempDirectory();
        var deck = WithDoctype(temp, "laughs.pptx", dtd, "&l9;");

        var result = Cli.Run(deck);

        AssertDtdRefused(result);
    }

    [Fact]
    public void ExternalEntity_IsRefused_AndNothingLeaks()
    {
        using var temp = new TempDirectory();
        const string sentinel = "ooxml-validate-xxe-sentinel-4f1c";
        var secret = temp.WriteText("secret.txt", sentinel);
        var dtd = $"<!DOCTYPE p:sld [<!ENTITY xxe SYSTEM \"{new Uri(secret).AbsoluteUri}\">]>";

        var deck = WithDoctype(temp, "xxe.pptx", dtd, "&xxe;");

        var result = Cli.Run(deck);

        AssertDtdRefused(result);

        // The assertion that catches a leak. A reader that resolved the entity without
        // erroring would pass the refusal check above only if something else also
        // failed; it cannot pass this one.
        Assert.DoesNotContain(sentinel, result.Stdout, StringComparison.Ordinal);
        Assert.DoesNotContain(sentinel, result.Stderr, StringComparison.Ordinal);
    }

    /// <summary>
    /// On the message, not merely on invalidity: a document that failed for some other
    /// reason would satisfy a weaker check while the DTD was being expanded.
    /// </summary>
    private static void AssertDtdRefused(CliResult result)
    {
        Assert.Equal(1, result.ExitCode);
        Assert.Equal(string.Empty, result.Stderr);

        var single = Report.Parse(result.Stdout).Results.Single();
        Assert.False(single.Valid);
        Assert.Contains(
            single.Errors,
            error => error.PartUri == "/" + Slide &&
                     error.Description.Contains("DTD is prohibited", StringComparison.Ordinal));
    }

    /// <summary>
    /// A copy of the clean deck whose first slide carries <paramref name="doctype"/>
    /// after its XML declaration and <paramref name="reference"/> as the text of its
    /// first run.
    /// </summary>
    private static string WithDoctype(TempDirectory temp, string name, string doctype, string reference)
    {
        var deck = temp.CopyFixture(Fixtures.CleanPptx, name);

        using var archive = ZipFile.Open(deck, ZipArchiveMode.Update);
        var entry = archive.GetEntry(Slide)
            ?? throw new InvalidOperationException($"{Fixtures.CleanPptx} has no {Slide}");

        string xml;
        using (var reader = new StreamReader(entry.Open()))
        {
            xml = reader.ReadToEnd();
        }

        var declarationEnd = xml.IndexOf("?>", StringComparison.Ordinal) + 2;
        var textStart = xml.IndexOf("<a:t>", StringComparison.Ordinal) + "<a:t>".Length;
        var textEnd = xml.IndexOf("</a:t>", textStart, StringComparison.Ordinal);
        Assert.True(declarationEnd > 1 && textStart > "<a:t>".Length - 1 && textEnd > 0);

        var rewritten =
            xml[..declarationEnd] + doctype + xml[declarationEnd..textStart] + reference + xml[textEnd..];

        entry.Delete();
        var replacement = archive.CreateEntry(Slide);
        using var writer = new StreamWriter(replacement.Open());
        writer.Write(rewritten);

        return deck;
    }
}
