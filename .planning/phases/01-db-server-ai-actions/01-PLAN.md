---
phase: 1
phase_name: "DB + Server AI Actions"
plan: "01"
wave: 1
depends_on: []
files_modified:
  - platform-app/prisma/schema.prisma
  - platform-app/src/server/workflow/types.ts
  - platform-app/src/server/workflow/helpers.ts
  - platform-app/src/server/workflow/__tests__/helpers.test.ts
  - platform-app/src/lib/ai-providers.ts
  - platform-app/src/lib/ai-models.ts
  - platform-app/src/server/agent/executeAction.ts
  - platform-app/src/server/actionRegistry.ts
  - platform-app/src/app/api/workflow/execute-node/route.ts
  - platform-app/src/app/api/workflow/__tests__/execute-node.test.ts
autonomous: true
requirements: [REQ-01, REQ-04, REQ-05, REQ-06, REQ-07, REQ-08, REQ-23]
must_haves:
  - "Prisma schema имеет колонку AIWorkflow.graph Json? и миграция применяется без ошибок"
  - "Экспортирована низкоуровневая функция invokeReplicateModel(slug, input) в ai-providers.ts"
  - "В MODEL_REGISTRY присутствуют id bria-product-cutout, bria-product-shadow, flux-kontext-pro, rembg-851-labs"
  - "executeAction поддерживает actionId remove_background и add_reflection с cascade fallback"
  - "Есть REST endpoint POST /api/workflow/execute-node с export const maxDuration = 300 (REQ-08)"
  - "Endpoint возвращает 401 для unauthenticated, 400 для SSRF-blocked URLs"
  - "Все unit-тесты (helpers.test.ts + execute-node.test.ts) зелёные"
---

<objective>
Доставить серверный слой для выполнения AI-нод воркфлоу: БД-миграция, типы графа, AI-хелперы с каскадом провайдеров, action handlers для background-removal и reflection, REST endpoint `/api/workflow/execute-node`, unit-тесты. Фаза не затрагивает клиентский код — только платформу для Phase 4 executor'а.
</objective>

<anti_goals>
- НЕ трогать `platform-app/src/components/**` и `platform-app/src/app/workflows/**` — UI делается в Phase 2-5.
- НЕ модифицировать существующие routes `/api/ai/generate`, `/api/ai/image-edit`, `orchestrator.ts`, `llmProviders.ts` — legacy agent flow должен продолжать работать.
- НЕ добавлять cost-tracking с `workflowId` (решение D-02 в CONTEXT.md — deferred до v1.1).
- НЕ вводить client-side NODE_REGISTRY в Phase 1 (D-11).
</anti_goals>

---

## Wave 1: Schema + Types (blocking для всех остальных волн)

<task id="1.1" wave="1" autonomous="true">
<title>Добавить колонку AIWorkflow.graph и применить миграцию</title>
<read_first>
  - platform-app/prisma/schema.prisma (строки 410-426 — текущая модель AIWorkflow)
  - .planning/phases/01-db-server-ai-actions/01-CONTEXT.md (decision D-01)
</read_first>
<action>
1. В файле `platform-app/prisma/schema.prisma` в модели `AIWorkflow` (после строки `steps       Json    // AIStep[] — ordered list of actions`) добавить:
   ```prisma
   graph       Json?   // WorkflowGraph — node-based editor (v1.0+). Nullable for backward compatibility.
   ```
2. Обновить комментарий `steps`:
   ```prisma
   steps       Json    // legacy: AIStep[] — linear LLM-agent actions. Co-exists with graph.
   ```
3. Сгенерировать миграцию:
   ```bash
   cd platform-app && npx prisma migrate dev --name add-workflow-graph
   ```
4. Убедиться, что `prisma/migrations/*_add_workflow_graph/migration.sql` содержит `ALTER TABLE "AIWorkflow" ADD COLUMN "graph" JSONB;`.
5. Сгенерировать Prisma client: `npx prisma generate`.
</action>
<acceptance_criteria>
  - grep 'graph       Json?' platform-app/prisma/schema.prisma → 1 match
  - ls platform-app/prisma/migrations/ | grep add_workflow_graph → 1 directory
  - grep 'ADD COLUMN "graph"' platform-app/prisma/migrations/*_add_workflow_graph/migration.sql → 1 match
  - cd platform-app && npx prisma validate → exits 0
</acceptance_criteria>
</task>

<task id="1.2" wave="1" autonomous="true">
<title>Создать src/server/workflow/types.ts с общими типами графа и NODE_REGISTRY</title>
<read_first>
  - .planning/research/ARCHITECTURE.md (секция "Node Contract — NODE_REGISTRY")
  - .planning/phases/01-db-server-ai-actions/01-CONTEXT.md (decisions D-11, D-12)
  - platform-app/src/server/actionRegistry.ts (ActionContext, ActionResult — для совместимости типов)
</read_first>
<action>
Создать НОВЫЙ файл `platform-app/src/server/workflow/types.ts` со следующим содержимым (концептуально):

```typescript
/**
 * Workflow Graph Types — server-side definitions.
 *
 * Phase 1 exports ONLY server-handled node types (removeBackground, addReflection).
 * Client-only handlers (imageInput, assetOutput) are registered in Phase 3.
 *
 * DO NOT import this file from client code in Phase 1 — client types arrive in Phase 2.
 */

