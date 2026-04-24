# Research: Архитектура Workflow Automation (v1.0)

> Цель: определить архитектурные решения для интеграции node-based workflow-редактора в существующий `platform-app` (Next.js 16 / tRPC 11 / Prisma 6 / Zustand / Konva). Все технологические решения зафиксированы в `STACK.md` (xyflow 12, graphology-dag, Bria models, Json-column storage); здесь — как они встают поверх существующей архитектуры, где границы client/server, какие TS-контракты, какие миграции БД и какой build-order фаз.

## Summary

- **Runtime: hybrid** — React Flow graph в Zustand store на клиенте; client оркестрирует волны (generations) из `topologicalGenerations`; I/O-ноды и AI-ноды вызывают серверные tRPC-процедуры, которые дёргают существующие `executeAction` и `ai-providers`.
- **State: новый Zustand-store `useWorkflowStore`** (по паттерну существующих канвасных слайсов). Хранит `{ nodes, edges, viewport, runState }`. Сериализуется в `AIWorkflow.graph: Json` на БД.
- **DB: additive migration** — новая nullable колонка `AIWorkflow.graph: Json?`. Старый `steps` не трогаем. Новая таблица `WorkflowRun` появится в v1.1 (сейчас за v1.0 в scope не идёт — run-history хранится in-memory в Zustand).
- **Executor: ~50 LoC** на базе `graphology-dag.topologicalGenerations()`. Параллель внутри поколения через `Promise.all`. Последовательно между поколениями.
- **tRPC: расширяем `workflowRouter`** тремя новыми процедурами: `saveGraph`, `loadGraph`, `executeGraphNode` (per-node execution, клиент зовёт подряд). Существующие CRUD (`list/create/update/delete`) расширяются — включают и `graph`.
- **Новые action handlers** в `executeAction.ts`: `remove_background` и `add_reflection` — по паттерну существующих 9 case-веток. Переиспользуют `ai-providers.callReplicate`, `ssrfGuard.assertUrlIsSafe`, `asset` router для сохранения.
- **Build order:** 6 фаз (DB+router → editor canvas → node palette → server actions → executor → preset "Product Reflection" UX).

---

## Runtime: Client vs Server vs Hybrid

### Решение: Hybrid — client orchestrates, server executes heavy operations

**Client-side (в браузере):**
- React Flow canvas (рендер нод, drag-drop, zoom/pan).
- `useWorkflowStore` — nodes, edges, viewport, runState, params.
- Executor oркестратор — `topologicalGenerations()` → per-generation обход → per-node dispatch.
- Для **client-executable нод** (`ImageInput` — pick/upload локально, `AssetOutput` — вызов asset-router один раз) — прямой async-код.
- Для **server-executable нод** (`BackgroundRemove`, `AddReflectionAI`) — tRPC-вызов `workflow.executeGraphNode({ nodeType, params })`.

**Server-side:**
- Stateless endpoints: executeGraphNode → существующий `executeAction` с новыми case-ветками.
- AI провайдеры, Replicate polling, S3-upload — всё остаётся на сервере (где ключи и проверки безопасности).

**Почему hybrid, а не чистый server-executor:**
- Yandex Cloud Serverless Containers — 300s maxDuration для AI-route и ~60s для обычных. Единый серверный executor, проходящий все 4 ноды в одном запросе, — рискует уложиться в таймаут только впритык (3 нод × 5-10s = 15-30s, но холодный старт Replicate может съесть 30-60s — остаётся мало буфера).
- При per-node executeGraphNode каждая нода = отдельный запрос, каждый со своим 300s бюджетом. Таймауты решаются по отдельности.
- Client видит per-node progress в real-time без SSE/WebSocket (которые проблемны в Yandex Cloud — см. PITFALLS.md).
- Упрощение: не нужен worker pool / queue на сервере.

