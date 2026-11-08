# syntax=docker/dockerfile:1.7
# One image per app. Build from the repo root:
#   docker build -f infra/docker/next-app.Dockerfile --build-arg APP=api -t ros-api:local .
# APP is one of api, console, ops, admin. The `migrate` target (from the builder
# stage, full source + dev tooling) runs the database CLIs as a one-shot job.
ARG NODE_VERSION=22
ARG TURBO_VERSION=2.11.10

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# Stage 1: keep only the workspace packages the app depends on.
FROM base AS pruner
ARG APP
ARG TURBO_VERSION
RUN npm install -g turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune @ros/${APP} --docker

# ---------------------------------------------------------------------------
# Stage 2: install with the pruned lockfile, then build only this app.
FROM base AS builder
ARG APP
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=1
RUN pnpm turbo run build --filter=@ros/${APP}
# Only the API ships the migration journal (frontends are pruned without the
# database package); stage it at a fixed path so the runner COPY always works.
# Frontends bundle their service worker after `next build` (.next/sw-prebuilt).
RUN mkdir -p /sw-prebuilt \
    && if [ -d apps/${APP}/.next/sw-prebuilt ]; then cp -r apps/${APP}/.next/sw-prebuilt/. /sw-prebuilt/; fi
RUN mkdir -p /migrations \
    && if [ -d packages/database/src/providers/postgres/migrations ]; then \
         cp -r packages/database/src/providers/postgres/migrations/. /migrations/; \
       fi

# ---------------------------------------------------------------------------
# One-shot migrations (docker compose `migrate` service): the builder image
# already has tsx, drizzle and the migrations folder.
FROM builder AS migrate
ENV NODE_ENV=production
WORKDIR /app/packages/database
CMD ["pnpm", "migrate"]

# ---------------------------------------------------------------------------
# Stage 3: minimal runtime from the standalone output.
FROM node:${NODE_VERSION}-slim AS runner
ARG APP
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV APP=${APP}
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --create-home --shell /usr/sbin/nologin app
WORKDIR /app
# server.js and the traced node_modules; the layout mirrors the repo because
# outputFileTracingRoot is the repo root.
COPY --from=builder --chown=app:app /app/apps/${APP}/.next/standalone ./
COPY --from=builder --chown=app:app /app/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=builder --chown=app:app /app/apps/${APP}/public ./apps/${APP}/public
# /api/v1/health/ready reads the migration journal through MIGRATIONS_DIR,
# which resolves next to the database package's client module.
COPY --from=builder --chown=app:app /migrations ./packages/database/src/providers/postgres/migrations
COPY --from=builder --chown=app:app /sw-prebuilt ./apps/${APP}/.next/sw-prebuilt
# Liveness path: the API has no /healthz page.
RUN if [ "${APP}" = "api" ]; then echo "/api/v1/health" > /app/.healthcheck; else echo "/healthz" > /app/.healthcheck; fi \
    && chown app:app /app/.healthcheck
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS "http://127.0.0.1:${PORT}$(cat /app/.healthcheck)" > /dev/null || exit 1
CMD ["sh", "-c", "exec node apps/${APP}/server.js"]