export type WorkflowNodeType =
  | "imageInput"
  | "removeBackground"
  | "addReflection"
  | "assetOutput";

export type PortType = "image" | "mask" | "text" | "number" | "any";

export interface Port {
  id: string;
  type: PortType;
  label: string;
  required?: boolean;
}

export interface WorkflowNode<TType extends WorkflowNodeType = WorkflowNodeType> {
  id: string;
  type: TType;
  position: { x: number; y: number };
  data: {
    params: Record<string, unknown>;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;        // node id
  sourceHandle: string;  // port id on source
  target: string;        // node id
  targetHandle: string;  // port id on target
}

export interface WorkflowGraph {
  version: 1;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export type NodeExecutor =
  | { kind: "client"; handler: "imageInput" | "assetOutput" }
  | { kind: "server"; actionId: "remove_background" | "add_reflection" };

export interface NodeDefinition {
  type: WorkflowNodeType;
  displayName: string;
  description: string;
  category: "input" | "ai" | "output";
  inputs: Port[];
  outputs: Port[];
  defaultParams: Record<string, unknown>;
  execute: NodeExecutor;
}

export const NODE_REGISTRY: Record<WorkflowNodeType, NodeDefinition> = {
  imageInput: {
    type: "imageInput",
    displayName: "Image Input",
    description: "Source image from Asset Library",
    category: "input",
    inputs: [],
    outputs: [{ id: "image-out", type: "image", label: "Image" }],
    defaultParams: {},
    execute: { kind: "client", handler: "imageInput" },
  },
  removeBackground: {
    type: "removeBackground",
    displayName: "Remove Background",
    description: "AI-powered background removal with alpha channel",
    category: "ai",
    inputs: [{ id: "image-in", type: "image", label: "Image", required: true }],
    outputs: [{ id: "image-out", type: "image", label: "Cut-out (RGBA)" }],
    defaultParams: {},
    execute: { kind: "server", actionId: "remove_background" },
  },
  addReflection: {
    type: "addReflection",
    displayName: "Add Reflection",
    description: "Generate soft reflection below the product (AI)",
    category: "ai",
    inputs: [{ id: "image-in", type: "image", label: "Image (RGBA)", required: true }],
    outputs: [{ id: "image-out", type: "image", label: "With reflection" }],
    defaultParams: { style: "subtle", intensity: 0.3 },
    execute: { kind: "server", actionId: "add_reflection" },
  },
  assetOutput: {
    type: "assetOutput",
    displayName: "Save to Library",
    description: "Persist final image as Asset",
    category: "output",
    inputs: [{ id: "image-in", type: "image", label: "Image", required: true }],
    outputs: [],
    defaultParams: {},
    execute: { kind: "client", handler: "assetOutput" },
  },
};

/** Request body для POST /api/workflow/execute-node */
export interface ExecuteNodeRequest {
  actionId: "remove_background" | "add_reflection";
  params: Record<string, unknown>;
  inputs: Record<string, { imageUrl: string }>;
  workspaceId: string;
  workflowId?: string;  // passed for future cost-tracking; ignored in Phase 1
}

export interface ExecuteNodeSuccess {
  success: true;
  type: "image";
  imageUrl: string;
  metadata?: {
    provider: string;
    costUsd: number;
  };
}

export interface ExecuteNodeError {
  success: false;
  type: "error";
  error: string;
  code?: "UNAUTHORIZED" | "SSRF_BLOCKED" | "RATE_LIMITED" | "PROVIDER_FAILED" | "BAD_REQUEST";
  requestId: string;
}
```
</action>
<acceptance_criteria>
  - test -f platform-app/src/server/workflow/types.ts
  - grep 'export const NODE_REGISTRY' platform-app/src/server/workflow/types.ts → 1 match
  - grep 'export interface WorkflowGraph' platform-app/src/server/workflow/types.ts → 1 match
  - grep 'export interface ExecuteNodeRequest' platform-app/src/server/workflow/types.ts → 1 match
  - cd platform-app && npx tsc --noEmit src/server/workflow/types.ts → exits 0
</acceptance_criteria>
</task>

---

## Wave 2: AI Providers Extension + Helpers (parallel — оба depend только на Wave 1)

<task id="2.1" wave="2" autonomous="true">
<title>Добавить Replicate-модели в MODEL_REGISTRY и экспортировать invokeReplicateModel</title>
<read_first>
  - platform-app/src/lib/ai-models.ts (строки 19-100 — структура ModelEntry, существующие записи)
  - platform-app/src/lib/ai-providers.ts (строки 348-500 — ReplicateProvider.callReplicate — polling, error handling)
  - .planning/research/STACK.md (секция §3 "Background Removal" и §4 "Reflection")
</read_first>
<action>
1. В `platform-app/src/lib/ai-models.ts` в конец `MODEL_REGISTRY` (перед закрывающим `]`) добавить 4 новые записи:

```typescript
// ── Workflow-only models (Phase 1: bg-removal + reflection) ──
{
    id: "bria-product-cutout",
    label: "Bria Product Cutout",
    slug: "bria/product-cutout",
    provider: "replicate",
    caps: ["remove-bg"],
    costPerRun: 0.025,
},
{
    id: "rembg-851-labs",
    label: "851 Labs Background Remover",
    slug: "851-labs/background-remover",
    provider: "replicate",
    caps: ["remove-bg"],
    costPerRun: 0.002,
},
{
    id: "bria-product-shadow",
    label: "Bria Product Shadow",
    slug: "bria/product-shadow",
    provider: "replicate",
    caps: ["edit"],
    costPerRun: 0.04,
},
{
    id: "flux-kontext-pro",
    label: "FLUX Kontext Pro",
    slug: "black-forest-labs/flux-kontext-pro",
    provider: "replicate",
    caps: ["edit", "inpaint"],
    costPerRun: 0.055,
},
```

Если `rembg` (`cjwbw/rembg`) ещё не зарегистрирован — оставить как есть (уже используется через `ReplicateProvider.removeBackground`).

2. В `platform-app/src/lib/ai-providers.ts`:
   - Найти `class ReplicateProvider` и его приватный метод `callReplicate(entry, input, token)`.
   - Извлечь polling-тело в НОВУЮ top-level функцию `invokeReplicateModel`:
     ```typescript
     export async function invokeReplicateModel(
       modelId: string,
       input: Record<string, unknown>,
     ): Promise<{ output: string; model: string; costUsd: number }> {
       const entry = getModelById(modelId);
       if (!entry || entry.provider !== "replicate") {
         throw new Error(`Unknown or non-Replicate model: ${modelId}`);
       }
       const token = process.env.REPLICATE_API_TOKEN;
       if (!token) throw new Error("REPLICATE_API_TOKEN not configured");
       // ... re-use existing polling logic (body construction + create + poll)
       // Return first array element if array, else the value itself, typed as string URL
       return { output: String(firstOutput), model: entry.slug, costUsd: entry.costPerRun };
     }
     ```
   - Приватный `ReplicateProvider.callReplicate` должен делегировать в `invokeReplicateModel` через `modelId` lookup, ЛИБО остаться как есть — дубликация нежелательна, поэтому лучше сделать `callReplicate` тонкой обёрткой над экспортируемой функцией. Сохранить backward compat: все существующие вызовы `this.callReplicate(entry, ...)` должны продолжать работать.
   - Экспортировать из файла: `export { invokeReplicateModel }`.
</action>
<acceptance_criteria>
  - grep "id: \"bria-product-cutout\"" platform-app/src/lib/ai-models.ts → 1 match
  - grep "id: \"bria-product-shadow\"" platform-app/src/lib/ai-models.ts → 1 match
  - grep "id: \"flux-kontext-pro\"" platform-app/src/lib/ai-models.ts → 1 match
  - grep "id: \"rembg-851-labs\"" platform-app/src/lib/ai-models.ts → 1 match
  - grep "export async function invokeReplicateModel" platform-app/src/lib/ai-providers.ts → 1 match
  - cd platform-app && npx tsc --noEmit → exits 0 (никаких regressions в других местах)
  - Existing tests продолжают работать: cd platform-app && pnpm test -- src/lib --run → exits 0 (если есть тесты на ai-providers.ts)
</acceptance_criteria>
</task>

<task id="2.2" wave="2" autonomous="true">
<title>Создать src/server/workflow/helpers.ts (tryWithFallback, uploadFromExternalUrl, buildReflectionPrompt, postProcessToTransparent)</title>
<read_first>
  - platform-app/src/server/security/ssrfGuard.ts (assertUrlIsSafe, safeFetch, uploadImagePolicy, SsrfBlockedError)
  - platform-app/src/app/api/upload/route.ts (строки 80-148 — образец URL-mode upload flow)
  - platform-app/src/server/routers/asset.ts (строки 27-37 — S3Client config)
  - .planning/phases/01-db-server-ai-actions/01-CONTEXT.md (decisions D-13 — D-16)
</read_first>
<action>
Создать НОВЫЙ файл `platform-app/src/server/workflow/helpers.ts`. Ожидаемая структура:

```typescript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { safeFetch, uploadImagePolicy, SsrfBlockedError } from "@/server/security/ssrfGuard";

const s3 = new S3Client({
  region: "ru-central1",
  endpoint: process.env.S3_ENDPOINT || "https://storage.yandexcloud.net",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET = process.env.S3_BUCKET || "acp-assets";
const S3_ENDPOINT = process.env.S3_ENDPOINT || "https://storage.yandexcloud.net";

/**
 * Try providers in order. First successful result wins. All-fail throws
 * aggregated error with individual messages.
 */
export async function tryWithFallback<T>(
  providers: Array<{ name: string; run: () => Promise<T> }>,
): Promise<{ result: T; winner: string }> {
  const errors: Array<{ name: string; message: string }> = [];
  for (const p of providers) {
    try {
      const result = await p.run();
      return { result, winner: p.name };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[workflow] provider ${p.name} failed: ${msg}`);
      errors.push({ name: p.name, message: msg });
    }
  }
  throw new Error(
    `All providers failed: ${errors.map(e => `${e.name}(${e.message})`).join(" → ")}`,
  );
}

/**
 * Re-upload an external URL (Replicate temp link) to our S3 bucket.
 * SSRF-guarded via safeFetch + uploadImagePolicy.
 * Prefix: workflow-runs/${workspaceId}/${uuid}.{ext}
 */
export async function uploadFromExternalUrl(
  url: string,
  opts: { workspaceId: string },
): Promise<{ s3Url: string; s3Key: string; contentType: string; sizeBytes: number }> {
  // Validates scheme/port/host/IP; pins DNS; enforces MIME + size
  const response = await safeFetch(
    url,
    { signal: AbortSignal.timeout(30_000) },
    uploadImagePolicy(),
  );
  if (!response.ok) throw new Error(`External URL fetch failed: ${response.status}`);

  const contentType = response.headers.get("content-type") || "image/png";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Non-image content-type from provider: ${contentType}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error("Provider returned empty body");

  const ext = contentType.split("/")[1]?.split(";")[0] || "png";
  const key = `workflow-runs/${opts.workspaceId}/${randomUUID()}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));

  return {
    s3Url: `${S3_ENDPOINT}/${BUCKET}/${key}`,
    s3Key: key,
    contentType,
    sizeBytes: buffer.length,
  };
}

/** Build prompt for AI reflection generation. */
export function buildReflectionPrompt(
  style: "subtle" | "hard" | "soft-glow" = "subtle",
  intensity: number = 0.3,
): string {
  const clampedIntensity = Math.max(0.1, Math.min(1, intensity));
  return `Generate a realistic reflection of the product below it. ` +
    `Style: ${style}. Opacity: ${clampedIntensity}. ` +
    `Preserve transparent background. Smooth gradient fade to fully transparent at the bottom. ` +
    `Photorealistic, high fidelity, commercial product photography aesthetic.`;
}

/** Re-entry to remove_background to guarantee RGBA output after reflection. */
export async function postProcessToTransparent(
  rgbaOrOpaqueUrl: string,
  ctx: { workspaceId: string; userId: string; prisma: unknown },
): Promise<string> {
  // Delegates to executeAction("remove_background", ...) internally.
  // Implemented as a late-binding import to avoid circular deps.
  const { executeAction } = await import("@/server/agent/executeAction");
  const result = await executeAction(
    "remove_background",
    { imageUrl: rgbaOrOpaqueUrl },
    ctx as never,
  );
  if (!result.success || result.type !== "image") {
    throw new Error(`Post-process bg-removal failed: ${result.content}`);
  }
  // Extract URL from metadata.imageUrl or content (convention from case handler)
  const url = (result.metadata as { imageUrl?: string })?.imageUrl ?? result.content;
  return url;
}
```

Важно:
- `uploadImagePolicy` и `safeFetch` ДОЛЖНЫ использоваться (REQ-23) — нельзя `fetch(url)` напрямую.
- SSRF-ошибки должны всплывать как `SsrfBlockedError` — caller на уровне endpoint превращает в 400.
- `postProcessToTransparent` — late-binding import, чтобы не было circular dep между `workflow/helpers.ts` и `agent/executeAction.ts`.
</action>
<acceptance_criteria>
  - test -f platform-app/src/server/workflow/helpers.ts
  - grep "export async function tryWithFallback" platform-app/src/server/workflow/helpers.ts → 1 match
  - grep "export async function uploadFromExternalUrl" platform-app/src/server/workflow/helpers.ts → 1 match
  - grep "export function buildReflectionPrompt" platform-app/src/server/workflow/helpers.ts → 1 match
  - grep "export async function postProcessToTransparent" platform-app/src/server/workflow/helpers.ts → 1 match
  - grep "safeFetch" platform-app/src/server/workflow/helpers.ts → 1+ match (SSRF compliance REQ-23)
  - grep -v "// " platform-app/src/server/workflow/helpers.ts | grep "fetch(url" → 0 matches (never raw fetch for external URL)
  - cd platform-app && npx tsc --noEmit → exits 0
</acceptance_criteria>
</task>

<task id="2.3" wave="2" autonomous="true">
<title>Unit-тесты для workflow/helpers.ts</title>
<read_first>
  - platform-app/src/server/workflow/helpers.ts (после task 2.2)
  - platform-app/src/server/security/__tests__/ssrfGuard.test.ts (образец моков для safeFetch)
</read_first>
<action>
Создать НОВЫЙ файл `platform-app/src/server/workflow/__tests__/helpers.test.ts` с покрытием:

1. `tryWithFallback` → первый провайдер success — returns его значение, `winner = его имя`.
2. `tryWithFallback` → primary throws, secondary success — returns secondary, winner = secondary.
3. `tryWithFallback` → все throw — throws aggregated Error с именами и сообщениями всех провайдеров.
4. `buildReflectionPrompt` → возвращает строку содержащую style и intensity (clamp: 0.05 → 0.1, 2 → 1).
5. `uploadFromExternalUrl` → mock `safeFetch` returning 200 + image/png body, mock S3 send → returns `{ s3Url starts with process.env.S3_ENDPOINT or "https://storage.yandexcloud.net", s3Key starts with "workflow-runs/ws-test/", contentType, sizeBytes > 0 }`.
6. `uploadFromExternalUrl` → mock `safeFetch` throws `SsrfBlockedError` — функция re-throws (not caught).
7. `uploadFromExternalUrl` → mock `safeFetch` 200 but content-type `text/html` → throws "Non-image content-type".

Используй Vitest: `vi.mock("@/server/security/ssrfGuard", () => ({ safeFetch: vi.fn(), uploadImagePolicy: vi.fn(), SsrfBlockedError: class extends Error {} }))` и `vi.mock("@aws-sdk/client-s3", ...)` для изоляции S3.
</action>
<acceptance_criteria>
  - test -f platform-app/src/server/workflow/__tests__/helpers.test.ts
  - grep -c "it\\|test(" platform-app/src/server/workflow/__tests__/helpers.test.ts → ≥ 7
  - cd platform-app && pnpm test -- src/server/workflow/__tests__/helpers.test.ts --run → exits 0
</acceptance_criteria>
</task>

---

## Wave 3: Action Handlers (depends on Wave 2)

<task id="3.1" wave="3" autonomous="true">
<title>Добавить case "remove_background" и "add_reflection" в executeAction.ts + ActionDefinition в actionRegistry.ts</title>
<read_first>
  - platform-app/src/server/agent/executeAction.ts (строка 1 — импорты; строка 36 — switch; строка 929 — default)
  - platform-app/src/server/actionRegistry.ts (строки 31-100 — ActionDefinition / ActionContext / ActionResult)
  - platform-app/src/server/workflow/helpers.ts (после task 2.2)
  - platform-app/src/lib/ai-providers.ts (invokeReplicateModel — после task 2.1)
  - .planning/phases/01-db-server-ai-actions/01-CONTEXT.md (decisions D-07 — D-10)
</read_first>
<action>
1. В `platform-app/src/server/actionRegistry.ts` добавить 2 новые записи в `ACTION_REGISTRY` (или в экспортируемый объект действий — уточнить по текущей структуре файла):
   ```typescript
   {
     id: "remove_background",
     name: "Remove Background",
     description: "AI-powered background removal with alpha channel (workflow-only)",
     parameters: {
       imageUrl: { type: "string", description: "Source image URL (http/https)" },
     },
     required: ["imageUrl"],
   },
   {
     id: "add_reflection",
     name: "Add Reflection",
     description: "Generate realistic reflection below the product (workflow-only)",
     parameters: {
       imageUrl: { type: "string", description: "Source image URL (RGBA recommended)" },
       style: { type: "string", description: "Reflection style", enum: ["subtle", "hard", "soft-glow"] },
       intensity: { type: "number", description: "Opacity 0.1-1.0" },
     },
     required: ["imageUrl"],
   },
   ```

2. В `platform-app/src/server/agent/executeAction.ts`:
   - Добавить импорты в начало файла:
     ```typescript
     import { invokeReplicateModel } from "@/lib/ai-providers";
     import {
       tryWithFallback,
       uploadFromExternalUrl,
       buildReflectionPrompt,
       postProcessToTransparent,
     } from "@/server/workflow/helpers";
     ```
   - Перед строкой `default:` (строка 929) добавить ДВА новых case:

   ```typescript
   case "remove_background": {
     const imageUrl = params.imageUrl as string;
     if (!imageUrl || typeof imageUrl !== "string") {
       return { success: false, type: "error", content: "imageUrl обязателен" };
     }
     // SSRF-guard на входном URL
     try {
       await assertUrlIsSafe(imageUrl, agentAddImagePolicy());
     } catch (err) {
       if (err instanceof SsrfBlockedError) {
         return { success: false, type: "error", content: `URL заблокирован: ${err.reason}` };
       }
       throw err;
     }

     try {
       const { result, winner } = await tryWithFallback([
         {
           name: "bria-product-cutout",
           run: () => invokeReplicateModel("bria-product-cutout", { image: imageUrl }),
         },
         {
           name: "rembg-851-labs",
           run: () => invokeReplicateModel("rembg-851-labs", { image: imageUrl }),
         },
         // cjwbw/rembg — optional final fallback if registered
       ]);
       // Provider returned temp URL → upload to our S3
       const { s3Url } = await uploadFromExternalUrl(result.output, {
         workspaceId: context.workspaceId,
       });
       return {
         success: true,
         type: "image",
         content: s3Url,
         metadata: { imageUrl: s3Url, provider: winner, costUsd: result.costUsd },
       };
     } catch (err) {
       const msg = err instanceof Error ? err.message : String(err);
       return { success: false, type: "error", content: `Все провайдеры bg-removal упали: ${msg}` };
     }
   }

   case "add_reflection": {
     const imageUrl = params.imageUrl as string;
     const style = (params.style as "subtle" | "hard" | "soft-glow") ?? "subtle";
     const intensity = typeof params.intensity === "number" ? params.intensity : 0.3;

     if (!imageUrl || typeof imageUrl !== "string") {
       return { success: false, type: "error", content: "imageUrl обязателен" };
     }
     try {
       await assertUrlIsSafe(imageUrl, agentAddImagePolicy());
     } catch (err) {
       if (err instanceof SsrfBlockedError) {
         return { success: false, type: "error", content: `URL заблокирован: ${err.reason}` };
       }
       throw err;
     }

     const prompt = buildReflectionPrompt(style, intensity);
     try {
       const { result, winner } = await tryWithFallback([
         {
           name: "bria-product-shadow",
           run: () => invokeReplicateModel("bria-product-shadow", { image: imageUrl, prompt }),
         },
         {
           name: "flux-kontext-pro",
           run: () => invokeReplicateModel("flux-kontext-pro", { image: imageUrl, prompt }),
         },
       ]);

       const { s3Url } = await uploadFromExternalUrl(result.output, {
         workspaceId: context.workspaceId,
       });

       // D-10: FLUX Kontext returns non-RGBA — re-run bg-removal to enforce transparency
       let finalUrl = s3Url;
       if (winner === "flux-kontext-pro") {
         finalUrl = await postProcessToTransparent(s3Url, {
           workspaceId: context.workspaceId,
           userId: context.userId,
           prisma: context.prisma,
         });
       }

       return {
         success: true,
         type: "image",
         content: finalUrl,
         metadata: {
           imageUrl: finalUrl,
           provider: winner,
           costUsd: result.costUsd,
           postProcessed: winner === "flux-kontext-pro",
         },
       };
     } catch (err) {
       const msg = err instanceof Error ? err.message : String(err);
       return { success: false, type: "error", content: `add_reflection упал: ${msg}` };
     }
   }
   ```

3. Убедиться, что файл всё ещё компилируется — запустить `npx tsc --noEmit`.
</action>
<acceptance_criteria>
  - grep 'case "remove_background"' platform-app/src/server/agent/executeAction.ts → 1 match
  - grep 'case "add_reflection"' platform-app/src/server/agent/executeAction.ts → 1 match
  - grep 'invokeReplicateModel' platform-app/src/server/agent/executeAction.ts → 2+ matches
  - grep 'tryWithFallback' platform-app/src/server/agent/executeAction.ts → 2 matches (один на remove_background, один на add_reflection)
  - grep 'assertUrlIsSafe' platform-app/src/server/agent/executeAction.ts → 3+ matches (existing + 2 new)
  - grep 'id: "remove_background"' platform-app/src/server/actionRegistry.ts → 1 match
  - grep 'id: "add_reflection"' platform-app/src/server/actionRegistry.ts → 1 match
  - cd platform-app && npx tsc --noEmit → exits 0
</acceptance_criteria>
</task>

---

## Wave 4: REST Endpoint + Integration Tests (depends on Wave 3)

<task id="4.1" wave="4" autonomous="true">
<title>Создать POST /api/workflow/execute-node с auth + rate-limit stub + SSRF-guard + maxDuration=300</title>
<read_first>
  - platform-app/src/app/api/ai/generate/route.ts (строки 1-115 — образец auth + rate-limit + error handling)
  - platform-app/src/server/workflow/types.ts (ExecuteNodeRequest / Success / Error — после task 1.2)
  - platform-app/src/server/agent/executeAction.ts (case remove_background / add_reflection — после task 3.1)
  - platform-app/src/server/authz/guards.ts (assertWorkspaceAccess)
</read_first>
<action>
Создать НОВЫЙ файл `platform-app/src/app/api/workflow/execute-node/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { executeAction } from "@/server/agent/executeAction";
import { assertWorkspaceAccess } from "@/server/authz/guards";
import type { ExecuteNodeRequest } from "@/server/workflow/types";

export const maxDuration = 300;

const ALLOWED_ACTIONS = new Set(["remove_background", "add_reflection"] as const);

export async function POST(req: NextRequest) {
  const requestId = randomUUID();

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, type: "error", error: "Unauthorized", code: "UNAUTHORIZED", requestId },
        { status: 401 },
      );
    }
    const userId = session.user.id;

