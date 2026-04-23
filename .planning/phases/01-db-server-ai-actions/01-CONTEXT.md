# Phase 1: DB + Server AI Actions — Context

**Gathered:** 2026-04-24
**Status:** Ready for planning
**Source:** Research pack (STACK/ARCHITECTURE/PITFALLS/SUMMARY) + 4 clarifying questions

<domain>
## Phase Boundary

**Ships:**
- Prisma миграция: `AIWorkflow.graph Json?` — колонка для node-graph представления.
- Server-side типы графа: `WorkflowGraph`, `WorkflowNode`, `WorkflowEdge`, `NodeData`, `NODE_REGISTRY` (initial) в `src/server/workflow/types.ts`.
- Workflow helpers (`src/server/workflow/helpers.ts`):
  - `tryWithFallback(providers)` — каскадный вызов list-of-thunks.
  - `uploadFromExternalUrl(url, { workspaceId })` — server-side перекачка внешнего URL → S3 с SSRF-guard.
  - `buildReflectionPrompt(style, intensity)` — шаблон промпта.
  - `postProcessToTransparent(rgbaUrl)` — обёртка вызова bg-removal для финального прозрачного PNG.
- AI-реестр дополняется 3 Replicate-моделями (`bria/product-cutout`, `bria/product-shadow`, `black-forest-labs/flux-kontext-pro`, `851-labs/background-remover`) через новую низкоуровневую функцию `invokeReplicateModel(slug, input)` — её же использует `ReplicateProvider.callReplicate`.
- Action handlers в `src/server/agent/executeAction.ts`:
  - `case "remove_background"` — primary: `bria/product-cutout`, fallback: `851-labs/background-remover`, final-fallback: `cjwbw/rembg`. SSRF guard на входном URL, результат перекачивается в наш S3.
  - `case "add_reflection"` — primary: `bria/product-shadow`, fallback: `black-forest-labs/flux-kontext-pro`. Если модель вернула непрозрачный фон — прогнать через `postProcessToTransparent`.
- REST endpoint `/api/workflow/execute-node` (`src/app/api/workflow/execute-node/route.ts`):
  - `export const maxDuration = 300;` (Yandex Cloud allow-list AI routes).
  - `POST` auth через `auth()` из NextAuth.
  - Request body: `{ actionId: "remove_background" | "add_reflection"; params: Record<string, unknown>; inputs: Record<string, { imageUrl: string }>; workspaceId: string; workflowId?: string }`.
  - Response: `{ success: true, type: "image", imageUrl: string } | { error: string, requestId: string }`.
  - Rate-limit: **stub** — использует существующий `checkRateLimit` с тем же лимитом, что `/api/ai/generate` (30/min). Полный REQ-07 (20/hr/user + UI) планируется в Phase 4.
- Unit-тесты (`src/app/api/workflow/__tests__/execute-node.test.ts` + `src/server/workflow/__tests__/helpers.test.ts`):
  - happy path (mock Replicate → S3 URL возвращается);
  - SSRF guard (приватный IP на входе → 400);
  - fallback cascade (primary throws → secondary success);
  - unauthenticated → 401.

**Does NOT ship:**
- UI для `/workflows` (Phase 2).
- Клиентский executor / Run button (Phase 4).
- Cost-tracking per-node с `workflowId` (defer — требует миграции AIMessage/AISession, перенесено в v1.1).
- Rate-limit UX (20/hr visible counter) — Phase 4.
- Progress events (SSE/WS) — Phase 4.
- Cache для identical inputs — Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Database
- **D-01:** Добавить одну колонку `AIWorkflow.graph Json?` через Prisma migration (REQ-01). Backward-compatible: existing workflows без `graph` продолжают работать через `steps` (legacy-агент). Миграция: `npx prisma migrate dev --name add-workflow-graph`.
- **D-02:** Cost-tracking per-node run в Phase 1 **не делаем** (нет REQ на это в REQUIREMENTS.md Phase 1). `AIMessage` пишется по legacy-пути только когда action вызван из LLM-агента. Для executeAction.ts-вызовов через `/api/workflow/execute-node` не пишется ничего — оставляем как TODO для v1.1 (упомянуто в Deferred).

