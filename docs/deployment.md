# Deployment

Production runs on DigitalOcean App Platform at `shots.playbookmedia.io`
(`shots.oppulence.io` redirects there; see `lib/canonical-host.ts`). The
[DigitalOcean deployment guide](digitalocean-deployment.md) documents the live
components, secrets, migration jobs, health checks, and release procedure.

The web and combined backend images are built on GitHub and stored in the
public GitHub Container Registry package. App Platform selects each image with
a unique commit SHA tag. The backend
container runs the social API, social Temporal worker,
tenant publishing worker, and six maintenance schedules as one service.

The `Web image` and `Social backend image` GitHub workflows publish their
respective images when relevant code lands on `main`. Their manual `deploy`
inputs load production secrets from Infisical using GitHub OIDC, validate the
live app topology, and update the corresponding App Platform components.
Deploy the backend before the web: its image carries the schema migrations, and
the web deploy refuses a topology that still has `web-migrate`. The Fly
deployment workflow and configuration have been removed.

Release Please reads Conventional Commit messages merged into `main`. It opens
version and changelog pull requests, then creates Git tags and GitHub Releases.
The `RELEASE_PLEASE_TOKEN` repository secret is required for release-created
commits and tags to start deployment workflows.

App Platform runs one `platform-migrate` predeploy job from the backend image.
It applies product and social migrations to the same PostgreSQL database and
`public` schema. The web has no database connection. Review the migration
sources in `services/platformmigrations/sql` and
`services/internal/social/migrations` and the
database backup before changing the backend image.

For a local web image smoke test:

```sh
docker build -t screenshot-studio .
docker run --rm -p 3000:3000 screenshot-studio
curl --fail http://localhost:3000/api/health
```
