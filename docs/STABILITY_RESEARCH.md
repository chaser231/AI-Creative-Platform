# Stability Research

_Last updated: 2026-04-21 — scope: agent, data, layout, security, frontend — depth: triage + MF-1 + QF-pack — execution: research + safe quickfixes_

## How to read

- Findings отсортированы по severity: `crit` > `high` > `med` > `low`
- `status`: `open` / `quickfix-proposed` / `fixed` / `wontfix` / `needs-discussion`
- Никаких длинных описаний — только суть, файл, и hint как чинить.

## Topology

- **LayoutEngine** (`platform-app/src/utils/layoutEngine.ts`): публичный API = `computeAutoLayout` (частичные апдейты детей auto-layout фрейма), `applyAllAutoLayouts` (двойной проход + каскад `computeConstrainedPosition`), `applyLayout` (слоты шаблона по формату).
- Используется в canvas-слайсах (`createLayerSlice`, `createResizeSlice`, `createSelectionSlice`), `templateService`, тестах.
- Измерение текста через Konva/Canvas с модульным кэшем и общим узлом `Konva.Text`.
- **Agent** (`platform-app/src/server/agent/`): `interpretAndExecute` строит план через LLM (OpenAI tools или JSON-tools через fal/Replicate), затем последовательно выполняет шаги `executeAction`. VLM (`analyzeReferenceImages`) обогащает контекст. Entry: tRPC `workflow.interpretAndExecute`. Провайдеры: OpenAI, fal (openrouter), Replicate (+ Gemini VLM). `callWithFallback` — цепочка провайдеров.
- **Data** (`platform-app/prisma/schema.prisma` + `src/server/routers/*`): Prisma → PostgreSQL. Ключевые сущности: `Workspace`/`WorkspaceMember`, `Project` (JSON `canvasState`), `Template`, `Asset`, `AISession`/`AIMessage`, `ProjectVersion`. В роутерах **не найдено `prisma.$transaction`** — цепочки записей последовательны. Realtime отсутствует; синхрон: tRPC + debounced Zustand → `project.saveState` + `POST /api/canvas/save` (sendBeacon). Клиент: Zustand с `createHistorySlice` (undo/redo в памяти). Коллективного редактирования нет.
- **Security**: NextAuth (куки `authjs.session-token`); `middleware.ts` редиректит неавторизованных. Типы процедур: `publicProcedure`, `protectedProcedure`, `approvedProcedure`, `superAdminProcedure`. Admin-роутеры на `superAdminProcedure`, UI на `/admin` дополнительно скрыт по role. **В dev `createTRPCContext` подставляет фейкового `SUPER_ADMIN`** — потенциальный риск, если dev-флаг утечёт в prod.
- **Frontend**: Next.js 16.1.6 + React 19; Konva/react-konva; Zustand (canvasStore + слайсы); tRPC v11 + TanStack Query. ~76 `.tsx` в `components`, 19 `.ts` в `store`. Виртуализация списков отсутствует. Много `"use client"` на корневых страницах. `Canvas.tsx` ~2318 строк, `editor/[id]/page.tsx` ~1029 строк — всё в клиентском бандле.

## Findings

