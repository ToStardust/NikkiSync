"""Build a verified additive icon-pack delta from two existing release ZIPs."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_deterministic(archive, name, data):
    item = ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
    item.compress_type = ZIP_DEFLATED
    item.external_attr = 0o644 << 16
    archive.writestr(item, data, compress_type=ZIP_DEFLATED, compresslevel=9)


def entries(archive):
    result = {}
    for item in archive.infolist():
        name = item.filename
        parts = PurePosixPath(name).parts
        if (item.is_dir() or name in result or "\\" in name or not parts
                or any(part in (".", "..") for part in parts)
                or PurePosixPath(name).is_absolute()):
            raise ValueError("Invalid archive entry")
        if name != "manifest.json" and (
                len(parts) != 2 or parts[0] not in ("icons", "fallbacks", "effects")
                or not name.endswith(".webp")):
            raise ValueError("Unexpected archive entry")
        result[name] = item
    if "manifest.json" not in result:
        raise ValueError("Missing manifest")
    return result


def build_delta(base_path, target_path, output_path):
    base_path, target_path, output_path = map(Path, (base_path, target_path, output_path))
    with ZipFile(base_path) as base, ZipFile(target_path) as target:
        old, new = entries(base), entries(target)
        if set(old) - set(new):
            raise ValueError("Removed files require a separate migration")
        old_manifest = base.read("manifest.json")
        new_manifest = target.read("manifest.json")
        base_version = json.loads(old_manifest)["version"]
        target_version = json.loads(new_manifest)["version"]
        changed = []
        for name in sorted(set(new) - {"manifest.json"}):
            image = target.read(name)
            if name not in old or digest(base.read(name)) != digest(image):
                changed.append((name, image))
        update = {
            "schemaVersion": 1,
            "baseVersion": base_version,
            "baseManifestSha256": digest(old_manifest),
            "targetVersion": target_version,
            "targetManifestSha256": digest(new_manifest),
            "files": [{"path": name, "sha256": digest(data), "size": len(data)}
                      for name, data in changed],
        }
        with ZipFile(output_path, "x", compression=ZIP_DEFLATED, compresslevel=9) as delta:
            write_deterministic(delta, "update.json", json.dumps(update, ensure_ascii=False, indent=2).encode("utf-8"))
            write_deterministic(delta, "manifest.json", new_manifest)
            for name, data in changed:
                write_deterministic(delta, name, data)
    return update


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("target")
    parser.add_argument("output")
    args = parser.parse_args()
    result = build_delta(args.base, args.target, args.output)
    print(json.dumps({"base": result["baseVersion"], "target": result["targetVersion"],
                      "files": len(result["files"])}))
