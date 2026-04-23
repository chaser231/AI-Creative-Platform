# Phase 2 — Plan (Editor Canvas + tRPC CRUD)

**Goal:** `/workflows` раздел работает end-to-end: list/new/[id] страницы, xyflow canvas с drag-drop 4 placeholder-нод, tRPC `saveGraph/loadGraph`, auto-save 2s + beforeunload. Runtime и inspector — out of scope (Phase 3-4).

**Depends on:** Phase 1 (миграция `graph` column + `NODE_REGISTRY` types). Оба требования удовлетворены в ветке `ai-workflows-creative`.

**Requirements covered:** REQ-02, REQ-09, REQ-10, REQ-13 (palette — частично, полный UX Phase 3), R-01..R-05.

---

## Waves

Каждая волна = логический чекпойнт с atomic commit. После каждой — ощутимый, самостоятельно верифицируемый результат.

```
Wave 1 (deps + schema) ─┐
                        ├─▶ Wave 2 (router) ─┐
Wave 3 (store) ─────────┤                    ├─▶ Wave 4 (pages+shell) ─▶ Wave 5 (components+autosave) ─▶ Wave 6 (verify)
                        └────────────────────┘
```

Wave 1 и Wave 3 независимы (можно распараллелить). Wave 2 читает schema из Wave 1. Wave 4 использует всё предыдущее. Wave 5 полирует UX внутри Wave 4. Wave 6 — финальная проверка.

---

## Wave 1 — Dependencies + shared graph schema

### Task 1.1 — Install dependencies

**Files:**
- `platform-app/package.json` (edit)
- `platform-app/pnpm-lock.yaml` (auto-update)

**Actions:**
1. `cd platform-app && pnpm add @xyflow/react@^12 graphology@^0.25 graphology-dag@^0.4`
2. `pnpm add -D @types/graphology` if needed
3. Verify versions in `package.json`

**AC:**
- `package.json` содержит три пакета.
- `pnpm install` проходит без warnings (peer deps React 19 satisfied).

### Task 1.2 — Shared WorkflowGraph Zod schema

**Files (new):**
- `platform-app/src/lib/workflow/graphSchema.ts`

**Actions:**
1. Импортировать `WorkflowGraph, WorkflowNode, WorkflowEdge, WorkflowNodeType` из `@/server/workflow/types`.
2. Описать `workflowGraphSchema`, `workflowNodeSchema`, `workflowEdgeSchema` через Zod (mirror существующих TS типов, валидирует `version: z.literal(1)`, `nodes` — массив с `WorkflowNodeType` enum, `edges` — массив с cross-reference-friendly структурой).
3. Экспортировать `emptyWorkflowGraph()` helper, возвращающий `{ version: 1, nodes: [], edges: [] }`.

**AC:**
- `workflowGraphSchema.parse({ version: 1, nodes: [], edges: [] })` = ok.
- Invalid `version: 2` → throw.
- Type-level: `z.infer<typeof workflowGraphSchema>` совместим с `WorkflowGraph` (cast test).

### Task 1.3 — Unit tests for schema

**Files (new):**
- `platform-app/src/lib/workflow/__tests__/graphSchema.test.ts`

**AC (3 тест-кейса):**
- parses empty graph.
- rejects unknown node type.
- rejects edge referencing non-existent node ID (soft: just structural — deep node-existence check может быть вне Zod, но строковые ID — обязательны).

**Commit:** `feat(phase-02/wave-1): install xyflow+graphology, add WorkflowGraph Zod schema`

---

## Wave 2 — tRPC router extension

### Task 2.1 — Add `saveGraph`, `loadGraph`, extend `list`

**Files (edit):**
- `platform-app/src/server/routers/workflow.ts`

**Actions:**

1. Добавить import `workflowGraphSchema, emptyWorkflowGraph` из `@/lib/workflow/graphSchema`.
2. Extend `list` procedure:
   - Input: `z.object({ workspaceId: z.string(), includeLegacy: z.boolean().optional().default(false) })`.
   - `where`: если `includeLegacy === false` → добавить `graph: { not: Prisma.DbNull }`; иначе — без фильтра.
   - Select: добавить `graph: true` (для frontend превью).