| id | sev | area | summary | file:line | fix hint | status |
|----|-----|------|---------|-----------|----------|--------|
| L1 | high | layout | `Math.max(1, w)` не лечит NaN — размеры/позиции ломаются | platform-app/src/utils/layoutEngine.ts:337 | валидировать числа, fallback к 1 | fixed (QF-1) |
| L2 | high | layout | Нулевая сторона родителя даёт NaN/Inf в center/scale ветках | platform-app/src/store/canvas/helpers.ts:52 | guard `oldWidth/oldHeight > 0` | fixed (QF-2) |
| L3 | med  | layout | Глобальный кэш текста + общий `Konva.Text` — риск при параллельных вызовах | platform-app/src/utils/layoutEngine.ts:32 | изолировать на контекст или убрать шаринг | open |
| L4 | med  | layout | Отрицательный `availablePrimarySpace` даёт скрытое переполнение (fill=1px) | platform-app/src/utils/layoutEngine.ts:404 | явная политика overflow/min | open |
| L5 | med  | layout | `childToParent`: при двух родителях побеждает первый в обходе | platform-app/src/utils/layoutEngine.ts:577 | детект дубликатов или жёсткая модель | open |
| L6 | med  | layout | Цикл в иерархии: `getDepth` обрывает на 0 — порядок прохода слабый | platform-app/src/utils/layoutEngine.ts:589 | топосорт с ошибкой на цикл | open |
| L7 | med  | layout | `applyLayout`: left/right/top/bottom перезаписывают друг друга | platform-app/src/utils/layoutEngine.ts:773 | явный приоритет или валидация правил | open |
| L8 | med  | perf  | После каждого фрейма полный `map` всех слоёв | platform-app/src/utils/layoutEngine.ts:612 | точечные обновления по id | open |
| L9 | low  | layout | Мёртвый тернар `isHorizontal ? totalPrimaryAll : totalPrimaryAll` | platform-app/src/utils/layoutEngine.ts:367 | удалить ветвление | fixed (QF-3) |
| L10| med  | tests | Нет тестов на `computeAutoLayout`/`applyLayout`/текст | platform-app/src/utils/__tests__/layoutEngineConstraints.test.ts:1 | добавить поведенческие кейсы | open |
| A1 | high | agent | JSON parse errors на tool args молча роняют параметры | platform-app/src/server/agent/orchestrator.ts:63 | fail step или reject невалидный JSON | fixed (QF-6) |
| A2 | high | agent | Replicate poll loop без лимита итераций — вечный висяк | platform-app/src/server/agent/llmProviders.ts:441 | max polls + timeout abort | fixed (QF-5) |
| A3 | high | agent | Все LLM `fetch` без timeout/AbortSignal | platform-app/src/server/agent/llmProviders.ts:86 | `AbortSignal.timeout` или общий controller | fixed (QF-4) |
| A4 | med  | agent | fal tool path возвращает пустой plan при полном фейле | platform-app/src/server/agent/llmProviders.ts:388 | throw или пробросить ошибку | open |
| A5 | med  | agent | Vision ошибки скрыты, фейковые summary инжектятся в prompt | platform-app/src/server/agent/visionAnalyzer.ts:41 | flag failure, не инжектить mock-контекст | open |
| A6 | med  | sec/log | Полный image prompt логируется в console | platform-app/src/server/agent/executeAction.ts:157 | хэши/редакция, dev-only guard | fixed (QF-7: base64-redacted + length cap) |
| A7 | med  | sec   | Canvas `add_image` берёт LLM-URL без проверки (SSRF риск) | platform-app/src/server/agent/executeAction.ts:224 | allowlist схем/хостов или proxy fetch | open |
| A8 | med  | agent | Provider fallback retry без backoff | platform-app/src/server/agent/orchestrator.ts:202 | exp backoff + классификация retriable | open |
| A9 | low  | agent | Нет кап на кол-во tool-call в плане | platform-app/src/server/agent/orchestrator.ts:60 | лимит `steps.length` | open |
| A10| low  | agent | `chatResponse` экспортирован, но не вызывается | platform-app/src/server/agent/orchestrator.ts:217 | wire или удалить dead API | open |
| D1 | crit | sec/data | IDOR: доступ к canvas по id без проверки членства workspace | platform-app/src/server/routers/project.ts:265 | checkRole по project перед update/load | fixed (MF-1) |
| D2 | crit | sec/data | Beacon-сейв обходит проверки — тот же IDOR | platform-app/src/app/api/canvas/save/route.ts:29 | Те же проверки, что в saveState | fixed (MF-1) |
| D3 | high | data | Параллельные saveState перезаписывают JSON без версии | platform-app/src/server/routers/project.ts:265 | optimistic locking (version/updatedAt) | open |
| D4 | high | data | Template: update + S3 + createMany/deleteMany без транзакции | platform-app/src/server/routers/template.ts:383 | `$transaction` + согласованный откат/outbox | open |
| D5 | med  | perf | admin: выборка ВСЕХ assistant-сообщений для статы | platform-app/src/server/routers/admin.ts:207 | агрегация в SQL, лимиты | open |
| D6 | med  | perf | stats тянет все trackedMessages в память | platform-app/src/server/routers/admin.ts:30 | GROUP BY в БД или матвью | open |
| D7 | med  | data | `AISession`: findFirst→create гонка, дубликаты | platform-app/src/server/routers/workflow.ts:28 | upsert или @@unique(projectId,userId) | open |
| D8 | med  | data | `createVersion`: findFirst→create unique violation при гонке | platform-app/src/server/routers/project.ts:344 | транзакция/serialization + retry | open |
| D9 | med  | perf | `asset.list`: findMany без take — неограниченный ответ | platform-app/src/server/routers/asset.ts:43 | take + курсор | fixed (QF-8: take=200, opt limit ≤500) |
| D10| med  | data | Уход из workspace: многошаговая запись без транзакции | platform-app/src/server/routers/workspace.ts:353 | `$transaction` | open |
| D11| low  | data | `saveState`: `z.any()` в canvas — слабая валидация | platform-app/src/server/routers/project.ts:244 | сузить zod-схему | open |
| D12| low  | ops  | Нет каталога `prisma/migrations` в репо | platform-app/prisma/schema.prisma:1 | версионировать миграции | open |
| D13| low  | data | `project.delete`: S3 затем DB — возможны осиротевшие ключи | platform-app/src/server/routers/project.ts:224 | очередь очистки/outbox | open |
| S1 | high | sec | `workflow.*`: процедуры по id/workspaceId без проверки членства | platform-app/src/server/routers/workflow.ts:68 | общий `assertProjectAccess`/`requireRole` | fixed (MF-1) |
| S2 | high | sec | `project.getById/loadState/versions/favorite` без проверки доступа | platform-app/src/server/routers/project.ts:114 | `assertProjectAccess` как в `ai` | fixed (MF-1) |
| S3 | high | sec | `template.recent/getById/create/delete` без членства/видимости | platform-app/src/server/routers/template.ts:77 | `requireRole` + правила видимости | fixed (MF-1) |
| S4 | high | sec | `asset.getUploadUrl/getDownloadUrl/delete*` без проверки workspace | platform-app/src/server/routers/asset.ts:319 | проверка member по workspaceId объекта | fixed (MF-1) |
| S5 | high | sec | `asset.copyTemplateAssetsToProject` без проверки projectId | platform-app/src/server/routers/asset.ts:275 | проверить членство в проекте/workspace | fixed (MF-1) |
| S6 | high | sec | POST `/api/upload` — серверный fetch произвольного URL (SSRF) | platform-app/src/app/api/upload/route.ts:52 | allowlist хостов или отключить режим `url` | partial (authz added; MF-2 нужен allowlist) |
| S7 | med  | sec | `/api/upload/presign`: projectId в S3 key без авторизации | platform-app/src/app/api/upload/presign/route.ts:59 | связать ключ с проверенным проектом | fixed (MF-1) |
| S8 | med  | sec | `/api/setup-cors`: любой залогиненный меняет CORS бакета на `*` | platform-app/src/app/api/setup-cors/route.ts:37 | только super-admin, ограничить origins | open |
| S9 | med  | sec | `/api/template/[id]`: полный шаблон без проверки видимости | platform-app/src/app/api/template/[id]/route.ts:53 | те же проверки, что в `template.loadState` | fixed (MF-1) |
| S10| med  | sec | Доменные мутации на `protectedProcedure`, а не `approvedProcedure` | platform-app/src/server/trpc.ts:102 | критичные роуты — на одобренных | open |
| S11| med  | data | Широкие `z.any` в templates/AI/workflow/workspace brand | platform-app/src/server/routers/template.ts:241 | ужесточить Zod-схемы | open |
| S12| low  | sec | Dev: авто-SUPER_ADMIN + join всех workspaces | platform-app/src/server/trpc.ts:33 | строгий guard на `NODE_ENV`, отключить вне localhost | open |
| S13| low  | sec | `workspace.selfPromoteAdmin`: SUPER_ADMIN → ADMIN любого workspace | platform-app/src/server/routers/workspace.ts:633 | явный аудит/ограничение политикой | open |
| F1 | high | perf | 6 `useCanvasStore` на каждый `FrameLayerRenderer` | platform-app/src/components/editor/canvas/Canvas.tsx:300 | один `useShallow`, прокинуть пропсы | open |
| F2 | high | perf | `Canvas.tsx` ~2318 строк в клиентском бандле | platform-app/src/components/editor/canvas/Canvas.tsx:1 | разнести / lazy подмодули | open |
| F3 | high | perf | `editor/[id]/page.tsx` ~1029 строк, `"use client"` | platform-app/src/app/editor/[id]/page.tsx:1 | RSC-оболочка + острова | open |
| F4 | high | perf | WorkspaceAssetGrid до 200 ассетов без виртуализации | platform-app/src/components/dashboard/WorkspaceAssetGrid.tsx:87 | windowing / infinite scroll | open |
| F5 | high | perf | `useBrandKitStore()` подписка на весь стор | platform-app/src/app/settings/brand-kit/page.tsx:23 | узкие селекторы + `useShallow` | open |
| F6 | med  | perf | `useTemplateStore`/`useProjectStore` без селекторов | platform-app/src/components/editor/TemplatePanel.tsx:77 | узкие селекторы | open |
| F7 | med  | perf | То же в WizardFlow | platform-app/src/components/wizard/WizardFlow.tsx:33 | селекторы | open |
| F8 | med  | perf | `useThemeStore()` деструктуризация всего слайса | platform-app/src/app/settings/profile/page.tsx:40 | `(s) => s.theme` | open |
| F9 | med  | perf | Новый `commonProps` каждый рендер слоя | platform-app/src/components/editor/canvas/Canvas.tsx:70 | `useMemo` / разбить пропсы | open |
| F10| med  | perf | Несколько `usePhotoStore` в одном баре | platform-app/src/components/photo/PhotoPromptBar.tsx:45 | один shallow-селектор | open |
| F11| med  | perf | Превью через `<img>` без `next/image` | platform-app/src/components/dashboard/WorkspaceAssetGrid.tsx:94 | `next/image` + sizes/srcset | open |
| F12| med  | perf | AssetLibraryModal: полный `assets.map` без windowing | platform-app/src/components/editor/AssetLibraryModal.tsx:324 | виртуализировать сетку | open |
| F13| med  | perf | Почти все `app/**/page.tsx` — клиентские | platform-app/src/app/page.tsx:1 | вынести интерактив в листья | open |
| F14| med  | perf | Figma статус: `refetchInterval` 2s до терминального | platform-app/src/components/dashboard/FigmaImportModal.tsx:85 | backoff, стоп после done | wontfix (QF-9: уже корректно — interval=false на COMPLETED/FAILED) |
| F15| low  | perf | Сайдбар опрос админки 60s | platform-app/src/components/layout/Sidebar.tsx:84 | `staleTime`/условный опрос | fixed (QF-10: staleTime=30s) |

