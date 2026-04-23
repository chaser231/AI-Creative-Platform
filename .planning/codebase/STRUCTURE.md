# Структура кодовой базы

**Дата анализа:** 2026-04-22

Корень репозитория содержит приложение `platform-app/` (Next.js 15 + App Router + tRPC + Prisma + PostgreSQL), а также документацию (`docs/`, `documentation/`), директиву планирования (`.planning/`) и прототип-файл `AI Creative Platform Development.md`. Ниже — карта для навигации агентов по основному приложению.

---

## Directory Layout

```
AI Creative Platform/                      # корень репозитория
├── .planning/                             # GSD-артефакты (phases, codebase, planning)
├── .cursor/rules/                         # Cursor rules (deploy-pipeline, design-system-contrast)
├── docs/                                  # Общая документация репозитория
├── documentation/                         # Исходные проектные документы (40+ файлов)
├── AI Creative Platform Development.md    # Исторический brief / vision
├── functional_documentation.(md|html)     # Функциональная документация
├── README.md                              # Описание репозитория
└── platform-app/                          # Основное Next.js-приложение
    ├── ARCHITECTURE.md                    # Целевая архитектура (авторский документ)
    ├── PRODUCT.md                         # Продуктовое описание
    ├── DEVELOPMENT_PLAN.md                # План разработки
    ├── DEPLOY-YANDEX-CLOUD.md             # Инструкция деплоя
    ├── GIT_WORKFLOW.md                    # Регламент работы с git
    ├── README.md                          # Readme приложения
    ├── Dockerfile                         # Multi-stage standalone build
    ├── docker-compose.prod.yml            # Prod-оркестрация
    ├── next.config.ts                     # output: "standalone", remotePatterns
    ├── next-env.d.ts                      # Типы Next.js
    ├── tsconfig.json                      # strict TS, alias "@/*" → ./src/*
    ├── tsconfig.tsbuildinfo               # Кэш incremental build (артефакт)
    ├── package.json                       # Зависимости, scripts
    ├── package-lock.json                  # npm lockfile
    ├── eslint.config.mjs                  # ESLint flat config (next/core-web-vitals)
    ├── .prettierrc                        # Prettier-конфиг
    ├── postcss.config.mjs                 # PostCSS + tailwindcss v4
    ├── vitest.config.ts                   # Vitest (node env, alias "@")
    ├── .env / .env.local / .env.example   # Переменные окружения
    ├── .gitignore                         # Игнор для приложения
    ├── .dockerignore                      # Игнор для docker-сборки
    ├── infra/                             # Terraform / docker-инфраструктура
    ├── prompts/                           # Текстовые AI-промпты (reference)
    ├── public/                            # Статические ассеты (SVG, favicon, fonts)
    ├── scripts/                           # Вспомогательные Node-скрипты
    ├── prisma/                            # Prisma schema и seed-ы
    │   ├── schema.prisma                  # ~488 строк, все модели
    │   ├── seed.ts                        # tsx prisma/seed.ts
    │   └── seed-presets.ts                # Сиды stylePresets
    └── src/                               # Весь исходный код Next.js приложения
        ├── middleware.ts                  # Защита маршрутов (проверка cookie)
        ├── app/                           # App Router — страницы и API
        ├── components/                    # React-компоненты
        ├── providers/                     # React Context (WorkspaceProvider)
        ├── server/                        # Backend: tRPC, Prisma, NextAuth, AI-агент
        ├── store/                         # Zustand-сторы (+ store/canvas слайсы)
        ├── services/                      # Доменные сервисы (каталог, layout, snap, AI)
        ├── hooks/                         # React-хуки (sync, upload, keyboard)
        ├── lib/                           # Низкоуровневые утилиты и интеграции
        ├── config/                        # Feature-config (preinstalledFonts)
        ├── constants/                     # Константы (defaultPacks)
        ├── utils/                         # Чистые утилиты + __tests__
        └── types/                         # Глобальные TS-типы
```

---

## Directory Purposes

### `platform-app/src/app/` — Next.js App Router

- Назначение: маршруты (pages) и API-эндпоинты.
- Ключевые файлы: `layout.tsx` (корневой layout с провайдерами), `page.tsx` (дашборд), `globals.css`, `fonts.css`, `favicon.ico`.
- Вложенные сегменты:

