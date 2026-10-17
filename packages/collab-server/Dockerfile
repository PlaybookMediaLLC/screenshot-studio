# syntax=docker/dockerfile:1.7
# The collaboration server (RFC 037). Build from the repository root:
#   docker build --file packages/collab-server/Dockerfile .
FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
# npm ci links every workspace, so each workspace manifest must exist first.
# test/workspace-manifests.test.ts fails when a workspace is missing here.
COPY packages/collab-server/package.json ./packages/collab-server/
COPY packages/platejs-editor/package.json ./packages/platejs-editor/
COPY packages/screenshot-studio-backend-sdk/package.json ./packages/screenshot-studio-backend-sdk/
RUN --mount=type=cache,target=/root/.npm npm ci --workspace @shots/collab-server --omit=dev --ignore-scripts --no-audit

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=1234

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY packages/collab-server/package.json ./package.json
COPY packages/collab-server/src ./src

USER node

EXPOSE 1234

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 1234) + '/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

# Node 22 runs the TypeScript source directly (type stripping); there is no build step.
CMD ["node", "src/main.ts"]