## Top-10 risks (триаж завершён)

Ранжировано по `severity × blast radius × likelihood`:

1. **D1 + D2 + S1…S5** — **массовый IDOR по всем доменным роутерам** (`workflow`, `project`, `template`, `asset`) и в `/api/canvas/save`. Любой залогиненный может читать/писать чужие проекты/ассеты/шаблоны по известному id. **Одна проблема, лечится введением единого `assertProjectAccess`/`assertWorkspaceAccess` + применением во всех процедурах, берущих id.**
2. **S6** — SSRF через `/api/upload` (серверный fetch произвольного URL).
3. **D3** — Lost updates: параллельные `saveState` перезаписывают canvas JSON без версии. Для multi-tab/flaky-network — реальный сценарий потери данных.
4. **D4** — Template save без транзакции: DB + S3 + createMany/deleteMany; частичный сбой → несогласованное состояние.
5. **A2 + A3** — Бесконечный Replicate poll + отсутствие timeout на всех LLM fetch → висящие серверные запросы, трата квоты и слотов функции Vercel.
6. **A1** — Silent drop параметров при невалидном JSON tool-args → агент тихо делает не то, что просил пользователь.
7. **A7** — Canvas `add_image` берёт URL от LLM без валидации (SSRF + mix-content).
8. **L1 + L2** — NaN/Infinity в layout при вырожденных размерах: визуальная поломка редактора и падения в Konva.
9. **F2 + F3 + F4** — 3.3k+ строк клиентского JS в редакторе + невиртуализированные списки ассетов → долгая загрузка и фризы на слабых машинах.
10. **S12** — Dev-автологин как SUPER_ADMIN в `createTRPCContext`: если где-то случайно включится в prod (неправильный `NODE_ENV`/флаг) — мгновенный privilege bypass.

