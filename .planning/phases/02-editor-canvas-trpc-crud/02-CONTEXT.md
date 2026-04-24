# Phase 2 — Context (Editor Canvas + tRPC CRUD)

> Этот документ фиксирует фактическое состояние кода и решения discuss-phase,
> которые определят PLAN.md. Читается план-чекером и исполнителем.

## Goal (goal-backward check)

Пользователь из аутентифицированной сессии:

1. Открывает новую страницу `/workflows` → видит список своих workflow'ов + preset'ов.
2. Кликает «Создать» → попадает на `/workflows/new` → после первого сохранения редиректится на `/workflows/<id>`.
3. В редакторе видит xyflow canvas с palette слева и topbar сверху. Может перетащить ноду из palette, соединить две ноды, передвинуть, удалить.
4. Закрывает вкладку / обновляет страницу → граф восстанавливается из БД.
5. На `/workflows` list **не видит** legacy чат-workflow'ов (у них `graph IS NULL`).

Runtime (Run button) и inspector — **вне scope** Phase 2 (Phase 3-4).

## Decisions locked in discuss-phase

| ID | Решение | Обоснование |
| --- | --- | --- |
| **D-08** | Расширяем существующий `workflowRouter`: новые методы `saveGraph`, `loadGraph` + расширение `list` через `includeLegacy` flag. Legacy `create/update/delete/interpretAndExecute/applyTemplate` — не трогаем. | Минимум поверхности, не ломает LLM-чат. Альтернативы (new router / split) — лишний overhead. |
| **D-09** | `useWorkflowStore` — композиция слайсов (graphSlice + viewportSlice + runStateSlice-stub), паттерн повторяет `canvasStore`. | Соответствие существующему codebase convention; Phase 3-4 расширят run/inspector слайсы без переписывания Phase 2. |
| **D-10** | Auto-save: debounced 2s + `beforeunload` force-save. Без versioning. Collision стратегия — last-write-wins (добавление `version` отложено в v1.1). | Ускоряет Phase 2; `Project.version` не пересекается с `AIWorkflow`; дублированный tab-open малоправдоподобен в MVP. |
| **D-11** | Ноды Phase 2 = голые placeholder-карточки (label + handles с правильными типами, без стилизации). Tailwind полировка и inspector — Phase 3. | AC Phase 2 — «drag/drop/connect работают», визуал Phase 3 не регрессирует. |
| **D-12** | `/workflows/new?preset=X` — маршрут присутствует, logic = stub (читаем query, пишем `console.info('[preset] TODO Phase 5', preset)`). Реальные preset-графы — Phase 5. | Обратная совместимость URL, не потребуется переделывать ссылки. |
| **D-13** | xyflow wrapping pattern для Next.js 16: все `/workflows/*` страницы — client components (workspace только client через `useWorkspace()`). Внутри `[id]/page.tsx` рендерится `<WorkflowEditorShell>` (отдельный client component с `next/dynamic({ ssr: false })` на `WorkflowEditor`). Это обеспечивает code-split и соответствует official xyflow Next.js example. | Community-подтверждено (PostHog 26016, xyflow 4694); совпадает с `react-flow-example-apps/reactflow-nextjs`. |

## Current state (что уже есть в `ai-workflows-creative`)

### DB
- `AIWorkflow.graph: Json?` — nullable колонка, migration `20260424120000_add_workflow_graph` (Phase 1).
- `AIWorkflow.steps: Json` — legacy column, продолжает использоваться чатом.

### Server
- `WorkflowGraph`, `WorkflowNode`, `WorkflowEdge`, `NODE_REGISTRY` — в `src/server/workflow/types.ts` (source of truth, импортируется клиентом).
- `workflowRouter` (`src/server/routers/workflow.ts`) — существующие методы: `list`, `getById`, `create`, `update`, `delete`, `interpretAndExecute`, `applyTemplate`. Workspace guards настроены.
- REST endpoint `POST /api/workflow/execute-node` — Phase 1, готов к использованию в Phase 4.

### Client
- `useCanvasStore` — эталон-паттерн композиции Zustand-слайсов (`src/store/canvasStore.ts`), повторяется для workflow'а.
- `TRPCProvider` уже есть, `protectedProcedure` включает `ctx.user`, `ctx.prisma`.

