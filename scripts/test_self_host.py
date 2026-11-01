#!/usr/bin/env python3
"""Unprivileged installer/data/rollback regressions. Never provision this host."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
COMMON = ROOT / "scripts/self-host/common.sh"
ENTRY = ROOT / "scripts/setup-self-host.sh"
spec = importlib.util.spec_from_file_location("verify_self_host", ROOT / "scripts/self-host/verify-data.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class InstallerTests(unittest.TestCase):
    def shell(self, script, *args):
        return subprocess.run(["bash", "-euo", "pipefail", "-c", 'source "$1"; shift\n' + script, "test", str(COMMON), *map(str, args)],
                              capture_output=True, text=True)

    def test_plan_does_not_need_root_server_files_or_network(self):
        result = subprocess.run(["bash", str(ENTRY), "--plan", "--domain", "bricks.example.org"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("No changes made", result.stdout)
        self.assertIn("127.0.0.1:5000", result.stdout)

    def test_rejects_unsafe_arguments_before_any_mutations(self):
        cases = [
            ["--domain", "https://example.org"],
            ["--domain", "a..example.org"],
            ["--domain", "x.org;touch /tmp/unwanted"],
            ["--domain", "example.org", "--cert", "/tmp/cert;\ncommand"],
            ["--domain", "example.org", "--api-port", "22"],
            ["--domain", "example.org", "--api-port", "99999"],
            ["--domain", "example.org", "--node-version", "22.1.0"],
            ["--domain", "example.org", "--nginx-site", "/etc/passwd"],
            ["--domain", "example.org", "--catalog", "one", "--catalog-url", "https://example.org/two"],
            ["--domain", "example.org", "--ldraw-dir", "one", "--approve-ldraw-download"],
        ]
        for case in cases:
            with self.subTest(case=case):
                result = subprocess.run(["bash", str(ENTRY), "--plan", *case], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("ERROR", result.stderr)

    def test_templates_preserve_same_origin_and_least_privilege(self):
        result = self.shell("""
DOMAIN=bricks.example.org CERT=/cert/fullchain.pem KEY=/cert/privkey.pem
ACME_ROOT=/var/www/letsencrypt INSTALL_ROOT=/opt/brickbuilder API_PORT=5123
NODE_DIR=/opt/node24 ARCHIVE=/var/lib/brickbuilder/ldraw/approved
render_nginx
render_unit
""")
        self.assertEqual(result.returncode, 0, result.stderr)
        for required in ["location ^~ /api/catalog/snapshot/", "gzip off;", "proxy_pass http://127.0.0.1:5123;",
                         "Environment=HOST=127.0.0.1", "User=brickbuilder", "ProtectSystem=strict",
                         "ssl_certificate /cert/fullchain.pem", "location /licenses/"]:
            self.assertIn(required, result.stdout)
        self.assertNotIn("proxy_pass http://127.0.0.1:5123/;", result.stdout)
        self.assertEqual(result.stdout.count("{"), result.stdout.count("}"))

    def test_dual_stack_is_enabled_only_when_available(self):
        assignments = """
DOMAIN=bricks.example.org CERT=/cert/fullchain.pem KEY=/cert/privkey.pem
ACME_ROOT=/var/www/letsencrypt INSTALL_ROOT=/opt/brickbuilder API_PORT=5123
"""
        for supported in (0, 1):
            result = self.shell(assignments + f"\nIPV6={supported}\nrender_nginx")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual("listen [::]:443 ssl;" in result.stdout, supported == 1)

    def test_atomic_link_never_replaces_a_real_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "current").mkdir()
            result = self.shell('atomic_link /some/release "$1/current"', root)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue((root / "current").is_dir())

    def test_failed_update_restores_prior_files_links_and_running_service(self):
        self.rollback_case(existing=True)

    def test_failed_first_install_removes_only_new_activation_files(self):
        self.rollback_case(existing=False)

    def rollback_case(self, existing):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "unrelated").write_text("keep")
            result = self.shell("""
INSTALL_ROOT=$1 NGINX_SITE=$1/site UNIT=$1/unit ENABLED_SITE=$1/enabled BACKUP=$1/backup
EXISTING=$2
systemctl() {
  if [[ "$1" == is-active || "$1" == is-enabled ]]; then [[ "$EXISTING" == yes ]]; return; fi
  printf '%s\\n' "$*" >> "$INSTALL_ROOT/service-calls"
}
nginx() { return 0; }
if [[ "$EXISTING" == yes ]]; then
  echo old-site > "$NGINX_SITE"; echo old-unit > "$UNIT"
  ln -s "$INSTALL_ROOT/old-release" "$INSTALL_ROOT/current"
  ln -s "$NGINX_SITE" "$ENABLED_SITE"