3. Добавить `saveGraph` mutation:
   - Input: `z.object({ workspaceId: z.string(), workflowId: z.string().optional(), name: z.string().min(1).max(200), description: z.string().optional(), graph: workflowGraphSchema })`.
   - Behavior: если `workflowId` передан — update (с authz + assertWorkspaceAccess CREATOR); иначе create (с CREATOR).
   - При create — `steps: []` (обязательное поле прежней схемы).
   - Возврат: `{ id: string }`.
4. Добавить `loadGraph` query:
   - Input: `z.object({ id: z.string() })`.
   - Returns: `{ id, name, description, graph: WorkflowGraph | null, updatedAt, isTemplate }`.
   - `assertWorkspaceAccess(ctx, workflow.workspaceId, "USER")`.
   - Если `graph === null` → return с `graph: null` (UI может показать migration-UI или ошибку «legacy workflow»).
5. **Не трогать** legacy `create/update/delete/interpretAndExecute/applyTemplate`.

**AC:**
- `saveGraph` без `workflowId` → создаёт с `graph` non-null → возвращает id.
- `saveGraph` с `workflowId` → upserts.
- `saveGraph` чужого workspace → `FORBIDDEN`.
- `loadGraph` существующего — возвращает graph; легаси (graph=null) — возвращает null, не throw.
- `list({includeLegacy: false})` скрывает записи где `graph === null`.
- `list({includeLegacy: true})` показывает всё.

### Task 2.2 — Integration tests for saveGraph / loadGraph / list

**Files (new):**
- `platform-app/src/server/routers/__tests__/workflow.graph.test.ts`

**Actions — 6 тест-кейсов:**
1. `saveGraph` creates new workflow with `graph` non-null.
2. `saveGraph` with `workflowId` updates existing.
3. `saveGraph` other workspace → FORBIDDEN.
4. `loadGraph` returns graph for graph-workflow.
5. `loadGraph` returns `graph: null` for legacy workflow (without throwing).
6. `list({includeLegacy: false})` excludes legacy; with `includeLegacy: true` includes them.

**Mocking pattern:** по образцу существующих `__tests__/project.saveState.test.ts` — фейковый ctx с mock prisma, mock authz, mock `ctx.user`.

**Commit:** `feat(phase-02/wave-2): workflowRouter saveGraph/loadGraph + legacy-filter list`

---

## Wave 3 — Zustand store

### Task 3.1 — Store types + slices

