"""Offline generator verification, including the complete downloaded sources."""
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("builder", Path(__file__).with_name("build-mapping-catalog.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class CatalogBuildTests(unittest.TestCase):
    def test_full_sources_reproduce_pinned_snapshot(self):
        source = Path("generated-artifacts/catalog-sources")
        if not (source / "parts.csv.gz").exists():
            self.skipTest("Explicit complete source downloads not available")
        pinned = json.loads(Path("artifacts/brickbuilder-mobile/src/features/catalog/manifest.json").read_text())
        manifest = builder.build(source, pinned["version"])
        self.assertEqual(manifest, pinned)
        for name in builder.FILES:
            self.assertGreater(manifest["sources"][name]["rows"], 0)

    def test_unexpected_schema_is_rejected_not_silently_truncated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "parts.csv.gz").write_bytes(gzip.compress(b"wrong,columns\n1,test\n", mtime=0))
            with self.assertRaisesRegex(ValueError, "Unexpected CSV schema"):
                builder.build(root, "test")

    def test_bad_mapping_flag_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            records = {
                "parts": "p,Test,1,Plastic\n", "colors": "0,Black,000000,False,1,1,2000,2026\n",
                "part_mappings": "p,LD,part,yes,True\n", "color_mappings": "0,LD,0,[],True,True\n",
            }
            for name, columns in builder.FILES.items():
                (root / (name + ".csv.gz")).write_bytes(gzip.compress((",".join(columns) + "\n" + records[name]).encode(), mtime=0))
            with self.assertRaisesRegex(ValueError, "Invalid mapping direction"):
                builder.build(root, "test")

if __name__ == "__main__":
    unittest.main()