**Почему не чистый client-executor:**
- API-ключи провайдеров (Replicate, Gemini) секретны — не экспозим на клиент.
- SSRF-guard, auth-guards, rate-limit — серверная ответственность.
- Результаты должны проходить через S3 (загружать с Replicate на сервер, потом в наш Yandex S3).

### Как стримится progress к клиенту

**Решение v1.0: no streaming — синхронный per-node request.** Каждый `executeGraphNode` возвращает результат целиком. UI показывает per-node `running` с момента вызова до ответа. Это не real-time progress внутри ноды (нет прогресс-бара 0%...100% для Replicate polling), но per-node state достаточен для MVP.

**Альтернативы рассмотренные и отвергнутые:**
- SSE (Server-Sent Events) — Yandex API Gateway буферизует ответы (до ~1MB), стримы работают ненадёжно.
- WebSocket subscriptions в tRPC — Yandex Serverless не поддерживает входящие WS connections.
- Polling `WorkflowRun` таблицы — overkill для v1.0, вводится в v2.

### Отмена и тайм-ауты

**v1.0:** пользователь закрыл вкладку → tRPC request cancelled на клиенте, но на сервере продолжает исполняться до 300s. Replicate-запрос пройдёт до конца (biling). Это приемлемо для MVP.

**v2:** AbortController через tRPC + пропуск abort-сигнала в ReplicateProvider → `replicate.cancel(predictionId)`.

---

## State Management

### Новый store: `src/store/workflow/useWorkflowStore.ts`

По паттерну `src/store/canvasStore.ts` + composed slices (`createLayerSlice`, `createHistorySlice`, …). В v1.0 — один плоский store без слайсов (сплитуем по мере роста).

```ts
// src/store/workflow/useWorkflowStore.ts (контракт, не код)
import { create } from "zustand";
import type { Edge, Node, Viewport } from "@xyflow/react";
import type { NodeData, WorkflowNodeType } from "./types";

export type AppNode = Node<NodeData, WorkflowNodeType>;

export interface NodeRunState {
  status: "idle" | "running" | "done" | "error" | "blocked";
  result?: unknown;          // дискриминированный по nodeType
  thumbnailUrl?: string;     // для preview
  error?: { message: string; code?: string };
  startedAt?: number;
  finishedAt?: number;
}

export interface WorkflowState {
  /* identity */
  workflowId: string | null;       // null до первого save (draft mode)
  workspaceId: string;
  name: string;
  description: string;
  isTemplate: boolean;

  /* graph */
  nodes: AppNode[];
  edges: Edge[];
  viewport: Viewport;

  /* runtime */
  runState: Record<string, NodeRunState>;  // keyed by node.id
  running: boolean;                         // any node currently running
  runStartedAt: number | null;

  /* actions */
  setNodes: (nodes: AppNode[]) => void;
  setEdges: (edges: Edge[]) => void;
  setViewport: (vp: Viewport) => void;
  updateNodeParams: (nodeId: string, params: Partial<NodeData["params"]>) => void;
  addNode: (type: WorkflowNodeType, position: { x: number; y: number }) => void;
  removeNode: (nodeId: string) => void;
  connect: (edge: Edge) => void;
  disconnect: (edgeId: string) => void;

  /* run */
  runAll: () => Promise<void>;
  resetRun: () => void;

  /* persistence */
  saveToServer: () => Promise<void>;
  loadFromServer: (workflowId: string) => Promise<void>;
  resetToPreset: (presetKey: string) => void;
}
```

### Undo/Redo

**v1.0: не включаем.** (см. FEATURES.md open question 5). При наличии времени в конце фазы — добавить по паттерну `createHistorySlice.ts` из canvas store. v1.1 — отдельным patch'ем.

### Persistence

**Save triggers:**
- Debounced auto-save каждые 2с при ≥1 изменении и workflowId !== null.
- Manual save: кнопка в topbar (force-save).
- При переходе со страницы `beforeunload` — тоже force-save.

**Load triggers:**
- При открытии `/workflows/[id]` — `loadFromServer(id)`.
- При `/workflows/new?preset=...` — `resetToPreset(presetKey)` (никакого server-call).

