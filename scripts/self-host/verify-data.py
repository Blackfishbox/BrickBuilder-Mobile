#!/usr/bin/env python3
"""Verify self-hosted data before activating a release. No network or mutations."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys


def catalog(manifest_path, payload_path):
    manifest = json.loads(Path(manifest_path).read_text())
    digest = manifest["sha256"]
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError("Invalid catalog digest")
    if manifest["url"] != "api/catalog/snapshot/" + digest:
        raise ValueError("Unexpected catalog route")
    payload = Path(payload_path).read_bytes()
    if len(payload) != manifest["bytes"] or hashlib.sha256(payload).hexdigest() != digest:
        raise ValueError("Catalog size/SHA-256 mismatch; obtain the reviewed catalog.bin")
    return digest


def archive(directory):
    root = Path(directory).resolve()
    descriptor = root / "manifest.json"
    if descriptor.is_symlink() or descriptor.stat().st_size > 12 * 1024 * 1024:
        raise ValueError("Unsafe/oversized archive manifest")
    manifest = json.loads(descriptor.read_text())
    if manifest.get("version") != 1 or not re.fullmatch(r"[a-f0-9]{64}", manifest.get("sha256", "")):
        raise ValueError("Unsupported approved LDraw manifest")
    files = manifest["files"]
    if not isinstance(files, dict) or not 1 <= len(files) <= 150_002:
        raise ValueError("Invalid LDraw file count")
    for legal in ("CAreadme.txt", "CAlicense4.txt", "CC0-1.0.txt"):
        if legal not in files:
            raise ValueError("Missing LDraw legal document: " + legal)
    total = 0
    for name, digest in files.items():
        if not (re.fullmatch(r"(parts|p)/[a-z0-9_/-]+\.dat", name) or
                name in ("CAreadme.txt", "CAlicense4.txt", "CC0-1.0.txt")):
            raise ValueError("Unsafe archive member")
        path = root / name
        if ".." in Path(name).parts or path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError("Unsafe archive path")
        if not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("Invalid member digest")
        if not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
            raise ValueError("Missing/oversized archive member: " + name)
        total += path.stat().st_size
        if total > 1200 * 1024 * 1024:
            raise ValueError("Archive expansion budget exceeded")
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError("Archive member hash mismatch: " + name)
    return manifest["sha256"]


if __name__ == "__main__":
    try:
        if sys.argv[1] == "catalog" and len(sys.argv) == 4:
            print(catalog(*sys.argv[2:]))
        elif sys.argv[1] == "archive" and len(sys.argv) == 3:
            print(archive(sys.argv[2]))
        elif sys.argv[1] == "copy-archive" and len(sys.argv) == 4:
            digest = archive(sys.argv[2])
            source, destination = map(Path, sys.argv[2:])
            destination.mkdir(parents=True, exist_ok=False)
            manifest = json.loads((source / "manifest.json").read_text())
            # Copy only reviewed records: never sweep unrelated files/symlinks.
            for name in ["manifest.json", *manifest["files"]]:
                target = destination / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source / name, target)
            archive(destination)
            print(digest)
        else:
            raise ValueError("Usage: verify-data.py catalog MANIFEST PAYLOAD | archive DIRECTORY")
    except (ValueError, OSError, KeyError, TypeError, IndexError) as error:
        sys.exit("Data verification failed: " + str(error))
