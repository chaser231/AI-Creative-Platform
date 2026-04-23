# Архитектура

**Analysis Date:** 2026-04-22

## Общий паттерн

**Overall:** Next.js 15 App Router + tRPC v11 "server/client" монолит с классической слоёной архитектурой (presentation → API → service → data) и выделенным canvas-домен-слоем (Konva + Zustand slices).

**Ключевые характеристики:**

- **Next.js App Router (Next 15 + React 19)** в `platform-app/src/app/` — все маршруты, страницы, layout, API routes.
- **tRPC v11 как единственная основная data-API** между клиентом и сервером (`src/server/routers/*`). Вызывается через `@trpc/react-query` хуки.
- **Отдельные REST-эндпоинты** в `src/app/api/` для того, что не вписывается в tRPC: стриминг AI (`/api/ai/generate`, `/api/ai/image-edit`), S3 presign (`/api/upload/presign`), beacon-сохранение канваса (`/api/canvas/save`), Figma OAuth (`/api/connect/figma/*`), NextAuth (`/api/auth/[...nextauth]`).
- **Prisma + PostgreSQL (Yandex Managed)** — единый ORM, Prisma client синглтон в `src/server/db.ts`.
- **NextAuth v5** с Prisma adapter (`src/server/auth.ts`), провайдер Yandex OAuth, защита маршрутов через edge-совместимый cookie-check в `src/middleware.ts`.
- **Zustand** для тяжёлого локального состояния (canvas, project, template, AI, theme, brandKit, photo). Canvas store разделён на slices (`src/store/canvas/*`) по доменам: viewport, history, layer, selection, component, resize, template, palette.
- **React Context** для кросс-app-состояния: `WorkspaceProvider`, `ThemeProvider`, `SessionProvider`, `TRPCProvider`.
- **Client-heavy rendering**: почти все страницы объявлены как `"use client"`. SSR-ветка минимальна и по сути используется только для layout shell, metadata и hydration.
- **Canvas-движок** на Konva.js / react-konva, паттерн "master component / instance" для мультиформатного дизайна.

---

## Слои

**Presentation (App Router + Components):**

- Purpose: страницы, layout, клиентские UI-панели редактора.
- Location: `src/app/`, `src/components/`
- Contains: `page.tsx`, `layout.tsx`, React-компоненты (редактор, дашборд, wizard, ui-примитивы).
- Depends on: tRPC-клиент (`src/lib/trpc.ts`), Zustand stores, hooks, services.
- Used by: конечный пользователь (браузер).

**API Gateway (tRPC HTTP adapter + REST routes):**

- Purpose: транспорт между браузером и сервером.
- Location: `src/app/api/trpc/[trpc]/route.ts`, `src/app/api/**/route.ts`
- Contains: fetch-handler `fetchRequestHandler` из `@trpc/server/adapters/fetch`; отдельные `route.ts` для AI-стриминга, загрузок, OAuth-колбэков.
- Depends on: `appRouter` (`src/server/routers/_app.ts`), `createTRPCContext`, NextAuth `auth()`.
- Used by: клиент (через `@trpc/react-query` и `fetch`).

**Domain Routers (tRPC):**

- Purpose: бизнес-логика, валидация, авторизация, доступ к БД.
- Location: `src/server/routers/`
- Contains: `auth`, `workspace`, `project`, `template`, `asset`, `ai`, `workflow`, `admin`, `adminTemplate`, `figma`.
- Depends on: Prisma, authz guards, AI-провайдеры, S3 SDK, Figma client.
- Used by: `appRouter` агрегатор.

**Authorization / Security:**

- Purpose: RBAC и защита ресурсов.
- Location: `src/server/authz/guards.ts`, `src/server/security/ssrfGuard.ts`, процедуры в `src/server/trpc.ts`.
- Contains: `assertWorkspaceAccess`, `assertProjectAccess`, `assertVersionAccess`, `assertTemplateAccess`, `assertAssetAccess`, `roleRank`. Procedure-хелперы: `publicProcedure`, `protectedProcedure`, `approvedProcedure`, `superAdminProcedure`.
- Depends on: Prisma, tRPC, NextAuth.
- Used by: все routers, некоторые REST-handlers (через `requireSessionAnd*` варианты).

**AI Agent & Providers:**

