#!/usr/bin/env python3
"""Collect installed production-package legal texts without publishing local paths."""
import json
from pathlib import Path
import re
import sys


def collect(report, root, destination):
    root = Path(root).resolve()
    sections = ["Production dependency notices\n",
                "Generated from the installed lockfile. This inventory is not a license-compatibility audit.\n"]
    missing = []
    for license_name, packages in sorted(json.loads(Path(report).read_text()).items()):
        for package in packages:
            name = package["name"]
            if name == "workspace" or name.startswith("@workspace/"):
                continue
            versions = ", ".join(package.get("versions", []))
            sections.append(f"\n{'=' * 72}\n{name} {versions}\nDeclared license: {license_name}\n")
            sections.append(f"Project: {package.get('homepage', '')}\n")
            seen = set()
            for location in package.get("paths", []):
                directory = Path(location).resolve()
                if not directory.is_relative_to(root):
                    raise ValueError("Dependency path is outside the installed checkout")
                for file in sorted(directory.iterdir()):
                    if not file.is_file() or not re.match(r"^(licen[cs]e|copying|notice)([._-].*|$)", file.name, re.I):
                        continue
                    if not file.resolve().is_relative_to(directory) or file.stat().st_size > 1024 * 1024:
                        raise ValueError("Unsafe/oversized dependency notice")
                    text = file.read_text(errors="replace")
                    if text in seen:
                        continue
                    seen.add(text)
                    sections.append(f"\n--- {file.name} ---\n{text}\n")
            if not seen:
                missing.append(name)
                sections.append("No root-level legal text was found in this package; review its upstream distribution.\n")
    Path(destination).write_text("".join(sections))
    return missing


if __name__ == "__main__":
    missing = collect(*sys.argv[1:])
    if missing:
        print("WARNING: Review upstream notices for packages without root legal files: " + ", ".join(missing), file=sys.stderr)
