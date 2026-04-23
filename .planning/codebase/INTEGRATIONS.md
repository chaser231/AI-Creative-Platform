# Внешние интеграции

**Дата анализа:** 2026-04-22

Платформа интегрирована с экосистемой Yandex Cloud (БД, OAuth, S3, Serverless Containers) и с пулом AI-провайдеров (Replicate, fal.ai, OpenAI) через унифицированный слой `platform-app/src/lib/ai-providers.ts`. Figma подключена как вторичный OAuth-провайдер поверх NextAuth для импорта дизайнов.

## API и внешние сервисы

### AI-провайдеры (генерация изображений / текста)

**Унифицированный слой:** `platform-app/src/lib/ai-providers.ts` (fallback-цепочки, ретраи, sibling-модели) + реестр моделей `platform-app/src/lib/ai-models.ts` (`MODEL_REGISTRY`, 23 модели).

**Replicate** (основной для большинства моделей):
- Используется для семейств `google/nano-banana*`, `black-forest-labs/flux-*`, `openai/gpt-image-1.5`, `qwen/qwen-image*`, `bytedance/seedream-4.5`, `bria/expand-image`, `zsxkib/outpainter`, `cjwbw/rembg`, `nightmareai/real-esrgan`, `deepseek-ai/deepseek-v3`, `google/gemini-2.5-flash`.
- SDK: прямой `fetch` к `https://api.replicate.com/v1/models/{slug}/predictions` и `/v1/predictions/{id}` (polling до 300 с, 150 попыток × 2 с) — без официальной SDK, см. `platform-app/src/lib/ai-providers.ts:346-453`.
- Env: `REPLICATE_API_TOKEN` (Bearer auth). Доп. тюнинг: `REPLICATE_MAX_POLLS` (`platform-app/src/server/agent/llmProviders.ts:14`).
- Также используется для LLM-вызовов (DeepSeek V3, Gemini 2.5 Flash) и в агент-слое `platform-app/src/server/agent/llmProviders.ts`.

**fal.ai** (предпочтительный / fallback):
- Первичный провайдер для моделей из множества `FAL_PRIMARY_MODELS` (`nano-banana`, `nano-banana-2`, `nano-banana-pro`, `bria-expand`, `bria-rmbg`, `esrgan`, `seedvr`, `sima-upscaler` — `platform-app/src/lib/ai-providers.ts:934-943`). Для остальных — fallback после Replicate.
- SDK: прямой `fetch` к `https://queue.fal.run/{endpoint}` + polling `status_url` / `response_url` (`platform-app/src/lib/ai-providers.ts:478-917`).
- Endpoint-маппинг: `FAL_MODEL_MAP` (базовые) и `FAL_MODEL_MAP_EDIT` (/edit-варианты Nano Banana для reference images).
- Env: `FAL_KEY` (schema `Key {key}`).
- Специализированные операции: remove-bg, outpainting, upscale (ESRGAN/SeedVR2/Sima), inpaint, edit с reference images.

**OpenAI (direct)**:
- Используется для `dall-e-3` (image generation) и `gpt-4o` (chat completions) — `platform-app/src/lib/ai-providers.ts:62-121`.
- SDK: официальный `openai ^6.22.0`, клиент инициализируется с `dangerouslyAllowBrowser: false`.
- Env: `OPENAI_API_KEY`. В агент-слое также участвует в `getActiveProvider()` приоритезации (`platform-app/src/server/agent/llmProviders.ts:39-50`).
- GPT Image 1.5 помечен как `byok: true` (`platform-app/src/lib/ai-models.ts:128`).
- Vision-анализ: `platform-app/src/server/agent/visionAnalyzer.ts` (OpenAI приоритетнее Replicate).

**Стратегия отказоустойчивости (`generateWithFallback`, `platform-app/src/lib/ai-providers.ts:1023-1081`):**
1. Try primary provider с retry (2 попытки, 5 с пауза).
2. Try secondary provider с retry.
3. Try sibling-модели из `MODEL_FALLBACK_CHAIN` (nano-banana-2 → nano-banana → nano-banana-pro и т.д.).
4. Иначе — бросить агрегированную ошибку по-русски.

### Интеграция с Figma

**Назначение:** импорт Figma-файлов в проекты платформы (файлы: `platform-app/src/lib/figma/*.ts` — `oauth.ts`, `client.ts`, `mapper.ts`, `assets.ts`, `importWorker.ts`, `parseUrl.ts`, `types.ts`).