    const rl = checkRateLimit(`workflow-node:${userId}`, { limit: 30, windowSeconds: 60 });
    if (!rl.allowed) {
      return NextResponse.json(
        {
          success: false,
          type: "error",
          error: "Слишком много запросов. Подождите минуту.",
          code: "RATE_LIMITED",
          requestId,
          retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000),
        },
        { status: 429 },
      );
    }

    const body = (await req.json()) as Partial<ExecuteNodeRequest>;
    const { actionId, params, inputs, workspaceId, workflowId } = body;

    if (!actionId || !ALLOWED_ACTIONS.has(actionId as never)) {
      return NextResponse.json(
        { success: false, type: "error", error: `Unsupported actionId: ${actionId}`, code: "BAD_REQUEST", requestId },
        { status: 400 },
      );
    }
    if (!workspaceId || typeof workspaceId !== "string") {
      return NextResponse.json(
        { success: false, type: "error", error: "workspaceId required", code: "BAD_REQUEST", requestId },
        { status: 400 },
      );
    }
    if (!inputs || typeof inputs !== "object") {
      return NextResponse.json(
        { success: false, type: "error", error: "inputs object required", code: "BAD_REQUEST", requestId },
        { status: 400 },
      );
    }

    // Workspace access check (REQ-23 + general authz)
    try {
      await assertWorkspaceAccess({ userId, prisma } as never, workspaceId);
    } catch {
      return NextResponse.json(
        { success: false, type: "error", error: "Forbidden workspace", code: "UNAUTHORIZED", requestId },
        { status: 403 },
      );
    }

    // Merge inputs into action params. Contract (D-04): for remove_background / add_reflection,
    // the primary input port is "image-in" → provides imageUrl. Flatten into params.imageUrl.
    const imageInput = inputs["image-in"];
    const actionParams = {
      ...(params || {}),
      imageUrl: imageInput?.imageUrl,
    };

    const result = await executeAction(
      actionId as "remove_background" | "add_reflection",
      actionParams,
      { userId, workspaceId, prisma },
    );

    if (!result.success) {
      // Known SSRF / provider errors → map to 400 (client-side bug in graph) vs 502 (upstream)
      const isSsrf = result.content.toLowerCase().includes("url заблокирован") ||
        result.content.toLowerCase().includes("ssrf");
      const status = isSsrf ? 400 : 502;
      return NextResponse.json(
        {
          success: false,
          type: "error",
          error: result.content,
          code: isSsrf ? "SSRF_BLOCKED" : "PROVIDER_FAILED",
          requestId,
        },
        { status },
      );
    }

    const imageUrl = (result.metadata as { imageUrl?: string } | undefined)?.imageUrl ?? result.content;

    return NextResponse.json({
      success: true,
      type: "image",
      imageUrl,
      metadata: {
        provider: (result.metadata as { provider?: string } | undefined)?.provider,
        costUsd: (result.metadata as { costUsd?: number } | undefined)?.costUsd,
      },
      requestId,
    });
  } catch (err) {
    console.error(`[/api/workflow/execute-node][${requestId}]`, err);
    return NextResponse.json(
      {
        success: false,
        type: "error",
        error: err instanceof Error ? err.message : "Internal error",
        code: "PROVIDER_FAILED",
        requestId,
      },
      { status: 500 },
    );
  }
}
```
</action>
<acceptance_criteria>
  - test -f platform-app/src/app/api/workflow/execute-node/route.ts
  - grep "export const maxDuration = 300" platform-app/src/app/api/workflow/execute-node/route.ts → 1 match
  - grep "export async function POST" platform-app/src/app/api/workflow/execute-node/route.ts → 1 match
  - grep "checkRateLimit" platform-app/src/app/api/workflow/execute-node/route.ts → 1 match
  - grep "assertWorkspaceAccess" platform-app/src/app/api/workflow/execute-node/route.ts → 1 match
  - grep "ALLOWED_ACTIONS" platform-app/src/app/api/workflow/execute-node/route.ts → 2+ matches (declaration + check)
  - cd platform-app && npx tsc --noEmit → exits 0
  - cd platform-app && pnpm build 2>&1 | grep -E "error|Error" | head -5 → no errors (route builds as part of Next.js app)
</acceptance_criteria>
</task>

<task id="4.2" wave="4" autonomous="true">
<title>Integration tests для /api/workflow/execute-node</title>
<read_first>
  - platform-app/src/app/api/workflow/execute-node/route.ts (после task 4.1)
  - platform-app/src/server/agent/executeAction.ts (case remove_background / add_reflection)
  - platform-app/src/server/security/__tests__/ssrfGuard.test.ts (образец моков)
</read_first>
<action>
Создать НОВЫЙ файл `platform-app/src/app/api/workflow/__tests__/execute-node.test.ts`. Покрыть **7 кейсов**:

1. **Unauthenticated → 401 UNAUTHORIZED.** Mock `auth()` returns null → assert status 401, `code === "UNAUTHORIZED"`.
2. **Missing actionId → 400 BAD_REQUEST.** Authorized session + body `{ workspaceId: "w1", inputs: {} }` (no actionId) → 400, `code === "BAD_REQUEST"`.
3. **Unsupported actionId → 400.** body `{ actionId: "generate_image", workspaceId: "w1", inputs: {} }` → 400.
4. **Forbidden workspace → 403.** Mock `assertWorkspaceAccess` throws → 403, `code === "UNAUTHORIZED"`.
5. **SSRF blocked URL → 400.** Mock `executeAction` returns `{ success: false, type: "error", content: "URL заблокирован: private IP" }` → 400, `code === "SSRF_BLOCKED"`.
6. **Provider cascade success → 200.** Mock `executeAction` returns `{ success: true, type: "image", content: "https://storage.yandexcloud.net/.../a.png", metadata: { imageUrl: "https://.../a.png", provider: "bria-product-cutout", costUsd: 0.025 } }` → 200, response.imageUrl matches S3 URL.
7. **Provider all-fail → 502.** Mock `executeAction` returns `{ success: false, type: "error", content: "Все провайдеры упали: X→Y" }` → 502, `code === "PROVIDER_FAILED"`.

Структура (Next.js route-level testing через прямой вызов `POST(req)`):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/auth", () => ({ auth: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/agent/executeAction", () => ({ executeAction: vi.fn() }));
vi.mock("@/server/authz/guards", () => ({ assertWorkspaceAccess: vi.fn() }));

const { POST } = await import("@/app/api/workflow/execute-node/route");
const { auth } = await import("@/server/auth");
const { executeAction } = await import("@/server/agent/executeAction");
const { assertWorkspaceAccess } = await import("@/server/authz/guards");

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://test.local/api/workflow/execute-node", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/workflow/execute-node", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);
    const res = await POST(makeReq({ actionId: "remove_background", workspaceId: "w1", inputs: {} }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.code).toBe("UNAUTHORIZED");
  });

  // ...etc for cases 2-7
});
```
</action>
<acceptance_criteria>
  - test -f platform-app/src/app/api/workflow/__tests__/execute-node.test.ts
  - grep -c "it(" platform-app/src/app/api/workflow/__tests__/execute-node.test.ts → ≥ 7
  - grep "UNAUTHORIZED" platform-app/src/app/api/workflow/__tests__/execute-node.test.ts → 1+ match
  - grep "SSRF_BLOCKED" platform-app/src/app/api/workflow/__tests__/execute-node.test.ts → 1+ match
  - grep "PROVIDER_FAILED" platform-app/src/app/api/workflow/__tests__/execute-node.test.ts → 1+ match
  - cd platform-app && pnpm test -- src/app/api/workflow/__tests__/execute-node.test.ts --run → exits 0