## Quickfix candidates (требуют апрува)

«Безопасные» мелкие правки (≤50 строк каждая, без архитектурных решений):

| id  | что сделать | риск | эффект |
|-----|-------------|------|--------|
| QF-1 | L1: в `Math.max(1, w)` добавить `Number.isFinite(w) ? w : 1` (и аналоги для h) | низкий | убирает NaN-поломки layout |
| QF-2 | L2: guard `oldWidth>0 && oldHeight>0` в `helpers.ts:52` перед делением | низкий | убирает Infinity-скейл |
| QF-3 | L9: удалить мёртвый тернар `isHorizontal ? totalPrimaryAll : totalPrimaryAll` | нулевой | чистка |
| QF-4 | A3: обернуть все LLM fetch в `AbortSignal.timeout(30_000)` (или env-конфиг) | низкий | убирает висяки |
| QF-5 | A2: добавить `maxPolls=120` + `AbortSignal.timeout` для Replicate poll | низкий | убирает бесконечный цикл |
| QF-6 | A1: при `JSON.parse` catch → пометить step как `failed`, не пропускать | низкий | прозрачность ошибок |
| QF-7 | A6: заменить `console.log` полного prompt на hash + длину (или dev-only) | низкий | перестаём сливать промпты |
| QF-8 | D9: `asset.list` — добавить `take: 200` + опциональный курсор | низкий | защита от неограниченного ответа |
| QF-9 | F14: Figma `refetchInterval` — отключать после `status === 'done'/'error'` | низкий | меньше фонового трафика |
| QF-10 | F15: Sidebar админ-опрос — добавить `staleTime` и `enabled` по role | низкий | меньше лишних запросов |