**OAuth 2.0 + PKCE** (`platform-app/src/lib/figma/oauth.ts`):
- Authorize: `https://www.figma.com/oauth`
- Token: `https://api.figma.com/v1/oauth/token`
- Refresh: `https://api.figma.com/v1/oauth/refresh`
- Scopes: `files:read`, `current_user:read`.
- Это НЕ NextAuth-провайдер для входа: Figma подключается к уже авторизованному пользователю. Токены хранятся в таблице `Account` (общая с NextAuth) с `provider="figma"`.
- Роуты: `platform-app/src/app/api/connect/figma/start/route.ts` (PKCE challenge + state), `.../callback/route.ts` (обмен кода, `saveFigmaAccount`).
- tRPC-роутер: `platform-app/src/server/routers/figma.ts`.
- Env: `AUTH_FIGMA_ID`, `AUTH_FIGMA_SECRET`, `AUTH_FIGMA_REDIRECT_URI`.
- Типы Figma REST API: `@figma/rest-api-spec ^0.37.0`.
- БД-модель импорта: `FigmaImport` (`platform-app/prisma/schema.prisma:456-488`) с полями `status`, `progress`, `report`, `options`.

## Хранилища данных

### БД

**Yandex Managed PostgreSQL** (основное хранилище):
- ORM: Prisma `^6.19.2`, схема `platform-app/prisma/schema.prisma` (provider: `postgresql`).
- Соединение: `DATABASE_URL`, опционально `DIRECT_DATABASE_URL` (для миграций, обход pgBouncer).
- В `.env.example` endpoint: `rc1a-8bmsd3jc3p2p5vj2.mdb.yandexcloud.net:6432` (pgBouncer), `sslmode=verify-full`.
- Клиент: синглтон `platform-app/src/server/db.ts` (кэш в `globalThis.prisma` для dev и serverless).
- Модели: `User`, `Account`, `Session`, `VerificationToken`, `Workspace`, `WorkspaceMember`, `JoinRequest`, `Project`, `ProjectVersion`, `FavoriteProject`, `Template`, `TemplateShare`, `Asset`, `SystemPrompt`, `AIPreset`, `AISession`, `AIMessage`, `AIWorkflow`, `PlatformEvent`, `FigmaImport` (20 моделей).
- Seed: `platform-app/prisma/seed.ts` + `platform-app/prisma/seed-presets.ts`, запуск `npm run db:seed` через `tsx`.

### Хранение файлов

**Yandex Object Storage (S3-совместимый)**:
- SDK: `@aws-sdk/client-s3 ^3.1014.0` + `@aws-sdk/s3-request-presigner ^3.1014.0`.
- Регион: `ru-central1`, endpoint: `https://storage.yandexcloud.net`, bucket по умолчанию: `acp-assets`.
- Клиентские модули:
  - `platform-app/src/app/api/upload/route.ts` — base64 или URL → PUT в S3 (+ создание записи `Asset` в БД).
  - `platform-app/src/app/api/upload/presign/route.ts` — пресайнед PUT-URL (10 мин) для прямой загрузки из браузера.
  - `platform-app/src/app/api/setup-cors/route.ts` — настройка CORS на бакете.
  - `platform-app/src/server/routers/asset.ts` — tRPC CRUD ассетов (включая `saveGeneratedImage`).
  - `platform-app/src/server/utils/s3-cleanup.ts` — очистка осиротевших объектов.
  - `platform-app/src/lib/figma/assets.ts` — заливка ассетов Figma-импорта.
  - `platform-app/scripts/setup-s3-lifecycle.ts` — настройка lifecycle-политик.
- Env: `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`.
- Публичные URL разрешены в Next/Image: `next.config.ts` → `images.remotePatterns` allowlist `storage.yandexcloud.net/acp-assets/**`.

### Кэш

- Специализированного кэш-сервиса (Redis/Upstash) нет. Клиентское кэширование — TanStack Query (`@tanstack/react-query`). Серверное — внутренние мемоизации.

## Аутентификация и идентичность

