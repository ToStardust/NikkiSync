# M4.2.2B Local Extraction Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone read-only .NET 8 probe that mounts local Infinity Nikki archives, inventories candidate resources, and emits provenance-rich evidence for supplied clothing IDs.

**Architecture:** The helper is isolated under `tools/` and is never referenced by the production PC companion or release package. A CLI validates one explicit `Content/Paks` directory, a CUE4Parse adapter is the only archive boundary, and JSON reports are written only to the helper's own ignored `out/` directory.

**Tech Stack:** .NET SDK 8.0.424; C# `net8.0`; CUE4Parse `1.2.2`; xUnit `2.9.2`.

**Spec:** `docs/superpowers/specs/2026-09-04-m4-2-2b-local-extraction-design.md`

## Global Constraints

- Read only the explicitly passed `X6Game/Content/Paks` directory; reject a filesystem root and non-`Paks` directory.
- Never access photo data, UID, NUAN5 parameters, or remote resolver/dictionary configuration.
- Never add this helper or CUE4Parse to production PC/Android packages.
- Use `EGame.GAME_InfinityNikki`; do not silently choose a generic Unreal game version.
- Never report raw-byte matches as clothing evidence; only a loaded record/row/property is `structured-record`.
- This workspace has no `.git`; validation results go into reports/documentation rather than a commit.

---

### Task 1: Scaffold CLI and argument tests

**Files:**

- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/Cue4ParseProbe.sln`
- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/Cue4ParseProbe.csproj`
- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/CliArguments.cs`
- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/Reports.cs`
- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/Program.cs`
- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/test/Cue4ParseProbe.Tests/Cue4ParseProbe.Tests.csproj`
- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/test/Cue4ParseProbe.Tests/CliArgumentsTests.cs`

**Interfaces:**

```csharp
public enum ProbeCommand { Inventory, Probe }
public sealed record ProbeRequest(ProbeCommand Command, string PaksDirectory, IReadOnlyList<string> EntityIds, string OutputDirectory);
public static bool TryParse(string[] args, string workingDirectory, out ProbeRequest? request, out string? error);
```

- [ ] **Step 1: Write failing parser tests**

```csharp
[Fact]
public void Inventory_uses_default_output_directory()
{
    Assert.True(CliArguments.TryParse(["inventory", @"D:\Game\X6Game\Content\Paks"], @"D:\tool", out var request, out var error), error);
    Assert.Equal(ProbeCommand.Inventory, request!.Command);
    Assert.Equal(@"D:\tool\out", request.OutputDirectory);
}

[Fact]
public void Probe_rejects_a_non_ten_digit_id()
{
    Assert.False(CliArguments.TryParse(["probe", @"D:\Game\X6Game\Content\Paks", "not-an-id"], @"D:\tool", out _, out var error));
    Assert.Contains("10-digit", error);
}
```

- [ ] **Step 2: Confirm they fail**

Run: `dotnet test tools/m4-2-local-dictionary-probe/cue4parse-spike/test/Cue4ParseProbe.Tests/Cue4ParseProbe.Tests.csproj --filter FullyQualifiedName~CliArgumentsTests`

Expected: FAIL because the projects/parser are absent.

- [ ] **Step 3: Implement the minimal CLI**

Create a `net8.0` executable and xUnit test project. Parse only `inventory <paks>` or `probe <paks> <one-or-more-IDs>`; IDs must match `^\d{10}$`; default output is `<working-directory>/out`; parsing performs no file I/O.

- [ ] **Step 4: Verify the contract**

Run: `dotnet test tools/m4-2-local-dictionary-probe/cue4parse-spike/test/Cue4ParseProbe.Tests/Cue4ParseProbe.Tests.csproj --filter FullyQualifiedName~CliArgumentsTests`

Expected: PASS.

### Task 2: Add read-only input validation and report schema

**Files:**

- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/PaksDirectory.cs`
- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/ResourceClassifier.cs`
- Modify: `tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/Reports.cs`
- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/test/Cue4ParseProbe.Tests/PaksDirectoryTests.cs`
- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/test/Cue4ParseProbe.Tests/ResourceClassifierTests.cs`
- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/README.md`
- Modify: `NikkiSync/.gitignore`

**Interfaces:**

```csharp
public sealed record PaksFingerprint(int FileCount, long TotalBytes, string Sha256);
public static PaksFingerprint ValidateAndFingerprint(string paksDirectory);
public static void VerifyUnchanged(string paksDirectory, PaksFingerprint before);
public sealed record InventoryEntry(string VirtualPath, string ResourceKind, bool Candidate);
```