«Средние» правки (требуют больше 1 файла или небольшой общей утилиты):

| id  | что сделать | риск | эффект |
|-----|-------------|------|--------|
| MF-1 | **Authz unification**: ввести `src/server/trpc/guards.ts` с `assertProjectAccess(projectId, userId, ctx)` / `assertWorkspaceAccess(workspaceId, userId, ctx)` и применить в **workflow, project, template, asset**. Закрывает **D1, D2, S1–S5, S9**. | средний (много файлов) | **критическая authz-дыра закрывается одним PR** |
| MF-2 | SSRF-allowlist для `/api/upload` и агента `add_image`: общая утилита `isAllowedExternalUrl(url)` + проверка через HEAD. Закрывает **S6, A7**. | средний | закрывает оба SSRF-вектора |
| MF-3 | `saveState` optimistic locking: добавить `version` в `Project`, проверка `where: { id, version }` + retry в клиенте. Закрывает **D3**. | средний | убирает lost updates |
| MF-4 | Transaction wrapping: `template.save`, `workspace.leave`, `project.createVersion` — обернуть в `prisma.$transaction`. Закрывает **D4, D8, D10**. | низкий | атомарность |
| MF-5 | Dev-context guard: жёсткий `if (process.env.NODE_ENV === 'development' && process.env.ALLOW_DEV_AUTH === '1')`. Закрывает **S12**. | низкий | защита от утечки dev-режима |

## Decisions log

- 2026-04-21 — скоуп: agent, data, layout, security, frontend; глубина: triage; артефакт: этот документ; субагенты: serial; старт: LayoutEngine.
- 2026-04-21 — триаж завершён по всем 5 зонам; 61 находка, из них 2 crit + 14 high. Top-10 и quickfix-кандидаты ожидают апрува.
- 2026-04-21 — **MF-1 applied**: `src/server/authz/guards.ts` + guards во всех доменных роутерах (project, template, asset, workspace, workflow) и в 4 route handlers (canvas/save, template/[id], upload/presign, upload). Закрыто: D1, D2, S1–S5, S7, S9. Partial: S6 (authz добавлен; SSRF-allowlist — MF-2). Ревьюер (Opus) нашёл 2 blocker (template.create, template.recent/list перечисляли WORKSPACE-шаблоны чужих) — исправлены. Orphaned `requireRole` в workspace.ts удалён. `tsc` clean, lints clean. Остался non-blocker: `template.loadState` теперь возвращает полный объект вместо узкого select (не критично, фронт проглотит).
- 2026-04-21 — **QF-пакет applied** (без субагентов, каждая правка 1–10 строк): QF-1 (L1 NaN guard в `layoutEngine`), QF-2 (L2 zero-parent guard в `helpers.ts` + unit-регрессия `computeConstrainedPosition.test.ts`), QF-3 + доп. очистка unused `intrinsicPrimary/Counter` (L9), QF-4 (A3: `AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS=30s)` на все 7 fetch в `llmProviders.ts`), QF-5 (A2: `REPLICATE_MAX_POLLS=120` + throw при превышении), QF-6 (A1: invalid tool-call JSON → `status: "error"` + понятный error; добавлено поле `AgentStep.error`), QF-7 (A6: base64-redact + length cap в логе prompt), QF-8 (D9: `take=200` по умолчанию, опциональный `limit ≤500`), QF-10 (F15: `staleTime=30_000` в Sidebar). **QF-9 → wontfix**: Figma `refetchInterval` уже возвращает `false` на `COMPLETED/FAILED`, ложная тревога триажа. `tsc` clean, lint clean, 5/5 vitest зелёные. Закрыто в Findings: L1, L2, L9, A1, A2, A3, A6, D9, F15.
