"""Prepare immutable icon delta and a cumulative static update catalog.

Run through prepare-release.ps1, which checks the previous catalog signature and
signs the new catalog. No service or application build is needed for later icons.
"""

import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZipFile

from build_delta import build_delta, entries

MAX_DELTA_BYTES = 128 * 1024 * 1024
MAX_CATALOG_BYTES = 512 * 1024
MAX_CHAIN = 512
HASH = re.compile(r"[0-9a-f]{64}\Z")
VERSION = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}\Z")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_pack(path):
    with ZipFile(path) as archive:
        items = entries(archive)
        manifest_bytes = archive.read("manifest.json")
        if len(manifest_bytes) > 4 * 1024 * 1024:
            raise ValueError("Icon manifest is too large")
        manifest = json.loads(manifest_bytes)
        version = manifest.get("version")
        if (manifest.get("schemaVersion") != 2 or manifest.get("imageFormat") != "webp"
                or not isinstance(version, str) or not VERSION.fullmatch(version)):
            raise ValueError("Unsupported icon pack manifest")
        referenced = set()
        for section in ("entries", "fallbackEntries", "effectEntries"):
            for row in manifest.get(section, []):
                name = row["file"]
                if name not in items or not name.endswith(".webp"):
                    raise ValueError("Icon manifest references a missing image")
                image = archive.read(name)
                if (len(image) != row["sizeBytes"] or digest(image) != row["sha256"]
                        or len(image) > 256 * 1024 or image[:4] != b"RIFF"
                        or image[8:12] != b"WEBP" or int.from_bytes(image[4:8], "little") + 8 != len(image)
                        or not 1 <= row["width"] <= 192 or not 1 <= row["height"] <= 192):
                    raise ValueError("Icon manifest image failed validation")
                referenced.add(name)
        if referenced != set(items) - {"manifest.json"}:
            raise ValueError("Icon pack contains unlisted images")
        return version, digest(manifest_bytes)


def validate_previous(catalog, base_version, base_hash):
    if (catalog.get("Schema") != 2 or catalog.get("AppId") != "NikkiSync.Icons"
            or catalog.get("LatestVersion") != base_version
            or catalog.get("LatestManifestSha256") != base_hash):
        raise ValueError("Previous catalog does not match the base pack")
    chain = catalog.get("Deltas")
    if not isinstance(chain, list) or not 1 <= len(chain) < MAX_CHAIN:
        raise ValueError("Previous icon update chain is invalid or full")
    previous = None
    seen = set()
    for item in chain:
        if (not all(isinstance(item.get(key), str) and HASH.fullmatch(item[key])
                    for key in ("BaseManifestSha256", "TargetManifestSha256", "Sha256"))
                or not 0 < item.get("Size", 0) <= MAX_DELTA_BYTES
                or not VERSION.fullmatch(item.get("BaseVersion", ""))
                or not VERSION.fullmatch(item.get("TargetVersion", ""))):
            raise ValueError("Previous catalog has an invalid delta")
        if previous and (previous["TargetManifestSha256"] != item["BaseManifestSha256"]
                         or previous["TargetVersion"] != item["BaseVersion"]):
            raise ValueError("Previous catalog chain is not continuous")
        if item["BaseManifestSha256"] in seen or item["TargetManifestSha256"] in seen:
            raise ValueError("Previous catalog chain has a cycle")
        seen.add(item["BaseManifestSha256"])
        previous = item
    if previous["TargetManifestSha256"] != base_hash:
        raise ValueError("Previous catalog chain does not end at base pack")
    return chain


def prepare(base, target, previous_catalog, output, release_url):
    parts = urlsplit(release_url)
    if (parts.scheme != "https" or not parts.hostname or parts.username or parts.password
            or parts.query or parts.fragment or not parts.path.endswith("/icons-update")):
        raise ValueError("Use the fixed HTTPS icons-update release asset base URL")
    base_version, base_hash = read_pack(base)
    target_version, target_hash = read_pack(target)
    if base_hash == target_hash or base_version == target_version:
        raise ValueError("Target icon pack has no new version")
    previous = json.loads(Path(previous_catalog).read_text(encoding="utf-8")) if previous_catalog else None
    chain = validate_previous(previous, base_version, base_hash) if previous else []
    if output.exists():
        raise FileExistsError("Choose a new output directory; prepared releases are immutable")
    output.mkdir(parents=True)
    delta_name = f"NikkiSync-Icons-{base_version}-to-{target_version}-{target_hash[:12]}.zip"
    delta_path = output / delta_name
    metadata = build_delta(base, target, delta_path)
    if metadata["baseManifestSha256"] != base_hash or metadata["targetManifestSha256"] != target_hash:
        raise ValueError("Delta was built from different pack manifests")
    data = delta_path.read_bytes()
    if not 0 < len(data) <= MAX_DELTA_BYTES:
        raise ValueError("Delta exceeds client size limit")
    item = {
        "BaseVersion": base_version,
        "TargetVersion": target_version,
        "BaseManifestSha256": base_hash,
        "TargetManifestSha256": target_hash,
        "DownloadUrl": release_url.rstrip("/") + "/" + delta_name,
        "Sha256": digest(data),
        "Size": len(data),
    }
    catalog = {
        "Schema": 2, "AppId": "NikkiSync.Icons", "LatestVersion": target_version,
        "LatestManifestSha256": target_hash, "Deltas": [*chain, item],
    }
    catalog_data = json.dumps(catalog, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(catalog_data) > MAX_CATALOG_BYTES:
        raise ValueError("Catalog exceeds client size limit")
    (output / "MomoCamera-Icons-catalog.json").write_bytes(catalog_data)
    report = {
        "baseVersion": base_version, "targetVersion": target_version,
        "newOrChangedImages": len(metadata["files"]), "chainLength": len(catalog["Deltas"]),
        "deltaName": delta_name, "deltaBytes": len(data), "deltaSha256": item["Sha256"],
        "targetManifestSha256": target_hash,
        "uploadOrder": [delta_name, "MomoCamera-Icons-catalog.json", "MomoCamera-Icons-catalog.json.sig"],
    }
    (output / "publish-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--previous-catalog", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--release-url", required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.base, args.target, args.previous_catalog, args.output, args.release_url),
                     ensure_ascii=False))
