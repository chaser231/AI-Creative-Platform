# Технологический стек

**Дата анализа:** 2026-04-22

**Расположение приложения:** `platform-app/` (моно-репозиторий с единственным Next.js приложением). Корневая директория содержит планирование (`.planning/`), документацию (`docs/`, `documentation/`) и приложение.

## Языки

**Основной:**
- TypeScript `^5` — весь код приложения (`platform-app/src/**/*.ts`, `*.tsx`), строгий режим включён в `platform-app/tsconfig.json` (`"strict": true`).

**Вспомогательные:**
- JavaScript (ESM) — конфигурационные файлы (`platform-app/eslint.config.mjs`, `platform-app/postcss.config.mjs`, `platform-app/scripts/generate-fonts.js`).
- SQL/Prisma DSL — схема БД в `platform-app/prisma/schema.prisma`.
- YAML — спецификация API-шлюза `platform-app/infra/apigw-spec.yaml`, CI-пайплайн `.github/workflows/deploy.yml`.

## Runtime

**Среда:**
- Node.js `22` (slim) — зафиксировано во всех stages `platform-app/Dockerfile` (`FROM node:22-slim`).
- Target компиляции: `ES2017`, модули `esnext`, moduleResolution `bundler` (`platform-app/tsconfig.json`).
- JSX: `react-jsx` (новый трансформ React 19).

