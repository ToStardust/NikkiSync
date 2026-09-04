namespace Cue4ParseProbe;

public static class ProgramAnchor
{
}

public static class Program
{
    public static int Main(string[] args)
    {
        if (!CliArguments.TryParse(args, AppContext.BaseDirectory, out var request, out var error))
        {
            Console.Error.WriteLine(error);
            return 2;
        }

        try
        {
            var runner = new ProbeRunner(new Cue4ParseArchiveReader());
            runner.Run(request!);
            return 0;
        }
        catch (ArchiveProbeException archiveError)
        {
            Console.Error.WriteLine(archiveError.Message);
            return 1;
        }
    }
}