</acceptance_criteria>
</task>

<task id="4.3" wave="4" autonomous="true">
<title>Финальная проверка: full test suite + build</title>
<read_first>
  - platform-app/package.json (scripts)
</read_first>
<action>
1. Запустить полный testsuite новой зоны:
   ```bash
   cd platform-app && pnpm test -- \
     src/server/workflow/__tests__ \
     src/app/api/workflow/__tests__ \
     --run
   ```
   Все тесты должны пройти.

2. Type-check всего проекта: `cd platform-app && npx tsc --noEmit`.

3. Lint изменённых файлов: `cd platform-app && pnpm lint -- --fix src/server/workflow src/app/api/workflow`.

4. Sanity build (без deploy): `cd platform-app && pnpm build 2>&1 | tail -30` — проверить что Next.js нашёл новый route и не упал.

5. Убедиться, что existing tests не сломались:
   ```bash
   cd platform-app && pnpm test --run
   ```
   Все test files (не только новые) должны пройти.
</action>
<acceptance_criteria>
  - cd platform-app && pnpm test -- src/server/workflow src/app/api/workflow --run → exits 0
  - cd platform-app && npx tsc --noEmit → exits 0
  - cd platform-app && pnpm build 2>&1 | tail -5 | grep -iE "compiled|success" → 1+ match
  - cd platform-app && pnpm test --run 2>&1 | tail -5 | grep -E "passed|Test Files" → shows full suite green
