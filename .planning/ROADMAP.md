# Roadmap — v1.0 Workflow Automation: Product Reflection Scenario

> План фаз для реализации milestone v1.0. Каждая фаза — атомарная и делается от «чистого» к «чистому» состоянию (после фазы система в рабочем виде). Зависимости указаны явно, чтобы определить порядок и параллельность.

**Milestone target:** 2026-05-XX (6 фаз, ~2-3 недели при фокусной работе).
**Start:** 2026-04-24.
**Status:** Planning (готовятся REQUIREMENTS + ROADMAP).

## Обзор фаз

| # | Phase | Цель | Depends on | REQs | Parallel-able с |
|---|---|---|---|---|---|
| 1 | **DB + Server AI Actions** | Сервер умеет выполнять bg-removal и reflection через API + БД готова хранить graph | — | REQ-01, 04, 05, 06, 07 (partial), 08, 23 | Phase 2 (параллельно после schema migration) |
| 2 | **Editor Canvas + tRPC CRUD** | `/workflows` страницы работают, граф создаётся / сохраняется / загружается без runtime | 1 (schema) | REQ-02, 09, 10, 13, 24, 25 | Phase 1 (после REQ-01) |
| 3 | **Node Registry + Inspector + Client Handlers** | Каждая нода знает свою schema, inspector рендерит форму, ImageInput / AssetOutput client-handlers работают | 2 | REQ-11, 12, 13 (full), 14 | — |
| 4 | **Runtime / Executor / Run Button** | Нажатие Run реально запускает граф end-to-end, per-node progress UI, rate-limit | 1, 3 | REQ-07 (full), 15, 16, 17, 18, 19, 26 | — |
| 5 | **Preset + UX Polish + E2E Test** | Preset "Product Reflection" готов, RU тексты финализированы, e2e тест зелёный | 4 | REQ-03, 20, 21, 22, 27, 28 | — |
| 6 | **QA / Hardening (optional)** | Load testing, edge cases, release prep | 5 | — | — |

Критический путь: 1 → 2 → 3 → 4 → 5. Phase 6 — буфер.

---

## Phase 1 · DB + Server AI Actions

**Goal:** Все серверные изменения готовы, чтобы клиент мог выполнить AI-ноду через REST endpoint и получить s3 URL с результатом.

**Why first:** Phase 2 (UI) может начать параллельно после Prisma migration, но executor (Phase 4) строго зависит от REST endpoint.

### Deliverables

- **Миграция Prisma:** `add-workflow-graph` (+ колонка `AIWorkflow.graph: Json?`).
- **Shared TS types:** `src/server/workflow/types.ts` — `WorkflowGraph`, `WorkflowNode`, `WorkflowEdge`, `NodeData`, `NODE_REGISTRY` (initial).
- **Workflow helpers:** `src/server/workflow/helpers.ts`:
  - `tryWithFallback<T>(providers: Array<() => Promise<T>>): Promise<T>`.
  - `uploadFromExternalUrl(url, { workspaceId }): Promise<{ s3Url, s3Key }>`.
  - `buildReflectionPrompt(style, intensity): string`.
  - `postProcessToTransparent(rgbaUrl): Promise<string>` (обёртка через bg-removal).
- **AI providers расширение:** `src/lib/ai-providers.ts` + `src/lib/ai-models.ts`:
  - Добавить `bria/product-cutout`, `bria/product-shadow`, `black-forest-labs/flux-kontext-pro`, `851-labs/background-remover` как Replicate-модели.
  - `callReplicate` расширить для поддержки generic `modelSlug` + `input` dictionary.
- **Action handlers:** `src/server/agent/executeAction.ts`:
  - case `remove_background` — кascad провайдеров, SSRF-guard, cost-track.
  - case `add_reflection` — primary + fallback, cost-track.
- **REST endpoint:** `src/app/api/workflow/execute-node/route.ts`:
  - `export const maxDuration = 300`.
  - POST handler: auth via `requireSessionAnd*` wrapper, body `{ actionId, params, inputs, workspaceId, workflowId? }`, response `{ success, type, imageUrl }`.
  - Rate-limit stub (минимальная версия — full limits в Phase 4).
- **Integration test:** `src/app/api/workflow/__tests__/execute-node.test.ts`:
  - Happy path: mock Replicate → 200 s3 URL.
  - SSRF guard: private IP input → 400.
  - Fallback: primary fail → secondary success.

### Success criteria

- `npx prisma migrate dev` проходит.
- `curl -X POST /api/workflow/execute-node` с body `{ actionId: "remove_background", inputs: { "image-in": { imageUrl: "<valid-s3>" }}}` → 200 + s3 URL в нашем бакете.
- Повторный curl через 10 минут — URL результата всё ещё работает (proof: uploaded to our S3).
- Все тесты зелёные.

