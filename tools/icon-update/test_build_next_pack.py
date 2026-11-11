import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from PIL import Image, ImageDraw

from build_delta import write_deterministic
from build_next_pack import NoNewParts, build
from prepare_release import read_pack


class BuildNextPackTest(unittest.TestCase):
    def test_adds_new_id_and_recovers_locally_supplied_missing_icon(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cdn = "https://cdn.gongeo.us/images/items/icons/"
            missing, new = "1020100001", "1020100002"
            source = root / "catalog.json"
            source.write_text(json.dumps({"cdn": cdn, "rows": [{"id": missing}, {"id": new}]}))
            manifest = {"schemaVersion": 2, "imageFormat": "webp", "version": "r2", "source": cdn,
                        "entries": [], "fallbackEntries": [], "effectEntries": [],
                        "missingPartIds": [missing], "expectedPartIds": 1, "packedPartIds": 0}
            base = root / "base.zip"
            with ZipFile(base, "x") as archive:
                write_deterministic(archive, "manifest.json", json.dumps(manifest).encode())
            for part in (missing, new):
                image = Image.new("RGBA", (72, 120), (0, 0, 0, 0))
                ImageDraw.Draw(image).ellipse((8, 8, 64, 112), fill=(202, 105, 173, 210))
                image.save(root / (part + ".png"))
            target = root / "target.zip"
            report = build(base, source, "r3", target, root)
            self.assertEqual((1, 1, 2), (report["newIds"], report["recoveredIds"], report["addedIcons"]))
            self.assertEqual("r3", read_pack(target)[0])
            with ZipFile(target) as archive:
                actual = json.loads(archive.read("manifest.json"))
                self.assertEqual([], actual["missingPartIds"])
                self.assertEqual(2, actual["packedPartIds"])
                self.assertIn("icons/1020100001.webp", archive.namelist())
                self.assertIn("icons/1020100002.webp", archive.namelist())
            with self.assertRaises(NoNewParts):
                build(target, source, "r4", root / "none.zip", root)


if __name__ == "__main__":
    unittest.main()
