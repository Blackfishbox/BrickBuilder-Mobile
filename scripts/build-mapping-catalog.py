#!/usr/bin/env python3
"""Build a deterministic, complete public Rebrickable CSV snapshot; no scraping."""
import argparse
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
from urllib.request import urlopen

FILES = {
    "parts": ["part_num", "name", "part_cat_id", "part_material"],
    "colors": ["id", "name", "rgb", "is_trans", "num_parts", "num_sets", "y1", "y2"],
    "part_mappings": ["part_num", "ext_system", "ext_id", "is_export_id", "is_import_id"],
    "color_mappings": ["id", "ext_system", "ext_id", "ext_descr", "is_export_id", "is_import_id"],
}

def build(directory, version, download=False):
    directory.mkdir(parents=True, exist_ok=True)
    data, sources = {}, {}
    for name, columns in FILES.items():
        path = directory / (name + ".csv.gz")
        url = f"https://cdn.rebrickable.com/media/downloads/{name}.csv.gz"
        if download:
            with urlopen(url, timeout=120) as response:
                path.write_bytes(response.read(32 * 1024 * 1024))
        raw = path.read_bytes()
        unpacked = gzip.decompress(raw)
        reader = csv.reader(io.StringIO(unpacked.decode("utf-8-sig"), newline=""))
        if next(reader) != columns:
            raise ValueError(f"Unexpected CSV schema: {name}")
        rows = list(reader)
        if any(len(row) != len(columns) for row in rows):
            raise ValueError(f"Incomplete CSV row: {name}")
        if name in ("parts", "colors") and len({r[0] for r in rows}) != len(rows):
            raise ValueError(f"Duplicate primary key: {name}")
        # Preserve all source rows, including duplicates and every external system.
        data[name] = sorted(rows)
        sources[name] = dict(url=url, sha256=hashlib.sha256(raw).hexdigest(),
                             decodedSha256=hashlib.sha256(unpacked).hexdigest(),
                             bytes=len(raw), rows=len(rows), columns=columns)
    for table, parent in [("part_mappings", "parts"), ("color_mappings", "colors")]:
        keys = {row[0] for row in data[parent]}
        if any(row[0] not in keys for row in data[table]):
            raise ValueError(f"Orphan foreign key: {table}")
        for row in data[table]:
            if any(flag not in ("True", "False") for flag in row[-2:]):
                raise ValueError(f"Invalid mapping direction: {table}")
    attribution = ("Catalog data sourced from Rebrickable (https://rebrickable.com/downloads/). "
                   "Public catalog CSV downloads; permitted use under https://rebrickable.com/terms/ "
                   "sections 5.1 and 5.3, reviewed 2026-11-01. No MOC data, images or Studio resources. "
                   "Not a CC BY geometry license. No endorsement by Rebrickable, LEGO or BrickLink.")
    payload = dict(schema=1, version=version, sources=sources, attribution=attribution, **data)
    packed = gzip.compress(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode(), mtime=0)
    digest = hashlib.sha256(packed).hexdigest()
    (directory / "catalog.bin").write_bytes(packed)
    manifest = dict(schema=1, version=version, sha256=digest, bytes=len(packed),
                    url=f"api/catalog/snapshot/{digest}", sources=sources,
                    attribution=attribution, termsUrl="https://rebrickable.com/terms/",
                    object=f"catalog/approved/{digest}/catalog.bin")
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, default=Path("generated-artifacts/catalog-sources"))
    parser.add_argument("--version", required=True)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--approve", action="store_true", help="Explicitly update both pinned application descriptors")
    args = parser.parse_args()
    manifest = build(args.directory, args.version, args.download)
    if args.approve:
        for target in ["artifacts/brickbuilder-mobile/src/features/catalog/manifest.json",
                       "artifacts/api-server/src/lib/catalog-manifest.json"]:
            path = Path(target)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
