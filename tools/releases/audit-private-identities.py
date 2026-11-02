"""Local pre-publication scan. Identity values are supplied in an ignored JSON file.

Scans Git's index or proposed revisions, ZIP/APK/AAB entries, and extracted runtime
directories. Never prints matching identity values. Does not modify scanned files.
"""
import argparse
import io
import json
from pathlib import Path
import subprocess
import zipfile


def git(*args):
    return subprocess.check_output(["git", *args])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--identity-file", required=True)
    parser.add_argument("--index", action="store_true")
    parser.add_argument("--revision")
    parser.add_argument("--base", default="origin/main")
    parser.add_argument("--report", required=True)
    parser.add_argument("paths", nargs="*")
    args = parser.parse_args()
    identities = json.loads(Path(args.identity_file).read_text(encoding="utf-8-sig"))
    if not identities or not all(isinstance(x, str) and x for x in identities):
        raise ValueError("A non-empty private identity list is required")
    patterns = set()
    for value in identities:
        for encoding in ("utf-8", "utf-16le", "utf-16be"):
            patterns.add(value.encode(encoding))
        patterns.add(json.dumps(value, ensure_ascii=True)[1:-1].encode("ascii"))
    findings = []
    count = 0

    def scan(label, data, depth=0):
        nonlocal count
        count += 1
        if any(pattern in data for pattern in patterns):
            findings.append({"path": label, "kind": "private-identity"})
        if depth > 5:
            raise ValueError("Nested archive depth exceeded")
        if data.startswith(b"PK\x03\x04"):
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                for member in archive.infolist():
                    if not member.is_dir():
                        if member.file_size > 1024 ** 3:
                            raise ValueError("Archive entry too large")
                        scan(label + "!/" + member.filename, archive.read(member), depth + 1)

    revisions = []
    if args.index:
        for path in git("ls-files", "-z").split(b"\0"):
            if path:
                name = path.decode("utf-8")
                scan("index:" + name, git("show", ":" + name))
    if args.revision:
        revisions = git("rev-list", args.base + ".." + args.revision).decode().splitlines()
        if args.revision not in revisions:
            revisions.append(args.revision)
        for revision in revisions:
            scan(revision + ":metadata", git("show", "-s", "--format=fuller", revision))
            for path in git("ls-tree", "-r", "--name-only", "-z", revision).split(b"\0"):
                if path:
                    name = path.decode("utf-8")
                    scan(revision + ":" + name, git("show", revision + ":" + name))
    for path in args.paths:
        target = Path(path)
        if not target.exists():
            raise FileNotFoundError(target)
        for file in sorted(target.rglob("*") if target.is_dir() else [target]):
            if file.is_file():
                scan(str(file), file.read_bytes())
    report = {"scanned": count, "revisions": revisions, "findings": findings}
    output = Path(args.report)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=True, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True))
    if not count or findings:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