---

## Node Contract

### TypeScript-контракт

```ts
// src/server/workflow/types.ts (контракт, shared между client и server)

export type WorkflowNodeType =
  | "imageInput"
  | "removeBackground"
  | "addReflection"
  | "assetOutput";

export type PortType = "image" | "mask" | "text" | "number" | "any";

export interface Port {
  id: string;              // "image-out", "image-in"
  label: string;            // human-readable
  type: PortType;
  required?: boolean;       // for inputs
}

// Discriminated union — каждому nodeType — свой NodeData
export type NodeData =
  | {
      kind: "imageInput";
      params: {
        assetId?: string;          // reference в нашу Asset library
        sourceUrl?: string;        // data: или https:// (только Asset Library sources)
      };
    }
  | {
      kind: "removeBackground";
      params: {
        model: "bria-product-cutout" | "rembg" | "bg-remover-851";
        threshold?: number;        // 0..1, only for 851-labs
      };
    }
  | {
      kind: "addReflection";
      params: {
        model: "bria-product-shadow" | "flux-kontext-pro";
        intensity?: number;        // 0..1
        style?: "mirror" | "soft" | "floor";
      };
    }
  | {
      kind: "assetOutput";
      params: {
        assetName?: string;        // как назвать новый asset
        format: "png";
      };
    };

// Node registry — single source of truth для палитры и валидатора
export interface NodeDefinition<T extends WorkflowNodeType = WorkflowNodeType> {
  type: T;
  displayName: string;        // русский
  description: string;
  icon: string;               // Lucide icon name
  category: "input" | "transform" | "ai" | "composite" | "output";
  inputs: Port[];             // каждая — `targetHandle`
  outputs: Port[];            // каждая — `sourceHandle`
  defaultParams: Extract<NodeData, { kind: T }>["params"];

  /** Where executes. Если "server" — executeGraphNode tRPC call; если "client" — локальная функция. */
  execute:
    | { kind: "client"; handler: "imageInput" | "assetOutput" }
    | { kind: "server"; actionId: string };   // actionId из executeAction.ts
}

export const NODE_REGISTRY: Record<WorkflowNodeType, NodeDefinition> = {
  imageInput: {
    type: "imageInput",
    displayName: "Изображение",
    description: "Исходное изображение продукта",
    icon: "image",
    category: "input",
    inputs: [],
    outputs: [{ id: "image-out", label: "Image", type: "image" }],
    defaultParams: {},
    execute: { kind: "client", handler: "imageInput" },
  },
  removeBackground: {
    type: "removeBackground",
    displayName: "Удалить фон",
    description: "AI-удаление фона (PNG с прозрачностью)",
    icon: "scissors",
    category: "ai",
    inputs: [{ id: "image-in", label: "Image", type: "image", required: true }],
    outputs: [{ id: "image-out", label: "RGBA Image", type: "image" }],
    defaultParams: { model: "bria-product-cutout" },
    execute: { kind: "server", actionId: "remove_background" },
  },
  addReflection: {
    type: "addReflection",
    displayName: "Добавить отражение",
    description: "AI-добавление реалистичного отражения/тени",
    icon: "flip-vertical",
    category: "ai",
    inputs: [{ id: "image-in", label: "RGBA Image", type: "image", required: true }],
    outputs: [{ id: "image-out", label: "RGBA Image", type: "image" }],
    defaultParams: { model: "bria-product-shadow", intensity: 0.7, style: "mirror" },
    execute: { kind: "server", actionId: "add_reflection" },
  },
  assetOutput: {
    type: "assetOutput",
    displayName: "Сохранить в Assets",
    description: "Сохраняет результат в Asset Library workspace",
    icon: "save",
    category: "output",
    inputs: [{ id: "image-in", label: "Image", type: "image", required: true }],
    outputs: [],
    defaultParams: { format: "png" },
    execute: { kind: "client", handler: "assetOutput" },
  },
};
```

