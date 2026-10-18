# syntax=docker/dockerfile:1.7
# Production image for the Next.js web app (Phase 10, docs/DEPLOYMENT.md), using
# Next's standalone output. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t vrp-web \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.lk/api/v1 \
#     --build-arg NEXT_PUBLIC_WEB_URL=https://app.example.lk \
#     --build-arg NEXT_PUBLIC_IMAGE_ORIGINS=https://img.example.lk \
#     --build-arg NEXT_PUBLIC_MAP_ORIGINS=https://tiles.openfreemap.org \
#     --build-arg NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty .
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so the
# image is specific to one environment; server-only values (API_INTERNAL_URL)
# are read at run time. No .env is copied; nothing secret belongs in this image.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @vrp/web...

FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WEB_URL
ARG NEXT_PUBLIC_IMAGE_ORIGINS
ARG NEXT_PUBLIC_MAP_ORIGINS
ARG NEXT_PUBLIC_MAP_STYLE_URL
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ARG NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL
ENV NEXT_PUBLIC_IMAGE_ORIGINS=$NEXT_PUBLIC_IMAGE_ORIGINS
ENV NEXT_PUBLIC_MAP_ORIGINS=$NEXT_PUBLIC_MAP_ORIGINS
ENV NEXT_PUBLIC_MAP_STYLE_URL=$NEXT_PUBLIC_MAP_STYLE_URL
ENV NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL
ENV NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL=$NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL
COPY turbo.json ./
COPY packages/contracts packages/contracts
COPY packages/typescript-config packages/typescript-config
COPY packages/eslint-config packages/eslint-config
COPY apps/web apps/web
# The app has no static public assets yet; the runtime stage copies the folder unconditionally.
RUN mkdir -p apps/web/public \
 && pnpm --filter @vrp/contracts build \
 && pnpm --filter @vrp/web build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# `outputFileTracingRoot` is the repository root, so the standalone tree keeps the apps/web prefix.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