**Менеджер пакетов:**
- npm (версия из Node 22, явно НЕ обновляется — см. комментарий в `platform-app/Dockerfile:4-7` о баге с `npm install -g npm@latest`, ломавшем деплои #49–#53).
- Lockfile: `platform-app/package-lock.json` присутствует (lockfileVersion 3).
- Сборка в контейнере использует `npm ci --ignore-scripts` + явный `npx prisma generate`.

## Фреймворки

**Ядро (frontend + fullstack):**
- Next.js `16.1.6` (App Router) — `platform-app/next.config.ts`, режим сборки `output: "standalone"`, telemetry отключена.
- React `19.2.3` и React DOM `19.2.3` — последние стабильные React 19.
- Tailwind CSS `^4` (через `@tailwindcss/postcss`) — оформление, конфиг PostCSS в `platform-app/postcss.config.mjs`.

**UI-кит:**
- Radix UI primitives: `@radix-ui/react-dialog ^1.1.15`, `react-select ^2.2.6`, `react-slot ^1.2.4`, `react-tabs ^1.1.13`, `react-toggle ^1.1.10`, `react-tooltip ^1.2.8`.
- Lucide React `^0.563.0` — иконки.
- `class-variance-authority ^0.7.1`, `clsx ^2.1.1`, `tailwind-merge ^3.4.0` — композиция классов.

**Canvas / рендеринг:**
- Konva `^10.2.0` + React Konva `^19.2.2` — canvas-редактор (см. `platform-app/src/components/editor/canvas/`).

**API-слой:**
- tRPC `^11.13.0` — полный стек `@trpc/client`, `@trpc/next`, `@trpc/react-query`, `@trpc/server`. Роутеры: `platform-app/src/server/routers/_app.ts`.
- TanStack Query `@tanstack/react-query ^5.91.3` — кэширование клиентских запросов.
- SuperJSON `^2.2.6` — сериализация payload'ов tRPC (Date, BigInt и т.д.).
- Zod `^4.3.6` — валидация входных данных на границах API/router'ов.

**State management:**
- Zustand `^5.0.11` — глобальный/компонентный стор (`platform-app/src/store/**`, слайсы canvas, theme, template, badge).

**Аутентификация:**
- NextAuth.js `^5.0.0-beta.30` (Auth.js v5 beta) — `platform-app/src/server/auth.ts`.
- `@auth/prisma-adapter ^2.11.1` — адаптер сессий на Prisma.

**ORM / БД-клиент:**
- Prisma Client `^6.19.2` + CLI `prisma ^6.19.2`. Скрипт postinstall: `prisma generate` (`platform-app/package.json:15`).
- Генератор: `prisma-client-js`, провайдер `postgresql` (`platform-app/prisma/schema.prisma:5-13`).

**AI SDK:**
- OpenAI SDK `openai ^6.22.0` — используется в `platform-app/src/lib/ai-providers.ts` для DALL-E 3 и GPT-4o, а также в агент-слое.

**Хранилище объектов (S3):**
- `@aws-sdk/client-s3 ^3.1014.0`
- `@aws-sdk/s3-request-presigner ^3.1014.0` — пре-подписанные URL для прямой загрузки.

**Интеграции:**
- `@figma/rest-api-spec ^0.37.0` — типы Figma REST API (импорт Figma-дизайнов).

**Утилиты:**
- `jszip ^3.10.1` + `@types/jszip ^3.4.0` — экспорт наборов ассетов.
- `file-saver ^2.0.5` + `@types/file-saver ^2.0.7` — сохранение файлов в браузере.
- `uuid ^13.0.0` + `@types/uuid ^10.0.0` — генерация идентификаторов (часть кода также использует `crypto.randomUUID()`).

## Тестирование

**Runner:**
- Vitest `^4.1.4` — конфиг `platform-app/vitest.config.ts`, окружение `node`.
- `@vitest/coverage-v8 ^4.1.4` — покрытие.
- Шаблон включения: `src/**/*.test.ts`, `src/**/*.test.tsx`. `passWithNoTests: false`.

**Скрипты:**
- `npm test` → `vitest run`
- `npm run test:watch` → `vitest`

## Build / Dev tools

**Dev/Build:**
- `next dev` / `next build` / `next start` (скрипты `platform-app/package.json:6-8`).
- `tsx ^4.21.0` — выполнение TypeScript-скриптов (`prisma/seed.ts`, служебные `platform-app/scripts/*.ts`).
- Turbopack — по умолчанию в Next.js 16 (явный флаг не используется).

**Линтинг/форматирование:**
- ESLint `^9` (flat-config, `platform-app/eslint.config.mjs`) с `eslint-config-next 16.1.6` (core-web-vitals + typescript).
  - `no-console: warn` (allow: `["error"]`), для `src/server/**` и `src/app/api/**` — отключён.
  - `@typescript-eslint/no-explicit-any: warn`, `no-var: error`, `prefer-const: warn`, `eqeqeq: warn`.
  - Скрипт линта: `npm run lint` (`eslint src/`).
  - Важно: `next.config.ts` задаёт `eslint.ignoreDuringBuilds: true` — линт во время `next build` не блокирует сборку.
- Prettier (конфиг `platform-app/.prettierrc`): `semi: true`, `singleQuote: true`, `trailingComma: "es5"`, `printWidth: 100`, `tabWidth: 2`, `useTabs: false`.

## Скрипты npm

```
dev            next dev
build          next build
start          next start
lint           eslint src/
lint:fix       eslint src/ --fix
db:push        prisma db push
db:seed        prisma db seed
test           vitest run
test:watch     vitest
postinstall    prisma generate
```

Prisma-seed: `tsx prisma/seed.ts` (см. `platform-app/package.json:17-19`).

## Конфигурация

**Переменные окружения (локально):**
- `.env`, `.env.example`, `.env.local` присутствуют в `platform-app/` — содержимое не приводится. Шаблон задан в `platform-app/.env.example`.
- Ключевые группы: БД, NextAuth, Yandex OAuth, Yandex Object Storage (S3), AI-провайдеры. Полный список — в `INTEGRATIONS.md`.

**Конфигурационные файлы:**
- `platform-app/next.config.ts` — `output: "standalone"`, `eslint.ignoreDuringBuilds: true`, `images.remotePatterns` для `https://storage.yandexcloud.net/acp-assets/**`.
- `platform-app/tsconfig.json` — path alias `@/*` → `./src/*`, `strict: true`, плагин `next`.
- `platform-app/vitest.config.ts` — alias `@` → `src/` (повтор для Vitest).
- `platform-app/eslint.config.mjs` — правила + игноры `.next/`, `out/`, `build/`, `next-env.d.ts`.
- `platform-app/postcss.config.mjs` — единственный плагин `@tailwindcss/postcss`.
- `platform-app/.prettierrc` — стиль форматирования.
- `platform-app/prisma/schema.prisma` — схема БД и enum'ы.

## Платформенные требования

**Разработка:**
- Node 22.x + npm (версия из Node 22).
- Доступ к PostgreSQL (в .env.example настроен на Yandex Managed PostgreSQL через pgBouncer на порту 6432, `sslmode=verify-full`).
- API-ключи провайдеров (см. `INTEGRATIONS.md`) задаются через `.env.local`.

**Production target:**
- Yandex Cloud Serverless Containers — `platform-app/DEPLOY-YANDEX-CLOUD.md` описывает pipeline: Docker build → push в Yandex Container Registry → `yc serverless container revision deploy`.
- API Gateway спецификация: `platform-app/infra/apigw-spec.yaml` (маршрутизация `/{proxy+}` на serverless-контейнер).
- Альтернатива — Compute Instance с `platform-app/docker-compose.prod.yml`.
- CI: `.github/workflows/deploy.yml`.

**Docker-образ (3 stages, `platform-app/Dockerfile`):**
1. `deps` — `node:22-slim` + openssl/ca-certificates, `npm ci --ignore-scripts`, `npx prisma generate`.
2. `builder` — `npm run build` с `NEXT_TELEMETRY_DISABLED=1`.
3. `runner` — `node:22-slim` + Yandex CA cert (`https://storage.yandexcloud.net/cloud-certs/CA.pem`, устанавливается в `NODE_EXTRA_CA_CERTS`), пользователь `nextjs:nodejs` uid/gid 1001, `EXPOSE 8080`, запуск `node server.js` (standalone-output Next.js).

---

*Stack analysis: 2026-04-22*
