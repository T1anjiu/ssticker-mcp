FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vitest.config.ts ./
COPY apps/admin/package.json apps/admin/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build \
    && pnpm --filter ssticker-mcp deploy --prod --legacy /prod

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV SSTICKER_HOST=0.0.0.0
ENV SSTICKER_PORT=3377
ENV SSTICKER_DATA_DIR=/data
ENV SSTICKER_MODEL_CACHE=/data/models
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && mkdir -p /data \
    && chown node:node /data

COPY --from=build --chown=node:node /prod ./
COPY --from=build --chown=node:node /workspace/apps/admin/dist ./apps/admin/dist

USER node
EXPOSE 3377
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3377/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/cli.js", "serve"]