- Purpose: мультипровайдерная генерация и агент с tool-calling.
- Location: `src/server/agent/`, `src/lib/ai-providers.ts`, `src/lib/ai-models.ts`
- Contains: `orchestrator.ts` (цикл tool-calling), `executeAction.ts` (registry канвас-действий), `llmProviders.ts`, `visionAnalyzer.ts`, `systemPrompt.ts`, `actionRegistry.ts`.
- Depends on: OpenAI SDK, Yandex GPT, Replicate, Gemini, Prisma (для персистентности сессий).
- Used by: tRPC-роутер `ai`, REST `/api/ai/generate`, `/api/ai/image-edit`.

**Services (клиентские доменные сервисы):**

- Purpose: не-тривиальные клиентские алгоритмы (канвас, шаблоны, AI-клиент).
- Location: `src/services/`
- Contains: `aiService.ts` (клиент REST /api/ai), `templateService.ts`, `templateCatalogService.ts`, `slotMappingService.ts`, `smartResizeService.ts`, `snapService.ts`.
- Depends on: `src/types`, Zustand stores, `src/utils/layoutEngine.ts`.
- Used by: React-компоненты редактора, hooks.

**State (Zustand stores):**

- Purpose: синхронное клиентское состояние.
- Location: `src/store/`, `src/store/canvas/` (слайсы)
- Contains: `canvasStore.ts` (composed), `projectStore.ts`, `templateStore.ts`, `brandKitStore.ts`, `aiStore.ts`, `badgeStore.ts`, `themeStore.ts`, `photoStore.ts`.
- Depends on: `src/types`, helpers `src/store/canvas/helpers.ts`.
- Used by: UI-компоненты, hooks синхронизации.

**Hooks (интеграция state ↔ сервер):**

- Purpose: автосохранение, синхронизация, подписка на tRPC.
- Location: `src/hooks/`
- Contains: `useProjectSync`, `useProjectVersions`, `useTemplateSync`, `useAssetUpload`, `useAISessionSync`, `useKeyboardShortcuts`, `useCreateBannerFromAsset`, `useProjectLibrary`, `useStylePresets`.
- Depends on: Zustand stores, tRPC client.
- Used by: страницы редактора / photo / dashboard.

**Data (Prisma + S3):**

- Purpose: персистентное хранилище.
- Location: `prisma/schema.prisma`, `src/server/db.ts`, `src/server/utils/s3-cleanup.ts`, `@aws-sdk/client-s3`.
- Contains: модели User/Account/Session, Workspace/WorkspaceMember/JoinRequest, Project/ProjectVersion/FavoriteProject, Template/TemplateShare, Asset, AISession/AIMessage, AIWorkflow/AIPreset, FigmaImport.
- Depends on: env `DATABASE_URL`, `DIRECT_DATABASE_URL`, Yandex Object Storage credentials.
- Used by: Domain Routers, REST-handlers.

---

## Data Flow

**Основной CRUD (e.g. save project):**

1. React-компонент в `src/app/editor/[id]/page.tsx` изменяет Zustand `useCanvasStore`.
2. Hook `useProjectSync` debounce'ит изменения и вызывает `trpc.project.save.useMutation`.
3. `httpBatchLink` (`src/components/providers/TRPCProvider.tsx`) отправляет batch-запрос на `/api/trpc`.
4. `fetchRequestHandler` (`src/app/api/trpc/[trpc]/route.ts`) создаёт `TRPCContext` через `createTRPCContext()` — разрешает сессию (`NextAuth.auth()`), в dev-режиме подставляет `dev@acp.local` с ролью `SUPER_ADMIN`.
5. Procedure `projectRouter.save` валидирует вход через Zod, вызывает `assertProjectAccess(ctx, projectId, "write")`, затем Prisma.
6. Результат сериализуется через `superjson`, возвращается клиенту, React Query обновляет кэш.

**AI-генерация (REST, потоковая):**

1. `src/components/editor/AIPromptBar.tsx` / `src/components/photo/PhotoPromptBar.tsx` вызывает `fetch("/api/ai/generate")` с prompt/модель/референсами.
2. `route.ts` проверяет `auth()`, применяет `checkRateLimit` (`src/lib/rateLimit.ts`).
3. `generateWithFallback` (`src/lib/ai-providers.ts`) маршрутизирует по `getModelById` на Yandex GPT / OpenAI / Replicate / Gemini.
4. Ответ (включая URL ассета, если изображение) пишется в `AIMessage` через Prisma, возвращается клиенту.

**Beacon-сохранение (unload):**

- `src/app/api/canvas/save/route.ts` принимает `navigator.sendBeacon` с финальным canvasState при закрытии вкладки редактора.

