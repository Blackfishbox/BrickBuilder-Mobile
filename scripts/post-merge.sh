#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# The merge runner may lack the Git authorization available to the Agent shell.
# Do not prevent application startup when an external backup needs a retry.
if bash scripts/backup-github.sh; then
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
  echo "Application setup continues; Agent must retry bash scripts/backup-github.sh." >&2
fi