**Files (new):**
- `platform-app/src/store/workflow/types.ts` — `WorkflowStore` interface (composition of slices).
- `platform-app/src/store/workflow/createGraphSlice.ts` — `nodes: WorkflowNode[]`, `edges: WorkflowEdge[]`, actions: `setGraph`, `addNode(type, position)`, `updateNodePosition(id, position)`, `updateNodeParams(id, patch)`, `removeNode(id)`, `connect({source, sourceHandle, target, targetHandle})`, `disconnect(edgeId)`, `serialize(): WorkflowGraph`, `hydrate(graph: WorkflowGraph)`.
- `platform-app/src/store/workflow/createViewportSlice.ts` — `viewport: { x, y, zoom }`, action `setViewport(vp)`.
- `platform-app/src/store/workflow/createRunStateSlice.ts` — stub: `runState: Record<string, 'idle'|'running'|'done'|'error'>` (используется placeholder'ом для Phase 4), single action `setNodeRunState(id, state)` с default idle. Нужен сейчас, чтобы UI не падал при ссылках.
- `platform-app/src/store/workflow/useWorkflowStore.ts` — `create<WorkflowStore>(...)` композиция.

**`addNode(type, position)` должен:**
- generate ID через `crypto.randomUUID()` (доступно в browser).
- читать `defaultParams` из `NODE_REGISTRY[type]`.
- пушить node в state, триггерить dirty flag (для auto-save).

**`connect(...)` должен:**
- generate edge ID.
- пушить edge; dirty flag.
- **НЕ валидирует** типы портов — это Phase 3 (`isValidConnection` prop у ReactFlow).

### Task 3.2 — Unit tests for slices

**Files (new):**
- `platform-app/src/store/workflow/__tests__/graphSlice.test.ts`

**AC (5 тест-кейсов):**
1. `addNode("imageInput", {x:0,y:0})` → `nodes.length === 1`, node имеет `defaultParams` из registry.
2. `connect(...)` → `edges.length === 1` с корректными handles.
3. `removeNode(id)` → node исчезает + все edges его трогающие тоже (cascade).
4. `serialize()` возвращает `{ version: 1, nodes: [...], edges: [...] }`, валидирует через `workflowGraphSchema`.
5. `hydrate(graph)` сбрасывает nodes/edges и заменяет.

**Commit:** `feat(phase-02/wave-3): useWorkflowStore with graph/viewport/runState slices`

---

## Wave 4 — Pages + xyflow shell

### Task 4.1 — Page routes

**Important note:** `WorkspaceProvider` хранит `currentWorkspace` в React Context + localStorage (**client-only**). Значит `workspaceId` доступен **только на клиенте**. Все три страницы — client components (`"use client"`) и читают workspace через `useWorkspace()` hook.

**Files (new):**
- `platform-app/src/app/workflows/page.tsx` — `"use client"`, компонент вызывает `useWorkspace()` → `workspaceId`, затем `trpc.workflow.list.useQuery({ workspaceId, includeLegacy: false })`. Показывает skeleton до загрузки workspace, рендерит grid из `<Card>` с name/description/updatedAt + `<Link href={"/workflows/"+id}>`. «Создать» → `<Link href="/workflows/new">`. Если нет workspace → показать `<WorkspaceOnboarding />` (существует).
- `platform-app/src/app/workflows/new/page.tsx` — `"use client"`. Читает `searchParams.preset` через `useSearchParams()` (log-only stub per D-12). При mount + `workspaceId` доступен — вызывает `trpc.workflow.saveGraph.useMutation({ onSuccess: ({id}) => router.replace("/workflows/"+id) })` с `{ name: "Новый workflow", graph: emptyWorkflowGraph() }`. Показывает «Создаём workflow…» spinner.
- `platform-app/src/app/workflows/[id]/page.tsx` — `"use client"` тонкий wrapper: передаёт `params.id` в `<WorkflowEditorShell workflowId={params.id} />`. `WorkflowEditorShell` сам управляет loading/error через `trpc.workflow.loadGraph.useQuery`.

**Pattern source:** подход с `useWorkspace()` + `trpc.X.useQuery` — посмотреть `src/app/editor/[id]/page.tsx` или `src/app/projects/page.tsx` для шаблона.

### Task 4.2 — WorkflowEditorShell (client wrapper with dynamic import)

**Files (new):**
- `platform-app/src/components/workflows/WorkflowEditorShell.tsx` — `"use client"`. Использует `next/dynamic(() => import("./WorkflowEditor"), { ssr: false, loading: () => <EditorSkeleton /> })`. Внутри:
  - `trpc.workflow.loadGraph.useQuery({ id: workflowId })` → при success передаёт `graph` в `<WorkflowEditor>`.
  - Loading/error UI.

**Critical (D-13):** даже если родитель (page.tsx) — уже client component, паттерн `dynamic(..., {ssr:false})` всё равно рекомендуется в отдельном wrapper-файле чтобы обеспечить чистый code-split и избежать eager-bundle xyflow в главном chunk'е. Это соответствует рекомендации `xyflow/react-flow-example-apps/reactflow-nextjs`.

### Task 4.3 — WorkflowEditor (xyflow canvas skeleton)

**Files (new):**
- `platform-app/src/components/workflows/WorkflowEditor.tsx` — импортирует `@xyflow/react` + `@xyflow/react/dist/style.css`. Обёртка:
  ```
  <ReactFlowProvider>
    <div className="h-full w-full flex">
      <NodePalette />  // Wave 5
      <div className="flex-1">
        <NodeTopbar name={...} />  // Wave 5
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={...} onEdgesChange={...}
          onConnect={...}
          onMove={setViewport}
          defaultViewport={viewport}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  </ReactFlowProvider>
  ```
- Подписка на `useWorkflowStore`. `nodeTypes` map — пока stub'ом (см. Wave 5 — 4 компонента).
- При mount — `trpc.workflow.loadGraph.useQuery({ id: workflowId })` → `hydrate(graph)`.
- Обработка loading/error states (простой skeleton + error banner).

**AC после Wave 4:**
- `next build` проходит.
- `pnpm dev` → навигация `/workflows` показывает список; `/workflows/new` редиректит на свежесозданный; `/workflows/<id>` показывает xyflow с пустым canvas, Background, Controls, MiniMap.
- В console — нет hydration warnings (это ключевой pass-gate для R-01).

**Commit:** `feat(phase-02/wave-4): workflow pages + xyflow editor shell`

---

## Wave 5 — Components + auto-save

### Task 5.1 — Placeholder node components

**Files (new):**
- `platform-app/src/components/workflows/nodes/ImageInputNode.tsx`
- `platform-app/src/components/workflows/nodes/RemoveBackgroundNode.tsx`
- `platform-app/src/components/workflows/nodes/AddReflectionNode.tsx`
- `platform-app/src/components/workflows/nodes/AssetOutputNode.tsx`
- `platform-app/src/components/workflows/nodes/index.ts` — экспорт `nodeTypes` map для ReactFlow.

**AC (per node):**
- Функциональный React компонент с props `NodeProps<WorkflowNode>`.
- Рендерит простую карточку: `<div className="rounded border bg-white p-2 text-sm">{displayName из NODE_REGISTRY}</div>`.
- Handles рендерятся из `NODE_REGISTRY[type].inputs/outputs` — `<Handle type="target" position={Position.Left} id="image-in" />` и т.п.
- Тип порта через `data-port-type` атрибут (для Phase 3 валидации) — но без visual styling сейчас.

### Task 5.2 — NodePalette (sidebar drag source)

**Files (new):**
- `platform-app/src/components/workflows/NodePalette.tsx`

**AC:**
- Sidebar 240px шириной, `overflow-y-auto`.
- Группирует `NODE_REGISTRY` по `category` (input / ai / output).
- Каждая строка — `<div draggable onDragStart={...}>{displayName}</div>`.
- `onDragStart` устанавливает `dataTransfer.setData("application/reactflow", nodeType)` + `dataTransfer.effectAllowed = "move"`.
- В `WorkflowEditor` — на `ReactFlow`: handlers `onDragOver` (preventDefault), `onDrop` → читает `dataTransfer.getData("application/reactflow")`, считает `screenToFlowPosition`, вызывает `useWorkflowStore.getState().addNode(type, position)`.

### Task 5.3 — NodeTopbar

**Files (new):**
- `platform-app/src/components/workflows/NodeTopbar.tsx`

**AC:**
- Горизонтальная полоса сверху: название workflow (editable text — onChange через `updateName` mutation/store), кнопки `Save` (force-save), `Run` (**disabled with tooltip "Доступно в следующей фазе"**).
- `Save` manually вызывает `useWorkflowAutoSave.flushNow()`.

### Task 5.4 — Auto-save hook

**Files (new):**
- `platform-app/src/hooks/workflow/useWorkflowAutoSave.ts`

**AC:**
- Хук принимает `workflowId: string` и `workspaceId: string`.
- Подписывается на `useWorkflowStore` через selector по nodes/edges/name → debounced (2000ms) `trpc.workflow.saveGraph.mutate({ workflowId, workspaceId, name, graph })`.
- При `document.visibilityState === 'hidden'` или `beforeunload` — вызывает `flushNow()` (синхронный, использует `fetch(..., { keepalive: true })` или `navigator.sendBeacon` для надёжной доставки при закрытии вкладки).
- Returns: `{ flushNow, saveStatus: 'idle' | 'saving' | 'saved' | 'error' }`.
- Ошибки → toast (существующий `sonner` или что есть в codebase — проверить).

### Task 5.5 — Unit tests for auto-save hook

**Files (new):**
- `platform-app/src/hooks/workflow/__tests__/useWorkflowAutoSave.test.ts`

**AC (3 тест-кейса):**
1. После 2s debounce → trpc mutation вызывается ровно один раз.
2. Несколько быстрых edits в пределах 2s → ровно одна mutation в конце.
3. `flushNow()` вызывает mutation немедленно, bypassing debounce.

Используется fake timers (vi.useFakeTimers) + mock tRPC client.

**Commit:** `feat(phase-02/wave-5): placeholder nodes + palette + topbar + auto-save`

---

## Wave 6 — Verification

### Task 6.1 — Automated gates

**Actions (sequential):**
1. `cd platform-app && npx prisma generate` — schema не меняли, но sanity check.
2. `npx tsc --noEmit` → 0 errors.
3. `npx vitest run` → все тесты проходят, новые 17 штук (3 schema + 6 router + 5 slice + 3 autosave) добавлены.
4. `pnpm lint` → 0 errors (warnings допустимы, если были до Phase 2).
5. `pnpm build` (next build) → проходит без hydration/SSR warnings о xyflow.

### Task 6.2 — Manual smoke (оставить чек-лист в SUMMARY)

**Manual sanity (10 мин):**
1. `pnpm dev`, open `http://localhost:3000/workflows`.
2. Create new → redirect на `/workflows/<id>`.
3. Drag `ImageInput` из palette на canvas → appears.
4. Соединить `ImageInput.image-out` → `RemoveBackground.image-in` → edge появляется.
5. Reload → nodes и edges на месте.
6. Open чат в `/editor/[projectId]` → legacy `workflowRouter.interpretAndExecute` работает как раньше (не сломан).
7. В `/workflows` нет legacy workflows (если есть workspace с legacy graph=null, он не показан).

### Task 6.3 — SUMMARY + docs

**Files (new):**
- `.planning/phases/02-editor-canvas-trpc-crud/02-SUMMARY.md` — deliverables, decisions, deviations, verify results, затем update STATE.md.

**Commit (final):** `docs(phase-02): add SUMMARY — editor canvas + tRPC CRUD verified green`

---

## Goal-backward verification (plan-checker sanity)

| Success criterion (CONTEXT) | Wave / Task | Verify |
|---|---|---|
| `/workflows` видно list | Wave 4 / Task 4.1 | Manual 6.2 step 1 |
| Create → redirect на `/workflows/<id>` | Wave 4 / Task 4.1 | Manual step 2 |
| Drag node → appears | Wave 5 / Task 5.2 | Manual step 3 |
| Connect nodes → edge | Wave 5 (xyflow default onConnect) | Manual step 4 |
| Reload → граф восстанавливается | Wave 2 + Wave 5 (autosave + loadGraph) | Manual step 5 |
| Legacy чат не сломан | Wave 2 (не трогали legacy procedures) | Manual step 6 |
| На `/workflows` нет legacy | Wave 2 (list filter) | Router test 6 + manual 7 |

Каждое требование покрыто явным test/manual check. Нет сироткой AC без verification.

## Dependencies resolved

- DB schema: `AIWorkflow.graph` — есть.
- Server types `NODE_REGISTRY`: есть.
- REST endpoint `/api/workflow/execute-node`: есть (будет использован Phase 4).
- AI actions `remove_background`, `add_reflection`: есть (будут использованы Phase 4).

## Definition of Done Phase 2

Все 6 waves закоммичены как отдельные коммиты. `02-SUMMARY.md` написан. Goal-backward verification прошёл 100%. Ветка `ai-workflows-creative` запушена на origin. Phase 3 (Inspector) может стартовать.
