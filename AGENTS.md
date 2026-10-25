<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fork development rules

This repo is a PlaybookMediaLLC fork of KartikLabhshetwar/screenshot-studio.
The fork is the product of record: Shots, the release-readiness platform.
Product direction lives in `company.md` and `vision.md`; the authoritative
execution order lives in `docs/rfcs/README.md` and the README roadmap. Upstream
remains the original browser screenshot editor.

## Branch and release flow

- Start work branches from `develop` and target `develop` in every work PR,
  including fixes, dependencies, upstream sync and release preparation.
- `main` is the production release branch. Only a PR from this repository's
  `develop` branch may target `main`, and only as an intentional release.
- Merge release PRs with a merge commit; do not squash or rebase `develop`
  into `main`. Preserve both long-lived branches after merging.
- Prepare version/changelog changes through Release Please PRs into `develop`.
  Production deploys and published releases remain tied to `main`.
- See [branching and releases](docs/branching-and-releases.md) for checks,
  repository rules and the release procedure.

## Keep upstream merges cheap

1. Put new platform code in new directories and new files. Edit upstream
   editor files only when the change belongs upstream too.
2. Do not reformat or restyle upstream files.
3. Keep platform namespaces separate: new Ent models, new routes, and new
   env vars get platform names, not editor names.
4. The web never touches the database. Product data goes through the Go
   backend and `lib/backend/sdk.ts`; `test/web-database-boundary.test.ts`
   enforces it.
5. A platform API route declares a zod contract in `lib/api/contracts/` and
   exports `route(contract, { auth, handler })`. API code under `lib/api/**`
   and `app/api/**` uses only zod-derived types and puts TSDoc on every
   export; `test/api-platform-boundary.test.ts` enforces both.

## Upstream sync

`.github/workflows/sync-upstream.yml` merges upstream main into the
`upstream` branch every night and opens a PR against develop.

Resolve conflicts by class:

1. Platform code, tenancy, campaign domain, infra: the fork wins.
2. Editor internals the fork never modified: upstream wins.
3. `bun.lock` is deleted in the fork (npm is the only package manager). When
   upstream changes it, resolve the modify/delete conflict with
   `git rm bun.lock`.
4. Root `package.json` and `package-lock.json` are fork-owned. Keep the
   `workspaces` entry, take upstream's dependency changes, then regenerate
   the lockfile with `npm install`.
5. Run the repo checks before you push the merge.