```
src/app/
├── layout.tsx                             # Root layout: шрифты + провайдеры
├── page.tsx                               # "/" — дашборд (client component)
├── globals.css                            # Глобальные Tailwind-стили и CSS-токены
├── fonts.css                              # @font-face для кастомных шрифтов
├── favicon.ico
│
├── editor/[id]/page.tsx                   # Редактор канваса (основной экран)
├── photo/[id]/page.tsx                    # Photo-модуль (генерация изображений)
├── projects/page.tsx                      # Список всех проектов
├── templates/page.tsx                     # Каталог шаблонов
├── admin/page.tsx                         # Super-admin панель
├── admin/templates/page.tsx               # Администрирование глобальных шаблонов
├── settings/
│   ├── page.tsx                           # Общие настройки
│   ├── profile/page.tsx                   # Профиль пользователя
│   ├── brand-kit/                         # Настройки бренд-кита
│   ├── workspace/                         # Настройки воркспейса (admin+)
│   ├── styles/page.tsx                    # Стили / пресеты
│   ├── ai/page.tsx                        # Настройки AI
│   └── integrations/page.tsx              # Интеграции (Figma, и др.)
├── invite/[slug]/page.tsx                 # Публичная страница приглашения
├── auth/
│   ├── signin/page.tsx                    # Страница входа
│   └── waitlist/page.tsx                  # Ожидание одобрения
│
└── api/                                   # App Router HTTP-хендлеры
    ├── trpc/[trpc]/route.ts               # tRPC-хендлер (GET + POST)
    ├── auth/[...nextauth]/route.ts        # NextAuth хендлеры
    ├── ai/
    │   ├── generate/route.ts              # Генерация (текст/изображения)
    │   └── image-edit/route.ts            # Редактирование изображений
    ├── canvas/save/route.ts               # Beacon-сохранение канваса
    ├── upload/
    │   ├── route.ts                       # Прямая загрузка
    │   └── presign/route.ts               # Presigned URL для S3
    ├── template/[id]/route.ts             # Экспорт шаблона
    ├── connect/figma/
    │   ├── start/route.ts                 # OAuth: инициация
    │   └── callback/route.ts              # OAuth: callback
    └── setup-cors/route.ts                # Инициализация CORS бакета
```

### `platform-app/src/components/` — React-компоненты

- Назначение: вся презентационная и feature-level разметка.
- Содержит (группировка по доменам):

```
src/components/
├── layout/                                # AppShell.tsx, Sidebar.tsx, TopBar.tsx
├── providers/                             # TRPCProvider.tsx, ThemeProvider.tsx
├── auth/                                  # UserMenu.tsx, WaitlistGuard.tsx
├── dashboard/                             # EmptyState, NewProjectModal, ProjectCard,
│                                          # ProjectContextMenu, WorkspaceAssetGrid,
│                                          # FigmaImportModal
├── editor/                                # Основной canvas-редактор
│   ├── AIPromptBar.tsx
│   ├── AssetLibraryModal.tsx
│   ├── BindToMasterModal.tsx
│   ├── ContextMenu.tsx
│   ├── ExportModal.tsx
│   ├── LayersPanel.tsx
│   ├── MissingFontsModal.tsx
│   ├── PreviewCanvas.tsx
│   ├── ResizePanel.tsx
│   ├── SlotMappingModal.tsx
│   ├── TemplatePanel.tsx
│   ├── TemplateSettingsModal.tsx
│   ├── Toolbar.tsx
│   ├── VersionHistoryPanel.tsx
│   ├── ai-chat/                           # AIChatPanel, MessageBubble
│   ├── canvas/                            # Canvas.tsx, InlineTextEditor,
│   │                                      # ArtboardBackgroundRenderer, ExpandOverlay,
│   │                                      # SnapGuides, transformers, useImage, usePanZoom
│   ├── properties/                        # PropertiesPanel + *PropsGrouped, ColorInput,
│   │                                      # CompactInput, AlignButton
│   └── swatches/                          # Палитры и сватчи
├── photo/                                 # Photo-модуль (альтернативный UI)
│   ├── PhotoWorkspace.tsx
│   ├── PhotoSidebar.tsx
│   ├── PhotoChatView.tsx
│   ├── PhotoPromptBar.tsx
│   ├── PhotoLibraryPanel.tsx
│   ├── PhotoResultCard.tsx
│   └── TemplatePickerForAssetModal.tsx
├── wizard/                                # Wizard-flow для создания дизайна
│   ├── WizardFlow.tsx
│   └── blocks/                            # Content-блоки (Badge/Image/Text/TextGroup)
├── workspace/                             # WorkspaceBrowseModal, CreateWorkspaceModal,
│                                          # WorkspaceOnboarding
└── ui/                                    # Примитивы: Button, Modal, Dialog, Popover,
                                           # Tabs, Badge, Input, Textarea, Select,
                                           # SegmentedControl, Toggle, ConfirmDialog,
                                           # StylePresetPicker, RefAutocompleteTextarea,
                                           # ReferenceImageInput
```

