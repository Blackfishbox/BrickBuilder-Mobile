#!/usr/bin/env python3
"""Build an explicitly pinned offline dataset; never runs during normal builds.

Shadow originals retain CC BY-SA 4.0. The extracted LDraw reference graph retains
CC BY 4.0/CC0 attribution independently. No geometry or Studio assets are used.
"""
import argparse
import base64
import collections
import hashlib
import json
import pathlib
import re
import subprocess
import zipfile
import zlib

PIN = "9b1131fb1991f8c0bfc072325e4e12f6271aba35"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--shadow", required=True)
parser.add_argument("--ldraw-archive", required=True)
args = parser.parse_args()
shadow = pathlib.Path(args.shadow)
if subprocess.check_output(["git", "-C", str(shadow), "rev-parse", "HEAD"], text=True).strip() != PIN:
    raise SystemExit("Shadow revision differs from the reviewed pin.")
destination = pathlib.Path("artifacts/brickbuilder-mobile/src/features/connections/data")
legal = pathlib.Path("artifacts/brickbuilder-mobile/public/licenses/connections")
destination.mkdir(parents=True, exist_ok=True)
legal.mkdir(parents=True, exist_ok=True)
sha = lambda b: hashlib.sha256(b).hexdigest()
originals = {}
counts = collections.Counter()
for path in sorted(shadow.rglob("*.dat")):
    raw = path.read_bytes()
    text = raw.decode("utf-8-sig")
    if "0 !LICENSE CC BY-SA 4.0, see LICENSE.md" not in text:
        raise SystemExit(f"Unreviewed shadow license: {path}")
    key = path.relative_to(shadow).as_posix().lower()
    originals[key] = {"text": text, "sha256": sha(raw)}
    counts.update(re.findall(r"!LDCAD (SNAP_\w+)", text))
for name in ("LICENSE.md", "README.md", "CONTRIBUTING.md"):
    (legal / name).write_bytes((shadow / name).read_bytes())

graph = {}
rejected = {}
archive = pathlib.Path(args.ldraw_archive).read_bytes()
with zipfile.ZipFile(args.ldraw_archive) as z:
    for name in sorted(z.namelist()):
        key = name.replace("\\", "/").removeprefix("ldraw/").lower()
        if key in ("careadme.txt", "calicense4.txt"):
            (legal / key).write_bytes(z.read(name))
        if not re.fullmatch(r"(parts|p)/[a-z0-9_/-]+\.dat", key):
            continue
        raw = z.read(name)
        text = raw.decode("utf-8-sig", errors="replace")
        author = re.search(r"^0 Author: (.+)$", text, re.M)
        license_line = re.search(r"^0 !LICENSE (.+)$", text, re.M)
        license_text = license_line[1].strip() if license_line else ""
        approved = license_text in (
            "Licensed under CC0 : see CAreadme.txt",
            "Licensed under CC BY 4.0 : see CAreadme.txt",
            "Licensed under CC BY 2.0 and CC BY 4.0 : see CAreadme.txt",
        )
        if not approved or not author:
            rejected[key] = "Unapproved license or missing author"
            continue
        # Only reference lines are adapted, in source order, not geometry.
        graph[key] = {
            "refs": [line.strip() for line in text.splitlines() if re.match(r"^\s*1\s", line)],
            "author": author[1].strip(), "license": license_text,
            "sha256": sha(raw),
        }

def write_data(name, data):
    raw = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    encoded = base64.b64encode(zlib.compress(raw, 9)).decode()
    # Source data, not generated app build output. Kept compressed to limit
    # install size; decoded once, synchronously, with the installed JS bundle.
    chunks = [encoded[i:i + 2_000_000] for i in range(0, len(encoded), 2_000_000)]
    for i, chunk in enumerate(chunks):
        (destination / f"{name}-{i}.ts").write_text(
            "// Licensed upstream dataset; see public/licenses/connections and manifest.json.\n"
            f"export default {json.dumps(chunk)};\n")
    (destination / f"{name}.ts").write_text(
        "".join(f'import chunk{i} from "./{name}-{i}";\n' for i in range(len(chunks))) +
        "export default " + " + ".join(f"chunk{i}" for i in range(len(chunks))) + ";\n")
    return {"sha256": sha(raw), "decodedBytes": len(raw), "compressedBytes": len(base64.b64decode(encoded))}

