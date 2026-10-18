# syntax=docker/dockerfile:1.7
# Production image for the API and the worker (Phase 10, docs/DEPLOYMENT.md).
# One image, two commands:
#   API:    node dist/main.js      (default)
#   worker: node dist/worker.js
# Build from the repository root:  docker build -f apps/api/Dockerfile -t vrp-api .
#
# No .env is copied; configuration comes from the environment at run time
# (production:check validates it). Runs as the unprivileged `node` user.

ARG NODE_IMAGE=node:24-bookworm-slim

# ---- base: pnpm via corepack -------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate
WORKDIR /repo

# ---- deps: install the workspace subset the API needs ------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @vrp/api...

# ---- build: compile contracts, database and the API ---------------------------
FROM deps AS build
COPY turbo.json ./
COPY packages/contracts packages/contracts
COPY packages/database packages/database
COPY packages/typescript-config packages/typescript-config
COPY packages/eslint-config packages/eslint-config
COPY apps/api apps/api
RUN pnpm --filter @vrp/contracts build \
 && pnpm --filter @vrp/database build \
 && pnpm --filter @vrp/api build
# Production-only node_modules plus the built workspace packages, flattened for the runtime image.
RUN pnpm --filter @vrp/api deploy --prod --legacy /out \
 && rm -rf /out/src /out/test /out/scripts /out/Dockerfile /out/eslint.config.mjs \
           /out/vitest.config.mts /out/nest-cli.json /out/tsconfig.json /out/tsconfig.build.json \
           /out/*.tsbuildinfo

# ---- runtime -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV API_PORT=4000
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
# Liveness only; readiness (database, PostGIS, migrations) is /api/v1/ready for the platform's probes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
