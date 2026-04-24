# Research: Stack для Workflow Automation (v1.0 — Product Reflection Scenario)

> Цель: подобрать технологический стек для визуального редактора сценариев автоматизации (ComfyUI-like) поверх существующего `platform-app` (Next.js 16.1.6 + React 19.2.3 + tRPC 11 + Prisma 6.19 + Konva + Zustand 5). Первый продуктовый сценарий: `image-input → remove-background → add-reflection → output (PNG+alpha)`.

## Summary

- **Node-editor:** `@xyflow/react` **v12.10.2** — единственный зрелый MIT-вариант с реальной поддержкой React 19 и SSG/SSR; tldraw отпадает по лицензии (коммерческий ключ ~$6k/год), rete.js — нишевая альтернатива без критического преимущества.
- **Remove-background:** primary — `bria/product-cutout` на Replicate ($0.04/img, commercial-safe, нативный alpha, лицензированный тренинг-корпус); fallback — уже интегрированный `cjwbw/rembg` ($0.002/img); сверх-дешёвый третий уровень — `851-labs/background-remover` ($0.00043/img, ~2 s).
- **Add-reflection:** primary — `bria/product-shadow` на Replicate — API построен **именно** под «добавить консистентную тень/отражение к product-cutout», принимает RGBA, флаг `preserve_alpha: true` сохраняет полупрозрачность; fallback — `black-forest-labs/flux-kontext-pro` с prompt engineering и постобработкой через BG-removal.
- **Gemini 2.5 Flash Image ("Nano Banana") как fallback для remove-bg — ❗ нельзя:** Nano Banana **не поддерживает alpha-канал** при генерации и редактировании. Обходной путь `jide/nano-banana-2-transparent` ($0.010/run) — триангулярное маттирование через 2× вызова, экономически хуже rembg в 5× и без нужды.
- **DAG runtime:** кастомный executor поверх `graphology` + `graphology-dag` (MIT, 108K DL/week) — `topologicalGenerations()` даёт волны параллельно-исполнимых нод; не тащить Temporal/Airflow/Bull для v1.0.
- **Storage:** добавить новую nullable колонку `AIWorkflow.graph: Json?` в формате React Flow state (`{ nodes: [...], edges: [...], viewport }`) с per-node `data.nodeType` + `data.params` — backward-compatible с легаси `steps: Json`.

---

## Node-editor UI

### Рекомендация: `@xyflow/react` **v12.10.2** (MIT, React 19.2 compat)

**Почему:**