### Lifecycle ноды

```
1. User drag'ает ноду из палитры → useWorkflowStore.addNode(type, position).
2. User соединяет ноды → onConnect → useWorkflowStore.connect(edge).
   Валидация: isValidConnection(conn) проверяет совпадение port.type.
3. User редактирует params в inspector → updateNodeParams.
4. User жмёт Run → useWorkflowStore.runAll():
     a) Build graphology DirectedGraph из nodes + edges.
     b) hasCycle() → если true, показать error.
     c) topologicalGenerations() → Generation[].
     d) For each generation (sequentially):
          For each node in generation (Promise.all):
            - resolveInputs: {portId: upstream-result}.
            - если execute.kind==="client": await clientHandlers[handler]().
            - если execute.kind==="server": await trpc.workflow.executeGraphNode.mutate({...}).
            - update runState[nodeId].
5. Finished: runState[outputNodeId] содержит asset info. UI показывает thumbnail + link.
```

### Валидация совместимости портов

- **Клиент (xyflow):** `isValidConnection(conn)` возвращает true только если `sourcePort.type === targetPort.type` (или один из них `"any"`).
- **Сервер (executeGraphNode):** доп-валидация: Zod-схема `input` ноды — проверка, что переданный upstream результат имеет ожидаемый shape (e.g. `{ imageUrl: string }` для image-ports).

---

## DB Schema Changes

### Prisma diff

```prisma
// prisma/schema.prisma (только изменения)

model AIWorkflow {
  id          String  @id @default(cuid())
  name        String
  description String  @default("")
  steps       Json    // legacy: AIStep[] — линейная последовательность LLM-agent actions.
  graph       Json?   // NEW: WorkflowGraph — node-based редактор (v1.0+). Nullable для backward compat.
  isTemplate  Boolean @default(false)

  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  workspaceId String
  createdBy   User      @relation("WorkflowCreator", fields: [createdById], references: [id])
  createdById String

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([workspaceId])
}
```

### Миграция

```
npx prisma migrate dev --name add-workflow-graph
```

**Полностью additive:** существующие AIWorkflow records не модифицируются, колонка `graph` = NULL. Старые workflows продолжают работать в `interpretAndExecute` (который читает `steps`). Новые — в `executeGraph` (который читает `graph`).

**Rollback-safe:** откат миграции = `DROP COLUMN graph`. Не ломает существующие queries.

### Когда вводится `WorkflowRun` таблица

**Не в v1.0.** В v1.0 run-history in-memory в Zustand (пропадает при reload). Это приемлемо для MVP (пользователь просто re-runs).

В v1.1 / v2 — добавляем:
```prisma
model WorkflowRun {
  id          String   @id @default(cuid())
  workflowId  String
  workflow    AIWorkflow @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  status      String   // "pending" | "running" | "succeeded" | "failed"
  trace       Json     // per-node timings + results summary
  costUnits   Float    @default(0)
  startedAt   DateTime @default(now())
  finishedAt  DateTime?

  @@index([workflowId])
  @@index([userId])
}
```

---

## Execution Model

### Client-side orchestrator (новый модуль)

**Файл:** `src/store/workflow/executor.ts` (client-only).

