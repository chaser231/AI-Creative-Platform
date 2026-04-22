# Codebase Concerns

**Analysis Date:** 2026-04-22

> Область анализа: `platform-app/` (единственный Next.js 16 / React 19 / tRPC / Prisma сервис в репозитории).
> Ветка: `fix/asset-catalog-dedupe`. Несмотря на упоминание в задаче, `platform-app/src/server/routers/asset.ts` в `git status` как изменённый **не значится** — рабочее дерево чистое, единственный untracked-путь — это `.planning/`.

---

## Critical

### C-1. CORS на S3-бакете открыт на `*`
- Проблема: эндпоинт `POST /api/setup-cors` выставляет `AllowedOrigins: ["*"]` для всех GET/HEAD-запросов к бакету `acp-assets`.
- Файлы: `platform-app/src/app/api/setup-cors/route.ts:37`
- Риск: любой сторонний фронтенд может читать ассеты пользователей напрямую (включая потенциально чувствительные брендкиты, шрифты клиентов, черновики баннеров). Отсутствие whitelisted-origins делает утечки по referrer/embed тривиальными и ломает будущую подпись URL для приватного контента.
- Что сделать: заменить `*` на список продакшен-origin'ов (прод-домен, staging-домен, `http://localhost:3000` для dev), вынести список в ENV (`S3_CORS_ALLOWED_ORIGINS`). Эндпоинт должен быть доступен только `SUPER_ADMIN`, а не любому авторизованному пользователю (`platform-app/src/app/api/setup-cors/route.ts:26-29` проверяет только `session.user`).

### C-2. `.env` / `.env.local` не исключены в `.gitignore`
- Проблема: в `platform-app/.gitignore` нет правил `.env*`, `.env.local`, `.env.*.local`. Файлы `platform-app/.env` и `platform-app/.env.local` сейчас существуют на диске и содержат секреты (S3 access keys, OAuth client secrets, LLM API tokens).
- Файлы: `platform-app/.gitignore`, `platform-app/.env`, `platform-app/.env.local`
- Риск: достаточно одного `git add .` у любого разработчика — и прод-ключи утекут в историю. Отсутствие явного guard'а — только «пока повезло».
- Что сделать: добавить в `platform-app/.gitignore`:
  ```
  .env
  .env.*
  !.env.example
  ```
  и проверить `git log --all -- platform-app/.env` — ни одного коммита секретов в истории быть не должно. Если есть — ротировать все ключи.

### C-3. Dev auth bypass выдаёт `SUPER_ADMIN` + членство во всех воркспейсах
- Проблема: `getDevUser()` в dev-режиме создаёт пользователя `dev@acp.local` с ролью `SUPER_ADMIN` и автоматически добавляет его `ADMIN`-ом во все существующие воркспейсы. Если в проде случайно оставят `NODE_ENV=development` (или кто-то поднимет dev-сборку на публичном URL), доступ к любому воркспейсу получает любой неавторизованный посетитель.
- Файлы: `platform-app/src/server/trpc.ts:22-56`, `platform-app/src/server/trpc.ts:63-65`
- Риск: полный компромисс multi-tenant-изоляции при неверном `NODE_ENV`. Плюс: dev-пользователь создаётся в **любой** подключенной БД, включая прод, если туда случайно сходить dev-сборкой.
- Что сделать: добавить вторую защиту — помимо `NODE_ENV !== "production"` проверять `process.env.ALLOW_DEV_USER === "1"`, и отказываться создавать `dev@acp.local`, если `DATABASE_URL` указывает на прод-хост. Логировать предупреждение при каждом попадании в бранч.

---

## High

### H-1. `ignoreDuringBuilds: true` для ESLint + `@ts-expect-error` на конфиге
- Проблема: `next.config.ts` выключает ESLint на CI-сборке и содержит `@ts-expect-error` над самим блоком `eslint`.
- Файлы: `platform-app/next.config.ts:5-8`
- Риск: любые lint-ошибки (включая `no-explicit-any`, `react-hooks/exhaustive-deps`, `no-console`) в прод-билд проходят молча. В проекте уже 20+ `eslint-disable-next-line` (`platform-app/src/components/editor/canvas/Canvas.tsx:34-44,287-295` — 10 штук на один файл) — без CI-gate их станет только больше.
- Что сделать: включить `eslint` в build или завести отдельный pre-push / GH Actions job `npm run lint` с `--max-warnings=0`. Починить `@ts-expect-error` — в `next@16.1.6` поле `eslint` в `NextConfig` типизировано корректно.