</acceptance_criteria>
</task>

---

## Verification (Phase-level)

Выполняется после всех waves:

**End-to-end curl verification** (manual, после deployment в dev):
```bash
# Получить session cookie (локально через /auth/signin или dev-bypass)
SESSION_COOKIE="..."

curl -X POST http://localhost:3000/api/workflow/execute-node \
  -H "Content-Type: application/json" \
  -H "Cookie: $SESSION_COOKIE" \
  -d '{
    "actionId": "remove_background",
    "params": {},
    "inputs": { "image-in": { "imageUrl": "https://storage.yandexcloud.net/acp-assets/canvas-images/test.png" } },
    "workspaceId": "ws-dev-001"
  }' | jq '.'

# Expected: { "success": true, "type": "image", "imageUrl": "https://storage.yandexcloud.net/acp-assets/workflow-runs/ws-dev-001/....", "metadata": { "provider": "bria-product-cutout", "costUsd": 0.025 }, "requestId": "..." }
```

## Threat Model (security)

| Threat | Severity | Mitigation |
|---|---|---|
| SSRF через `imageUrl` | HIGH | `assertUrlIsSafe` + `agentAddImagePolicy` в executeAction перед вызовом Replicate. `safeFetch` + `uploadImagePolicy` в `uploadFromExternalUrl` для download. Покрыто test case #5 + test в helpers.test.ts. |
| Cross-workspace API abuse | HIGH | `assertWorkspaceAccess` в route handler. Покрыто test case #4. |
| Rate-limit bypass (DoS на Replicate bill) | MEDIUM | `checkRateLimit(workflow-node:${userId}, 30/min)` в Phase 1 (stub). Полный 20/hr/user — Phase 4 (REQ-07). |
| Expired Replicate URL на retry | LOW | Немедленная перекачка в наш S3 через `uploadFromExternalUrl`. URL, отдаваемый клиенту, — всегда наш `storage.yandexcloud.net`. |
| Large file DoS (OOM) | MEDIUM | `uploadImagePolicy()` ограничивает HEAD Content-Length + MIME (существующий код ssrfGuard). |
| Cost blow-up (unlimited cascade) | MEDIUM | Каскад — max 3 провайдера на `remove_background`, 2 на `add_reflection`. Если все упали — fail-fast с aggregate error. |

**Block on:** HIGH (SSRF, cross-workspace). MEDIUM — warning, OK для Phase 1 при явном acknowledgement (rate-limit stub стоит ровно из-за этого — полные 20/hr в Phase 4).
