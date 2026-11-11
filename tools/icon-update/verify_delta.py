"""Verify the downloaded test delta against both real packs in an isolated directory."""

import hashlib
import json
import subprocess
import tempfile
from pathlib import Path, PurePosixPath
from zipfile import ZipFile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    root = Path.cwd()
    base = root / "out/current-clothing-webp85-20261109/NikkiSync-ClothingIcons-WebP85-192-20261109-r2.zip"
    target = root / "out/photo-effect-icons-20261110/NikkiSync-ClothingAndPhotoEffects-WebP-20261110-r3.zip"
    delta = root / "out/CNB-r2-to-r3-anonymous.zip"
    with tempfile.TemporaryDirectory(prefix="nikkisync-delta-proof-") as temporary:
        installed = Path(temporary) / "clothing-icons"
        installed.mkdir()
        with ZipFile(base) as archive:
            archive.extractall(installed)
        with ZipFile(delta) as archive:
            metadata = json.loads(archive.read("update.json"))
            if sha((installed / "manifest.json").read_bytes()) != metadata["baseManifestSha256"]:
                raise ValueError("Base manifest does not match")
            new_manifest = archive.read("manifest.json")
            if sha(new_manifest) != metadata["targetManifestSha256"]:
                raise ValueError("Target manifest does not match")
            listed = {item["path"]: item for item in metadata["files"]}
            if set(archive.namelist()) != set(listed) | {"update.json", "manifest.json"}:
                raise ValueError("Unexpected delta entries")
            for name, item in listed.items():
                parts = PurePosixPath(name).parts
                if len(parts) != 2 or parts[0] not in ("icons", "fallbacks", "effects"):
                    raise ValueError("Unexpected image path")
                data = archive.read(name)
                if sha(data) != item["sha256"] or len(data) != item["size"]:
                    raise ValueError("Damaged delta image")
                destination = installed.joinpath(*parts)
                if destination.exists():
                    raise ValueError("This proof accepts additions only")
                destination.parent.mkdir(exist_ok=True)
                destination.write_bytes(data)
            (installed / "manifest.json").write_bytes(new_manifest)
        with ZipFile(target) as archive:
            for entry in archive.infolist():
                if sha(archive.read(entry)) != sha((installed / entry.filename).read_bytes()):
                    raise ValueError("Updated pack differs from target")
        script = '''
import {loadLocalClothingIconPack} from "./apps/pc-companion/dist/src/metadata/LocalClothingIconPack.js";
const p = await loadLocalClothingIconPack(process.argv[1]);
if (!p?.valid || !(await p.read("1020100001")) || !(await p.readEffect("pose", "1090012102"))
    || !(await p.readEffect("lighting", "HueEdgeLight_001_R"))) process.exit(1);
console.log(JSON.stringify({valid:p.valid, clothing:true, pose:true, lighting:true}));
'''
        result = subprocess.run(["node", "--input-type=module", "-e", script, str(installed)],
                                cwd=root, check=True, capture_output=True, text=True)
        print(json.dumps({"updatedFiles": len(listed), "targetFilesVerified": len(archive.infolist()),
                          "clientLoader": json.loads(result.stdout)}))


if __name__ == "__main__":
    main()