### H-2. Валидация загружаемых ассетов — только в REST-эндпоинте, не в tRPC
- Проблема: `GET /api/upload/presign` проверяет mimeType против белого списка (`ALLOWED_MIME_TYPES` на 5 типов), а tRPC-процедура `asset.getUploadUrl` принимает `mimeType: z.string()` без какой-либо проверки — можно выписать presigned PUT на любой `Content-Type`, включая `text/html` или `application/octet-stream`.
- Файлы: `platform-app/src/app/api/upload/presign/route.ts:46-52` (правильно), `platform-app/src/server/routers/asset.ts:465-510` (нет проверки), `platform-app/src/server/routers/asset.ts:478` (см. `input` схему)
- Риск: пользователь может залить HTML/JS на `storage.yandexcloud.net/acp-assets/...` и, поскольку CORS открыт (см. C-1), использовать это для XSS/фишинга с доверенного домена. Также размер (`sizeBytes: z.number()`) не ограничен — ни min, ни max.
- Что сделать: вынести `ALLOWED_MIME_TYPES` в общий модуль (`src/lib/assetValidation.ts`) и использовать в обоих путях. Добавить `sizeBytes: z.number().int().min(1).max(100 * 1024 * 1024)`.

### H-3. Отсутствуют индексы по `(projectId, url)` и `(workspaceId, url)` на модели `Asset`
- Проблема: схема `Asset` имеет индексы только `(workspaceId, type)`, `(projectId)`, `(templateId)`. При этом hot-path-запросы идут именно по `(projectId, url)` и `(workspaceId, url)`:
  - Идемпотентные `findFirst` в `saveGeneratedImage`, `attachUrlToProject`, `cloneAssetToProject` — все три на каждый апселют в проекте
  - `copyTemplateAssetsToProject` — `{ projectId, url: { in: [...] } }`
  - `delete` / `deleteMany` — `{ workspaceId, url }` для каскада по S3-объекту
  - `listByWorkspace` выбирает до 800 строк и делает in-memory dedupe по `url` (`platform-app/src/server/routers/asset.ts:109-161`)
- Файлы: `platform-app/prisma/schema.prisma:303-330`, `platform-app/src/server/routers/asset.ts:189-192,249-252,310-314,436-444,557-564,641-648`
- Риск: при росте воркспейса выше ~10 тыс. ассетов: (a) каталог dashboard начнёт тормозить на dedupe, (b) idempotent-write-пути на каждом upload дают sequential-scan. Индексов достаточно, но их нет.
- Что сделать: добавить в схему
  ```prisma
  @@index([projectId, url])
  @@index([workspaceId, url])
  ```
  и рассмотреть `@@unique([projectId, url])` как жёсткий DB-guard вместо application-level `findFirst`.

### H-4. N+1 в `asset.deleteMany`: `assertAssetAccess` + `getWorkspaceRole` в цикле
- Проблема: цикл `for (const __id of input.ids)` последовательно выполняет `assertAssetAccess` (1 Prisma-query) и `getWorkspaceRole` (1 Prisma-query) на каждый ID, затем ещё цикл `for (const { workspaceId, url } of byUrl.values())` снова вызывает `getWorkspaceRole` + `findMany`. Удаление 50 ассетов = ~200 round-trip'ов к БД.
- Файлы: `platform-app/src/server/routers/asset.ts:599-611`, `platform-app/src/server/routers/asset.ts:639-650`
- Риск: медленный bulk-delete, таймауты в UI, локи на строках `Asset` при параллельных удалениях.
- Что сделать: единым `findMany({ where: { id: { in: input.ids } } })` + одним `findMany` по `workspaceMember` для всех уникальных воркспейсов; роль кэшировать в `Map`. Префиксы `__a`, `__id`, `__r` (названия переменных) тоже выдают исторический workaround — переписать без андерскоров.