**AI-агент с tool-calling (tRPC + agent orchestrator):**

1. Клиент вызывает `trpc.ai.sendMessage`.
2. `aiRouter` грузит историю `AIMessage`, инициализирует `orchestrator.ts` с `actionRegistry` (канвас-действия).
3. LLM возвращает tool-calls, orchestrator выполняет их через `executeAction.ts`, пишет сообщения обратно в `AIMessage`.
4. Финальный state возвращается клиенту, тот применяет diffs к `useCanvasStore`.

**State Management:**

- Серверное state: React Query (встроен в tRPC) — кэш запросов, инвалидация по mutation.
- Клиентское canvas state: `useCanvasStore` (Zustand, composed из 8 слайсов).
- Воркспейс/тема/аутентификация: React Context (`WorkspaceProvider`, `ThemeProvider`, `SessionProvider` от next-auth).
- Локальная персистентность: `localStorage` для выбранного workspace (`acp_workspace_id`).

---

## Key Abstractions

**tRPC Context:**

- Purpose: per-request объект с `prisma`, `session`, `user`, `headers`.
- Examples: `src/server/trpc.ts` (`createTRPCContext`, `TRPCContext`).
- Pattern: Dependency injection через `t.procedure.use(...)`.

**Procedure tiers:**

- Purpose: каскадная авторизация.
- Examples: `src/server/trpc.ts` — `publicProcedure` → `protectedProcedure` → `approvedProcedure` → `superAdminProcedure`.
- Pattern: middleware composition.

**Authz Guards:**

- Purpose: единая политика доступа к workspace-scoped ресурсам.
- Examples: `src/server/authz/guards.ts` (`assertWorkspaceAccess`, `assertProjectAccess`, `assertTemplateAccess`, `assertAssetAccess`, `assertVersionAccess`).
- Pattern: guard-функция получает `ctx` + `resourceId` + `mode: "read"|"write"`, возвращает загруженный row либо бросает `TRPCError`.

**Canvas Store Slices:**

- Purpose: композиция независимых доменов канваса в единый Zustand store.
- Examples: `src/store/canvas/createLayerSlice.ts`, `createResizeSlice.ts`, `createTemplateSlice.ts`, `createHistorySlice.ts`.
- Pattern: slice-pattern (StateCreator → объединение через spread в `useCanvasStore`).

**Master / Instance (канвас):**

- Purpose: одна логическая сущность с разным layout на разные форматы.
- Examples: `src/store/canvas/createComponentSlice.ts`, `src/store/canvas/bindingCascade.ts`, `src/types/index.ts` (`MasterComponent`, `ComponentInstance`, `LayerBinding`).
- Pattern: контент cascade-ится мастер → инстанс, layout остаётся локальным.

**AI Action Registry:**

- Purpose: описание "инструментов", доступных LLM-агенту.
- Examples: `src/server/agent/actionRegistry.ts`, `src/server/agent/executeAction.ts`.
- Pattern: tool-calling registry (JSON schema → handler).

**AI Provider abstraction:**

- Purpose: единый интерфейс над Yandex GPT / OpenAI / Replicate / Gemini.
- Examples: `src/lib/ai-providers.ts` (`generateWithFallback`), `src/lib/ai-models.ts` (реестр моделей client-safe).
- Pattern: Strategy + fallback chain.

---

## Entry Points

**Root layout:**

- Location: `src/app/layout.tsx`
- Triggers: любой HTTP-запрос к маршрутам.
- Responsibilities: подключает `SessionProvider` → `TRPCProvider` → `WaitlistGuard` → `WorkspaceProvider` → `ThemeProvider`, загружает `globals.css` и `fonts.css`, регистрирует шрифт `Plus Jakarta Sans`, устанавливает `lang="ru"`.

**Dashboard:**

- Location: `src/app/page.tsx` (`"use client"`)
- Triggers: `/`
- Responsibilities: список проектов, последние шаблоны, кнопка нового проекта, `WorkspaceOnboarding` если нет workspace.

**Editor:**

- Location: `src/app/editor/[id]/page.tsx`
- Triggers: `/editor/:id`
- Responsibilities: Konva-канвас, панели (Layers, Properties, Toolbar, Resize, Template, AI chat/prompt), авто-сохранение, загрузка project state, ExportModal, VersionHistoryPanel.

**Photo workspace:**

- Location: `src/app/photo/[id]/page.tsx`
- Triggers: `/photo/:id`
- Responsibilities: отдельный AI-photo workflow со своим UI и store (`photoStore.ts`).

