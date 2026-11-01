#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# The merge runner may lack the Git authorization available to the Agent shell.
# Do not prevent application startup when an external backup needs a retry.
# Task commit subjects must be descriptive English messages (see replit.md).
BACKUP_SUBJECT=$(git log -1 --format=%s)
if bash scripts/backup-github.sh "$BACKUP_SUBJECT"; then
  echo "Post-merge GitHub backup completed."
else
  BACKUP_EXIT_CODE=$?
  node - "$BACKUP_EXIT_CODE" <<'NODE'
const fs = require("node:fs");
fs.mkdirSync(".local", { recursive: true });
fs.writeFileSync(".local/github-backup-pending.json", JSON.stringify({
  status: "pending",
  exitCode: Number(process.argv[2]),
  recordedAt: new Date().toISOString(),
  message: "GitHub backup did not complete. Retry from an authorized Agent shell.",
}, null, 2) + "\n");
NODE
  echo "WARNING: GITHUB BACKUP PENDING (exit $BACKUP_EXIT_CODE)." >&2
  echo "Application setup continues; Agent must retry the backup with a specific change description." >&2
fi