### H-5. Rate limiter — in-memory, не расшарен между инстансами
- Проблема: `platform-app/src/lib/rateLimit.ts` держит счётчик в `Map` процесса. В Docker/Vercel serverless / horizontal scaling каждый инстанс имеет свой квот-пул → реальный лимит = `limit × N_instances`.
- Файлы: `platform-app/src/lib/rateLimit.ts:16`, `platform-app/src/app/api/ai/generate/route.ts:20` (30 rps на пользователя на инстанс)
- Риск: в проде с 2+ подами AI-генерация утраивается поверх заявленных 30/мин; лимит не защищает бюджет на OpenAI/FAL/Replicate.
- Что сделать: перевести на Upstash Redis / Yandex Managed Redis (`@upstash/ratelimit` или ручной Lua-скрипт). Комментарий в файле (`platform-app/src/lib/rateLimit.ts:8`) уже это признаёт — значит, feature, не bug, но критично для прод-readiness.

### H-6. `setInterval` без cleanup в серверном модуле
- Проблема: `rateLimit.ts:19-24` запускает `setInterval(..., 60_000)` на топ-левеле. В Next.js App Router на dev-hot-reload модуль может переимпортироваться → утечка таймеров. В проде при SIGTERM процесс не останавливает интервал → graceful shutdown затягивается.
- Файлы: `platform-app/src/lib/rateLimit.ts:19-24`
- Что сделать: обернуть в `globalThis.__acpRateLimitInterval ||= setInterval(...)` для idempotency, либо перейти на lazy-cleanup внутри `checkRateLimit` (удалять expired entries во время чтения).

---

## Medium

### M-1. Огромные файлы — сложно тестировать и ревьюить
Пять файлов превышают 1000 строк, один — 2340:
- `platform-app/src/components/editor/canvas/Canvas.tsx` — **2340**
- `platform-app/src/app/editor/[id]/page.tsx` — **1158**
- `platform-app/src/store/canvas/createLayerSlice.ts` — **1126**
- `platform-app/src/lib/ai-providers.ts` — **1081** (все четыре AI-провайдера в одном модуле)
- `platform-app/src/components/editor/TemplatePanel.tsx` — **1051**
- `platform-app/src/components/editor/AIPromptBar.tsx` — **1049**

Риск: высокий cognitive load, `Canvas.tsx` содержит 10 `eslint-disable` только из-за `Konva.KonvaEventObject<any>`. Юнит-тестов нет ни для одного из них (в `src/**/__tests__/` — всего 6 файлов, все на `ssrfGuard`, `figma/mapper`, `layoutEngine`, `computeConstrainedPosition`).
Что сделать: приоритет на `Canvas.tsx` — выделить `CanvasLayer`, `useCanvasTransform`, `useCanvasKeyboard` в отдельные модули. `ai-providers.ts` — разрезать на `providers/openai.ts`, `providers/fal.ts`, `providers/replicate.ts`.

### M-2. `z.any()` в tRPC-инпутах
- Проблема: критичные мутации принимают нетипизированный JSON.
- Файлы:
  - `platform-app/src/server/routers/template.ts:237-238,267-268,339` — `tags`, `data` (TemplatePack!)
  - `platform-app/src/server/routers/adminTemplate.ts:144-145`
  - `platform-app/src/server/routers/workflow.ts:126,151` — `steps: AIStep[]`
  - `platform-app/src/server/routers/workspace.ts:449-450` — `colors`, `fonts` брендкита
- Риск: полный обход валидации на границе клиент→сервер. Клиент может положить в БД что угодно (в том числе `{ __proto__: ... }`); при последующем `as Record<string, unknown>` (см. `platform-app/src/server/agent/executeAction.ts:414,442`) никаких проверок уже нет.
- Что сделать: выписать Zod-схемы для `TemplatePackSchema`, `AIStepSchema`, `BrandColorsSchema`, `BrandFontsSchema`. Использовать их и на клиенте (через `z.infer`) — устранит дублирование типов.

### M-3. Async-ошибки глушатся через `.catch(() => undefined)` / `.catch(() => {})`
Найдено 9 мест:
- `platform-app/src/components/editor/TemplatePanel.tsx:99,102`
- `platform-app/src/app/editor/[id]/page.tsx:457,460,475,478`
- `platform-app/src/hooks/useProjectLibrary.ts:71,74`
- `platform-app/src/components/editor/AIPromptBar.tsx:542,640`
- `platform-app/src/app/api/template/[id]/route.ts:87`