### Пакеты
- Не установлены: `@xyflow/react@^12`, `graphology@^0.25`, `graphology-dag@^0.4`. **Устанавливаем в Wave 1.**

## Scope Phase 2 (что делаем)

1. **Wave 1 — Deps + Types.** Установить `@xyflow/react`, `graphology`, `graphology-dag`; shared `src/lib/workflow/graphSchema.ts` (Zod-schema для `WorkflowGraph`, переиспользуется сервером и клиентом).
2. **Wave 2 — tRPC saveGraph/loadGraph.** Добавить в `workflowRouter`: `saveGraph` (upsert по id), `loadGraph` (read with graph field), обновить `list` с `includeLegacy?: boolean` (default `false`); unit-тесты на router (3-4 кейса + authz).
3. **Wave 3 — Zustand store.** `src/store/workflow/types.ts` + `createGraphSlice.ts` + `createViewportSlice.ts` + `createRunStateSlice.ts` + `useWorkflowStore.ts`. Unit-тесты на слайсы (addNode/connect/setViewport + serialize/hydrate).
4. **Wave 4 — Pages + editor shell.** `/workflows/page.tsx` (list), `/workflows/new/page.tsx` (create-or-redirect), `/workflows/[id]/page.tsx` (editor page shell); `WorkflowEditorShell.tsx` (client wrapper with dynamic import), `WorkflowEditor.tsx` (xyflow canvas + placeholder palette + topbar).
5. **Wave 5 — Components + auto-save wiring.** `NodePalette.tsx`, `NodeTopbar.tsx`, 4 placeholder node components (`ImageInputNode`, `RemoveBackgroundNode`, `AddReflectionNode`, `AssetOutputNode`), auto-save hook `useWorkflowAutoSave.ts` (debounce 2s + beforeunload).
6. **Wave 6 — Verification.** tsc + vitest + eslint + next build; ручной sanity check (описан в PLAN).

## Out of scope Phase 2 (не делаем)

- **Inspector panel** — Phase 3.
- **`isValidConnection` с visual feedback** — Phase 3.
- **Runtime / Run button логика** — Phase 4. (В Phase 2 topbar Run — disabled.)
- **Реальные preset-графы** — Phase 5.
- **Node стилизация/иконки** — Phase 3.
- **Undo/redo** — v1.1.
- **Thumbnail generation** — v1.1.

## Risks for this phase

| ID | Риск | Mitigation |
|---|---|---|
| R-01 | SSR hydration error на xyflow из-за Next 16 запрета `ssr:false` в server components. | D-13 паттерн shell-wrapper; smoke-тест на `pnpm dev` → Network/Console clean. |
| R-02 | Tailwind preflight + xyflow CSS конфликт. | `@xyflow/react/dist/style.css` импорт в `WorkflowEditor.tsx` (scoped к route chunk). Проверка Wave 6. |
| R-03 | `list` фильтр по `graph !== null` может рандомно сломать LLM-чат UI (если тот использует `list` из `workflowRouter`). | `list` расширяем с default `includeLegacy: false` на `/workflows`, но callers чата не меняются (им передаём явный `includeLegacy: true` или они используют другую процедуру). Проверяем где вызывается `workflow.list` в клиенте. |
| R-04 | Bundle size — xyflow добавляет ~60kb. | Route-level split через `next/dynamic`, главная страница не затрагивается. `next build` выход проверяем на Phase 2 size regression. |
| R-05 | Auto-save race: debounced save после beforeunload. | `beforeunload` handler вызывает `store.flushNow()` — sync call без debounce, через `navigator.sendBeacon` или `keepalive: true` fetch. |

## Verification gates

- **Каждая Wave:** коммит + green tsc/vitest/lint (где уместно).
- **Итог Phase 2:** ручной sanity в `pnpm dev`:
  1. Navigate `/workflows` → skeleton → list рендерится.
  2. Click «Создать» → `/workflows/new` → автоматический `saveGraph({ graph: emptyGraph })` → redirect `/workflows/<newId>`.
  3. Drag `ImageInput` в canvas → node видно.
  4. Соединить ImageInput `image-out` → RemoveBackground `image-in` → edge создан (без validation — просто drop; Phase 3 добавит).
  5. Reload → граф на месте.
  6. Navigate legacy чат → workflowRouter работает как раньше.

Если любой из пунктов ломается — Phase 2 не завершена.