manifest = {
    "version": 1,
    "shadow": {
        "url": "https://github.com/RolandMelkert/LDCadShadowLibrary",
        "revision": PIN, "license": "CC-BY-SA-4.0",
        "records": len(originals), "constructs": dict(sorted(counts.items())),
        "payload": write_data("shadow", originals),
    },
    "ldraw": {
        "url": "https://library.ldraw.org/library/updates/complete.zip",
        "archiveSha256": sha(archive), "records": len(graph),
        "rejected": rejected, "payload": write_data("hierarchy", graph),
        "adaptation": "Extracted type-1 reference lines, original authors, license declarations and SHA-256 hashes. No geometry.",
    },
    "specification": "https://www.melkert.net/LDCad/tech/meta",
    "notice": "Source presence is not evidence of usable connectors. Runtime expansion and matching report rejections separately.",
}
(legal / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
(legal / "ATTRIBUTION.txt").write_text(
    f"LDCad Shadow Library, Roland Melkert and contributors, revision {PIN}.\n"
    "https://github.com/RolandMelkert/LDCadShadowLibrary\n"
    "Original shadow files are redistributed in a losslessly compressed container.\n"
    "Shadow data and adaptations: Creative Commons Attribution-ShareAlike 4.0.\n"
    "See LICENSE.md, README.md and CONTRIBUTING.md. No application-wide relicensing.\n\n"
    "LDraw.org contributors: authors and original per-file license declarations are\n"
    "retained in the separately compressed reference graph. Changes: reference-only\n"
    "extraction; no source geometry is redistributed in this connection dataset.\n"
    "See careadme.txt and calicense4.txt. CC0 files retain their CC0 declaration.\n"
    "The application source code is separate from these licensed datasets.\n")

# Genuine geometry fixtures used for enabled-family tests. Keep original
# content, headers, source hashes and the complete recursive closure.
roots = ["3001", "3003", "3022", "2780", "3700", "3705", "32064",
         "30374", "4085a", "4275a", "4276a", "14417", "30396", "2412b"]
with zipfile.ZipFile(args.ldraw_archive) as z:
    names = {n.removeprefix("ldraw/").lower(): n for n in z.namelist()}
    fixture = {}
    todo = [f"parts/{p}.dat" for p in roots]
    while todo:
        path = todo.pop()
        if path in fixture:
            continue
        if path not in graph:
            raise SystemExit(f"Unreviewed fixture dependency: {path}")
        raw = z.read(names[path])
        record = graph[path]
        fixture[path] = {"path": path, "content": raw.decode("utf-8-sig"),
                         "author": record["author"], "sha256": record["sha256"],
                         "sourceUrl": "https://library.ldraw.org/library/official/" + path,
                         "license": "CC0-1.0" if "CC0" in record["license"] else "CC-BY-4.0"}
        for line in record["refs"]:
            ref = "/".join(line.split()[14:]).replace("\\", "/").lower()
            target = next((p for p in [f"parts/{ref}", f"p/{ref}", ref] if p in graph), None)
            if not target:
                raise SystemExit(f"Incomplete fixture: {ref}")
            todo.append(target)
    manifest["testExamples"] = {
        "roots": roots, "files": len(fixture),
        "payload": write_data("examples", fixture),
        "notice": "Genuine source geometry for automatic tests only; not installed by the production app.",
    }
manifest["legalDocuments"] = {
    path.name: {"sha256": sha(path.read_bytes()), "bytes": path.stat().st_size}
    for path in sorted(legal.iterdir())
    if path.is_file() and path.name not in ("manifest.json", "coverage.json")
}
(legal / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest, indent=2))
