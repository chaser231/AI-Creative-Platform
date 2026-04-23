# Phase 2 — Editor Canvas + tRPC CRUD

**Status:** ✅ Complete
**Branch:** `ai-workflows-creative`
**Executed:** 2026-04-24, single-session inline sequential

## Goal

Build the graph-mode workflow editor shell so creators can:

1. Reach a dedicated `/workflows` hub separate from legacy chat-LLM workflows.
2. Create, open, and auto-save a blank workflow backed by the new
   `AIWorkflow.graph` column (added in Phase 1).
3. Drag nodes from a palette, wire them together, and have the graph persist
   without needing a real execution runtime (Phase 4).

Phase 2 deliberately does **not** ship: inspector panel, run button, real
styling, preset library. Those land in Phase 3 (UI polish), Phase 4 (DAG
runtime), Phase 5 (presets).

## Waves

| # | Scope | Commit |
|---|-------|--------|
| 1 | Dependencies + Zod `workflowGraphSchema` | `726f09b` |
| 2 | `workflowRouter.{saveGraph,loadGraph}` + `list` legacy filter | `e3f7a20` |
| 3 | `useWorkflowStore` (graph / viewport / runState slices) | `d0ebb33` |
| 4 | `/workflows{,/new,/[id]}` pages + `WorkflowEditorShell` dynamic-import | `85395e5` |
| 5 | Placeholder nodes, palette, topbar, `useWorkflowAutoSave` | `238f968` |
| 6 | Verification gates (this summary) | – |

## Deliverables

### New files

**Schema & types**
- `src/lib/workflow/graphSchema.ts` — Zod schema + `emptyWorkflowGraph()`.

**Zustand store**
- `src/store/workflow/types.ts`
- `src/store/workflow/createGraphSlice.ts`
- `src/store/workflow/createViewportSlice.ts`
- `src/store/workflow/createRunStateSlice.ts`
- `src/store/workflow/useWorkflowStore.ts`

**Pages**
- `src/app/workflows/page.tsx` — list grid.
- `src/app/workflows/new/page.tsx` — Suspense-wrapped creator + `?preset=` stub.
- `src/app/workflows/[id]/page.tsx` — thin wrapper; unwraps `params` promise.

**Components**
- `src/components/workflows/WorkflowEditorShell.tsx` — `dynamic({ssr:false})` shell.
- `src/components/workflows/WorkflowEditor.tsx` — xyflow canvas + palette + topbar.
- `src/components/workflows/NodePalette.tsx` — draggable sidebar.
- `src/components/workflows/NodeTopbar.tsx` — name input + save status + buttons.
- `src/components/workflows/nodes/BaseNode.tsx`
- `src/components/workflows/nodes/index.tsx` — `nodeTypes` map.

**Hook**
- `src/hooks/workflow/useWorkflowAutoSave.ts`

### Modified files

- `src/server/routers/workflow.ts` — added `saveGraph`, `loadGraph`, extended
  `list` with `includeLegacy` flag (default `false`).
- `platform-app/package.json` — added `@xyflow/react@^12`, `graphology@^0.25`,
  `graphology-dag@^0.4`.

### New tests (21 total)

- `src/lib/workflow/__tests__/graphSchema.test.ts` — 5 cases.
- `src/server/routers/__tests__/workflow.graph.test.ts` — 6 cases.
- `src/store/workflow/__tests__/graphSlice.test.ts` — 7 cases.
- `src/hooks/workflow/__tests__/useWorkflowAutoSave.test.tsx` — 3 cases.

## Locked-in decisions (Phase 2)

| ID | Decision | Rationale |
|----|----------|-----------|
| D-08 | Extend existing `workflowRouter` with `saveGraph`/`loadGraph`; `list` gains `includeLegacy` flag | Avoid a parallel router; legacy chat UI keeps using the same API. |
| D-09 | `useWorkflowStore` composed of slices (graph / viewport / runState-stub) | Matches `canvasStore` convention; RunStateSlice ships now so Phase 4 has no refactor cost. |
| D-10 | 2 s debounced auto-save + `beforeunload` flush; last-write-wins | Simple UX, zero server-side version tracking. Revisit if we add collab editing. |
| D-11 | Bare placeholder node cards (correct handles, minimal styling) | Style + inspector are Phase 3's job. |
| D-12 | `?preset=X` supported as a logged stub | Reserves the URL surface for Phase 5 preset library. |
| D-13 | All `/workflows/*` routes are `"use client"`; editor wrapped in `next/dynamic({ssr:false})` | `useWorkspace()` is client-only (React context + localStorage). xyflow needs `window`/`ResizeObserver`. |

## Verification gates

| Gate | Command | Result |
|------|---------|--------|
| Type-check | `npx tsc --noEmit` | ✅ clean |
| Unit + integration | `npx vitest run` | ✅ 113/113 pass (15 files) |
| Lint (Phase 2 scope) | `npx eslint src/{app,components,store,lib,hooks}/**/workflow* src/server/routers/workflow.ts` | ✅ 0 errors, 1 pre-existing warning (`any` on L360 of `workflow.ts`, not ours) |
| Production build | `next build` | ✅ clean; `/workflows` static, `/workflows/[id]` dynamic, `/workflows/new` static |

## Architectural notes worth preserving

- **`nodeTypes` keys === `WorkflowNodeType` union.** React Flow looks up
  components by `node.type`. The registry is the single source of truth; if
  a new node is added, it *must* be added to `NODE_REGISTRY` and
  `nodeTypes` simultaneously. Phase 3's inspector will read the same
  registry for port rendering.
- **Legacy filter in `list`.** Without `includeLegacy: true`, we Prisma-filter
  `graph: { not: Prisma.DbNull }`. This hides chat-LLM workflows from the
  `/workflows` grid but keeps the old AI-chat UI unaffected.
- **`useWorkflowAutoSave` test duplication.** The repo has no `jsdom` /
  `@testing-library/react`, so we can't `renderHook`. The scheduling loop
  is re-implemented inside the test file; a comment at the top of the hook
  warns the next editor to mirror any behavioural changes. This is fragile
  but cheap — if we ever add `@testing-library/react` for another feature,
  replace the clone with a real `renderHook` test.
- **`beforeunload` save is best-effort.** We can't await the mutation; we
  just fire it. React Query retries on new window events. If the user
  force-closes the tab before the fetch flushes, the last <2 s of edits
  can still be lost. Accept this until collab editing is on the roadmap.

## What Phase 3 picks up

- Real node visual design (icons, inspector previews, error badges reading
  `runState`).
- Port-type-aware connection validation (currently any handle connects to
  any handle — Zod schema doesn't enforce compatibility yet).
- Inspector panel for `updateNodeParams` (the store API is ready).
- UI for the `Run` button (currently disabled).

## What to watch for

- **Drag-drop on MiniMap / Controls.** The RF `onDrop` on `ReactFlow` will
  receive events even when dropping onto the minimap. If this becomes a
  UX annoyance, `nodeOrigin` + `onNodesChange` can filter.
- **`use(params)` in `[id]/page.tsx`.** Next.js 16's async params API is
  stable, but if it ever gets deprecated for a replacement, this is the one
  line to update.
