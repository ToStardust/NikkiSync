"""Add new clothing IDs from a refreshed source catalog to a WebP 85 icon pack.

The source catalog has {"cdn": "https://.../", "rows": [{"id": "102..."}, ...]}.
Only IDs absent from the installed pack are fetched. Local PNGs named <ID>.png
can be supplied for missing upstream images. The previous images are unchanged.
"""

import argparse
import hashlib
import io
import json
import math
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZipFile

from PIL import Image, ImageChops

from build_delta import entries, write_deterministic
from prepare_release import read_pack

PART_ID = re.compile(r"[1-9][0-9]{9}\Z")
PNG_HEADER = b"\x89PNG\r\n\x1a\n"


class NoNewParts(ValueError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def read_source(part_id, local, cdn, opener):
    local_path = local / (part_id + ".png") if local else None
    if local_path and local_path.is_file():
        raw = local_path.read_bytes()
        origin = "local-png"
    else:
        origin = cdn + part_id + ".png"
        request = urllib.request.Request(origin, headers={"User-Agent": "NikkiSync-IconPackBuilder/1.0"})
        with opener.open(request, timeout=25) as response:
            if response.status != 200:
                raise ValueError(f"Image HTTP {response.status}")
            raw = response.read(2 * 1024 * 1024 + 1)
    if not 45 <= len(raw) <= 2 * 1024 * 1024 or not raw.startswith(PNG_HEADER):
        raise ValueError("Source is not a bounded PNG")
    return raw, origin


def encode(raw):
    with Image.open(io.BytesIO(raw), formats=("PNG",)) as source:
        if max(source.size) > 8192:
            raise ValueError("Source dimensions exceed limit")
        rgba = source.convert("RGBA")
    scale = min(1, 192 / max(rgba.size))
    size = tuple(max(1, math.floor(value * scale + 0.5)) for value in rgba.size)
    if size != rgba.size:
        rgba = rgba.resize(size, Image.Resampling.BILINEAR)
    alpha = rgba.getchannel("A")
    if not alpha.getbbox() or alpha.getextrema()[0] == 255:
        raise ValueError("Source has no usable transparency")
    output = io.BytesIO()
    rgba.save(output, "WEBP", quality=85, method=6, alpha_quality=100)
    image = output.getvalue()
    if not 25 <= len(image) <= 256 * 1024:
        raise ValueError("Encoded WebP exceeds size limit")
    with Image.open(io.BytesIO(image), formats=("WEBP",)) as check:
        if check.size != size or ImageChops.difference(alpha, check.convert("RGBA").getchannel("A")).getbbox():
            raise ValueError("WebP round-trip changed size or alpha")
    return image, size


def build(base, catalog_path, version, output, local=None, delay=1.0, allow_missing=False):
    if output.exists():
        raise FileExistsError("Choose a new target-pack path")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", version):
        raise ValueError("Invalid target version")
    source = json.loads(Path(catalog_path).read_text(encoding="utf-8"))
    cdn = source.get("cdn")
    parsed = urlsplit(cdn or "")
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or not cdn.endswith("/")):
        raise ValueError("Source catalog requires an approved HTTPS CDN base URL")
    rows = source.get("rows")
    if not isinstance(rows, list):
        raise ValueError("Source catalog has no part rows")
    available = set()
    for row in rows:
        part_id = row.get("id") if isinstance(row, dict) else None
        if not isinstance(part_id, str) or not PART_ID.fullmatch(part_id) or part_id in available:
            raise ValueError("Source catalog has an invalid or duplicate part ID")
        available.add(part_id)
    read_pack(base)
    with ZipFile(base) as archive:
        archive_entries = entries(archive)
        manifest = json.loads(archive.read("manifest.json"))
        missing = set(manifest.get("missingPartIds", []))
        known = {row["id"] for row in manifest["entries"]} | missing
        local_fixes = {part_id for part_id in missing & available
                       if local and (Path(local) / (part_id + ".png")).is_file()}
        new_ids = sorted((available - known) | local_fixes)
        if not new_ids:
            raise NoNewParts("Source catalog contains no new clothing IDs")
        opener = urllib.request.build_opener(NoRedirect)
        additions = {}
        failures = {}
        last_request = None
        for part_id in new_ids:
            try:
                local_path = Path(local) / (part_id + ".png") if local else None
                if not (local_path and local_path.is_file()):
                    if last_request is not None and delay > 0:
                        time.sleep(max(0, delay - (time.monotonic() - last_request)))
                    last_request = time.monotonic()
                raw, origin = read_source(part_id, Path(local) if local else None, cdn, opener)
                webp, (width, height) = encode(raw)
                digest = hashlib.sha256(webp).hexdigest()
                additions[f"icons/{part_id}.webp"] = webp
                manifest["entries"].append({
                    "id": part_id, "file": f"icons/{part_id}.webp", "sha256": digest,
                    "sizeBytes": len(webp), "width": width, "height": height,
                    "hasAlpha": True, "source": origin,
                })
            except (OSError, ValueError, urllib.error.URLError) as error:
                failures[part_id] = str(error)[:160]
                if isinstance(error, urllib.error.HTTPError) and error.code in (429, 503):
                    raise RuntimeError("Source CDN is limiting requests; stop and retry later") from error
        if failures and not allow_missing:
            raise ValueError(f"{len(failures)} new icons are missing; provide local PNGs or use --allow-missing")
        if not additions:
            raise ValueError("No new icons could be encoded")
        manifest["version"] = version
        manifest["source"] = cdn
        manifest["packedPartIds"] = len(manifest["entries"])
        manifest["missingPartIds"] = sorted((missing - {name[6:-5] for name in additions}) | set(failures))
        manifest["expectedPartIds"] = len(known | available)
        manifest_bytes = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        output.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(output, "x") as result:
            write_deterministic(result, "manifest.json", manifest_bytes)
            for name in sorted(set(archive_entries) - {"manifest.json"}):
                write_deterministic(result, name, archive.read(name))
            for name, image in sorted(additions.items()):
                write_deterministic(result, name, image)
    read_pack(output)
    report = {"version": version, "newIds": len(new_ids) - len(local_fixes),
              "recoveredIds": len(local_fixes), "addedIcons": len(additions),
              "missingIds": failures, "targetPack": str(output), "targetBytes": output.stat().st_size}
    output.with_suffix(".report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-directory", type=Path)
    parser.add_argument("--delay-seconds", type=float, default=1.0)
    parser.add_argument("--allow-missing", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(build(args.base, args.catalog, args.version, args.output,
                               args.source_directory, args.delay_seconds, args.allow_missing), ensure_ascii=False))
    except NoNewParts:
        print(json.dumps({"status": "up-to-date", "message": "No new clothing IDs to publish"}))
        sys.exit(3)
