FROM node:22-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
    && apt-get install --no-install-recommends --yes openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

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

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
