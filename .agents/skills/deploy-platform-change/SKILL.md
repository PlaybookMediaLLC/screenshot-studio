---
name: deploy-platform-change
description: Deliver a Screenshot Studio platform change safely. Use for Docker image changes, Fly or Helm configuration, PlanetScale migrations, Trigger.dev deployment, GitHub Actions, secrets, health checks, or a new development environment.
---

# Deploy Platform Change

Use the existing small standalone Next.js image. Keep the UI, Better Auth,
tRPC, and webhook adapters in that one web container. Trigger.dev and social
work remain separate managed task execution.

## Delivery sequence

1. Inspect the changed paths and affected runtime configuration. Keep one
   change set focused on one deployable concern.
2. Build the Docker image and call `/api/health` as the non-root runtime user.
3. Apply and record a reviewed Prisma migration first. PlanetScale Postgres
   branches do not have deploy requests or automatic schema merging.
4. Deploy Trigger.dev task changes with the web release when their payload
   contract changes. Keep a compatible task version during a rolling release.
5. Deploy the web container to the current Fly regions, US East and US West,
   then verify health, auth, one tenant request, and one background task.

## GitHub and secrets

- Keep pull-request checks read-only and deployment workflows explicit.
- Pin workflow actions to reviewed versions and use least-privilege token
  permissions.
- Store only references and environment variable names in the repository.
  Never commit database URLs, R2 credentials, Better Auth secrets, Trigger
  keys, or provider tokens.
- Add an upstream-sync workflow only when it opens a reviewable PR; never let
  it merge changes automatically.

## Environment contract

Use the same names in local, preview, and production: `DATABASE_URL`, Better
Auth base URL and secret, private R2 bucket settings, Trigger environment key,
and provider credentials. Keep Postiz as an optional local integration fixture;
it is not the application database or tenant authority.

## Verification

- Run the focused test suite, `npm run lint`, and a production Docker build.
- Confirm the migration status and rollback or forward-fix plan.
- Confirm `/api/health`, authenticated organization isolation, an R2 upload,
  and a harmless task in the target environment.