### `platform-app/src/server/` — Backend-код

- Назначение: всё, что исполняется на сервере (tRPC, Prisma, NextAuth, AI-агент, auth-guards).

```
src/server/
├── trpc.ts                                # init tRPC + context + процедуры
├── auth.ts                                # NextAuth v5 config (Yandex OAuth)
├── db.ts                                  # Singleton PrismaClient
├── actionRegistry.ts                      # Декларативный реестр canvas-действий для AI
├── routers/
│   ├── _app.ts                            # Корневой роутер + type AppRouter
│   ├── auth.ts                            # getSession, me
│   ├── workspace.ts                       # CRUD, membership, join-requests
│   ├── project.ts                         # Проекты, версии, избранное
│   ├── template.ts                        # Пользовательские шаблоны
│   ├── adminTemplate.ts                   # Глобальные шаблоны (super-admin)
│   ├── asset.ts                           # S3-upload/list/delete
│   ├── ai.ts                              # AI-сессии, сообщения, system-prompts
│   ├── workflow.ts                        # AI-workflow шаблоны
│   ├── admin.ts                           # Платформенный админ-UI
│   └── figma.ts                           # Figma-импорт
├── agent/                                 # AI-оркестратор с tool-calling
│   ├── index.ts
│   ├── orchestrator.ts                    # interpretAndExecute (основной вход)
│   ├── executeAction.ts                   # Исполнение canvas-инструкций
│   ├── llmProviders.ts                    # getProviderChain, callLLM, fallback
│   ├── systemPrompt.ts                    # SYSTEM_PROMPT константа
│   ├── visionAnalyzer.ts                  # VLM-описание reference-изображений
│   └── types.ts                           # AgentStep, AgentResponse, ChatMessage
├── authz/
│   └── guards.ts                          # assert*Access + requireSessionAnd*
├── security/
│   ├── ssrfGuard.ts                       # SSRF-защита исходящих fetch
│   └── __tests__/ssrfGuard.test.ts
└── utils/
    └── s3-cleanup.ts                      # Очистка orphaned-ассетов в S3
```

### `platform-app/src/store/` — Zustand-сторы

```
src/store/
├── canvasStore.ts                         # Композиция всех canvas-слайсов
├── canvas/                                # Слайсы канваса
│   ├── types.ts                           # Общие типы стора
│   ├── helpers.ts                         # computeConstrainedPosition и др.
│   ├── bindingCascade.ts                  # Логика каскада master → instance
│   ├── createViewportSlice.ts
│   ├── createHistorySlice.ts
│   ├── createLayerSlice.ts
│   ├── createSelectionSlice.ts
│   ├── createComponentSlice.ts
│   ├── createResizeSlice.ts
│   ├── createTemplateSlice.ts
│   ├── createPaletteSlice.ts
│   └── __tests__/computeConstrainedPosition.test.ts
├── projectStore.ts                        # Активный проект (metadata)
├── templateStore.ts                       # Применённый шаблон
├── brandKitStore.ts                       # Бренд-кит
├── aiStore.ts                             # AI-генерация (очередь, статус)
├── badgeStore.ts                          # Badge-компонент
├── photoStore.ts                          # Photo-модуль
└── themeStore.ts                          # Тема UI
```

### `platform-app/src/services/` — Доменные сервисы

```
src/services/
├── aiService.ts                           # AI API клиент (для Zustand-стора)
├── templateService.ts                     # TemplatePack: парсинг, применение
├── templateCatalogService.ts              # Поиск/фильтрация шаблонов
├── slotMappingService.ts                  # Слоты шаблона ↔ слои
├── smartResizeService.ts                  # Multi-format адаптация
└── snapService.ts                         # Snap-to-grid / guides
```

### `platform-app/src/hooks/` — React-хуки