Риск: реальные ошибки (network, 5xx, expired session) никогда не доходят до пользователя и до логов. Debug «почему не синкается» превращается в раскопки.
Что сделать: минимум — `.catch((err) => console.error("<context>", err))`, идеально — toast/Sentry. Ни одной реальной «прочитали и осознанно проигнорировали» ситуации среди них нет.

### M-4. `process.env.X!` (non-null assertion) без fail-fast guard
- Проблема: провайдеры LLM читают ключи как `process.env.OPENAI_API_KEY!` (non-null bang) вместо явной проверки при старте приложения.
- Файлы: `platform-app/src/server/agent/llmProviders.ts:100,127,284,422`, `platform-app/src/server/agent/visionAnalyzer.ts:58,126`
- Риск: если переменная не задана, SDK получает `undefined` → ошибка во время пользовательского запроса, а не при старте контейнера. В `lib/ai-providers.ts:73` применён антипаттерн ещё жёстче — `apiKey: process.env.OPENAI_API_KEY || "dummy"` (фейковый ключ отправляется в OpenAI SDK).
- Что сделать: завести `src/server/env.ts` с `z.object({...}).parse(process.env)` при cold start, убрать `||"dummy"` / `!`.

### M-5. Асимметричные дефолты S3 endpoint/bucket продублированы в 5 файлах
- Проблема: строки `process.env.S3_ENDPOINT || "https://storage.yandexcloud.net"` и `process.env.S3_BUCKET || "acp-assets"` повторяются в:
  - `platform-app/src/app/api/upload/route.ts:42,49,148`
  - `platform-app/src/app/api/upload/presign/route.ts:37,44,93`
  - `platform-app/src/app/api/setup-cors/route.ts:15,22`
  - `platform-app/src/lib/figma/assets.ts:20-21`
  - `platform-app/src/server/routers/asset.ts:29,36,493`
  - `platform-app/src/server/utils/s3-cleanup.ts:21`
- Риск: сменили ENV в одном месте — забыли в другом, инстансы S3-клиента разошлись. Дефолтный bucket `acp-assets` — это _прод-бакет_, т.е. локальная dev-инсталяция без `.env.local` пишет в прод.
- Что сделать: выделить `src/server/s3.ts` с singleton `s3Client` и константами, запретить дефолты (fail на старте, если `S3_BUCKET` не задан).

### M-6. `openai@^6` — major version bump
- Проблема: в проекте установлен `openai@^6.22.0` (package.json:46). Это крупный major-релиз с серьёзно переработанным SDK (Responses API по умолчанию, breaking changes в `chat.completions` shape по сравнению с v4/v5). В коде (`platform-app/src/lib/ai-providers.ts:92-116`) используется именно `chat.completions.create` + `images.generate` со старым `response_format: "url"`.
- Риск: `response_format` — deprecated поле в v6 (теперь `images.generate` возвращает url по умолчанию, DALL-E 3 заменён рекомендацией `gpt-image-1`). При минорном апдейте `npm update` поведение может внезапно измениться.
- Что сделать: зафиксировать конкретную версию (`"openai": "6.22.0"` без caret) и запланировать апдейт до Responses API / `gpt-image-1` как отдельную фазу.

### M-7. `zod@^4.3.6` — major v4 API
- Проблема: Zod v4 (релиз 2025) имеет ряд breaking changes по сравнению с v3: переработанный `z.string().email()`, `z.record()` требует 2 аргумента (что мы и видим — `z.record(z.string(), z.unknown())` в `platform-app/src/server/routers/asset.ts:474`). Не проблема сама по себе, но — все гайды/copilot-предложения всё ещё v3-ориентированы, легко сломать.
- Файлы: `platform-app/package.json:53`
- Что сделать: пин `"zod": "4.3.6"`, добавить примечание в `CONVENTIONS.md` про v4-specific синтаксис.

### M-8. `next-auth@5.0.0-beta.30`
- Проблема: NextAuth v5 всё ещё в бете, и проект на public-facing продукте зависит от beta-release.
- Файлы: `platform-app/package.json:45`
- Риск: breaking changes между бета-версиями, отсутствие LTS-гарантий.
- Что сделать: отслеживать релиз v5 GA, настроить version-pinning (`5.0.0-beta.30` exact), завести issue на миграцию после GA.