> **Важно:** REQ-08 — это `maxDuration = 300` на endpoint, НЕ cost-tracking. Реализуется в task 4.1 (`export const maxDuration = 300;`).

### Server runtime
- **D-03:** Endpoint называется `/api/workflow/execute-node` (REST, не tRPC) — `maxDuration = 300` нужен для Replicate cold-start (до 60s+). tRPC mutations не имеют per-route maxDuration controls в нашей конфигурации.
- **D-04:** Body format — **resolved** inputs. Клиент сам разрешает upstream outputs и передаёт `inputs: { "image-in": { imageUrl } }`. Никаких `assetId → URL` lookup на сервере (это Phase 2 concerns).
- **D-05:** Auth — простой `await auth()` + 401. Rate-limit через `checkRateLimit(\`workflow-node:${userId}\`, { limit: 30, windowSeconds: 60 })`. Full quotas в Phase 4.
- **D-06:** Workspace access check — `await assertWorkspaceAccess(ctx, workspaceId)` перед любыми AI-вызовами. Защищает от cross-workspace API abuse.

### AI providers
- **D-07:** `remove_background` cascade: `bria/product-cutout` → `851-labs/background-remover` → `cjwbw/rembg`. Bria — коммерчески безопасная модель, оптимизированная для e-commerce product shots; остальные — community fallback.
- **D-08:** `add_reflection` cascade: `bria/product-shadow` → `black-forest-labs/flux-kontext-pro`. Bria делает честный reflection, FLUX Kontext — общий inpainter с prompting.
- **D-09:** **Нет Gemini** в этой фазе (решение из research: Gemini 2.5 Flash Image не умеет alpha channel).
- **D-10:** После `add_reflection` — если провайдер не вернул RGBA (например, FLUX Kontext делает JPEG-like), прогоняем результат через `remove_background` ещё раз для финального прозрачного PNG. Это описано в `postProcessToTransparent`.

### Shared types
- **D-11:** `NODE_REGISTRY` в Phase 1 содержит только те типы нод, handlerы которых есть на сервере: `removeBackground`, `addReflection`. `imageInput`/`assetOutput` — client-side, регистрируются в Phase 3.
- **D-12:** Типы живут в `src/server/workflow/types.ts` и **не импортируются клиентом** (это задача Phase 2 — вынести shared types в `src/shared/workflow/types.ts` или использовать `zod` + `trpc` infer).

### Helpers
- **D-13:** `tryWithFallback<T>(providers: Array<() => Promise<T>>): Promise<T>` — iterate, catch error, пробует следующий. Если все упали — throws aggregated error. Логирует каждую попытку через `console.warn` с именем провайдера.
- **D-14:** `uploadFromExternalUrl(url, { workspaceId })` — переиспользует `safeFetch(url, {...}, uploadImagePolicy())` из ssrfGuard, S3Client из существующего asset router. Пишет в prefix `workflow-runs/${workspaceId}/${uuid}.{ext}`. Возвращает `{ s3Url, s3Key, contentType, sizeBytes }`.
- **D-15:** `buildReflectionPrompt(style = "subtle", intensity = 0.3)` — RU/EN шаблон типа `"Generate a soft reflection of the product below it, opacity ${intensity}, style ${style}, transparent background, high fidelity"`. Параметры ограничены enum'ами.
- **D-16:** `postProcessToTransparent(url)` — вызывает `remove_background` handler внутренне (re-entry через executor, не через HTTP).

### Testing
- **D-17:** Unit-тесты — mock `callReplicate` / `safeFetch` / `s3.send` через Vitest's `vi.mock`. Никаких реальных HTTP запросов.
- **D-18:** Тестовые кейсы (обязательные):
  1. `remove_background` happy path (mock primary success → returns S3 URL).
  2. `remove_background` cascade (mock primary throws, secondary returns → S3 URL из secondary).
  3. `remove_background` all-fail (все провайдеры throw → returns ActionResult `{ success: false, type: "error" }`).
  4. `add_reflection` with post-process (mock FLUX Kontext returns non-RGBA, post-process re-runs remove_background).
  5. `/api/workflow/execute-node` unauthorized (no session → 401).
  6. `/api/workflow/execute-node` SSRF block (imageUrl = `http://127.0.0.1:8080/x.png` → 400).
  7. `/api/workflow/execute-node` happy path end-to-end (mocked).

