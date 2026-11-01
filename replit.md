# BrickBuilder Mobile

A local-first 3D brick editor and installable PWA with a German interface.

## Run and operate

- See `README.md` and `docs/setup-and-hosting.md` for clean-checkout installation
  and static hosting.
- `PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run dev`
  starts the standalone frontend.
- `pnpm --filter @workspace/brickbuilder-mobile run typecheck`
- `pnpm --filter @workspace/brickbuilder-mobile run test`
- `PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run build`
  writes `artifacts/brickbuilder-mobile/dist/public`.
- `pnpm run typecheck` / `pnpm run build` cover the whole workspace.
- The optional API uses its own `PORT` and mounts routes under `/api`.
  Imports use its optional same-origin LDraw resolver; editing and cached models
  do not require it. See the hosting guide for explicit archive approval.
- PostgreSQL is optional, not a frontend requirement. Database tools/library
  require `DATABASE_URL` only when explicitly used.
- `pnpm --filter @workspace/api-spec run codegen` regenerates API hooks and
  schemas from the OpenAPI spec.

## Stack and structure

- pnpm workspaces, Node.js 24, TypeScript, React, Vite, Three.js.
- Dexie/IndexedDB stores local projects and downloaded parts.
- `artifacts/brickbuilder-mobile/docs/` documents architecture, import limits,
  evidence and separate LDraw licensing.
- `artifacts/api-server/` is the optional Express service.
- `lib/` contains API contracts, generated clients and optional Drizzle support.

## Repository language policy

First-party GitHub-facing documentation, comments, test descriptions and
development-facing explanations are English. The visible application stays
German, including labels, localized errors/notifications and manifest locale.
Preserve original third-party files, credits and authoritative legal texts verbatim.
Do not translate application resources merely to remove German source strings.

## Authorized code backups

- The user authorizes completed code changes and merged task results to be
  backed up without asking again to
  `https://github.com/Blackfishbox/BrickBuilder-Mobile` on `main`.
- Run `DANGEROUSLY_ALLOW_GIT=1 bash scripts/backup-github.sh "Describe the actual changes in English"`;
  an optional second argument supplies detailed English change notes.
- Both subject and body must be specific English descriptions of actual changes,
  not generic backup messages. Task merge subjects must also be English because
  they can become GitHub messages; do not forward German subjects unchanged.
- Do not rewrite history without an explicit request. Normal backups are
  fast-forward pushes, with remote drift checked before writing and remote
  success verified afterward.
- The post-merge process may lack Git authorization. A failed backup is recorded
  in `.local/github-backup-pending.json` without blocking app startup. Retry
  pending backups from the authorized Agent environment after merging and
  verify success.
- Private uploads, local agent notes, environment files and generated output
  remain excluded. This permission covers code backups, not production publishing.

## Important constraints

- Vite requires `PORT` and `BASE_PATH` even for builds.
- Snapshot updates are deliberate maintenance actions, never automatic app-build
  downloads. Preserve original data and license evidence.
- Private-reference tests must skip explicitly without local uploads while
  synthetic regressions remain active.
- Do not claim general Studio compatibility or physical Android acceptance
  based on limited fixture/desktop-preview evidence.
