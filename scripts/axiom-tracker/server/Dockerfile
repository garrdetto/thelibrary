FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY scripts/axiom-tracker/server/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    AXIOM_COLLECTOR=extension \
    AXIOM_DB_PATH=/data/axiom-tracker.db \
    AXIOM_SETTINGS_PATH=/data/radar-settings.json
COPY --from=deps /app/node_modules ./node_modules
COPY scripts/axiom-tracker/server/package.json ./package.json
COPY src/lib/axiom-radar-learner.ts src/lib/axiom-radar-settings.ts src/lib/axiom-radar-types.ts ./src/lib/
COPY scripts/axiom-tracker ./scripts/axiom-tracker
RUN mkdir -p /data && ln -s /data /app/data
EXPOSE 8791
CMD ["node", "node_modules/tsx/dist/cli.mjs", "scripts/axiom-tracker/index.ts"]