**Templates catalog:**

- Location: `src/app/templates/page.tsx`

**Admin panel:**

- Location: `src/app/admin/page.tsx`, `src/app/admin/templates/`

**Settings:**

- Location: `src/app/settings/{page.tsx,ai,brand-kit,integrations,profile,styles,workspace}`

**Auth:**

- Location: `src/app/auth/signin`, `src/app/auth/waitlist`, `src/app/api/auth/[...nextauth]`

**tRPC endpoint:**

- Location: `src/app/api/trpc/[trpc]/route.ts` (GET + POST через общий handler).

**REST endpoints:**

- `src/app/api/ai/generate/route.ts` — AI генерация текста/изображений, `maxDuration = 300`.
- `src/app/api/ai/image-edit/route.ts` — редактирование изображений.
- `src/app/api/upload/route.ts` + `src/app/api/upload/presign/route.ts` — загрузка ассетов в S3.
- `src/app/api/canvas/save/route.ts` — beacon-сохранение.
- `src/app/api/template/[id]/route.ts` — экспорт шаблона.
- `src/app/api/connect/figma/start/`, `src/app/api/connect/figma/callback/` — Figma OAuth.
- `src/app/api/setup-cors/route.ts` — утилита конфигурации S3 CORS.

**Middleware:**

- Location: `src/middleware.ts`
- Triggers: любой запрос, кроме статики.
- Responsibilities: cookie-check (`authjs.session-token` / `__Secure-authjs.session-token`), редирект на `/auth/signin` с `callbackUrl`.

---

## Rendering Strategy

- **Подавляющее большинство страниц — Client Components** (`"use client"` на верхнем уровне). App Router используется как SPA-навигация поверх Next.js.
- **React Server Components** используются только в `app/layout.tsx` (serverless-friendly shell).
- **SSG / ISR не используется** — данные всегда пуляются клиентским tRPC + React Query.
- **Streaming / long-running** обрабатывается отдельными REST-route.ts с `export const maxDuration = 300;` (`/api/ai/generate`).
- **Konva-канвас** грузится через `next/dynamic` с `ssr: false` в `src/app/editor/[id]/page.tsx`.
- **Fonts:** `next/font/google` для Plus Jakarta Sans + custom fonts через IndexedDB (`src/lib/customFonts.ts`).

---

## API Layer Design

**Транспорт:**

- tRPC v11 поверх HTTP (`httpBatchLink`) с `superjson` трансформером.
- Клиент: `createTRPCReact<AppRouter>()` (`src/lib/trpc.ts`), провайдер `src/components/providers/TRPCProvider.tsx`.
- Сервер: `fetchRequestHandler` в `src/app/api/trpc/[trpc]/route.ts`.

**Структура роутеров** (`src/server/routers/_app.ts`):

| Router | Ключевые процедуры |
|--------|---------------------|
| `auth` | `getSession`, `me` |
| `workspace` | `list`, `listAll`, `create`, `join`, `leave`, `update`, `delete`, `listMembers`, `updateMemberRole`, `removeMember`, `requestJoin`, `listJoinRequests`, `handleJoinRequest` |
| `project` | `list`, `create`, `getById`, `save`, `delete`, `listVersions`, `restoreVersion`, `listFavorites`, `toggleFavorite`, `recent` |
| `template` | `list`, `recent`, `create`, `update`, `delete`, `getById`, `share` |
| `asset` | `upload`, `list`, `delete`, `presign` |
| `ai` | `listSessions`, `getSession`, `sendMessage`, `listSystemPrompts`, `listPresets` |
| `workflow` | `list`, `create`, `execute` |
| `admin` | `stats`, `users`, `workspaces`, `updateUserRole` |
| `adminTemplate` | `list`, `update`, `duplicate`, `delete` |
| `figma` | OAuth-связанные процедуры + import |

**Валидация:** Zod схемы как `input(z.object(...))` на каждой procedure; ошибки Zod поднимаются как `TRPCError.BAD_REQUEST` и форматируются в `errorFormatter` (`src/server/trpc.ts`).

**Авторизация:** все mutation-процедуры используют `approvedProcedure` + guard из `src/server/authz/guards.ts`. Query могут использовать `protectedProcedure` (чтобы PENDING-пользователь видел `auth.me`).

**REST-эндпоинты** используются только там, где нужен стриминг, long-running, бинарная загрузка, OAuth-колбэк или beacon — они повторяют ту же авторизацию через `await auth()` + `requireSessionAnd*` обёртки из `guards.ts`.

