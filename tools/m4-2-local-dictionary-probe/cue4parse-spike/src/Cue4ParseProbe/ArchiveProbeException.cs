namespace Cue4ParseProbe;

public sealed class ArchiveProbeException(string message, Exception? innerException = null)
    : Exception(message, innerException);