```ts
// Контракт (pseudo)
import Graph from "graphology";
import { hasCycle, topologicalGenerations } from "graphology-dag";
import { NODE_REGISTRY } from "@/server/workflow/types";
import { trpc } from "@/lib/trpc";

export async function runWorkflow(
  nodes: AppNode[],
  edges: Edge[],
  onNodeStart: (id: string) => void,
  onNodeDone: (id: string, result: unknown) => void,
  onNodeError: (id: string, err: Error) => void,
): Promise<{ outputNodeId: string; result: unknown }> {
  // 1. Build graphology graph
  const g = new Graph({ type: "directed" });
  for (const n of nodes) g.addNode(n.id, { node: n });
  for (const e of edges) g.addEdge(e.source, e.target, { edge: e });

  // 2. Cycle check
  if (hasCycle(g)) throw new Error("Граф содержит цикл. Удалите зацикленные соединения.");

  // 3. Topological generations
  const generations = topologicalGenerations(g);

  // 4. Execute wave-by-wave
  const nodeResults = new Map<string, unknown>();
  for (const gen of generations) {
    await Promise.all(
      gen.map(async (nodeId) => {
        const node = nodes.find((n) => n.id === nodeId)!;
        const def = NODE_REGISTRY[node.type!];
        onNodeStart(nodeId);
        try {
          // Resolve inputs from edges
          const inputs = resolveInputs(nodeId, edges, nodeResults);
          // Dispatch
          const result = def.execute.kind === "client"
            ? await clientHandlers[def.execute.handler](inputs, node.data.params)
            : await trpc.workflow.executeGraphNode.mutate({
                actionId: def.execute.actionId,
                params: node.data.params,
                inputs,
              });
          nodeResults.set(nodeId, result);
          onNodeDone(nodeId, result);
        } catch (err) {
          onNodeError(nodeId, err as Error);
          throw err; // halt wave → halt workflow
        }
      }),
    );
  }

  // 5. Find terminal "output" node
  const outputNode = nodes.find((n) => n.type === "assetOutput");
  return { outputNodeId: outputNode!.id, result: nodeResults.get(outputNode!.id) };
}

function resolveInputs(
  nodeId: string,
  edges: Edge[],
  results: Map<string, unknown>,
): Record<string, unknown> {
  const inbound = edges.filter((e) => e.target === nodeId);
  const inputs: Record<string, unknown> = {};
  for (const e of inbound) {
    inputs[e.targetHandle!] = results.get(e.source);
  }
  return inputs;
}
```

### Server-side action handlers (расширение `executeAction.ts`)

```ts
// src/server/agent/executeAction.ts — добавить case-ветки

switch (actionId) {
  // ...existing 9 actions...

  case "remove_background": {
    // inputs: { "image-in": { imageUrl } }
    // params: { model: "bria-product-cutout" | ... }
    const imageUrl = (inputs["image-in"] as { imageUrl: string }).imageUrl;
    await assertUrlIsSafe(imageUrl); // SSRF guard
    const modelId = params.model ?? "bria-product-cutout";
    // Каскад с fallback (try/catch по порядку)
    const resultUrl = await tryWithFallback([
      () => callReplicate("bria/product-cutout", { image_url: imageUrl }),
      () => callReplicate("cjwbw/rembg", { image: imageUrl }),
      () => callReplicate("851-labs/background-remover", { image: imageUrl }),
    ]);
    // Сохранить в S3 (чтобы не зависеть от expiring Replicate URL)
    const s3Url = await uploadFromExternalUrl(resultUrl, { workspaceId: ctx.workspaceId });
    return { success: true, type: "image", imageUrl: s3Url };
  }

  case "add_reflection": {
    const imageUrl = (inputs["image-in"] as { imageUrl: string }).imageUrl;
    await assertUrlIsSafe(imageUrl);
    const modelId = params.model ?? "bria-product-shadow";
    const resultUrl = await tryWithFallback([
      () => callReplicate("bria/product-shadow", {
        image_url: imageUrl,
        preserve_alpha: true,
        force_rmbg: false,
      }),
      () => callReplicate("black-forest-labs/flux-kontext-pro", {
        image: imageUrl,
        prompt: buildReflectionPrompt(params.style, params.intensity),
      }).then((url) => postProcessToTransparent(url)),
    ]);
    const s3Url = await uploadFromExternalUrl(resultUrl, { workspaceId: ctx.workspaceId });
    return { success: true, type: "image", imageUrl: s3Url };
  }

  // default unchanged
}
```

**tryWithFallback / uploadFromExternalUrl** — новые утилиты в `src/server/workflow/helpers.ts`. Логика понятна из контекста: first provider who returns non-throw wins; при success скачиваем image и пишем в наш S3 через существующий `@aws-sdk/client-s3`.

