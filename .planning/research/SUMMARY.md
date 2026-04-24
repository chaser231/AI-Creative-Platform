# Research Summary — v1.0 Workflow Automation

> Синтез четырёх исследовательских документов: [STACK](./STACK.md), [FEATURES](./FEATURES.md), [ARCHITECTURE](./ARCHITECTURE.md), [PITFALLS](./PITFALLS.md). Цель — одной страницей дать entry-point для планирования REQUIREMENTS.md и ROADMAP.md.

## Что строим

Визуальный node-based редактор AI-сценариев внутри AI Creative Platform. Первый целевой сценарий v1.0: пользователь загружает фото продукта → AI удаляет фон → AI добавляет реалистичное отражение/тень → результат PNG с прозрачным фоном сохраняется в Asset Library workspace-а.

Продукт — comfyUI-подобный canvas с drag-drop нодами и соединениями, но **curated** (4-7 нод для старта), **commercial-safe** (Bria models по умолчанию), **интегрированный** с существующим Asset Library и `/editor` редактором.

## Ключевые решения (зафиксированы по фазе discuss)

| Вопрос | Решение | Обоснование |
|---|---|---|
| Масштаб v1.0 | Полный node-editor + runtime + 5-7 core нод | User requested full flow, not partial prototype |
| BG-removal | Replicate bria/product-cutout primary + rembg + 851-labs fallbacks | Commercial-safe, native alpha, уже интегрирован Replicate в проекте |
| Reflection | AI-generated (Bria product-shadow + FLUX Kontext fallback) | User выбрал AI-путь над client-Canvas composite |
| Entry point | Отдельная секция `/workflows` + preset "Product Reflection" | Явный раздел навигации, discoverability |
| Research | 4 параллельных агента (stack/features/architecture/pitfalls) | Decision quality > speed для fundamentals |

## Технологический stack

- **Node-editor UI:** `@xyflow/react@12` (React Flow 12) — MIT, React 19 compatible, `next/dynamic({ ssr: false })`.
- **DAG runtime:** `graphology@0.25` + `graphology-dag@0.4` — topological sort через `topologicalGenerations()`.
- **AI providers:** Replicate (primary), уже интегрирован через `src/lib/ai-providers.ts`. Gemini 2.5 Flash Image ИСКЛЮЧЁН из BG/reflection путей (нет alpha channel support).
- **Storage:** новая nullable колонка `AIWorkflow.graph: Json?` — additive migration без breaking changes. Legacy `steps` колонка остаётся.
- **State:** Zustand `useWorkflowStore` по паттерну существующего `canvasStore`.
- **UI:** Tailwind 4 + Radix UI (существующий design system).

**Детали:** [STACK.md](./STACK.md).

## Архитектурная схема (client/server split)

```
┌────────────── BROWSER ──────────────┐        ┌──────────── YANDEX CLOUD ────────────┐
│                                     │        │                                      │
│  /workflows/[id] page                │        │  tRPC `workflowRouter`               │
│  └─ WorkflowEditor (xyflow canvas)   │        │  ├─ saveGraph / loadGraph / list     │
│     ├─ NodePalette (sidebar)         │        │  └─ (deprecated alias)               │
│     ├─ NodeInspector (right panel)   │        │                                      │
│     └─ RunButton (top bar)           │        │  POST /api/workflow/execute-node     │
│                                     ├───────▶│  (maxDuration=300)                   │
│  useWorkflowStore (Zustand)         │        │  ├─ executeAction(remove_background) │
│  ├─ nodes, edges, viewport          │        │  │   → callReplicate(bria/rembg/851) │
│  ├─ runState[nodeId]                │        │  │   → uploadFromExternalUrl → S3    │
│  └─ runAll() orchestrator           │        │  └─ executeAction(add_reflection)    │
│     └─ graphology topologicalGens   │        │      → callReplicate(bria/flux-ktx)  │
│        │                             │        │      → uploadFromExternalUrl → S3    │
│        ├─ client handlers            │        │                                      │
│        │  (ImageInput, AssetOutput) │        │  Prisma / PostgreSQL                 │
│        └─ per-node tRPC/REST call    │        │  └─ AIWorkflow.graph: Json? (new)    │
│                                     │        │                                      │
└──────────────────────────────────────┘        └──────────────────────────────────────┘
```

**Ключевой принцип:** client оркестрирует граф, сервер исполняет per-node AI-операции. Progress показывается через per-node status в UI.

**Детали:** [ARCHITECTURE.md](./ARCHITECTURE.md).