fi
backup_activation
atomic_link "$INSTALL_ROOT/new-release" "$INSTALL_ROOT/current"
echo new-site > "$NGINX_SITE"; echo new-unit > "$UNIT"
if [[ ! -L "$ENABLED_SITE" ]]; then ln -s "$NGINX_SITE" "$ENABLED_SITE"; fi
rollback_activation
""", root, "yes" if existing else "no")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((root / "unrelated").read_text(), "keep")
            if existing:
                self.assertEqual((root / "site").read_text().strip(), "old-site")
                self.assertEqual((root / "unit").read_text().strip(), "old-unit")
                self.assertEqual((root / "current").readlink(), root / "old-release")
                self.assertTrue((root / "enabled").is_symlink())
                self.assertIn("restart brickbuilder-api", (root / "service-calls").read_text())
            else:
                for name in ["site", "unit", "current", "enabled"]:
                    self.assertFalse((root / name).exists() or (root / name).is_symlink())


class DataTests(unittest.TestCase):
    def test_catalog_checks_exact_bytes_and_route(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            payload = root / "catalog.bin"
            payload.write_bytes(b"reviewed")
            digest = hashlib.sha256(b"reviewed").hexdigest()
            manifest = root / "manifest.json"
            descriptor = dict(sha256=digest, bytes=8, url="api/catalog/snapshot/" + digest)
            manifest.write_text(json.dumps(descriptor))
            self.assertEqual(verify.catalog(manifest, payload), digest)
            payload.write_bytes(b"modified")
            with self.assertRaisesRegex(ValueError, "mismatch"):
                verify.catalog(manifest, payload)
            descriptor["url"] = "../../escape"
            manifest.write_text(json.dumps(descriptor))
            with self.assertRaisesRegex(ValueError, "route"):
                verify.catalog(manifest, payload)

    def make_archive(self, root):
        names = ["parts/3004.dat", "CAreadme.txt", "CAlicense4.txt", "CC0-1.0.txt"]
        files = {}
        for name in names:
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(("fixture " + name).encode())
            files[name] = hashlib.sha256(target.read_bytes()).hexdigest()
        (root / "manifest.json").write_text(json.dumps(dict(version=1, sha256="a" * 64, files=files)))
        return files

    def test_archive_checks_hashes_and_legal_texts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_archive(root)
            self.assertEqual(verify.archive(root), "a" * 64)
            (root / "parts/3004.dat").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                verify.archive(root)

    def test_archive_rejects_traversal_and_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            files = self.make_archive(root)
            descriptor = root / "manifest.json"
            files["parts/../../outside.dat"] = "b" * 64
            descriptor.write_text(json.dumps(dict(version=1, sha256="a" * 64, files=files)))
            with self.assertRaisesRegex(ValueError, "Unsafe"):
                verify.archive(root)
            self.make_archive(root)
            target = root / "parts/3004.dat"
            target.unlink()
            target.symlink_to("/etc/passwd")
            with self.assertRaisesRegex(ValueError, "Unsafe"):
                verify.archive(root)

    def test_copy_includes_only_manifest_records_not_unrelated_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            self.make_archive(source)
            (source / "private-unrelated.txt").write_text("not distributed")
            result = subprocess.run(["python3", str(ROOT / "scripts/self-host/verify-data.py"),
                                     "copy-archive", str(source), str(root / "copy")],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((root / "copy/private-unrelated.txt").exists())
            self.assertEqual(verify.archive(root / "copy"), "a" * 64)


class BuiltApiTests(unittest.TestCase):
    @unittest.skipUnless((ROOT / "artifacts/api-server/dist/index.mjs").exists() and shutil.which("node"),
                         "Build the API first for the disposable loopback smoke test")
    def test_api_runs_without_storage_credentials_and_binds_requested_loopback(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            # Health needs no geometry; the explicit local directory skips cloud restore.
            (root / "manifest.json").write_text(json.dumps(dict(version=1, sha256="a" * 64, files={})))
            with socket.socket() as candidate:
                candidate.bind(("127.0.0.1", 0))
                port = candidate.getsockname()[1]
            environment = {key: value for key, value in os.environ.items() if key in ("PATH", "HOME", "LANG")}
            environment.update(HOST="127.0.0.1", PORT=str(port), NODE_ENV="production", LDRAW_APPROVED_DIR=str(root))
            process = subprocess.Popen(["node", str(ROOT / "artifacts/api-server/dist/index.mjs")],
                                       env=environment, cwd=ROOT, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, text=True)
            ready = False
            try:
                for _ in range(50):
                    if process.poll() is not None:
                        break
                    try:
                        with urlopen(f"http://127.0.0.1:{port}/api/healthz", timeout=0.5) as response:
                            ready = response.status == 200
                        if ready:
                            break
                    except OSError:
                        time.sleep(0.1)
            finally:
                process.terminate()
                try:
                    output, errors = process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    output, errors = process.communicate()
            self.assertTrue(ready, output + errors)
            events = [json.loads(line) for line in output.splitlines() if line.startswith("{")]
            listening = next(event for event in events if event.get("msg") == "Server listening")
            self.assertEqual(listening["host"], "127.0.0.1")
            self.assertEqual(listening["port"], port)


class DependencyNoticeTests(unittest.TestCase):
    def test_collector_keeps_texts_but_not_local_install_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / "node_modules/example"
            package.mkdir(parents=True)
            (package / "LICENSE").write_text("Example copyright and license")
            (package / "NOTICE").write_text("Example notice")
            report = root / "report.json"
            report.write_text(json.dumps({"MIT": [dict(name="example", versions=["1.0.0"], paths=[str(package)])]}))
            output = root / "notices.txt"
            result = subprocess.run(["python3", str(ROOT / "scripts/self-host/dependency-notices.py"),
                                     str(report), str(root), str(output)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Example copyright and license", output.read_text())
            self.assertIn("Example notice", output.read_text())
            self.assertNotIn(str(root), output.read_text())

    def test_collector_rejects_paths_outside_checkout(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            report = root / "report.json"
            report.write_text(json.dumps({"MIT": [dict(name="example", versions=["1"], paths=["/etc"])]}))
            result = subprocess.run(["python3", str(ROOT / "scripts/self-host/dependency-notices.py"),
                                     str(report), str(root), str(root / "notices.txt")], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root / "notices.txt").exists())


if __name__ == "__main__":
    unittest.main()
