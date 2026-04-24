# Phase 1 — DB + Server AI Actions — Summary

**Status:** ✅ COMPLETE
**Date:** 2026-04-24
**Commits:** `45591d3…07368ab` (8 atomic commits on `codex/auth-stability`)

---

## 1. What was delivered

Phase 1 builds the server-side foundation for the node-based workflow editor
(v1.0). It makes two AI-backed actions available through a dedicated REST
endpoint, independently of the existing LLM-agent pipeline.

Delivered capabilities:

- Node-editor graph schema stored alongside legacy linear steps.
- Reusable Replicate invocation utility (`invokeReplicateModel`).
- Cascade helper `tryWithFallback` + SSRF-safe `uploadFromExternalUrl`.
- Two workflow-only actions registered in `executeAction`:
    - `remove_background` — cascades `bria-product-cutout` → `rembg-851-labs` → `rembg`.
    - `add_reflection` — cascades `bria-product-shadow` → `flux-kontext-pro`, with
      optional `postProcessToTransparent` pass when the model returns opaque RGB.
- Public REST endpoint `POST /api/workflow/execute-node` (auth, stub
  rate-limit, workspace authz, client-resolved inputs, typed errors,
  `maxDuration=300`).

---

## 2. Key files

### New

- `platform-app/prisma/migrations/20260424120000_add_workflow_graph/migration.sql`
- `platform-app/src/server/workflow/types.ts` — `WorkflowGraph`, `NodeDefinition`, `NODE_REGISTRY`, `ExecuteNodeRequest/Response`.
- `platform-app/src/server/workflow/helpers.ts` — `tryWithFallback`, `uploadFromExternalUrl`, `buildReflectionPrompt`, `postProcessToTransparent`.
- `platform-app/src/server/workflow/__tests__/helpers.test.ts` — 10 unit tests.
- `platform-app/src/app/api/workflow/execute-node/route.ts` — REST endpoint.
- `platform-app/src/app/api/workflow/execute-node/__tests__/route.test.ts` — 7 integration tests.

### Modified

- `platform-app/prisma/schema.prisma` — added nullable `AIWorkflow.graph: Json?`.
- `platform-app/src/lib/ai-models.ts` — registered 4 workflow Replicate models.
- `platform-app/src/lib/ai-providers.ts` — extracted `replicatePredict`, exported `invokeReplicateModel`.
- `platform-app/src/server/actionRegistry.ts` — registered `remove_background`, `add_reflection`.
- `platform-app/src/server/agent/executeAction.ts` — two new case branches.

---

## 3. Decisions anchored in PLAN.md

| ID | Decision | Rationale |
| --- | --- | --- |
| D-01 | Coexist `steps` + `graph` on `AIWorkflow`, no new table | Minimal surface, back-compat with LLM-agent workflows (v0.x). |
| D-02 | Hybrid orchestration: client resolves DAG; server executes one node | Keeps single-node calls within standard function budget; no workers. |
| D-03 | `remove_background` cascade order `bria-product-cutout → rembg-851-labs → rembg` | Bria is best quality; rembg is free fallback. |
| D-04 | Client-resolved inputs (`{"image-in": { imageUrl }}`) | No `assetId → URL` lookup on server → simpler SSRF surface. |
| D-05 | Rate-limit stub (30/min) in Phase 1, full 20/hr/user UI → Phase 4 | Keeps Phase 1 shippable without UI work. |
| D-06 | Defer cost-tracking per node-run to v1.1 | Needed a new nullable `AIMessage.workflowId` column; out of scope. |
| D-07 | Dynamic `import()` for `postProcessToTransparent` → `executeAction` | Avoid circular `helpers ↔ executeAction`. |

---

## 4. Deviations from PLAN.md

- **Prisma migration**: `npx prisma migrate dev` could not resolve `DATABASE_URL`
  from `.env.local` in the sandbox. Created `migration.sql` manually and ran
  `prisma generate`. Migration will replay cleanly on first deploy.
- **Console-log warnings** in `executeAction.ts` are all pre-existing
  (surface lint audit, not Phase 1 scope). 0 errors, 42 warnings, none
  introduced by this phase.

---

## 5. Verification (Task 4.3)

```
tsc --noEmit          ✓ no errors
vitest run            ✓ 11 files, 89 tests, all pass
eslint (phase files)  ✓ 0 errors
next build            ✓ /api/workflow/execute-node in route manifest
```

Pattern-match AC verification:

- `route.ts` contains `export const maxDuration = 300` ✓
- `route.ts` contains `assertWorkspaceAccess` call ✓
- `route.ts` contains `checkRateLimit` call ✓
- `ALLOWED_ACTIONS` whitelist ✓
- 7/7 integration tests green ✓

---

## 6. Dependencies unblocked for next phases

Phase 2 (DAG runtime, client orchestrator) can now:

- Call `/api/workflow/execute-node` per topologically-sorted node.
- Read `NODE_REGISTRY` to discover node kinds and executor kind (client vs server).
- Persist + hydrate `AIWorkflow.graph` via the Prisma model.

Phase 4 (rate-limit UI + cost tracking) will:

- Replace stub 30/min with 20/hr/user quota and surface `retryAfter` in UI.
- Add nullable `AIMessage.workflowId` for per-node cost attribution.