**Основной провайдер:** Yandex OAuth через NextAuth.js (Auth.js) v5 beta:
- Конфиг: `platform-app/src/server/auth.ts`.
- Кастомный OAuth-провайдер (не npm-пакет): `id: "yandex"`, authorize `https://oauth.yandex.ru/authorize` (scope: `login:email login:info login:avatar`), token `https://oauth.yandex.ru/token`, userinfo `https://login.yandex.ru/info?format=json`.
- Аватарки: `https://avatars.yandex.net/get-yapic/{id}/islands-200`.
- Адаптер: `@auth/prisma-adapter ^2.11.1` → таблицы `Account`/`Session`/`User`/`VerificationToken` в Prisma.
- Custom session callback обогащает сессию полями `id` и `status` (enum `AccountStatus`: `PENDING | APPROVED | REJECTED`) с graceful degradation при сбое БД (дефолт `APPROVED`).
- Страницы: `pages.signIn: "/auth/signin"`, ошибки редиректятся на ту же страницу.
- Env: `AUTH_SECRET` (или legacy `NEXTAUTH_SECRET`), `NEXTAUTH_URL` / `AUTH_URL`, `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`. Debug-флаг: `AUTH_DEBUG=true`.

**Middleware-защита:** `platform-app/src/middleware.ts` — проверяет cookie `authjs.session-token` или `__Secure-authjs.session-token`, редиректит неавторизованных на `/auth/signin`. Public routes: `/auth/*`, `/api/auth`, `/api/trpc`, `/_next`, `/favicon.ico`.

**Вторичная интеграция:** Figma OAuth 2.0 + PKCE (см. выше, `platform-app/src/lib/figma/oauth.ts`).

## Мониторинг и observability

**Error tracking:**
- Внешнего сервиса (Sentry, Datadog, Rollbar и т.п.) НЕ обнаружено.
- Ошибки пишутся в `console.error` (ESLint разрешает `console.error` в клиентском коде; для `src/server/**` и `src/app/api/**` — любые `console`).

**Логи:**
- `console.log`/`warn`/`error` в server-роутерах, agent-слое и AI-провайдерах (префиксы `[Replicate]`, `[fal.ai]`, `[Pipeline ▶6 Provider]`, `[AUTH ERROR]`, `[AUTH WARN]`, `[AUTH DEBUG]`).
- Prisma query-log включён в dev (`platform-app/src/server/db.ts:9-12`), в prod — только `error`.

**События аналитики:**
- Таблица `PlatformEvent` (`platform-app/prisma/schema.prisma:440-451`) — произвольные события (`project_created`, `template_applied`, `ai_generation`, `user_login`) с полем `metadata: Json`.

## CI/CD и деплой

**Хостинг:** Yandex Cloud Serverless Containers (либо Compute Instance + docker-compose как запасной вариант).

**Container Registry:** Yandex Container Registry (`cr.yandex/{CR_ID}/acp-platform:latest` — `platform-app/docker-compose.prod.yml`).

**CI Pipeline:** GitHub Actions — `.github/workflows/deploy.yml`.

**API Gateway:** Yandex API Gateway, спецификация `platform-app/infra/apigw-spec.yaml`, проксирует `/{proxy+}` на контейнер `bbauroacejldutvjmm3g` через сервисный аккаунт `aje84cq0tggi5jep2nfs`.

**Инструкции деплоя:** `platform-app/DEPLOY-YANDEX-CLOUD.md` (полный runbook с командами `yc` CLI).

**Rules/артефакты:** `.cursor/rules/deploy-pipeline.mdc` — описывает причины пина Node-версии и запрета `npm install -g npm@latest`.

## Конфигурация окружения

**Обязательные env vars** (из `platform-app/.env.example` и прямых ссылок в коде):

