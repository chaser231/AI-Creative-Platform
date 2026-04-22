# ── Stage 1: Install dependencies ──────────────────────────
# Pin to a specific node:22 digest-free tag. The npm that ships with node:22
# (v10.x) understands lockfileVersion 3 just fine — DO NOT add
# `npm install -g npm@latest` here. That command intermittently fails with
# "Cannot find module 'promise-retry'" when npm tries to self-upgrade on a
# fresh image, and killed every Yandex Cloud deploy between #49 and #53.
# See .cursor/rules/deploy-pipeline.mdc for the full rationale.
FROM node:22-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y openssl ca-certificates --no-install-recommends && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci --ignore-scripts
RUN npx prisma generate

# ── Stage 2: Build ─────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ── Stage 3: Production runner ─────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"

RUN apt-get update && \
    apt-get install -y ca-certificates curl --no-install-recommends && \
    rm -rf /var/lib/apt/lists/* && \
    curl -sS -o /etc/ssl/certs/YandexCA.crt \
      https://storage.yandexcloud.net/cloud-certs/CA.pem && \
    update-ca-certificates

ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/YandexCA.crt

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 8080

CMD ["node", "server.js"]