### M-9. Два разных способа аплоадить: REST-роуты vs tRPC — и они не синхронизированы
- Проблема: одинаковая операция «получить presigned URL» существует и в `GET /api/upload/presign` (лимит 10 мин, белый список из 5 типов), и в `asset.getUploadUrl` tRPC (1 час, никакой валидации mime). Клиент может вызывать любой — но они производят Asset-записи по разным схемам (REST — с `skipAssetRecord`, tRPC — всегда создаёт запись).
- Файлы: `platform-app/src/app/api/upload/presign/route.ts`, `platform-app/src/server/routers/asset.ts:465-510`, `platform-app/src/app/api/upload/route.ts:154-178`
- Риск: расхождение логики, двойные/тройные записи `Asset` для одного S3-объекта (дедуп в `listByWorkspace` — следствие этого, см. `platform-app/src/server/routers/asset.ts:72-86`).
- Что сделать: выбрать один путь (рекомендация: tRPC, он уже типизирован), пометить REST как deprecated, мигрировать всех вызывающих.

---

## Low

### L-1. `dangerouslyAllowBrowser: false` — но объект всё равно создаётся при import
- Проблема: `new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "dummy" })` в модуле `src/lib/ai-providers.ts:72-76` выполняется при каждом импорте. Если файл случайно попадёт в client bundle (а он экспортирует клиент-safe `MODEL_REGISTRY`), dummy-ключ попадёт в браузер.
- Файлы: `platform-app/src/lib/ai-providers.ts:13-16,72-76`
- Что сделать: или вынести сервер-часть за `"use server"`, или сделать client-safe `ai-models.ts` отдельным пакажем без re-export `ai-providers`.

### L-2. Deprecated-поля на `LayerBinding` без timeline на удаление
- Проблема: `syncMode`, `syncImageProportional` помечены `@deprecated`, но миграция сделана лишь на чтении (`migrateLegacyBinding` в `platform-app/src/types/index.ts:61-80`). Записи в БД всё ещё могут приходить в legacy-формате.
- Файлы: `platform-app/src/types/index.ts:26-54`
- Что сделать: одноразовая data-migration в Prisma (JSON-update по всем `LayerBinding`), затем удалить legacy-поля.

### L-3. `seed-presets.ts` + `seed.ts` без guard'а против прода
- Проблема: `npm run db:seed` не проверяет `NODE_ENV` / `DATABASE_URL`. Запуск против прода затирает/добавит пресеты.
- Файлы: `platform-app/prisma/seed.ts:223` (выход с `process.exit(1)` на ошибке — но не на «это прод, не делай seed»)
- Что сделать: в начале `seed.ts` — `if (process.env.NODE_ENV === "production" && !process.env.ALLOW_PROD_SEED) throw`.

### L-4. Наличие `test.txt` в корне `platform-app/`
- Проблема: `platform-app/test.txt` (2160 байт) — похоже на отладочный артефакт, не gitignored, не на что не ссылается.
- Файлы: `platform-app/test.txt`
- Что сделать: удалить или переместить в `docs/`.

### L-5. `ExportModal`, `swatches/SwatchesPanel`, `wizard/blocks/*` — подозрение на тёплый dead code
- Не верифицировано full-scan'ом; требуется `knip` / `ts-prune` пройти один раз. В текущем дереве есть файлы, которые не импортированы ни из `app/`, ни из других компонентов (судя по `find + grep` семплам), но подтверждать нужно отдельным проходом.
- Что сделать: добавить `knip` в devDependencies, запустить один раз, удалить неимпортируемое.

### L-6. React Hook deps-lints отключены точечно 4 раза
- Файлы: `platform-app/src/hooks/useTemplateSync.ts:195`, `platform-app/src/hooks/useAISessionSync.ts:72`, `platform-app/src/hooks/useProjectSync.ts:326`, `platform-app/src/components/editor/canvas/InlineTextEditor.tsx:110`
- Риск: пропущенные/избыточные зависимости приводят к «залипшим» замыканиям или лишним ре-рендерам.
- Что сделать: проанализировать каждый случай — обычно решается через `useRef` для «мутабельных» значений или `useCallback`. Коммент-причина рядом с `eslint-disable` обязательна.