| Группа | Переменная | Где используется |
|---|---|---|
| БД | `DATABASE_URL` | `src/server/db.ts:13`, `prisma/schema.prisma:11` |
| БД | `DIRECT_DATABASE_URL` | `prisma/schema.prisma:12` (миграции в обход pgBouncer) |
| NextAuth | `NEXTAUTH_URL` / `AUTH_URL` | `src/app/api/connect/figma/callback/route.ts:125-127` |
| NextAuth | `NEXTAUTH_SECRET` / `AUTH_SECRET` | `src/server/auth.ts:16` |
| Yandex OAuth | `YANDEX_CLIENT_ID` | `src/server/auth.ts:36` |
| Yandex OAuth | `YANDEX_CLIENT_SECRET` | `src/server/auth.ts:37` |
| S3 | `S3_ENDPOINT` | все S3-клиенты (default `https://storage.yandexcloud.net`) |
| S3 | `S3_ACCESS_KEY_ID` | все S3-клиенты |
| S3 | `S3_SECRET_ACCESS_KEY` | все S3-клиенты |
| S3 | `S3_BUCKET` | все S3-клиенты (default `acp-assets`) |
| AI | `REPLICATE_API_TOKEN` | `src/lib/ai-providers.ts:130`, `src/server/agent/llmProviders.ts`, `src/server/agent/visionAnalyzer.ts` |
| AI | `OPENAI_API_KEY` | `src/lib/ai-providers.ts:73`, agent + vision |
| AI | `FAL_KEY` | `src/lib/ai-providers.ts:483`, agent |
| AI tuning | `AGENT_PROVIDER` (`openai`/`fal`/`replicate`/`auto`) | `src/server/agent/llmProviders.ts:40` |
| AI tuning | `LLM_FETCH_TIMEOUT_MS` (default 30000) | `src/server/agent/llmProviders.ts:11` |
| AI tuning | `REPLICATE_MAX_POLLS` (default 120) | `src/server/agent/llmProviders.ts:14` |
| Figma | `AUTH_FIGMA_ID` | `src/lib/figma/oauth.ts:33` |
| Figma | `AUTH_FIGMA_SECRET` | `src/lib/figma/oauth.ts:34` |
| Figma | `AUTH_FIGMA_REDIRECT_URI` | `src/lib/figma/oauth.ts:35` |
| Безопасность | `AGENT_IMAGE_URL_ALLOWLIST` | `src/server/security/ssrfGuard.ts:844` |
| Клиент | `NEXT_PUBLIC_APP_URL` | `src/app/api/connect/figma/callback/route.ts:127` |
| Среда | `VERCEL_URL` (fallback для URL в dev-редких случаях) | `src/components/providers/TRPCProvider.tsx:18` |
| Среда | `NODE_ENV` | везде |

**Файлы окружения:** `platform-app/.env`, `platform-app/.env.local`, `platform-app/.env.example` — присутствуют локально, содержимое намеренно не цитируется. На проде env-переменные передаются через `yc serverless container revision deploy --environment ...` (`DEPLOY-YANDEX-CLOUD.md:96-107`) или через `docker-compose.prod.yml` с `env_file: .env.production`.

**Ограничение:** суммарный объём env у Serverless Container ≤ 4 КБ. Для больших секретов — Yandex Lockbox (на момент анализа не подключён).

## Webhooks и callbacks

**Входящие:**
- `/api/auth/[...nextauth]` — callback'и NextAuth (Yandex OAuth).
- `/api/connect/figma/callback` — Figma OAuth redirect.

**Исходящие:**
- HTTP-POST в Replicate predictions API.
- HTTP-POST в fal.ai queue API.
- HTTP-POST в OpenAI API (через SDK).
- HTTP-POST в Figma token/refresh endpoints.
- S3 PutObject / presigned PUT → Yandex Object Storage.

**Очереди/брокеры:**
- Нативной очереди (Kafka, SQS, Redis Streams) НЕ обнаружено.
- fal.ai использует собственную queue-архитектуру (`queue.fal.run`), polling выполняется из Next.js route'ов.
- Прогресс Figma-импорта хранится в БД (`FigmaImport.status`/`progress`) — клиент опрашивает через tRPC.

## Встроенные механизмы безопасности

- SSRF-guard: `platform-app/src/server/security/ssrfGuard.ts` (+ тесты в `__tests__/ssrfGuard.test.ts`) — проверяет scheme/port/host/IP, пинит DNS перед `fetch`, валидирует MIME и размер через HEAD. Применяется в `/api/upload` для внешних URL (Replicate/fal temp links). Allowlist хостов — через `AGENT_IMAGE_URL_ALLOWLIST`.
- Rate limit: `platform-app/src/lib/rateLimit.ts`.
- Authz-guards: `platform-app/src/server/authz/` + `requireSessionAndProjectAccess` в upload-роутах.
- Yandex CA cert устанавливается в `NODE_EXTRA_CA_CERTS` в runner-stage Dockerfile для валидации TLS-соединений к Yandex-сервисам.

---

*Integration audit: 2026-04-22*