### Risks / Mitigations

- **Replicate cold start** — покрыто `maxDuration = 300`.
- **Bria доступность через Replicate** — проверить что модель актуальна (slug `bria/product-cutout` и `bria/product-shadow`). Fallback на `cjwbw/rembg` если недоступен.

### Checkpoints

- [ ] Prisma migration merged.
- [ ] Action handlers implemented + tests green.
- [ ] REST endpoint POC working via curl.

**Estimated effort:** 2-3 дня.

---

## Phase 2 · Editor Canvas + tRPC CRUD

**Goal:** `/workflows` страницы работают, граф создаётся / сохраняется / загружается. Ноды видны как placeholder'ы без реального runtime.

**Why after/parallel with Phase 1:** зависит от миграции (колонка `graph`), но не от AI actions. Может начаться сразу после `REQ-01` checkpoint.

### Deliverables

- **Пакеты:** `@xyflow/react@12`, `graphology`, `graphology-dag`.
- **tRPC router расширение:** `src/server/routers/workflow.ts`:
  - `saveGraph` mutation (create/update).
  - `loadGraph` query (by id).
  - `list` — добавить фильтр `graph !== null` по default; `includeLegacy` flag.
  - `getById` — select `graph`.
  - `delete` idempotent.
- **Zustand store:** `src/store/workflow/useWorkflowStore.ts` (базовый: nodes, edges, viewport, runState; без executor пока).
- **Pages:**
  - `src/app/workflows/page.tsx` — list.
  - `src/app/workflows/new/page.tsx` — create-new (optional `?preset=` query — поддержка preset-а будет в Phase 5, пока просто blank canvas).
  - `src/app/workflows/[id]/page.tsx` — редактор через `next/dynamic`.
- **Editor components (базовые, без inspector логики):**
  - `WorkflowEditor.tsx` — xyflow canvas + sidebar + topbar wrapper.
  - `NodePalette.tsx` — sidebar со списком типов нод (drag source).
  - `NodeTopbar.tsx` — имя, Save, Run (Run disabled пока).
  - Initial placeholder node components (без стилизации): 4 штуки.
- **Auto-save:** debounced 2s; `beforeunload` force-save.

### Success criteria

- Navigate to `/workflows` → видно список.
- Click «Создать» → `/workflows/new` с пустым canvas.
- Drag ноды из palette → появляется в canvas. Соединить две ноды → edge.
- Перезагрузка страницы → граф на месте (автосохранение).
- `/workflows` не показывает legacy chat-workflows (где `graph IS NULL`).

### Risks / Mitigations

- **SSR hydration warnings** — `next/dynamic({ ssr: false })` обязательно для WorkflowEditor.
- **Tailwind / xyflow CSS конфликт** — проверить в devserver, при необходимости wrap component scoped styles.
- **Bundle size** — xyflow ~60kb, приемлемо на отдельной route.

### Checkpoints

- [ ] tRPC router mutations implemented + Zod schemas.
- [ ] Pages render, no hydration warnings.
- [ ] Auto-save works.
- [ ] Drag-drop ноды functional.

**Estimated effort:** 3-4 дня.

---

## Phase 3 · Node Registry + Inspector + Client Handlers

**Goal:** Ноды имеют полные params-схемы, inspector рендерит форму автоматически, client-handlers (ImageInput, AssetOutput) готовы к use в executor'е.

**Depends on:** Phase 2 (canvas есть, edit params нужен UI layer).

### Deliverables

- **`NODE_REGISTRY` полный:** `src/server/workflow/types.ts`:
  - `imageInput`, `removeBackground`, `addReflection`, `assetOutput`.
  - Per-node Zod schema для params.
  - Russian display names + descriptions.
- **Inspector:**
  - `src/components/workflows/NodeInspector.tsx` — автогенерация формы из Zod schema.
  - Поддержка: text, number (с slider если min/max), enum (select), boolean (checkbox).
  - Validation + error messages.
  - Debounced update через `updateNodeParams`.
- **isValidConnection:** в xyflow — проверка совместимости `PortType`.
- **Visual feedback для connection:** зелёный/красный hover над target handle.
- **Client handlers:** `src/store/workflow/clientHandlers.ts`:
  - `imageInput({ params })` — возвращает `{ imageUrl }`; если `assetId` — резолв через `asset.getById`; если `sourceUrl` — возвращает direct (только для data-urls, SSRF prevented на server).
  - `assetOutput({ inputs, params, ctx })` — POST через tRPC `asset.createFromUrl`.
- **AssetLibraryModal reuse:** в `ImageInput` node — button «Выбрать из библиотеки» → open existing `AssetLibraryModal`.

