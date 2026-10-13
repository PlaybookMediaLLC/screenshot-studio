# Deployment

Production runs on DigitalOcean App Platform at `shots.oppulence.io`. The
[DigitalOcean deployment guide](digitalocean-deployment.md) documents the live
components, secrets, migration jobs, health checks, and release procedure.

The web and combined backend images are built on GitHub and stored in the
public GitHub Container Registry package. App Platform uses a digest for the
web image and a unique commit SHA tag for the backend image. The backend
container runs the social API, social Temporal worker,
tenant publishing worker, and six maintenance schedules as one service.

The `Social backend image` GitHub workflow publishes the combined backend on
changes to its Go code. Its manual `deploy` input performs the guarded
production topology update after the image is published. The old Fly deploy
workflow has been removed.

Release Please reads Conventional Commit messages merged into `main`. It opens
version and changelog pull requests, then creates Git tags and GitHub Releases.
The `RELEASE_PLEASE_TOKEN` repository secret is required for release-created
commits and tags to start deployment workflows.

App Platform runs the `web-migrate` and `postiz-migrate` predeploy jobs before
releasing a new app deployment. Review schema migrations and database backups
before changing the web image. Never use `npm run db:push` against production.

For a local web image smoke test:

```sh
docker build -t screenshot-studio .
docker run --rm -p 3000:3000 screenshot-studio
curl --fail http://localhost:3000/api/health
```
