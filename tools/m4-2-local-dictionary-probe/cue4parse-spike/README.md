# CUE4Parse local dictionary probe

This is an isolated, .NET 8 development helper for M4.2.2B. It is not linked by the PC companion, Android app, or release package.

It opens only a directory supplied on the command line, records a before/after metadata fingerprint, and writes JSON reports to its explicit output directory. It does not alter game files, export media, send data to the network, or include a game/archive key.

## Commands

From `NikkiSync`:

```powershell
dotnet restore tools/m4-2-local-dictionary-probe/cue4parse-spike/Cue4ParseProbe.sln
dotnet test tools/m4-2-local-dictionary-probe/cue4parse-spike/test/Cue4ParseProbe.Tests/Cue4ParseProbe.Tests.csproj
dotnet run --project tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/Cue4ParseProbe.csproj -- inventory "D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\Content\Paks" --out tools/m4-2-local-dictionary-probe/cue4parse-spike/out/inventory
```

The helper also recognizes the standard current-client source directories when called by a future game-root command:

```text
X6Game/Content/Paks
X6Game/Saved/Paks
X6Game/Saved/FastPatchPaks
```

## Current evidence boundary

The first real `Content/Paks` inventory was read-only and completed with the input fingerprint unchanged, but CUE4Parse recognized encrypted containers without a configured AES key and therefore exposed no virtual paths. This is a specific archive access-state diagnostic, not proof that the dictionary is absent.

Do not obtain keys from process memory, bypass archive protection, or add keys to source code, reports, logs, or releases. Resume extraction only with a legitimate documented CUE4Parse-compatible configuration source.

The CUE4Parse dependency is Apache-2.0. Version `1.2.2` is pinned because it supports the installed .NET 8 SDK.
