<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Web app rules

Paths here are relative to `clients/apps/web/`. The repository-wide fork
rules are in the [root AGENTS.md](../../../AGENTS.md).

1. The web never touches the database. Product data goes through the Go
   backend and `lib/backend/sdk.ts`; `test/web-database-boundary.test.ts`
   enforces it.
2. A platform API route declares a zod contract in `lib/api/contracts/` and
   exports `route(contract, { auth, handler })`. API code under `lib/api/**`
   and `app/api/**` uses only zod-derived types and puts TSDoc on every
   export; `test/api-platform-boundary.test.ts` enforces both.
3. Run `npm run quality:check` from `clients/` before you push.
