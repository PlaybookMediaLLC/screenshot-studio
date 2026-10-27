# Fork development rules

This repo is a PlaybookMediaLLC fork of KartikLabhshetwar/screenshot-studio.
The fork is the product of record: Shots, the release-readiness platform.
Product direction lives in `docs/company.md` and `docs/vision.md`; the authoritative
execution order lives in `docs/rfcs/README.md` and the README roadmap. Upstream
remains the original browser screenshot editor.

## Repository layout

The repository separates the backend from its clients, as polar.sh does:

- `server/`: the Go backend (APIs, workers, Ent models, migrations). Its
  `Makefile` runs the Go checks; see [server/README.md](server/README.md).
- `clients/`: the npm workspace. Run `npm` commands from here.
  - `apps/web/`: the Next.js web app, including the editor upstream ships at
    its repository root. Its rules are in
    [clients/apps/web/AGENTS.md](clients/apps/web/AGENTS.md).
  - `apps/collab-server/`: the real-time co-editing server.
  - `packages/`: shared libraries (backend SDK, typed API client, editor).
  - `integrations/`: native clients (Raycast, Zapier, Shortcuts, Claude Code).
- `dev/`: local development and repository tooling. `dev/studio` (behind
  `make`) runs the Compose stack in `dev/compose*.yaml`; `dev/verify-rfcs.py`
  and `dev/release-flow.cjs` back the RFC and release checks.
- `infra/`: deployment (Helm chart in `infra/charts/`, DigitalOcean, storage).
- `docs/`: product, architecture and RFC documentation.

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
4. The web never touches the database, and API routes declare zod
   contracts. [clients/apps/web/AGENTS.md](clients/apps/web/AGENTS.md) has
   the rules and the tests that enforce them.

## Upstream sync

`.github/workflows/sync-upstream.yml` merges upstream main into the
`upstream` branch every night and opens a PR against develop. Upstream keeps
the web app at its repository root; the fork keeps it in `clients/apps/web/`.
Git's rename detection maps most upstream paths onto the moved files. Do not
lower its threshold: below 30% it pairs deleted fork pages with unrelated ones.

Resolve conflicts by class:

1. Platform code, tenancy, campaign domain, infra: the fork wins.
2. Editor internals the fork never modified: upstream wins.
3. An upstream file that lands at its old root path (`app/`, `components/`,
   `lib/`, `tests/`, ...) was missed by rename detection. Port the change into
   the same path under `clients/apps/web/` (upstream's `tests/` is
   `clients/apps/web/test/`), then `git rm` the root copy.
4. `bun.lock` is deleted in the fork (npm is the only package manager). When
   upstream changes it, resolve the modify/delete conflict with
   `git rm bun.lock`.
5. The root `package.json` only carries the release version for Release
   Please, so upstream's changes to its own root `package.json` conflict
   there. Keep the fork's root file and port upstream's dependency changes
   into `clients/apps/web/package.json`. `clients/package.json` and
   `clients/package-lock.json` are fork-owned: keep the `workspaces` entry,
   then regenerate the lockfile with `npm install` in `clients/`.
6. Run the repo checks before you push the merge.