```
src/hooks/
├── useProjectSync.ts                      # Автосохранение проекта в БД
├── useProjectVersions.ts                  # История версий
├── useProjectLibrary.ts                   # Библиотека проектов
├── useTemplateSync.ts                     # Сохранение шаблона в БД
├── useAssetUpload.ts                      # S3-загрузка (через presign)
├── useAISessionSync.ts                    # Persistance AI-чата
├── useCreateBannerFromAsset.ts            # Быстрое создание баннера
├── useStylePresets.ts                     # Стилевые пресеты
└── useKeyboardShortcuts.ts                # Горячие клавиши редактора
```

### `platform-app/src/lib/` — Низкоуровневые утилиты

```
src/lib/
├── trpc.ts                                # createTRPCReact<AppRouter>() (клиент)
├── trpc-server.ts                         # Server-side tRPC caller (для RSC)
├── cn.ts                                  # classnames (tailwind-merge + clsx)
├── customFonts.ts                         # IndexedDB + Google Fonts loader
├── stylePresets.ts                        # Реестр стилевых пресетов
├── rateLimit.ts                           # Rate limiter (для AI-эндпоинтов)
├── ai-providers.ts                        # Серверные реализации провайдеров
│                                          # (Yandex GPT, OpenAI, Replicate, Gemini, Fal)
├── ai-models.ts                           # Client-safe реестр моделей
└── figma/
    ├── client.ts                          # @figma/rest-api-spec обёртка
    ├── oauth.ts                           # Figma OAuth helpers
    ├── parseUrl.ts                        # Парсинг Figma-URL
    ├── mapper.ts                          # Figma node → TemplatePack
    ├── assets.ts                          # Экспорт ассетов из Figma
    ├── importWorker.ts                    # Фоновый импорт
    ├── types.ts
    └── __tests__/                         # parseUrl, mapper + fixtures
```

### `platform-app/src/providers/` — React Context

```
src/providers/
└── WorkspaceProvider.tsx                  # Текущий workspace + role/isAdmin
```

> Примечание: `TRPCProvider` и `ThemeProvider` лежат в `src/components/providers/`, а не в `src/providers/`. Это исторически, не менять без явной причины.

### `platform-app/src/config/` и `platform-app/src/constants/`

```
src/config/
└── preinstalledFonts.ts                   # Шрифты, которые всегда доступны

src/constants/
└── defaultPacks.ts                        # Стартовые TemplatePack-и
```

### `platform-app/src/utils/` — Чистые утилиты

```
src/utils/
├── clipboardUtils.ts
├── cloneLayerTree.ts
├── fontUtils.ts
├── imageComposite.ts
├── imageFitUtils.ts
├── imageUpload.ts
├── keyboard.ts
├── layoutEngine.ts                        # Layout-движок (правила раскладки слотов)
├── resizeUtil.ts
└── __tests__/
    ├── layoutEngineConstraints.test.ts
    └── layoutEngineVisibility.test.ts
```

### `platform-app/src/types/`

```
src/types/
├── index.ts                               # Доменные типы: Layer, MasterComponent,
│                                          # ComponentInstance, ResizeFormat, BrandKit,
│                                          # TemplatePalette, LayerBinding, …
├── api-types.ts                           # DTO API (ArtboardProps и пр.)
└── next-auth.d.ts                         # Augmentation Session.user.{id,status}
```

---

## Key File Locations

**Точки входа:**

- `platform-app/src/app/layout.tsx` — корневой layout и цепочка провайдеров.
- `platform-app/src/app/page.tsx` — дашборд.
- `platform-app/src/app/editor/[id]/page.tsx` — canvas-редактор.
- `platform-app/src/app/photo/[id]/page.tsx` — photo-модуль.
- `platform-app/src/middleware.ts` — защита маршрутов.
- `platform-app/src/app/api/trpc/[trpc]/route.ts` — tRPC HTTP-хендлер.
- `platform-app/src/app/api/auth/[...nextauth]/route.ts` — NextAuth хендлеры.

**Конфигурация:**

