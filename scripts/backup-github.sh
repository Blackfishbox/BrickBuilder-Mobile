#!/usr/bin/env bash
# Code-only GitHub snapshots; never push Replit checkpoint history.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
REPOSITORY="https://github.com/Blackfishbox/BrickBuilder-Mobile.git"
BRANCH_REF="refs/heads/main"
TRACKING_REF="refs/brickbuilder-backup/main"
export GIT_TERMINAL_PROMPT=0

# Use a separate index and reference; leave the workspace branch/index intact.
GIT_DIRECTORY=$(git rev-parse --git-dir)
exec 9>"$GIT_DIRECTORY/brickbuilder-github-backup.lock"
if ! flock -n 9; then
  echo "GitHub backup is already running. Retry after it finishes." >&2
  exit 1
fi
TEMP_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEMP_DIRECTORY"' EXIT

node - "$TEMP_DIRECTORY/paths" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const output = process.argv[2];
const candidates = execFileSync("git", [
  "ls-files", "--cached", "--others", "--exclude-standard", "-z",
]).toString().split("\0").filter(Boolean);
const excludedDirectories = new Set([
  ".git", ".agents", ".local", ".cache", ".ssh", ".aws",
  "attached_assets", "generated-artifacts", "node_modules",
  "dist", "build", "coverage", ".next", ".expo", ".turbo",
]);
const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /AKIA[0-9A-Z]{16}/,
  /sk_live_[A-Za-z0-9]{20,}/,
];
const approved = [];
for (const name of [...new Set(candidates)].sort()) {
  const segments = name.split("/");
  const base = path.posix.basename(name);
  if (segments.some(segment => excludedDirectories.has(segment))) continue;
  if (/^\.env(?:\.|$)/i.test(base) && base !== ".env.example") continue;
  if (/\.(?:io|pem|p12|pfx|key|tsbuildinfo)$/i.test(base)) continue;
  if (/^(?:id_rsa|id_ed25519|credentials(?:\..*)?)$/i.test(base)) continue;
  let info;
  try { info = fs.lstatSync(name); }
  catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  if (info.isSymbolicLink()) {
    throw new Error(`Backup stopped: inspect symbolic link ${name}.`);
  }
  if (!info.isFile()) continue;
  if (info.size > 5 * 1024 * 1024) {
    throw new Error(`Backup stopped: ${name} exceeds the 5 MiB source-file limit.`);
  }
  const text = fs.readFileSync(name).toString("utf8");
  if (credentialPatterns.some(pattern => pattern.test(text))) {
    throw new Error(`Backup stopped: possible embedded credential in ${name}.`);
  }
  if (base === ".npmrc" && text.split(/\r?\n/).some(line =>
    /(?:_authToken|_auth|password)\s*=/i.test(line) && !line.includes("${")
  )) {
    throw new Error(`Backup stopped: inspect authentication settings in ${name}.`);
  }
  approved.push(name);
}
if (!approved.includes("package.json")) {
  throw new Error("Backup stopped: workspace package.json is missing.");
}
fs.writeFileSync(output, approved.join("\0") + "\0");
console.log(`GitHub backup: ${approved.length} source files passed exclusion checks.`);
NODE

REMOTE_STATUS=0
REMOTE_OUTPUT=$(timeout 25s git -c credential.interactive=never \
  ls-remote --exit-code "$REPOSITORY" "$BRANCH_REF") || REMOTE_STATUS=$?
if [[ "$REMOTE_STATUS" != 0 && "$REMOTE_STATUS" != 2 ]]; then
  echo "GitHub backup failed: repository could not be read." >&2
  exit "$REMOTE_STATUS"
fi
REMOTE_COMMIT=$(printf '%s' "$REMOTE_OUTPUT" | awk 'NR == 1 { print $1 }')
EXPECTED_COMMIT=$(git rev-parse --verify "$TRACKING_REF" 2>/dev/null || true)
if [[ "$REMOTE_COMMIT" != "$EXPECTED_COMMIT" ]]; then
  echo "GitHub backup stopped: remote history differs from the last verified backup." >&2
  echo "Review the remote changes before updating the backup tracking reference." >&2
  exit 1
fi

export GIT_INDEX_FILE="$TEMP_DIRECTORY/index"
export DANGEROUSLY_ALLOW_GIT=1
git read-tree --empty
git add -f --pathspec-from-file="$TEMP_DIRECTORY/paths" --pathspec-file-nul
TREE=$(git write-tree)
PARENT_ARGUMENTS=()
if [[ -n "$REMOTE_COMMIT" ]]; then
  PREVIOUS_TREE=$(git show -s --format=%T "$REMOTE_COMMIT")
  if [[ "$TREE" == "$PREVIOUS_TREE" ]]; then
    echo "GitHub backup is already up to date."
    exit 0
  fi
  PARENT_ARGUMENTS=(-p "$REMOTE_COMMIT")
fi
COMMIT=$(printf 'Back up BrickBuilder Mobile changes\n\nCode-only snapshot without private uploads or Replit checkpoint history.\n' \
  | git commit-tree "$TREE" "${PARENT_ARGUMENTS[@]}")

# A normal fast-forward push rejects concurrent remote changes.
timeout 90s git -c credential.interactive=never push \
  "$REPOSITORY" "$COMMIT:$BRANCH_REF"
VERIFIED=$(timeout 25s git -c credential.interactive=never \
  ls-remote "$REPOSITORY" "$BRANCH_REF" | awk 'NR == 1 { print $1 }')
if [[ "$VERIFIED" != "$COMMIT" ]]; then
  echo "GitHub backup verification failed; inspect the remote branch." >&2
  exit 1
fi
git update-ref "$TRACKING_REF" "$COMMIT"
echo "GitHub backup verified: $COMMIT"