### tRPC процедуры (расширение `workflowRouter`)

```ts
// src/server/routers/workflow.ts — добавить

executeGraphNode: protectedProcedure
  .input(z.object({
    actionId: z.enum(["remove_background", "add_reflection"]),
    params: z.any(),       // Zod-validated per actionId внутри executeAction
    inputs: z.record(z.string(), z.any()),
    workspaceId: z.string(),
    workflowId: z.string().optional(),  // для cost tracking
  }))
  .mutation(async ({ ctx, input }) => {
    await assertWorkspaceAccess(ctx, input.workspaceId, "USER");
    const result = await executeAction(
      input.actionId,
      { ...input.params, _inputs: input.inputs },
      { userId: ctx.user.id, workspaceId: input.workspaceId, prisma: ctx.prisma },
    );
    return result;
  }),

saveGraph: protectedProcedure
  .input(z.object({
    workflowId: z.string().optional(),
    workspaceId: z.string(),
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    graph: z.any(),          // WorkflowGraph — validated по TS type
    isTemplate: z.boolean().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    await assertWorkspaceAccess(ctx, input.workspaceId, "CREATOR");
    if (input.workflowId) {
      // update
      const existing = await ctx.prisma.aIWorkflow.findUnique({ where: { id: input.workflowId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.prisma.aIWorkflow.update({
        where: { id: input.workflowId },
        data: { name: input.name, description: input.description, graph: input.graph },
      });
    } else {
      // create
      return ctx.prisma.aIWorkflow.create({
        data: {
          name: input.name,
          description: input.description ?? "",
          steps: [],           // legacy field — empty for graph-native workflows
          graph: input.graph,
          isTemplate: input.isTemplate ?? false,
          workspaceId: input.workspaceId,
          createdById: ctx.user.id,
        },
      });
    }
  }),

// `list`, `getById` — расширяем select, чтобы возвращать и graph.
```

---

## Security

- **`assertWorkspaceAccess`** на каждом tRPC endpoint — существующая функция.
- **`assertUrlIsSafe` (ssrfGuard)** применяется в `remove_background` / `add_reflection` перед внешним вызовом с URL пользователя.
- **CSP** (`next.config.ts`): `images.remotePatterns` уже разрешает `storage.yandexcloud.net`. Если output ноды возвращают временные Replicate URL до их прокси через S3 — добавить `replicate.delivery` в allowlist или (лучше) **всегда** проксировать через S3 (что и делает план).
- **Rate limits:** `checkRateLimit` из `src/lib/rateLimit.ts` — применить к `executeGraphNode` endpoint. Per-user quota на AI-ноды. Конкретные лимиты — в discussion-phase фазы runtime.
- **Cost tracking:** в `executeGraphNode` — по паттерну существующего `trackAgentCosts`: пишем `AIMessage` record с `model` + `costUnits` для учёта.

---

## Integration Points

### Модификации существующих файлов

| Файл | Что меняется |
|---|---|
| `prisma/schema.prisma` | +1 nullable column `AIWorkflow.graph: Json?`. |
| `src/server/routers/workflow.ts` | +3 процедуры (`executeGraphNode`, `saveGraph`, `loadGraph`); расширение `list`/`getById` (select graph). |
| `src/server/agent/executeAction.ts` | +2 case: `remove_background`, `add_reflection`. |
| `src/server/agent/types.ts` | +2 actionId constants. |
| `src/lib/ai-providers.ts` | Расширение `generateImage` для поддержки per-request `model` parameter для remove-bg и reflection. Добавить slugs: `bria/product-cutout`, `bria/product-shadow`, `black-forest-labs/flux-kontext-pro`, `851-labs/background-remover`. |
| `src/lib/ai-models.ts` | +4 entries. |
| `src/server/actionRegistry.ts` | **Не трогаем** — новые actionId нужны только executor'у, не LLM-агенту. |