## Scope: что внутри / снаружи v1.0

### ✅ Внутри v1.0

- React Flow canvas с drag/zoom/pan, типизированные порты, inspector panel.
- 4 ноды для Product Reflection:
  1. **ImageInput** (client) — выбор asset из Library или upload.
  2. **RemoveBackground** (server, AI) — Bria product-cutout + каскадные fallbacks.
  3. **AddReflection** (server, AI) — Bria product-shadow + FLUX Kontext fallback.
  4. **AssetOutput** (client) — PNG в Asset Library.
- Preset "Product Reflection" — pre-filled граф для 1-click experience.
- Save/Load workflows в БД.
- Per-node runtime status (idle/running/done/error/blocked).
- Rate-limit 20 runs/hour per user.
- Cost tracking через `AIMessage` records (существующий паттерн).

### ❌ Вне v1.0 (backlog)

- Client-side композит-ноды (Blur, GradientMask, BlendMode, LayerStack, Flip, Crop, Resize) → v2 «local compositing» трек.
- Realtime collaboration → v3+.
- Custom code/script nodes → v3+ (security sandbox нужен).
- Subgraphs, node groups → v2.
- ComfyUI workflow.json import/export → по запросу.
- Batch / scheduled runs → v2.
- WorkflowRun таблица и история запусков → v1.1.
- Undo/redo в редакторе → v1.1.
- LLM auto-build graph from prompt → v2.

**Детали:** [FEATURES.md](./FEATURES.md).

## Build Order (6 фаз)

1. **Phase 1 — DB + Server actions.** Миграция `graph` column, `remove_background` + `add_reflection` actions, REST endpoint `/api/workflow/execute-node` с maxDuration=300, helpers (tryWithFallback, uploadFromExternalUrl, SSRF guard).
2. **Phase 2 — Editor Canvas.** xyflow canvas, `useWorkflowStore`, `/workflows` страницы (list/new/[id]), tRPC saveGraph/loadGraph, отделение legacy workflows через фильтр.
3. **Phase 3 — Node Registry + Inspector.** `NODE_REGISTRY` константа, 4 node components, Zod-schema params, автогенерация формы в inspector, isValidConnection + UX feedback.
4. **Phase 4 — Runtime / Executor.** Client-side executor на graphology, RunButton, per-node status UI, cycle detection, pre-run validation, rate-limits.
5. **Phase 5 — Preset "Product Reflection" + UX Polish.** Preset JSON, card на `/workflows`, end-to-end тест «30 секунд до первого PNG с отражением», error copy (RU).
6. **Phase 6 — QA / Hardening (optional).** Load testing, edge cases, перед demo/release.

**Estimate:** Phase 1-5 = core MVP; Phase 6 — buffer. Общая оценка 3-5 фаз parallel-able (Phase 1 ↔ Phase 2 параллельно; Phase 3-4 зависят от обеих; Phase 5 — последняя).

## Топ-5 рисков (P0)

1. **Replicate cold start >60s** — выделяем REST endpoint с `maxDuration=300` [Phase 1].
2. **SSR hydration xyflow** — `next/dynamic({ ssr: false })` + `"use client"` на странице [Phase 2].
3. **Replicate URL expiration** — немедленный upload в Yandex S3 в каждом AI action [Phase 1].
4. **AIWorkflow.steps vs graph** — фильтр `graph !== null` в `/workflows` list queries [Phase 2].
5. **Cost blow-up** — `checkRateLimit` 20/hour на user на executeGraphNode [Phase 4].

Полный перечень (15+ рисков) — в [PITFALLS.md](./PITFALLS.md).

## Открытые вопросы для REQUIREMENTS / ROADMAP

1. Точное число runs/hour для rate-limit — 20 достаточно?
2. Финальные имена ноды в UI (русификация): «Изображение», «Удалить фон», «Добавить отражение», «Сохранить в Assets» — утвердить.
3. Drag-drop file прямо на canvas → auto-create ImageInput — v1.0 или v1.1?
4. Показ предварительной стоимости ($0.08) на кнопке Run — v1.0 или v1.1?
5. Undo/redo в editor — обязательно для v1.0 или отлагаем?

Эти вопросы перейдут в REQUIREMENTS.md как acceptance-критерии и (при необходимости) в `gsd-discuss-phase` для соответствующей фазы.

## Next step

Создать `REQUIREMENTS.md` с REQ-ID'ами, основанными на scope из этого summary, и `ROADMAP.md` с 5-6 фазами build order.