- `platform-app/next.config.ts` — `output: "standalone"`, `images.remotePatterns` для Yandex S3.
- `platform-app/tsconfig.json` — strict, alias `@/*` → `./src/*`.
- `platform-app/vitest.config.ts` — vitest config (node env, тот же alias).
- `platform-app/eslint.config.mjs` — ESLint flat config.
- `platform-app/.prettierrc` — Prettier.
- `platform-app/postcss.config.mjs` — Tailwind v4 через PostCSS plugin.
- `platform-app/prisma/schema.prisma` — модель данных PostgreSQL.
- `platform-app/Dockerfile`, `platform-app/docker-compose.prod.yml` — deploy.
- `.cursor/rules/deploy-pipeline.mdc`, `.cursor/rules/design-system-contrast.mdc` — Cursor-правила.

**Core-логика (backend):**

- `platform-app/src/server/trpc.ts` — процедуры `publicProcedure` / `protectedProcedure` / `approvedProcedure` / `superAdminProcedure`.
- `platform-app/src/server/auth.ts` — NextAuth config.
- `platform-app/src/server/db.ts` — Prisma singleton.
- `platform-app/src/server/routers/_app.ts` — корневой роутер (тип `AppRouter`).
- `platform-app/src/server/authz/guards.ts` — единая точка авторизации.
- `platform-app/src/server/agent/orchestrator.ts` — AI-оркестратор.
- `platform-app/src/server/actionRegistry.ts` — реестр canvas-инструкций для агента.

**Core-логика (frontend):**

- `platform-app/src/store/canvasStore.ts` — canvas Zustand store (композиция слайсов).
- `platform-app/src/store/canvas/types.ts` — типы canvas-стора.
- `platform-app/src/services/templateService.ts` — применение TemplatePack.
- `platform-app/src/services/smartResizeService.ts` — мульти-формат адаптация.
- `platform-app/src/components/editor/canvas/Canvas.tsx` — основной Konva-канвас.
- `platform-app/src/providers/WorkspaceProvider.tsx` — текущий воркспейс.

**Тестирование:**

- `platform-app/vitest.config.ts` — паттерн `src/**/*.test.ts(x)`.
- `platform-app/src/utils/__tests__/` — тесты layout-движка.
- `platform-app/src/store/canvas/__tests__/computeConstrainedPosition.test.ts`.
- `platform-app/src/lib/figma/__tests__/` — `parseUrl.test.ts`, `mapper.test.ts`, `fixtures.ts`.
- `platform-app/src/server/security/__tests__/ssrfGuard.test.ts`.

**Планирование (GSD):**

- `.planning/codebase/` — результаты `/gsd-map-codebase` (этот документ и парные).
- `.planning/` — phase-артефакты.

---

## Naming Conventions

**Файлы:**

- React-компоненты: `PascalCase.tsx` (напр. `LayersPanel.tsx`, `NewProjectModal.tsx`).
- Хуки: `useCamelCase.ts` (напр. `useProjectSync.ts`).
- Zustand-слайсы: `createXxxSlice.ts` (напр. `createLayerSlice.ts`).
- Zustand-сторы: `camelCaseStore.ts` (напр. `brandKitStore.ts`, `aiStore.ts`).
- Сервисы: `camelCaseService.ts` (напр. `templateService.ts`, `snapService.ts`).
- tRPC-роутеры: короткое имя домена в нижнем регистре (`project.ts`, `workspace.ts`), корневой — `_app.ts`.
- App Router файлы следуют конвенции Next.js: `page.tsx`, `layout.tsx`, `route.ts`.
- Тесты: `Xxx.test.ts(x)` внутри `__tests__/` рядом с тестируемым модулем.

**Директории:**

- kebab-case для feature-групп в `components/` (`ai-chat/`).
- lowercase для слоёв (`server`, `store`, `services`, `hooks`, `lib`, `utils`, `types`, `config`, `constants`, `providers`, `components`).
- Динамические сегменты Next.js: `[param]/` или `[...slug]/` (напр. `editor/[id]`, `auth/[...nextauth]`).

**Импорт-алиас:** `@/*` → `platform-app/src/*` (настроен в `tsconfig.json` и `vitest.config.ts`).

---

## Where to Add New Code

**Новая страница / маршрут:**

- Файл: `platform-app/src/app/<segment>/page.tsx`.
- API-эндпоинт (не tRPC): `platform-app/src/app/api/<segment>/route.ts`.
- Динамический сегмент: `platform-app/src/app/<segment>/[param]/page.tsx`.

**Новый tRPC-ресурс:**