### Success criteria

- Click на ноду → inspector показывает form с корректными default values.
- Изменение params → автосохранение.
- Invalid param (e.g. число вне диапазона) → visual error.
- Drag edge → visual feedback по совместимости.
- ImageInput нода: click «Выбрать» → открыт asset-picker modal → select → `assetId` записан в params.

### Risks / Mitigations

- **AssetLibraryModal coupling** — если сложно переиспользовать (hard-coded context), extract в shared modal (минимальная рефакторинг ветка в Phase 3).
- **Zod → form mapping** — если complex, начать с простого switch по type, evolve.

### Checkpoints

- [ ] NODE_REGISTRY с 4 полноценными node definitions.
- [ ] Inspector рендерит form для всех 4-х типов.
- [ ] isValidConnection blocks bad edges.
- [ ] ImageInput + AssetOutput client-handlers tested manually.

**Estimated effort:** 3-4 дня.

---

## Phase 4 · Runtime / Executor / Run Button

**Goal:** Нажатие Run реально запускает граф end-to-end, UI показывает per-node progress, rate-limit применяется.

**Depends on:** Phase 1 (REST endpoint) + Phase 3 (NODE_REGISTRY complete).

### Deliverables

- **Client executor:** `src/store/workflow/executor.ts`:
  - Построение graphology graph.
  - Cycle detection.
  - Topological generations.
  - Per-generation `Promise.all`.
  - Dispatch per-node (client vs server handler).
  - Callbacks `onNodeStart`, `onNodeDone`, `onNodeError`.
- **Run integration в Zustand store:** `useWorkflowStore.runAll()`.
- **Pre-run validation:** проход по нодам, check required params + edges.
- **UI:**
  - `RunButton.tsx` с состояниями idle/running/success/error.
  - Per-node status rendering в кастомных node components: цветная рамка + иконка + thumbnail.
  - Failed node tooltip с error message.
  - Blocked node рендер.
- **Full rate-limit:** `checkRateLimit(userId, "workflow.execute", 20, "1h")` в REST endpoint.
- **Cost tracking per-node:** `AIMessage` на каждый server-action execute (including fallback attempts).
- **Unit tests:** `executor.test.ts`:
  - Cycle → throws.
  - Topological order.
  - Parallel within generation.
  - Error halts workflow.

### Success criteria

- Кнопка Run включается когда граф валиден.
- Click Run → ноды last → running → done sequentially.
- Final AssetOutput показывает thumbnail + link на asset.
- 21-й Run в час → user-facing error «Превышен лимит».
- SQL: `AIMessage` records созданы корректно (2 записи на 1 успешный run).
- Executor unit tests green.

### Risks / Mitigations

- **Race condition** при удалении edge во время Run — блокировать edit-interactions во время `running: true`.
- **Cancelled tRPC на unload** — накопительный cost не освобождается; accept в v1.0 (см. PITFALLS.md).

### Checkpoints

- [ ] Executor passes unit tests.
- [ ] Manual run of 2-node graph works end-to-end.
- [ ] Rate-limit enforced.
- [ ] Pre-run validation blocks invalid graphs.

**Estimated effort:** 3-4 дня.

---

## Phase 5 · Preset + UX Polish + E2E Test

**Goal:** User за ≤ 30 секунд получает первый reflection PNG. Все тексты финализированы, дизайн соответствует design system, e2e тест зелёный.

**Depends on:** Phase 4 (полноценный run работает).

### Deliverables

- **Preset data:** `src/server/workflow/presets/product-reflection.ts`:
  - Pre-filled graph JSON с 4 нодами, соединёнными правильно.
  - Positioning optimized для первого впечатления.
  - Default params (Bria models, style="mirror", intensity=0.7).
- **Preset seeder:**
  - На `workspace.create` hook — создать `AIWorkflow` с `isTemplate: true` + `graph` из preset'а.
  - Migration script для существующих workspace'ов: `scripts/seed-presets.ts`.
- **`/workflows/new?preset=...` handling:**
  - Page читает query param, инициализирует Zustand store с preset graph.
  - Нужен только при отсутствии `workflowId` в URL.
- **UX polish:**
  - Preset карточка визуально выделена (badge «Шаблон», градиент или иконка).
  - Pre-run validation сообщения на русском.
  - Run button с текстом «Запустить» + иконка.
  - Empty state на `/workflows` для нового workspace (до создания первой своей).
  - Loading skeletons.
- **Save as copy:** после Run preset'а — подсказка «Сохранить как мой workflow».
- **E2E тест:** `tests/e2e/workflows-preset.spec.ts`:
  - Login → navigate /workflows → click preset → canvas open → ImageInput с готовым test asset → Run → ожидание → check AssetOutput has result.
  - Mock Replicate (через MSW или custom proxy), чтобы CI run'ы не стоили денег.
