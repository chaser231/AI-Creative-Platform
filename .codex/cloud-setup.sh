#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/platform-app"

cd "$APP_DIR"

if [ ! -f .env ]; then
  cat > .env <<ENV
# Placeholder values for Codex Cloud setup, tests, typecheck, and Prisma generate.
# Configure real secrets in the Codex Cloud environment when a task needs live services.
DATABASE_URL="postgresql://codex:codex@localhost:5432/ai_creative_platform?schema=public"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="codex-cloud-placeholder-secret-change-in-real-env"
S3_ENDPOINT="https://storage.yandexcloud.net"
S3_BUCKET="acp-assets"
ENV
fi

npm ci
npx prisma generate
