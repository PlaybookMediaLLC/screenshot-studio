# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
    && apt-get install --no-install-recommends --yes openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --no-audit

FROM dependencies AS builder

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# Public values are compiled into the browser bundle. Do not pass secrets here.
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_R2_PUBLIC_URL
ARG DATABASE_URL=postgresql://screenshot_studio:screenshot_studio@localhost:5432/screenshot_studio

ENV DATABASE_URL=$DATABASE_URL \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_R2_PUBLIC_URL=$NEXT_PUBLIC_R2_PUBLIC_URL

RUN npm run build

# The app uses R2 for these backgrounds when its public URL is configured.
# Keep local files only for self-contained builds without R2.
RUN if [ -n "$NEXT_PUBLIC_R2_PUBLIC_URL" ]; then \
      rm -rf public/assets public/mac public/mesh public/paper public/pattern public/radiant public/raycast; \
    fi

FROM dependencies AS migrate

WORKDIR /app

COPY prisma ./prisma
COPY prisma.config.ts ./

CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

# Just the Prisma CLI, at the locked version, for Fly's release_command
# (fly.toml): the standalone server has no CLI, and the migrate stage's full
# dependency tree would multiply the image size.
FROM base AS migrator

WORKDIR /migrator

COPY package-lock.json /tmp/package-lock.json
RUN versions="$(node -p "const p = require('/tmp/package-lock.json').packages; ['prisma', 'dotenv'].map((name) => name + '@' + p['node_modules/' + name].version).join(' ')")" \
    && npm install --no-audit --no-fund --no-package-lock $versions

COPY prisma ./prisma
COPY prisma.config.ts ./

FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=migrator --chown=nextjs:nodejs /migrator ./migrator

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