### Новые файлы

| Файл | Назначение |
|---|---|
| `src/server/workflow/types.ts` | `WorkflowGraph`, `WorkflowNode`, `WorkflowEdge`, `NodeData` (shared TS). |
| `src/server/workflow/executor-server.ts` | (опционально v1.0) server-side executor если решим сделать «single tRPC запрос для всего графа» для простых случаев. По умолчанию — client executor, server только per-node. |
| `src/server/workflow/helpers.ts` | `tryWithFallback`, `uploadFromExternalUrl`, `buildReflectionPrompt`, `postProcessToTransparent`. |
| `src/store/workflow/useWorkflowStore.ts` | Zustand store. |
| `src/store/workflow/executor.ts` | Client-side orchestrator. |
| `src/store/workflow/clientHandlers.ts` | `imageInput`, `assetOutput` handlers. |
| `src/store/workflow/NODE_REGISTRY.ts` | Конcтанта (shared с сервером через re-export). |
| `src/components/workflows/WorkflowEditor.tsx` | React Flow canvas wrapper. |
| `src/components/workflows/NodePalette.tsx` | Sidebar со списком нод. |
| `src/components/workflows/NodeInspector.tsx` | Right panel с параметрами selected node. |
| `src/components/workflows/nodes/ImageInputNode.tsx` | Кастомная нода. |
| `src/components/workflows/nodes/RemoveBackgroundNode.tsx` | — |
| `src/components/workflows/nodes/AddReflectionNode.tsx` | — |
| `src/components/workflows/nodes/AssetOutputNode.tsx` | — |
| `src/components/workflows/RunButton.tsx` | Top-bar Run control с progress. |
| `src/app/workflows/page.tsx` | Список workflow + presets (SSR: project list, CSR: actions). |
| `src/app/workflows/new/page.tsx` | Create-new с optional `?preset=` query. |
| `src/app/workflows/[id]/page.tsx` | Редактор (dynamic import WorkflowEditor, ssr: false). |
| `src/server/workflow/presets/product-reflection.ts` | Pre-filled graph JSON для preset. |

### Переиспользуемые существующие сущности

| Сущность | Роль |
|---|---|
| `AIWorkflow` table + `workflowRouter` CRUD | Фундамент для save/load. |
| `executeAction` + `actionContext` | Каркас для server-side нод. |
| `ai-providers` + `callReplicate` | AI-провайдер слой. |
| `ssrfGuard` | Проверка входящих URL. |
| `asset` router + S3-presign | Сохранение output. |
| `assertWorkspaceAccess`, `assertProjectAccess` | Авторизация. |
| `trackAgentCosts` паттерн | Учёт расходов AI. |
| `AIMessage` record | Единица cost tracking. |

---

## Build Order (предлагаемые фазы)

Порядок минимизирует blocker'ы и позволяет каждой фазе закончиться работающим состоянием (можно остановиться после любой фазы — fallback на предыдущее рабочее состояние, не breaking).

### Phase 1: DB + AI Providers + Server actions (фундамент без UI)

**Goal:** Сервер умеет выполнять `remove_background` и `add_reflection` по tRPC-вызову; БД готова хранить graph.

**Deliverables:**
- Prisma migration: `AIWorkflow.graph: Json?`.
- `ai-models.ts`: +4 entries (bria-product-cutout, bria-product-shadow, flux-kontext-pro, bg-remover-851).
- `ai-providers.ts`: расширение под per-request `model` параметр.
- `workflow/helpers.ts`: tryWithFallback, uploadFromExternalUrl.
- `executeAction.ts`: +2 case.
- tRPC `workflow.executeGraphNode` endpoint.
- Интеграционный тест: curl-level вызов endpoint с mock image URL → получаем S3 URL результата.

**Why first:** без server actions клиент не сможет запустить никакие AI-ноды. Параллельно можно начинать Phase 2 (canvas каркас), когда schema fixed.