- **Visual review:**
  - Контрастность AA.
  - Spacing / typography consistent с остальным приложением.
  - Dark theme (если проект его поддерживает — проверить).

### Success criteria

- Новый workspace → `/workflows` показывает Product Reflection preset.
- Click preset → canvas с pre-filled графом.
- Select test image → Run → через ≤20s AssetOutput готов.
- Total time «нажал preset → увидел результат» < 30s.
- Resulting PNG → alpha channel присутствует.
- E2E тест зелёный в CI.

### Risks / Mitigations

- **Preset seeding для существующих workspace'ов** — написать idempotent script; безопасно запускать повторно.
- **Replicate latency в CI** — mock всегда; в staging можно делать real.

### Checkpoints

- [ ] Preset карточка показывается для нового workspace.
- [ ] Preset graph loads + runs end-to-end manually.
- [ ] E2E test green.
- [ ] Design review done.

**Estimated effort:** 2-3 дня.

---

## Phase 6 · QA / Hardening (optional, buffer)

**Goal:** Стресс-тест, edge cases, release-prep. Фаза опциональная — активируется, если перед release остаётся время; иначе элементы вытесняются в v1.1 backlog.

### Deliverables (flexible)

- **Load testing:** 5-10 конкурентных Run-ов в staging workspace → verify no 500, fair queuing.
- **Edge cases:**
  - Image > 10MB — graceful error (или прокси resize).
  - Replicate returns 500 на primary — fallback ровно работает.
  - User закрывает вкладку во время Run — no server crash.
  - Очень много нод (15+) — canvas performance ok.
  - Очень длинный workflow name — UI не ломается.
- **Cost dashboard полировка:** добавить в admin-panel view с `SUM(costUnits)` per workspace.
- **Monitoring:**
  - Alert в Datadog/Yandex Monitoring на high error rate `/api/workflow/execute-node`.
  - Graph of p95 latency per action.
- **Documentation:**
  - README раздел «Workflows» в `docs/`.
  - Inline tooltip в UI «Как это работает» для newbies.

### Success criteria

- Все edge cases: graceful degradation, no 500.
- Load test: 10 concurrent runs — p99 latency < 30s.

### Checkpoints

- [ ] Load test plan run.
- [ ] Monitoring alerts configured.
- [ ] Docs updated.

**Estimated effort:** 1-2 дня (flexible).

---

## Параллельность и критический путь

```
Phase 1 ────────────────────┐
                            │
        REQ-01 checkpoint ──┤
                            │
                            ▼
Phase 2 ──────────────▶ Phase 3 ──▶ Phase 4 ──▶ Phase 5 ──▶ Phase 6
                                              │
        REQ-01 ...─────────────────────────▶──┘ REST endpoint
```

- **Phase 1** (DB + server actions) и **Phase 2** (UI CRUD) **параллельны** после миграции `graph` column.
- **Phase 3** (Inspector) может стартовать только после **Phase 2** (канвас есть).
- **Phase 4** (Executor) требует **Phase 1** (REST) и **Phase 3** (node registry complete).
- **Phase 5** (Preset + polish) — после **Phase 4**.
- **Phase 6** — после всего.

**Оптимистичная оценка:** 12-15 рабочих дней с учётом параллельности Phases 1-2.
**Реалистичная:** 15-20 дней (учитывая code review, тесты, неожиданные pitfalls).

---

## Dependencies на код вне milestone'а

- **MF-6 (canvas state consistency fix):** идёт параллельно, не блокирует и не блокируется. Оба проекта модифицируют Zustand store-ы, но разные (canvas vs workflow) — конфликтов нет.
- **Существующие `/editor`, `/photo`, `/templates`** — не трогаем в этом milestone, только новый `/workflows`.
- **Actionы `interpretAndExecute` (legacy chat agent)** — не модифицируются, но `executeAction.ts` расширяется (+2 case). Риск минимальный благодаря unit-tests.

## Коммит-стратегия

- Atomic commits: один commit = один REQ (или небольшая группа в одной фазе).
- Phase-completion commit: `feat(workflows): complete Phase N — <summary>` + обновление `STATE.md`.
- Per-фаза — артефакты (`.planning/<phase>/PLAN.md`, `EXECUTION.md`, `VERIFICATION.md`) по стандартному GSD-flow.

## Следующий шаг

После ревью этого ROADMAP.md — запуск `/gsd-plan-phase` для Phase 1 (детальный план, task breakdown, dependency analysis).

---

*Last updated: 2026-04-24 (initial).*
