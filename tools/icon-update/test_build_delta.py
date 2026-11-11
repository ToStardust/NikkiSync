import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from build_delta import build_delta


class BuildDeltaTest(unittest.TestCase):
    def test_additions_and_replacements_are_included(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old, new, delta = (root / name for name in ("old.zip", "new.zip", "delta.zip"))
            with ZipFile(old, "w") as archive:
                archive.writestr("manifest.json", json.dumps({"version": "r2"}))
                archive.writestr("icons/one.webp", b"old")
                archive.writestr("icons/two.webp", b"same")
            with ZipFile(new, "w") as archive:
                archive.writestr("manifest.json", json.dumps({"version": "r3"}))
                archive.writestr("icons/one.webp", b"new")
                archive.writestr("icons/two.webp", b"same")
                archive.writestr("effects/pose-1.webp", b"pose")

            build_delta(old, new, delta)

            with ZipFile(delta) as archive:
                self.assertEqual(set(archive.namelist()), {
                    "update.json", "manifest.json", "icons/one.webp", "effects/pose-1.webp"
                })
                update = json.loads(archive.read("update.json"))
                self.assertEqual(update["baseVersion"], "r2")
                self.assertEqual(update["targetVersion"], "r3")
                self.assertEqual(archive.read("icons/one.webp"), b"new")

    def test_rejects_removed_files_and_unsafe_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old, new, delta = (root / name for name in ("old.zip", "new.zip", "delta.zip"))
            with ZipFile(old, "w") as archive:
                archive.writestr("manifest.json", json.dumps({"version": "r2"}))
                archive.writestr("icons/old.webp", b"old")
            with ZipFile(new, "w") as archive:
                archive.writestr("manifest.json", json.dumps({"version": "r3"}))
                archive.writestr("../outside.webp", b"unsafe")
            with self.assertRaises(ValueError):
                build_delta(old, new, delta)
            self.assertFalse(delta.exists())


if __name__ == "__main__":
    unittest.main()