### Out-of-scope
- Никакой client code в Phase 1. `.planning/phases/01-*` вообще не касается `platform-app/src/app/workflows/*` или `platform-app/src/components/workflow/*`.
- Никаких изменений в `src/server/agent/orchestrator.ts` / `llmProviders.ts` — legacy agent остаётся нетронутым.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research pack
- `.planning/research/STACK.md` — выбор моделей, DAG-runtime, DB-форма.
- `.planning/research/ARCHITECTURE.md` — hybrid runtime, NODE_REGISTRY contract, 6-phase build order.
- `.planning/research/PITFALLS.md` — P0 риски (cold-start, URL expiration, SSRF, cost blow-up).
- `.planning/research/SUMMARY.md` — сводный entry-point.
- `.planning/REQUIREMENTS.md` — 28 falsifiable REQ-IDs с phase allocation.
- `.planning/ROADMAP.md` — §"Phase 1 · DB + Server AI Actions".

### Existing code (must respect patterns)
- `platform-app/prisma/schema.prisma:410` — текущая модель `AIWorkflow`.
- `platform-app/src/server/security/ssrfGuard.ts` — `safeFetch`, `uploadImagePolicy`, `SsrfBlockedError` (REQ-23 compliance).
- `platform-app/src/app/api/upload/route.ts` — образец URL-mode загрузки через `safeFetch` + `S3Client.send(PutObjectCommand)`.
- `platform-app/src/server/routers/asset.ts:27` — `S3Client` configuration pattern (Yandex Object Storage).
- `platform-app/src/lib/ai-providers.ts:348` — `ReplicateProvider.callReplicate` — образец polling Replicate API (30s timeout on create, poll with exponential backoff).
- `platform-app/src/lib/ai-models.ts:72` — `MODEL_REGISTRY` структура `ModelEntry`.
- `platform-app/src/server/agent/executeAction.ts:36` — switch-based dispatch, куда добавляются новые cases.
- `platform-app/src/server/actionRegistry.ts:31` — `ActionContext` shape (`userId`, `workspaceId`, `projectId?`, `prisma`).
- `platform-app/src/app/api/ai/generate/route.ts:1-14` — образец Next.js route с `maxDuration = 300`, auth, `checkRateLimit`.
- `platform-app/src/lib/rateLimit.ts` — `checkRateLimit(key, { limit, windowSeconds })`.
- `platform-app/src/server/authz/guards.ts` — `assertWorkspaceAccess`.

</canonical_refs>

<specifics>
## Specific Ideas

- **NODE_REGISTRY в Phase 1 — только server-side handlers.** Серверный код не должен ссылаться на `imageInput`/`assetOutput` (client-only). Client-side регистр — отдельная проблема Phase 3.
- **Replicate polling повторно.** Использовать существующий polling code в `ai-providers.ts:348-480`. Не дублировать. Один из способов — экспортировать `invokeReplicateModel(slug, input)` из `ai-providers.ts`, использующий тот же polling helper.
- **Cost tracking deferred.** Не пишем `AIMessage.workflowId` — не меняем schema вокруг `AIMessage`. Когда Phase 4 будет делать UI для progress, вернёмся к этому в v1.1.
- **S3 prefix для workflow assets:** `workflow-runs/${workspaceId}/${uuid}.{ext}` — отделяет от `canvas-images/{projectId}`, чтобы можно было быстро чистить.

</specifics>

<deferred>
## Deferred Ideas

- **Real rate-limit quotas (20/hr/user с UI):** Phase 4 (REQ-07).
- **Cost-tracking per-node run:** v1.1 (требует мини-схему `WorkflowRun` или nullable `AIMessage.sessionId`).
- **Per-node progress events (SSE/WebSocket):** Phase 4 (REQ-17).
- **Result caching (dedupe identical input hashes):** Phase 4 или позже (REQ-26, если нужно).
- **Gemini 2.5 Flash Image as fallback for bg-removal:** Вычеркнуто окончательно (PITFALLS §"Gemini alpha channel").

</deferred>

---

*Phase: 01-db-server-ai-actions*
*Context gathered: 2026-04-24 via quick-context (4 clarifying questions + research pack consolidation)*
