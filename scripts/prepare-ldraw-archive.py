#!/usr/bin/env python3
"""Explicitly approve an official archive; never send the entire archive to a phone."""
import argparse
import hashlib
import io
import json
import pathlib
import re
import zipfile
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--approve-official-download", action="store_true", required=True)
parser.add_argument("--output", default="generated-artifacts/ldraw-approved")
parser.add_argument("--archive", help="Previously downloaded official complete.zip; still records its exact hash.")
args = parser.parse_args()
root = pathlib.Path(args.output)
if root.exists():
    raise SystemExit("Destination already exists. Choose a new directory; approved snapshots are immutable.")
url = "https://library.ldraw.org/library/updates/complete.zip"
if args.archive:
    archive_path = pathlib.Path(args.archive)
    if archive_path.stat().st_size > 200 * 1024 * 1024:
        raise SystemExit("Archive exceeds the download budget.")
    raw = archive_path.read_bytes()
else:
    raw = subprocess.run(["curl", "--fail", "--location", "--max-time", "150", "--max-filesize",
                          str(200 * 1024 * 1024), url], check=True, capture_output=True).stdout
if len(raw) > 200 * 1024 * 1024:
    raise SystemExit("Archive exceeds the download budget.")
digest = hashlib.sha256(raw).hexdigest()
files = {}
total = 0
with zipfile.ZipFile(io.BytesIO(raw)) as archive:
    for entry in archive.infolist():
        path = entry.filename.replace("\\", "/").removeprefix("ldraw/")
        if not (re.fullmatch(r"(parts|p)/[a-zA-Z0-9_/-]+\.dat", path) or
                path.lower() in ("careadme.txt", "calicense4.txt")):
            continue
        if ".." in path.split("/") or entry.file_size > 2 * 1024 * 1024:
            raise SystemExit("Unsafe archive entry.")
        path = {"careadme.txt": "CAreadme.txt", "calicense4.txt": "CAlicense4.txt"}.get(path.lower(), path.lower())
        if path in files:
            raise SystemExit("Duplicate normalized archive path.")
        total += entry.file_size
        if total > 1200 * 1024 * 1024 or len(files) > 150000:
            raise SystemExit("Archive expansion budget exceeded.")
        data = archive.read(entry)
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        files[path] = hashlib.sha256(data).hexdigest()
# CC0 files are accepted only alongside the complete original legal code.
data = subprocess.run(["curl", "--fail", "--location", "--max-time", "30", "--max-filesize", "100000",
                       "https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt"],
                      check=True, capture_output=True).stdout
if b"Creative Commons" not in data or b"<html" in data.lower():
    raise SystemExit("Invalid CC0 legal text.")
(root / "CC0-1.0.txt").write_bytes(data)
files["CC0-1.0.txt"] = hashlib.sha256(data).hexdigest()
for name in ("CAreadme.txt", "CAlicense4.txt"):
    if name not in files:
        raise SystemExit(f"Missing legal document: {name}")
(root / "manifest.json").write_text(json.dumps({
    "version": 1, "source": url, "sha256": digest, "files": files,
}), encoding="utf-8")
print(f"Approved archive SHA-256: {digest}; {len(files)} files; {total} expanded bytes.")
print(f"Set LDRAW_APPROVED_DIR to {root.resolve()}; original headers are checked on each served file.")