### Phase 2: Workflow Editor Canvas (UI без функциональности нод)

**Goal:** Можно открыть пустую страницу `/workflows/new`, видеть холст xyflow, drag-drop ноды из палитры, соединять их, save/load через tRPC.

**Deliverables:**
- `useWorkflowStore` Zustand store (без executor).
- `WorkflowEditor.tsx` + `NodePalette.tsx` + `NodeInspector.tsx`.
- Кастомные node components (4 штуки). Без runtime — просто visual.
- `/app/workflows/page.tsx` (list) + `/workflows/new` + `/workflows/[id]`.
- tRPC `saveGraph`, `loadGraph`.

### Phase 3: Node Registry + Client Handlers + Params Forms

**Goal:** Каждая нода умеет редактировать свои параметры в inspector; валидация соединений портов работает; client handlers (imageInput с pick-from-assets, assetOutput) готовы.

**Deliverables:**
- `NODE_REGISTRY` константа.
- Zod-схема params per node type.
- `NodeInspector` — автогенерация формы по Zod schema.
- `isValidConnection` в xyflow.
- `clientHandlers.ts`: imageInput (выбор из Asset library — уже есть Asset pickup UI в `components/editor/AssetLibraryModal.tsx`, переиспользуем), assetOutput (POST в `asset` router).

### Phase 4: Runtime / Executor / Run Button

**Goal:** Нажатие Run запускает граф, per-node progress visible, результат сохраняется в Assets.

**Deliverables:**
- `executor.ts` (graphology + client orchestrator).
- `RunButton.tsx` + per-node status UI.
- Cost tracking (AIMessage records из executeGraphNode).
- Error handling: blocked nodes при upstream fail.

### Phase 5: Preset "Product Reflection" + UX Polish

**Goal:** User может войти на `/workflows`, открыть preset "Product Reflection", загрузить свою картинку, нажать Run, получить PNG с отражением в Asset Library за ~30 секунд.

**Deliverables:**
- `presets/product-reflection.ts` — hardcoded pre-filled graph.
- UI card "Открыть Product Reflection" на `/workflows`.
- Демо-контент, тексты (RU), error-обработка.
- End-to-end тест: от открытия preset до появления asset в library.

### Phase 6: QA + Hardening (optional)

- Load testing: 5 конкурентных user-ов запускают workflow одновременно.
- Edge cases: cancelled tRPC, Replicate cold start 60s, большие изображения (>5MB).
- Перед демо / релизом.

---

## Open Questions

1. **Cost tracking unit.** В `AIMessage.costUnits` — один ли endpoint запись за весь workflow, или per-node? Рекомендация: **per-node**, чтобы можно было агрегировать по типу ноды (и увидеть какой провайдер съедает больше бюджета).

2. **Workflow name default.** Если user не задал — «Untitled workflow» / «Без названия» / auto-generated с timestamp? Дизайн-решение для Phase 2.

3. **Валидация workspace ownership для assetOutput.** Нужно убедиться, что `workspaceId` берётся из контекста workflow, а не params (чтобы пользователь не мог в своём graph'е записать asset в чужой workspace). Сервер-side check на save и execute.

4. **Paste-from-clipboard для ImageInput.** Nice-to-have. В v1.0 — опционально.

5. **Thumbnail generation** для ImageInput ноды при выборе asset. Переиспользовать существующие thumbnail endpoints из `asset` router? — check.

6. **Version field в `WorkflowGraph`.** Как мигрировать графы, если в v1.1 добавим новый параметр в `addReflection`? В `WorkflowGraph.version` — строковый или integer? Рекомендация: semver-подобный `"1.0"` — легче читается в БД и в JSON.

7. **`AIWorkflow.steps` deprecation timeline.** Колонка остаётся для legacy `interpretAndExecute`. Её не трогаем, но в коммент добавить: «// DEPRECATED: use `graph` for new node-based workflows». Формальное удаление — когда отпадёт нужда поддержки чат-агента workflow.