---

## Auth Flow

```
Browser → src/middleware.ts
  ├── cookie 'authjs.session-token' или '__Secure-authjs.session-token' есть → next()
  └── нет → redirect /auth/signin?callbackUrl=<pathname>

Страница входа → NextAuth signIn('yandex')
  → https://oauth.yandex.ru/authorize
  → /api/auth/callback/yandex (обработан NextAuth v5)
  → Prisma adapter пишет User + Account + Session
  → callback session({ session, user }) обогащает session.user.id, session.user.status

Защищённые tRPC-процедуры:
  createTRPCContext → await auth() → user
  protectedProcedure → требует user
  approvedProcedure → требует user.status === "APPROVED"
  superAdminProcedure → требует user.role === "SUPER_ADMIN"

Dev-режим (NODE_ENV === "development"):
  createTRPCContext → getDevUser() автосоздаёт dev@acp.local с role=SUPER_ADMIN,
  status=APPROVED, автоматически вступает ADMIN-ом во все Workspace.
```

**Workspace-scoped RBAC** (после аутентификации):

- Роли (низкая → высокая): `VIEWER` < `USER` < `CREATOR` < `ADMIN`.
- Проверка в guards через `roleRank()` (`src/server/authz/guards.ts`).
- Клиентский контекст: `WorkspaceProvider` экспонирует `currentRole`, `isAdmin`.

---

## Error Handling

**Стратегия:** fail-fast через `TRPCError` на сервере; толерантная деградация на клиенте (React Query retry, фоллбек-значения).

**Паттерны:**

- Server: `throw new TRPCError({ code: "...", message: "..." })` во всех guards и процедурах. Коды — `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `BAD_REQUEST`.
- REST handlers возвращают `NextResponse.json({ error, requestId }, { status })` с UUID `requestId` для трассировки (`src/app/api/ai/generate/route.ts`).
- Rate limiting: in-memory `checkRateLimit` (`src/lib/rateLimit.ts`) на чувствительных REST-эндпоинтах.
- NextAuth session callback деградирует gracefully: при недоступной БД возвращает `status: "APPROVED"` с логом, чтобы не выкидывать пользователя (`src/server/auth.ts`).
- Client: React Query `retry: 2` на queries, `retry: 1` на mutations (`src/components/providers/TRPCProvider.tsx`).
- ZodError специально выводится в `errorFormatter` как `shape.data.zodError` (`src/server/trpc.ts`).

---

## Cross-Cutting Concerns

**Logging:**

- Сервер: `console.log` / `console.error` с префиксами (`[/api/ai/generate]`, `[AUTH]`, `[AUTH ERROR]`). Нет централизованного логгера; в tRPC — `onError` только в dev.
- Prisma логирует `query` / `error` / `warn` в development, только `error` в production (`src/server/db.ts`).

**Validation:**

- Zod на всех tRPC inputs.
- В REST — ручная проверка полей тела запроса + возврат 400.

**Authentication:**

- Единственная точка входа — NextAuth v5 (`src/server/auth.ts`), провайдер Yandex OAuth + dev-bypass в `createTRPCContext`.

**Authorization:**

- Tier-procedures в `src/server/trpc.ts` + resource-guards в `src/server/authz/guards.ts`. Для REST — те же guards через `requireSessionAnd*` варианты.

**Security:**

- SSRF-защита для внешних URL (Figma imports, референсные изображения): `src/server/security/ssrfGuard.ts`.
- Edge-совместимый cookie-check вместо полного `auth()` в middleware — чтобы middleware не тянул Prisma в Edge runtime.
- CORS для S3 — утилита `src/app/api/setup-cors/route.ts`.

**Persistence:**

- `Project.canvasState` — JSON blob всего состояния канваса в PostgreSQL.
- Ассеты — Yandex Object Storage (S3-compatible) через `@aws-sdk/client-s3` + presigned URLs (`src/app/api/upload/presign/route.ts`).
- Очистка осиротевших S3-объектов — `src/server/utils/s3-cleanup.ts` (`collectS3KeysFromCanvasState`, `collectS3KeysFromAssets`, `deleteS3Objects`).

**Figma интеграция:**

- OAuth: `src/app/api/connect/figma/{start,callback}/`.
- Client + mapper: `src/lib/figma/{client,mapper,parseUrl,assets,importWorker,oauth,types}.ts`.
- Router: `src/server/routers/figma.ts`.

---

*Architecture analysis: 2026-04-22*