- **Лицензия MIT** — единственный по-настоящему open source вариант в шорт-листе. Для SaaS-платформы это критично (см. блок про tldraw).
- **Совместимость с React 19.2 и Next.js 16.1** — подтверждена:
  - `peerDependencies.react: ">=17"` в [npm metadata 12.10.2](https://www.npmjs.com/package/@xyflow/react); команда xyflow [официально обновила UI Components под React 19 + Tailwind CSS 4](https://reactflow.dev/whats-new/2025-10-28).
  - В issues и [Next.js интеграциях](https://reactflow.dev/learn/advanced-use/ssr-ssg-configuration) нет открытых проблем для R19.
  - **SSG/SSR поддержка** с 12.0 — `node.width`/`node.height` можно задать явно, тогда нода рендерится на сервере; edges/handles добавляются при гидрации. Для нашего кейса этого более чем достаточно: интерактивный редактор всё равно будет клиентским, а public-preview страницы (если когда-то понадобятся) будут SSG.
- **Зрелость:** 36k★ на GitHub, активные релизы каждые 1-3 месяца, последний 12.10.2 — 27 марта 2026.
- **API для кастомных нод с портами-сокетами** — ровно то, что нужно для ComfyUI-стиля:
  - `nodeTypes` — маппинг `{ imageInput: ImageInputNode, removeBg: RemoveBgNode, ... }`.
  - Компоненты `<Handle type="source" position={Position.Right} id="output" />` / `type="target"` — эквивалент input/output слотов ComfyUI. Можно типизировать сокеты (`image`, `mask`, `text`) через валидатор в `isValidConnection`.
  - Встроенные `useNodesState` / `useEdgesState` / `useReactFlow().toObject()` — сериализация/десериализация графа «из коробки».
  - `MiniMap`, `Controls`, `Background` — готовые компоненты.
- **Коллаборация (на будущее):** React Flow legally-clean-совместим с Yjs/Liveblocks (paid); не блокируется лицензией.
- **Bundle size:** по [bundlephobia](https://bundlephobia.com/package/@xyflow/react) `@xyflow/react@12` ≈ 48 KB gzipped (код) + `@xyflow/system` ≈ 15 KB gzipped + CSS ≈ 4 KB. Для сравнения: tldraw SDK ~800 KB.

**Альтернативы и почему не они:**

| Библиотека | Лицензия | Плюсы | Блокирующие минусы |
|---|---|---|---|
| **tldraw v4.x** | **tldraw SDK License (source-available, commercial key required)** | Богатый UX, «game-engine-like» стор, best-in-class рисование | **❗ Showstopper:** production-use требует коммерческую лицензию ($6k/год по [HN thread](https://news.ycombinator.com/item?id=45293839)), или hobby-лицензию с водяным знаком «made with tldraw». React 19 поддерживается (с v3.8, затем v3.x сам мигрировал на 19.2.1 в [PR #7317](https://github.com/tldraw/tldraw/pull/7317)), но лицензия — нет. Семантически tldraw вообще про **freeform canvas** (как Miro/Figma), а нам нужен structured node-graph (как ComfyUI) — tldraw для этого over-engineered. |
| **rete.js v2 + rete-react-plugin v2.1.0** | MIT | Framework-agnostic ядро, есть 3D-рендерер (`rete-area-3d-plugin`), плагинная архитектура | Меньшая экосистема (68★ react-plugin vs 36k React Flow); **требует ручного проброса `createRoot` для React 19** ([docs](https://retejs.org/docs/guides/renderers/react)); minimap/reroute/context-menu — отдельные плагины, которые нужно собирать руками; нет готового decoder/encoder для state; нет SSG. Уместно если бы мы хотели 3D-вью графа. |
| **tldraw v3.x (perpetual)** | tldraw License | Теоретически perpetual-лицензии ещё продаются | [Tldraw сами пишут](https://tldraw.dev/sdk-features/license-key), что новые perpetual не выдают. Plus водяной знак на hobby. |
| **LiteGraph.js** | MIT | Оригинальное вдохновение ComfyUI, Canvas-based | Написан на vanilla JS, своя императивная модель (не React), нет TS types. В 2026 проект полузаброшен. Интеграция в React-мир — большие расходы на glue-code. |
| **Drawflow** | MIT | Лёгкий (~20 KB), vanilla JS | Нет React-обёртки, нет TS, нет кастомных сокетов для типизированных портов. Для production — недостаточно. |
| **Flume** | MIT | React-native, специально под «визуальные программы» | 2.2k★, последний релиз — мартом 2023, фактически заброшен. |
| **JointJS** | MPL 2.0 (core) / commercial (plus) | Enterprise diagramming (UML, BPMN) | Другая ниша — бизнес-диаграммы, а не реактивные ноды с портами. Bundle огромный. |

**Интеграция с текущим стеком:**

- **SSR/CSR особенности:** редактор — сугубо клиентский. Загружать через `next/dynamic`:
  ```ts
  const WorkflowEditor = dynamic(() => import("./WorkflowEditor"), { ssr: false, loading: () => <EditorSkeleton /> })
  ```
  Это **отдельный роут** (`/workspaces/[id]/workflows/[wfId]`), поэтому ~60 KB React Flow не попадут в shared bundle главной страницы/редактора баннеров.
- **CSS:** React Flow 12 рекомендует импорт `@xyflow/react/dist/style.css` — встраивается ровно в ту же Tailwind-4-пирамиду, что уже есть в проекте (см. [официальный гайд по R19+TW4](https://reactflow.dev/whats-new/2025-10-28)).
- **Z-index с текущим Konva-редактором:** никаких конфликтов — workflow-editor рендерится на своей странице, не в одной DOM-иерархии с `Stage` Konva.
- **Zustand store:** можно подключить существующий паттерн слайсов (`createHistorySlice`, и т.п.) — React Flow 12 совместим с внешним state-management через `useNodesState`/`useEdgesState` либо полностью кастомный Zustand-store (в ReactFlow.tsx проп `nodes`/`edges` — controlled).
- **React Compiler (Next.js 16):** `@xyflow/react` 12.x **не** опирается на React Compiler (работает на классических хуках), но и не конфликтует с ним.
- **TypeScript 5:** `@xyflow/react` — полностью TS-типизирован; рекомендуется стиль из v12 — объявить объединённый `type AppNode = Node<ImageInputData, "imageInput"> | Node<RemoveBgData, "removeBg"> | …` в одном месте и использовать его везде.

---

## Background Removal

### Primary: Replicate `bria/product-cutout`

- Страница: <https://replicate.com/bria/product-cutout>
- Стоимость: **$0.04 / image** на Replicate (25 images/$1). Для Bria direct API — $0.018-0.03/image (см. [Bria pricing](https://bria.ai/pricing)).
- Latency: порядка 3-5 секунд на product shot (официальная «production-grade» SLA от Bria).
- Output: **PNG с native alpha** (`preserve_alpha: true` опционально), стороны входа — jpeg/png/webp ≤ 12 MB.
- Commercial safety: модель обучена **исключительно на лицензированном контенте** — это снимает риски претензий правообладателей, что важно для e-commerce пользователей платформы.

### Fallback 1 (уже в проекте): Replicate `cjwbw/rembg`

- Страница: <https://replicate.com/cjwbw/rembg>
- Стоимость: **$0.002 / image** (в 20× дешевле Bria).
- Latency: ~4-8 s.
- Output: PNG + alpha.
- Уже интегрирован в `src/lib/ai-providers.ts` как `rembg` c версией `fb8af171…5c003`, вызывается через `this.callReplicate(rembgEntry, { image: imageBase64 })`. Нулевая миграционная стоимость.

### Fallback 2 (budget tier): Replicate `851-labs/background-remover`

- Страница: <https://replicate.com/851-labs/background-remover>
- Стоимость: **$0.00043 / run** (≈2 325 runs / $1 — самый дешёвый из проверенных).
- Latency: **~2 s** (Nvidia T4 GPU).
- Output: PNG + alpha; поддерживает параметры `threshold` (soft/hard alpha), `background_type` (rgba/green/white/blur/overlay/…), `format`.
- Open-source (под transparent-background python lib). В отличие от `cjwbw/rembg`, не pin-нут к community-hash и активно обновляется лейблом 851-labs.

### Почему **не Gemini 2.5 Flash Image** как fallback

- **Подтверждено Google в [AI Studio docs](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image) + практикой** ([r/GeminiAI](https://www.reddit.com/r/GeminiAI/comments/1ni3z3s/)): Gemini 2.5 Flash Image / Nano Banana / Nano Banana 2 **не генерирует alpha-канал**. Если попросить «transparent background», модель рисует **шахматный паттерн прозрачности как картинку** (fake PNG). Это архитектурное ограничение Imagen-семейства Google на 2026-04, не prompt-проблема.
- Единственный known workaround — **двойная генерация + triangulation matting** (см. [Medium: jidefr](https://jidefr.medium.com/generating-transparent-background-images-with-nano-banana-pro-2-1866c88a33c5) и готовый замкнутый wrapper [`jide/nano-banana-2-transparent`](https://replicate.com/jide/nano-banana-2-transparent), **$0.010/run**).
  - По стоимости проигрывает Bria/rembg/851-labs в 5-20×.
  - По latency проигрывает ещё сильнее (два последовательных вызова NB2 + CPU-постобработка).
  - Единственный случай, когда имеет смысл — **генерация нового изображения с прозрачным фоном «с нуля»** (это не наш сценарий: у нас уже есть исходное изображение продукта).
- **Вывод:** Gemini 2.5 Flash Image не пригоден как BG-removal fallback. Для разнообразия провайдеров держать каскад `bria/product-cutout → cjwbw/rembg → 851-labs/background-remover` — это уже 3 независимых модели на Replicate, каскад sufficiency достаточен.

### Существующая интеграция и что добавить

- В `src/lib/ai-models.ts` уже есть `id: "rembg"` и `id: "bria-rmbg"` (последний — slug `fal-ai/bria/background/remove`, т.е. фактически через fal.ai). Нужно:
  - Добавить entry `id: "bria-product-cutout"` с `slug: "bria/product-cutout"`, `provider: "replicate"`, `caps: ["remove-bg"]`, `costPerRun: 0.04`.
  - Добавить entry `id: "bg-remover-851"` (slug `851-labs/background-remover`, `costPerRun: 0.00043`).
- В `ai-providers.ts.generateImage` case `remove-bg` сейчас hardcode-ит rembg. Переделать на выбор по параметру `model`, с default = `bria-product-cutout` и fallback-каскадом через `try/catch`.

---

## AI Reflection Generation

### Рекомендация: Replicate `bria/product-shadow`

- Страница: <https://replicate.com/bria/product-shadow>
- API doc: <https://docs.bria.ai/product-shot-editing/product-endpoints/product-shadow.md>
- **Что делает:** принимает product-cutout (RGBA PNG с прозрачным фоном) и добавляет **профессиональную, консистентную тень/отражение** под продуктом, сохраняя прозрачный фон везде, кроме области самой тени.
- **Параметры, релевантные нашему кейсу:**
  - `image_url` или `file` (base64) — на входе product-cutout с transparent bg.
  - `preserve_alpha: true` — выход сохраняет original transparency, **включая полупрозрачные пиксели тени** на прозрачном фоне — ровно то, что требует квалификация «PNG с альфой, отражение тоже полупрозрачное».
  - `force_rmbg: false` — если на входе уже RGBA, не делать RMBG повторно.
  - `content_moderation: true` — безопасный для e-commerce.
  - `background_color` не указывать → прозрачный фон.
- **Стоимость:** Bria direct pricing — **$0.03 / image**; на Replicate — ориентировочно та же ценовая категория ($0.03–$0.05).
- **Commercial use:** «Safe for commercial applications — trained exclusively on licensed content» — официально.
- **Подход:** **built-in ML для shadow generation**, не prompt-engineering. Никаких рисков «модель не поняла что такое отражение».

**Как сохраняется transparency:**
Product-shadow был спроектирован именно под e-commerce pipeline: `product photo → product-cutout (RGBA) → product-shadow (RGBA + тень) → product-packshot/lifestyle`. Alpha сохраняется нативно через `preserve_alpha: true`; полупрозрачность тени на прозрачном фоне — это **штатный выход модели**, не побочный эффект.

### Fallback: Replicate `black-forest-labs/flux-kontext-pro` + postprocessing

- Страница: <https://replicate.com/black-forest-labs/flux-kontext-pro>
- Стоимость: **$0.04 / image** на Replicate, [commercial use allowed](https://replicate.com/black-forest-labs/flux-kontext-pro#commercial-use).
- Latency: ~7 s (median 1080×1080).
- **Подход:** image-to-image editing с text prompt. Пример промпта: `"Add a subtle, realistic vertical mirror reflection of the product below it, on a glossy transparent surface. The reflection should be semi-transparent and gradually fade out towards the bottom. Keep the product identical."`
- **Проблема:** FLUX Kontext **всегда возвращает flat RGB** (jpg/webp/png без alpha). Чтобы получить transparent output, нужен постпроцесс:
  1. Вызвать Kontext с prompt «... на чисто белом фоне #FFFFFF».
  2. Прогнать результат через `bria/product-cutout` или `851-labs/background-remover` c `threshold: 0` (soft alpha) — тогда тень/отражение окажутся в полупрозрачной зоне alpha.
  3. Итого: $0.04 (Kontext) + $0.04 (Bria) ≈ $0.08/img, latency ~10-12 s — **в 2–3× дороже и медленнее Bria product-shadow**.
- Когда уместно: если Bria product-shadow недоступен (region outage, rate limit, content-moderation trip) или пользователь хочет **нестандартное** отражение (например «под продуктом отражение в водной глади с волнами»), которое не укладывается в пресет Bria.

### Почему **не Nano Banana** для отражений

- Те же причины что и в BG-removal: нет alpha на выходе. Плюс — Nano Banana image editing сохраняет композицию, но **не умеет вставлять physical reflections** (пишут сами [DigitalOcean](https://www.digitalocean.com/resources/articles/nano-banana): сильна для stylistic edits и object swapping, слаба для physically-plausible lighting/reflection).

### Почему **не FLUX Fill / SDXL img2img**

- FLUX Fill (inpainting) требует mask — под отражение пришлось бы вычислять маску «расширенного полотна под продуктом» на клиенте; overhead без выигрыша.
- SDXL img2img (через Stability) — старее и медленнее FLUX Kontext, prompt adherence хуже.

---

## Workflow Runtime

### Рекомендация: custom executor поверх `graphology` + `graphology-dag`

**Пакеты:**
- `graphology` **v0.26.x** — MIT, базовый граф data-structure, [108K weekly downloads](https://www.npmjs.com/package/graphology-dag), полностью TS.
- `graphology-dag` **v0.4.1** — MIT, компаньон-пакет с `topologicalSort`, `topologicalGenerations`, `hasCycle`, `willCreateCycle`, `forEachNodeInTopologicalOrder`, `forEachTopologicalGeneration`.

**Почему не writing-from-scratch:**
Ручная реализация Kahn's algorithm + cycle detection — это ~50 LoC, но graphology-dag даёт дополнительно `topologicalGenerations` — **поколения нод, которые можно выполнить параллельно** (все ноды без непройденных зависимостей). Это прямой прототип «волн» (waves), как это делает ComfyUI и наш существующий pattern `gsd-execute-phase`.

**Почему не graph-data-structure (v4.5.0):**
- Тоже MIT, [265★, TypeScript-native](https://github.com/datavis-tech/graph-data-structure) — валидная альтернатива.
- НО: у него нет `topologicalGenerations` (только линейный topo-sort), меньше встроенных функций, более узкое community.
- Рекомендация: брать graphology-dag ради топ-поколений; миграция на graph-data-structure — тривиальная, если graphology покажется тяжёлым.

**Почему не Temporal / Bull / BullMQ / Dagu / Airflow:**
- **Over-kill для v1.0** (3-узловой линейный сценарий). В Yandex Cloud Serverless Containers (Node 22-slim, stateless) это потребует поднимать Temporal cluster + воркеры с long-poll → отдельный сервис, отдельный Redis/Postgres, ~1-2 недели интеграции.
- tRPC-процедура `workflow.execute` отлично решает запуск в рамках `maxDuration: 300s`. Асинхронный pattern с `workflow_run` таблицей стоит внедрять, когда появятся ноды дольше 30s/штука или пользователь будет собирать графы из 10+ узлов. Отмечено в Open Questions.

### Паттерны из ComfyUI, которые берём

Из [docs.comfy.org/specs/workflow_json](https://docs.comfy.org/specs/workflow_json) и [ComfyUI workflows concepts](https://www.mintlify.com/Comfy-Org/ComfyUI/concepts/workflows):

1. **Строгая типизация сокетов.** У каждого output/input есть `type` (MODEL, IMAGE, MASK, CLIP…). В нашем случае — `"image"`, `"mask"`, `"text"`, `"number"`. Валидировать `isValidConnection` на уровне React Flow до того, как граф сохранён.
2. **Кэширование результатов нод (при необходимости — в Phase 2).** ComfyUI хеширует `(class_type, inputs)` и переиспользует output, если ни один upstream не изменился. Для нас в v1.0 это optimization not a requirement — каждый запуск полный re-execution. Заложить `nodeResultCache: Map<string, ActionResult>` в контекст executor'а, чтобы позже включить.
3. **Subgraph expansion.** Откладываем — для v1.0 всё плоско.
4. **Separation of UI-layer and execution-layer state** ([см. RunComfy docs](https://docs.runcomfy.com/serverless/workflow-files)):
   - `workflow.json` = canvas layout (позиции, размеры, группы, UI-виджеты) — для редактора.
   - `workflow_api.json` = execution graph (`{ [nodeId]: { class_type, inputs } }`) — для runtime.
   - В нашем случае обе роли можно делать из одного JSON, просто runtime игнорирует `position`, `viewport` и т.п.

### Контракт executor'а (спецификация, не код)

```
executeWorkflow(graph: WorkflowGraph, context: ActionContext): Promise<WorkflowRunResult>

1. Build graphology DirectedGraph from graph.nodes + graph.edges.
2. Run hasCycle() — если true, throw ValidationError.
3. Run topologicalGenerations() → Generation[] (массив массивов nodeId).
4. For each generation (sequentially):
     For each node in generation (Promise.all):
       a) Resolve inputs: lookup upstream nodes' outputs by edge.sourceHandle.
       b) Merge with node.data.params.
       c) Map node.type → actionId (imageInput→noop, removeBg→"remove_background",
          addReflection→"add_reflection", output→noop).
       d) Call existing executeAction(actionId, mergedParams, context).
       e) Store ActionResult in nodeResultMap.
5. Return { success, outputs: nodeResultMap.get(outputNodeId), trace: per-node timings }.
```

**Никакого отдельного DAG-фреймворка не требуется.** Всё собирается из 40-50 строк TS поверх `graphology-dag.topologicalGenerations` и уже существующего `executeAction` в `src/server/agent/executeAction.ts`.

---

## Workflow Definition Storage

### Рекомендация: новая nullable колонка `AIWorkflow.graph: Json?`

**Почему не расширять `steps: Json`:**
- `steps` — унаследован от линейного LLM-агента (`AIStep[]`), используется в `interpretAndExecute` и UI чата как список. Смешивать семантики рискованно: тогда каждое чтение поля должно dispatch'иться по `version` discriminator.
- Новая колонка = additive migration, zero-downtime, backward-compat: старые workflows продолжают работать через `workflow.interpretAndExecute`, новые — через `workflow.executeGraph`.

**Формат (инспирирован React Flow state + ComfyUI):**

```ts
// Prisma:
// ALTER TABLE "AIWorkflow" ADD COLUMN "graph" JSONB;

// TypeScript contract (src/server/workflow/types.ts):
export interface WorkflowGraph {
  version: "1.0";                         // schema versioning
  nodes: WorkflowNode[];                  // см. ниже
  edges: WorkflowEdge[];                  // см. ниже
  viewport: { x: number; y: number; zoom: number }; // для React Flow restore
}

export interface WorkflowNode {
  id: string;                             // cuid() / nanoid
  type: NodeType;                         // discriminated: "imageInput" | "removeBackground" | "addReflection" | "output" | ...
  position: { x: number; y: number };     // canvas coordinates
  data: NodeData;                         // зависит от type, см. ниже
  width?: number; height?: number;        // optional, для SSG
}

export type NodeData =
  | { kind: "imageInput"; params: { assetId?: string; source?: string } }
  | { kind: "removeBackground"; params: { model?: "bria-product-cutout" | "rembg" | "bg-remover-851"; threshold?: number } }
  | { kind: "addReflection"; params: { model?: "bria-product-shadow" | "flux-kontext-pro"; intensity?: number; style?: "mirror" | "soft" | "floor" } }
  | { kind: "output"; params: { format: "png" } };

export interface WorkflowEdge {
  id: string;
  source: string;                         // source nodeId
  target: string;                         // target nodeId
  sourceHandle: string;                   // e.g. "image-out"
  targetHandle: string;                   // e.g. "image-in"
  type?: "default" | "dataFlow";          // React Flow edge style
}
```

**Почему этот формат:**
- **React Flow-нативный** — `useReactFlow().toObject()` возвращает `{ nodes, edges, viewport }` практически один-в-один, минимальный glue-code для save/load.
- **ComfyUI-совместимый на уровне семантики** — поле `data.kind` играет роль `class_type`, `data.params` — `inputs`, `edges` с `sourceHandle`/`targetHandle` — connections. Если когда-то понадобится import/export ComfyUI workflows (например, для power-users, приносящих свои ноды) — мапперы пишутся за час.
- **Discriminated union `NodeData`** — TypeScript compile-time safety: невозможно сохранить addReflection-ноду с параметрами imageInput. Легко расширяется при добавлении новых типов нод.
- **Не mxgraph XML** — legacy, плохо парсится в JS, нет нативной TS-интеграции.
- **Не ComfyUI workflow.json as-is** — у них links как массив кортежей `[link_id, from_node, from_slot, to_node, to_slot, type]`, что хуже читается человеком и не матчится с React Flow state. Разумнее держать «ReactFlow first» и маппить в ComfyUI при import/export.

**Index для миграции:**
```
-- migration: add graph column
ALTER TABLE "AIWorkflow" ADD COLUMN "graph" JSONB;
-- можно также добавить GIN index, если потребуется искать по содержимому:
-- CREATE INDEX ON "AIWorkflow" USING GIN ("graph");
```
Индекс не требуется для v1.0 (поиск всегда по `workspaceId` / `createdById`). Добавить если появится requirement «найти все workflows, использующие ноду removeBackground».

---

## Integration Points

### Новые npm-зависимости

| Пакет | Версия | Lic. | Bundle (client) | Где используется |
|---|---|---|---|---|
| `@xyflow/react` | ^12.10.2 | MIT | ~48 KB gz + CSS | client-only (editor page) |
| `graphology` | ^0.26.0 | MIT | server-only | `src/server/workflow/executor.ts` |
| `graphology-dag` | ^0.4.1 | MIT | server-only | `src/server/workflow/executor.ts` |
| `graphology-types` | ^0.24.7 | MIT | server-only (peer) | типы |

- **Client bundle impact:** ~60 KB gzipped добавится **только** к `/workspaces/[id]/workflows/[wfId]` route через `next/dynamic({ ssr: false })`. На главную страницу, редактор баннеров и другие части UI это не влияет.
- **Server impact:** graphology-пара — zero-dep чистый JS, не тащит native binaries, совместим с Node 22-slim на Yandex Cloud Serverless Containers.
- **SSR нюансы для xyflow 12:** даже если page.tsx — server component, сам `<WorkflowEditor />` должен быть в "use client" модуле или подгружаться dynamic. Public read-only preview страницы (показать «картинку графа» незалогиненному пользователю) могут использовать SSG — xyflow рендерит ноды на сервере при явных `node.width`/`node.height`.

### Переиспользование существующего кода

| Существующий модуль | Роль в новой архитектуре | Изменения |
|---|---|---|
| `prisma/schema.prisma: AIWorkflow` | Хранилище графа | **+1 nullable column** `graph: Json?` (additive migration) |
| `src/server/routers/workflow.ts` | CRUD + агент | **+3 процедуры:** `workflow.saveGraph`, `workflow.getGraph`, `workflow.executeGraph`. Существующие `list`/`getById`/`create`/`update`/`delete` расширить, чтобы возвращать и `graph` тоже. |
| `src/server/agent/executeAction.ts` | Per-node handler | **+2 case-ветки:** `"remove_background"` (зовёт bria/product-cutout с fallback), `"add_reflection"` (зовёт bria/product-shadow с fallback). Существующие 9 действий не трогаем — они работают и из LLM-агента, и из новых нод. |
| `src/lib/ai-providers.ts` | Replicate wrapper | Добавить slugs `bria/product-cutout`, `bria/product-shadow`, `black-forest-labs/flux-kontext-pro`, `851-labs/background-remover` в ReplicateProvider + соответствующие entries в `src/lib/ai-models.ts`. |
| `src/lib/ai-models.ts` | Model registry | **+4 entries** (см. выше). |
| `src/server/security/ssrfGuard.ts: assertUrlIsSafe` | Защита при скачивании входного изображения | **Переиспользуется as-is** для `imageInput`-ноды, если `data.params.source` — URL. |
| `src/server/actionRegistry.ts` | Список actions для LLM | **Не трогаем** — новые «ноды» не нужны LLM-агенту; они вызываются напрямую graph-executor'ом. |

### Deployment / Yandex Cloud Serverless Containers

- **Cold start:** добавление xyflow-а влияет только на client bundle (SPA-route), на server cold start — 0.
- **`maxDuration`:** текущий лимит 300s для AI-роутов подходит для v1.0 сценария (3 шага × ~10s каждый = ~30s worst-case). Когда граф вырастет до 6+ шагов с AI — перенести executor в async pattern с `workflow_run` таблицей и polling.
- **pgBouncer / Yandex Managed PG:** `AIWorkflow.graph: Json?` — новая колонка в уже существующей таблице, pgBouncer transaction-pooling это не ломает (Prisma уже настроен с `pgbouncer=true&connection_limit=1`).

### Что НЕ надо менять в v1.0

- Konva canvas-редактор (`src/components/workspace/*`, `src/store/canvas/*`) — остаётся как есть. Workflow-editor — **отдельное приложение** на отдельном route, не встраивается в Konva-редактор.
- LLM-агент (`interpretAndExecute`) — остаётся как есть; его сценарий «линейная последовательность AI-действий по user natural language» продолжает работать для творческого чата. Workflow-editor — это структурный способ описать то же самое руками.

---

## Open Questions / Red Flags

1. **❗ Синхронная vs асинхронная execution.** tRPC-вызов `executeGraph` синхронный, timeout 300s. Для v1.0 сценария (3 шага) OK, но стоит заложить миграционный путь: таблица `WorkflowRun { id, workflowId, status, startedAt, finishedAt, trace: Json }` + polling endpoint + server-sent-events для progress. Сделать в Phase 2.

2. **Какой **primary** BG-removal выбрать по дефолту** — `bria/product-cutout` ($0.04, commercial-clean training data) или `cjwbw/rembg` ($0.002, open-source)? Product-решение. Рекомендация для платформы, монетизируемой бизнесом: **Bria default, rembg опционально для экономии cost** (можно выставлять в настройках workflow-а).

3. **Replicate цена `bria/product-shadow` на Replicate** — не удалось найти точную цифру на Replicate page (видна только Bria-direct $0.03/img). Перед запуском — сделать 3-4 test runs через Replicate dashboard и зафиксировать `costPerRun` в `ai-models.ts`.

4. **Gemini 2.5 Flash Image как alternative provider для *каких* нод вообще?** В брифе упомянут как fallback; на практике — хорош для **generate/edit image без требования alpha** (style transfer, object swap, character consistency). В v1.0 сценарии reflection его лучше не использовать. Оставить его в model registry на будущие ноды типа «image-style-transfer», «image-edit-conversational».

5. **Node типизация сокетов runtime vs compile-time.** Дискуссия: делать ли валидацию совместимости портов только через `isValidConnection` в React Flow (клиент), или ещё и в `executeGraph` на сервере. Рекомендация: **обе стороны** — клиент предотвращает создание невалидных рёбер, сервер отбрасывает их как fail-safe (вдруг пользователь POST-ит руками через API).

6. **Коллаборация (многопользовательский редактор).** Out of scope для v1.0. React Flow юридически чистый для Yjs/Liveblocks. Когда дойдём — планировать отдельный milestone.

7. **Импорт ComfyUI workflows.** Power-users могут попросить. Наш формат дизайнился ComfyUI-semantically-compatible, но не wire-compatible. Написать converter имеет смысл, когда появится такой request — **не на старте**.

8. **Replicate API timeout в serverless.** Код уже имеет `REPLICATE_MAX_POLLS = 120` (2 минуты polling). Для bria/product-shadow + product-cutout latency ~3-5s каждый — с огромным запасом. НО: `flux-kontext-pro` при cold start может занять 10-15s до первой подписки — закладывать retry с exponential backoff.

9. **Cost gates per-workspace.** Workflow автоматизация позволяет пользователю неограниченно гонять expensive AI-ноды. До v1.0 release — продумать rate-limit на уровне workspace (`maxWorkflowRunsPerDay`), иначе один зловредный пользователь может сжечь бюджет. Не блокер для MVP (internal dogfooding), но блокер для public release.

10. **Versioning node schemas.** Если в Phase 2 добавим новый параметр в `removeBackground.data.params` (напр. `maskRefinement: boolean`), старые сохранённые workflows должны продолжать работать. Заложить в `executor` default values и schema migrations через `version` поле в `WorkflowGraph`.