1. Добавить файл в `platform-app/src/server/routers/<domain>.ts`.
2. Экспортировать `xxxRouter = createTRPCRouter({...})`.
3. Зарегистрировать в `platform-app/src/server/routers/_app.ts`.
4. Если нужна авторизация — расширить `platform-app/src/server/authz/guards.ts` (единая точка, не inline).
5. Использовать на клиенте через `trpc.<domain>.<procedure>.useQuery/useMutation` (`platform-app/src/lib/trpc.ts`).

**Новый feature-компонент:**

- Группа по домену: `platform-app/src/components/<feature>/<Component>.tsx`.
- UI-примитив (reusable): `platform-app/src/components/ui/<Primitive>.tsx`.
- Клиентский компонент требует `"use client"` сверху файла.

**Новый Zustand-стор / слайс:**

- Изолированный стор: `platform-app/src/store/<name>Store.ts`.
- Слайс для canvasStore: `platform-app/src/store/canvas/create<Name>Slice.ts`, затем зарегистрировать в `platform-app/src/store/canvasStore.ts` и добавить тип в `platform-app/src/store/canvas/types.ts`.

**Новый сервис / алгоритм:** `platform-app/src/services/<name>Service.ts` (чистая логика, без React/Prisma).

**Новый хук:** `platform-app/src/hooks/use<Name>.ts`.

**Интеграция внешнего API:** `platform-app/src/lib/<provider>/` (по образцу `platform-app/src/lib/figma/`). Исходящие fetch обязаны идти через `platform-app/src/server/security/ssrfGuard.ts` для user-supplied URLs.

**AI-провайдер / модель:**

- Серверная реализация: `platform-app/src/lib/ai-providers.ts`.
- Реестр моделей для клиента: `platform-app/src/lib/ai-models.ts`.
- Новое действие для AI-агента: `platform-app/src/server/actionRegistry.ts` + соответствующий обработчик в `platform-app/src/server/agent/executeAction.ts`.

**Новая модель Prisma:**

1. Описать в `platform-app/prisma/schema.prisma`.
2. Запустить `npm run db:push` (в `platform-app/`).
3. Добавить seed в `platform-app/prisma/seed.ts` при необходимости.
4. Добавить guard в `platform-app/src/server/authz/guards.ts`, если ресурс workspace-scoped.

**Тесты:** `<dir>/__tests__/<name>.test.ts(x)` — подхватываются Vitest автоматически (`src/**/*.test.ts(x)`).

**Статические ассеты:** `platform-app/public/` (SVG, favicon, fonts).

---

## Special Directories

**`platform-app/.next/`:**

- Назначение: build-артефакты Next.js (standalone сборка).
- Сгенерировано: Да (`next build`).
- В git: Нет.

**`platform-app/node_modules/`:**

- Назначение: зависимости.
- Сгенерировано: Да (`npm install` + `postinstall: prisma generate`).
- В git: Нет.

**`platform-app/prisma/`:**

- Назначение: schema, миграции, seed-ы.
- Сгенерировано: Частично (`@prisma/client` генерится в `node_modules/.prisma`).
- В git: Да — `schema.prisma`, `seed.ts`, `seed-presets.ts`.

**`platform-app/public/`:**

- Назначение: статические ассеты, доступные по корню (`/logo.svg`).
- Сгенерировано: Нет.
- В git: Да.

**`platform-app/prompts/`:**

- Назначение: эталонные текстовые AI-промпты (справочные, не импортируются в рантайме напрямую — большая часть встроена в `src/server/agent/systemPrompt.ts`).
- В git: Да.

**`platform-app/scripts/`:**

- Назначение: вспомогательные Node/tsx скрипты (миграции, бекапы).
- В git: Да. Исключены из `tsconfig.json` (`"exclude": ["node_modules", "scripts"]`).

**`platform-app/infra/`:**

- Назначение: инфраструктура (Yandex Cloud, docker).
- В git: Да.

**`.planning/`:**

- Назначение: GSD workflow артефакты (фазы, codebase-документация, roadmap).
- В git: Да (за исключением временных файлов).

**`documentation/`:**

- Назначение: оригинальная проектная документация (40+ файлов, MD).
- В git: Да.

**`.env` / `.env.local` / `.env.example`:**

- Назначение: переменные окружения.
- `.env.example` — в git (шаблон).
- `.env`, `.env.local` — присутствуют в файловой системе, секреты (в git не должны попадать, cм. `platform-app/.gitignore`).

---

*Анализ структуры: 2026-04-22*
