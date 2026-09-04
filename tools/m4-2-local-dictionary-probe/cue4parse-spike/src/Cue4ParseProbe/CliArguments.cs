using System.Text.RegularExpressions;

namespace Cue4ParseProbe;

public enum ProbeCommand
{
    Inventory,
    Probe
}

public sealed record ProbeRequest(
    ProbeCommand Command,
    string PaksDirectory,
    IReadOnlyList<string> EntityIds,
    string OutputDirectory);

public static partial class CliArguments
{
    public static bool TryParse(string[] args, string workingDirectory, out ProbeRequest? request, out string? error)
    {
        request = null;
        error = null;
        if (args.Length < 2)
        {
            error = "usage: inventory <Paks-directory> | probe <Paks-directory> <10-digit-entity-id> [...]";
            return false;
        }

        var command = args[0] switch
        {
            "inventory" => ProbeCommand.Inventory,
            "probe" => ProbeCommand.Probe,
            _ => (ProbeCommand?)null
        };
        if (command is null)
        {
            error = "command must be inventory or probe";
            return false;
        }

        var payload = args.Skip(2).ToList();
        var outputDirectory = Path.Combine(workingDirectory, "out");
        var outIndex = payload.IndexOf("--out");
        if (outIndex >= 0)
        {
            if (outIndex != payload.Count - 2 || string.IsNullOrWhiteSpace(payload[outIndex + 1]))
            {
                error = "--out must be followed by one output directory at the end of the command";
                return false;
            }

            outputDirectory = payload[outIndex + 1];
            payload.RemoveRange(outIndex, 2);
        }

        var ids = payload.ToArray();
        if (command == ProbeCommand.Inventory && ids.Length != 0)
        {
            error = "inventory does not accept entity IDs";
            return false;
        }
        if (command == ProbeCommand.Probe && (ids.Length == 0 || ids.Any(id => !EntityId().IsMatch(id))))
        {
            error = "probe requires one or more 10-digit entity IDs";
            return false;
        }

        request = new ProbeRequest(command.Value, args[1], ids, outputDirectory);
        return true;
    }

    [GeneratedRegex("^\\d{10}$", RegexOptions.CultureInvariant)]
    private static partial Regex EntityId();
}