- [ ] **Step 1: Write failing safety/classifier tests**

```csharp
[Fact]
public void ValidateAndFingerprint_rejects_a_filesystem_root()
{
    var root = Path.GetPathRoot(Path.GetTempPath())!;
    Assert.Throws<ArgumentException>(() => PaksDirectory.ValidateAndFingerprint(root));
}

[Theory]
[InlineData("/Game/Data/Clothes/DT_Clothes.uasset", "data-table", true)]
[InlineData("/Game/Localization/Default.locres", "localization", true)]
[InlineData("/Game/Movies/Intro.bk2", "media", false)]
public void Classify_is_conservative(string path, string kind, bool candidate)
{
    var result = ResourceClassifier.Classify(path);
    Assert.Equal((kind, candidate), (result.ResourceKind, result.Candidate));
}
```

- [ ] **Step 2: Confirm they fail**

Run: `dotnet test tools/m4-2-local-dictionary-probe/cue4parse-spike/test/Cue4ParseProbe.Tests/Cue4ParseProbe.Tests.csproj --filter "FullyQualifiedName~PaksDirectoryTests|FullyQualifiedName~ResourceClassifierTests"`

Expected: FAIL because the classes are absent.

- [ ] **Step 3: Implement the safety boundary**

Resolve the full path, require leaf name `Paks`, require a `.utoc` or `.pak`, and fingerprint sorted relative path/length/UTC-write-tick tuples with SHA-256. Classify only `data-table`, `string-table`, `localization`, `config`, `json`, `lua`, `media`, and `other`; never label media a candidate. Add ignored `tools/m4-2-local-dictionary-probe/cue4parse-spike/out/`. `README.md` states no game file is written and output is not a dictionary.

- [ ] **Step 4: Verify safety tests**

Run: `dotnet test tools/m4-2-local-dictionary-probe/cue4parse-spike/test/Cue4ParseProbe.Tests/Cue4ParseProbe.Tests.csproj`

Expected: PASS.

### Task 3: Mount archives and write a candidate inventory report

**Files:**