### L-7. Тестовое покрытие — точечное, без интеграционных
- Что есть: 6 файлов в `__tests__/` — только чистая логика (SSRF, Figma parseUrl/mapper, layoutEngine, computeConstrainedPosition).
- Чего нет: ни одного теста на tRPC-роутеры (`asset.ts`, `workspace.ts`, `project.ts`), ни одного E2E, ни одного теста на authz-guards (`platform-app/src/server/authz/guards.ts`).
- Риск: весь access control живёт на доверии к ручным review. Регрессии в `assertWorkspaceAccess` / `assertProjectAccess` / `assertAssetAccess` ловить нечем.
- Приоритет: Medium→High (см. CONCERNS в общей картине), но формально — Low coverage gap.
- Что сделать: минимум — vitest-тесты на guards с fixtures `workspace+user+role`; идеально — tRPC caller-тесты через `createCallerFactory` (уже экспортирован в `platform-app/src/server/trpc.ts:96`).

### L-8. Комментарии на двух языках (русский + английский) без правила
- Проблема: в одном файле сосуществуют rus-тексты ошибок (`throw new TRPCError({ message: "Нельзя клонировать..." })`) и eng-комментарии. Пользовательские сообщения — rus; технические — eng; но единого правила нет.
- Файлы: `platform-app/src/server/routers/asset.ts:306,552,603`, и ещё десятки.
- Что сделать: явно зафиксировать в `CONVENTIONS.md`: user-facing messages → ru, code comments / JSDoc → en. Вывести i18n-словарь для сообщений (сейчас строки захардкожены).

---

## Inconsistencies & Documentation Risks

### I-1. Дублирование документации верхнего уровня
В корне репозитория живут четыре отдельных описания продукта, которые частично противоречат друг другу и явно не поддерживаются синхронно:
- `AI Creative Platform Development.md` (48 KB, правка 5 февраля)
- `functional_documentation.md` / `functional_documentation.html` (46 KB / 46 KB, апрель)
- `platform-app/PRODUCT.md`, `platform-app/DEVELOPMENT_PLAN.md`, `platform-app/ARCHITECTURE.md`
- `documentation/` — 61 файл

Риск: для нового контрибьютора непонятно, что из этого «живой» документ, а что — archaeology. Часть наверняка устарела относительно текущей схемы (`Asset`-dedupe, UNF/BU разбивка и т.д.).
Что сделать: провести аудит, пометить неактуальные как `ARCHIVE/`, сделать `README.md` единой точкой входа.

### I-2. Названия временных переменных с двойным подчёркиванием (`__id`, `__a`, `__r`, `__s`)
- Файлы: `platform-app/src/server/routers/asset.ts:599-611`
- Это вероятно следствие конфликта имён после рефакторинга / merge conflict'а. Читается как «мы торопились».
- Что сделать: переименовать в человеческие `assetId`, `asset`, `role`, `sibling`.

---

## Summary of Immediate Priorities

| # | Severity | Effort | Impact | Issue |
|---|----------|--------|--------|-------|
| 1 | Critical | S | Security | C-2. Добавить `.env*` в `.gitignore` |
| 2 | Critical | S | Security | C-1. Ограничить CORS на S3 |
| 3 | Critical | S | Security | C-3. Защитить dev-auth-bypass от прод-окружения |
| 4 | High | M | Perf | H-3. Индексы `Asset(projectId,url)` + `Asset(workspaceId,url)` |
| 5 | High | S | Quality | H-1. Включить ESLint в build |
| 6 | High | M | Security | H-2. Вынести mime whitelist в общий модуль и применить в tRPC |
| 7 | High | L | Perf/Scale | H-5. Redis rate limiter |
| 8 | Medium | M | Correctness | M-2. Убрать `z.any()` из tRPC-инпутов |

---

*Concerns audit: 2026-04-22. Заметка: задача ссылалась на модифицированный `platform-app/src/server/routers/asset.ts`, но `git status` показывает чистое рабочее дерево на ветке `fix/asset-catalog-dedupe` — изменения либо уже закоммичены, либо ещё не начаты.*