- Modify: `tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/Cue4ParseProbe.csproj`
- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/ArchiveReader.cs`
- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/Cue4ParseArchiveReader.cs`
- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/ProbeRunner.cs`
- Modify: `tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/Program.cs`
- Create: `tools/m4-2-local-dictionary-probe/cue4parse-spike/test/Cue4ParseProbe.Tests/ProbeRunnerTests.cs`

**Interfaces:**

```csharp
public interface IArchiveReader
{
    IReadOnlyList<string> ListVirtualPaths(string paksDirectory);
    IReadOnlyList<EvidenceHit> FindEntityReferences(string paksDirectory, IReadOnlyList<string> entityIds);
}
public sealed record EvidenceHit(string EntityId, string VirtualPath, string ObjectPath, string Field, string Value, string Confidence);
public sealed class ProbeRunner(IArchiveReader reader)
{
    public InventoryReport Run(ProbeRequest request);
}
```

- [ ] **Step 1: Write a failing fake-reader orchestration test**

```csharp
[Fact]
public void Inventory_writes_candidate_paths_and_preserves_input()
{
    using var fixture = PaksFixture.Create();
    var reader = new FakeArchiveReader("/Game/Data/Clothes/DT_Clothes.uasset", "/Game/Movies/Intro.bk2");
    var report = new ProbeRunner(reader).Run(new(ProbeCommand.Inventory, fixture.PaksPath, [], fixture.OutputPath));
    Assert.Single(report.Entries);
    Assert.True(File.Exists(Path.Combine(fixture.OutputPath, "inventory-report.json")));
}
```

- [ ] **Step 2: Confirm it fails**

Run: `dotnet test tools/m4-2-local-dictionary-probe/cue4parse-spike/test/Cue4ParseProbe.Tests/Cue4ParseProbe.Tests.csproj --filter FullyQualifiedName~ProbeRunnerTests`

Expected: FAIL because `IArchiveReader`/`ProbeRunner` are absent.

- [ ] **Step 3: Implement CUE4Parse adapter and report writer**

Add `<PackageReference Include="CUE4Parse" Version="1.2.2" />` only to the helper project. Build `DefaultFileProvider` with the passed Paks directory, `SearchOption.TopDirectoryOnly`, `true`, and `new VersionContainer(EGame.GAME_InfinityNikki)`, then call `Initialize()` and list normalized virtual paths. Wrap mount failures as `ArchiveProbeException` with the original exception type/message. Fingerprint before and after, filter conservative candidates, and write indented `inventory-report.json` with `schemaVersion`, UTC creation time, reader name/version, fingerprint, entries, and diagnostics.

- [ ] **Step 4: Restore, test, build**

```powershell
dotnet restore tools/m4-2-local-dictionary-probe/cue4parse-spike/Cue4ParseProbe.sln
dotnet test tools/m4-2-local-dictionary-probe/cue4parse-spike/test/Cue4ParseProbe.Tests/Cue4ParseProbe.Tests.csproj
dotnet build tools/m4-2-local-dictionary-probe/cue4parse-spike/Cue4ParseProbe.sln --no-restore
```

Expected: PASS. If restore fails, record the exact error and stop rather than substitute another library.

- [ ] **Step 5: Run the first real inventory**

```powershell
dotnet run --project tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/Cue4ParseProbe.csproj -- inventory "D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\Content\Paks"
```

Expected: `out/inventory-report.json` contains a mounted inventory or a specific archive/key/mapping diagnostic, never raw archive bytes.

**Execution note (2026-09-04):** The .NET 8 helper and isolated tests were implemented. The first real `Content/Paks` run completed read-only and kept the input fingerprint unchanged (`4bbbaf5bc3a14f8bb59b13bd83e4a57d4a0334475deefeb6c23852453fbcc2f5`), but CUE4Parse identified 33 containers with `Files=0`, `UnloadedVfs=33`, and no supplied AES key. A later read-only game-root inventory found the current content layer is also `Saved/Paks` plus `Saved/FastPatchPaks`; use `GameArchiveDirectories` before resuming any real inventory. The resulting status is a precise key/access-state diagnostic, not B-1 acceptance.

### Task 4: Add structured target-ID evidence and finalize B-1 handoff

**Files:**

- Modify: `tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/Cue4ParseArchiveReader.cs`
- Modify: `tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/ProbeRunner.cs`
- Modify: `tools/m4-2-local-dictionary-probe/cue4parse-spike/test/Cue4ParseProbe.Tests/ProbeRunnerTests.cs`
- Modify: `tools/m4-2-local-dictionary-probe/cue4parse-spike/README.md`
- Modify: `docs/M4_2_2B_LOCAL_DICTIONARY_EXTRACTION.md`

- [ ] **Step 1: Write a failing structured-provenance test**

```csharp
[Fact]
public void Probe_keeps_record_provenance()
{
    var hit = new EvidenceHit("1020100111", "/Game/Data/Clothes/DT_Clothes.uasset", "DT_Clothes.Row_1020100111", "ItemId", "1020100111", "structured-record");
    var report = ProbeReport.From([hit]);
    Assert.Equal("structured-record", Assert.Single(report.Hits).Confidence);
}
```

- [ ] **Step 2: Implement only structured record inspection**

Use CUE4Parse package/object APIs for candidate assets. Emit a hit only when a target ID is a loaded DataTable row key, StringTable key, object name, or named text property value. If mappings/keys prevent deserialization, emit a diagnostic with virtual path and error class; do not scan arbitrary archive buffers and do not invent a slot/category.

- [ ] **Step 3: Verify and run the real probe**

```powershell
dotnet test tools/m4-2-local-dictionary-probe/cue4parse-spike/test/Cue4ParseProbe.Tests/Cue4ParseProbe.Tests.csproj
dotnet run --project tools/m4-2-local-dictionary-probe/cue4parse-spike/src/Cue4ParseProbe/Cue4ParseProbe.csproj -- probe "D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\Content\Paks" 1020100111 1020600111 1020900111
npm test
```

Expected: helper tests and current TypeScript tests PASS. `probe-report.json` contains either true `structured-record` provenance or specific unsupported/mapping diagnostics.

- [ ] **Step 4: Update evidence boundary**

Update `docs/M4_2_2B_LOCAL_DICTIONARY_EXTRACTION.md` with exact command, archive fingerprint, report paths, and only confirmed findings. If there are no structured hits, retain status `extraction-proof pending`; do not begin localization or manifest generation.

## Plan self-review

- **Spec coverage:** Tasks 1–2 enforce the isolation/read-only/report contract. Task 3 performs the approved archive-aware mount/inventory. Task 4 accepts only structured ID proof and writes a precise handoff.
- **Scope:** Localization, icon extraction, SQLite integration, and production packaging remain explicitly outside this B-1 plan.
- **Consistency:** All tasks use the same `ProbeRequest`, `IArchiveReader`, `EvidenceHit`, and `ProbeRunner` boundaries.
