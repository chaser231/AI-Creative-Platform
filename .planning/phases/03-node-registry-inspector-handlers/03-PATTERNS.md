# Phase 3 — Patterns Map

**Mapped:** 2026-04-24
**Files analyzed:** 10 new + 6 edited
**Analogs found:** 10 / 10 new files (1 partial)

This document maps every new file Phase 3 will introduce to its closest existing analog in `platform-app/`, with concrete patterns to copy and patterns to deliberately avoid. The planner consumes this directly when authoring per-plan action items.

---

## File Classification

| New / Edited file | Role | Data flow | Closest analog | Match |
|-------------------|------|-----------|----------------|-------|
| `components/workflows/NodeInspector.tsx` | component (panel) | request-response (store-driven) | `components/workflows/NodePalette.tsx` | role + sibling |
| `components/workflows/inspector/renderField.tsx` | helper (switch by type) | transform | `lib/workflow/graphSchema.ts` (Zod patterns) + `editor/properties/CompactInput.tsx` (input shape) | partial |
| `components/workflows/inspector/ImageSourceInput.tsx` | component (composite input) | request-response | `components/ui/ReferenceImageInput.tsx` (upload pattern) + `editor/properties/PropertiesPanel.tsx::handleBgFilePick` (presign flow) | role-match |
| `lib/workflow/connectionValidator.ts` | utility (pure fn) | transform | `lib/workflow/graphSchema.ts` (sibling, pure) | exact role |
| `lib/workflow/__tests__/connectionValidator.test.ts` | test | n/a | `lib/workflow/__tests__/graphSchema.test.ts` | exact |
| `lib/workflow/nodeParamSchemas.ts` | utility (Zod schemas) | transform | `lib/workflow/graphSchema.ts` | exact |
| `lib/workflow/__tests__/nodeParamSchemas.test.ts` | test | n/a | `lib/workflow/__tests__/graphSchema.test.ts` | exact |
| `store/workflow/clientHandlers.ts` | service (thin wrapper, no store ties) | request-response (tRPC) | `server/workflow/helpers.ts` (function-export, dispatch table) | role-match |
| `store/workflow/__tests__/clientHandlers.test.ts` | test | n/a | `server/workflow/__tests__/helpers.test.ts` (mock-heavy) | exact |
| `components/assets/AssetPickerModal.tsx` | component (modal) | request-response (tRPC) | `components/editor/AssetLibraryModal.tsx` (slim + extract) | exact (extract) |

---

## New files

### 1. `platform-app/src/components/workflows/NodeInspector.tsx`

- **Analog:** `platform-app/src/components/workflows/NodePalette.tsx` (sibling client-component, also store-reading).
- **Copy:**
  - File header comment style — short JSDoc explaining role + Phase boundary, like `NodePalette.tsx` lines 3-8.
  - `"use client"` directive on line 1, blank line, JSDoc, blank line, imports.
  - Import order (matches `NodePalette.tsx` lines 10-11): React → external libs (`@xyflow/react`) → `@/` aliases → `./` relative.
  - Use `useWorkflowStore((s) => s.fieldName)` selector form (single-field selectors, NOT `useShallow`) — see `WorkflowEditor.tsx` lines 61-65.
  - Tailwind dark-mode pattern: `bg-white dark:bg-neutral-950 border-neutral-200 dark:border-neutral-800` — matches `NodePalette.tsx` line 33 and `NodeTopbar.tsx` line 51.
  - Russian inline strings (REQ-14, D-20): "Параметры", "Сбросить параметры", category-badge labels — see `NodePalette.tsx` `CATEGORY_LABELS` lines 13-17 for pattern.
  - Empty-state JSX block when 0 or >1 nodes selected — analogous to the empty-state branch in `AssetLibraryModal.tsx` lines 313-322.
- **Deviate:**
  - Don't use the `bg-bg-surface` / `text-text-primary` design-tokens used in `editor/properties/PropertiesPanel.tsx`; the **workflows** subtree uses **raw Tailwind palette** (`bg-neutral-50`, `text-neutral-900`) per `NodePalette.tsx` and `BaseNode.tsx`. Stay consistent with the workflows subtree, not the editor subtree.
  - Don't reach for `useShallow` from `zustand/react/shallow` (used in `editor/properties/PropertiesPanel.tsx` lines 43-51) — workflows store usage in this codebase uses individual selector calls (`WorkflowEditor.tsx` lines 61-65). Stay consistent.
  - Don't subscribe to a `selectedNodeId` field — it doesn't exist in `useWorkflowStore`. Read selection from React Flow's `useStore` or pass through `onSelectionChange` on `<ReactFlow>`. Planner must decide; recommended path: derive from `useStore((s) => s.nodes.find(n => n.selected))` of `@xyflow/react`.

---

### 2. `platform-app/src/components/workflows/inspector/renderField.tsx`

- **Analog (partial):** No exact analog — the codebase has no Zod-driven form renderer. Closest references:
  - `platform-app/src/lib/workflow/graphSchema.ts` lines 18-46 — pattern for narrowing Zod types with `satisfies z.ZodType<T>`.
  - `platform-app/src/components/editor/properties/CompactInput.tsx` lines 1-28 — minimal controlled-input shape (`value`, `onChange`, label) to mirror per-branch.
  - `platform-app/src/components/ui/Select.tsx` (read-on-demand) — for the enum branch dropdown.
- **Copy:**
  - `"use client"` + JSDoc header (≤5 lines) describing the dispatch contract.
  - Switch-style dispatch via `definition.typeName`-discriminated branches, analogous to how `NodePalette.tsx` lines 27-30 dispatches by category.
  - One small pure function exported per file is the workflows convention (see `lib/workflow/graphSchema.ts::emptyWorkflowGraph` lines 49-51) — `renderField` should be a single named export with no React hooks of its own (caller owns state).
  - Inline Russian error/help copy (D-20).
- **Deviate:**
  - Do NOT introduce `react-hook-form` / `@hookform/resolvers` (D-14 explicitly rejects).
  - Do NOT mirror `editor/properties/PropertiesPanel.tsx` 533-line monolith. Inspector form code stays in `inspector/` subfolder, one helper per concern.
  - Avoid magic-string field names — the function should accept a typed `field: { key, schema, value, onChange }` shape, not `Record<string, unknown>`.
  - Do NOT call `updateNodeParams` on every keystroke for invalid values. CONTEXT D-14 mandates Zod `safeParse` gate before pushing to store.

---

### 3. `platform-app/src/components/workflows/inspector/ImageSourceInput.tsx`

- **Analog:** `platform-app/src/components/ui/ReferenceImageInput.tsx` lines 1-80 (upload + preview + drag-drop) **plus** `platform-app/src/components/editor/properties/PropertiesPanel.tsx::handleBgFilePick` lines 57-81 (uses `uploadForAI` from `@/utils/imageUpload`).
- **Copy:**
  - `"use client"` + JSDoc header explaining the three modes (D-15: asset / url / upload).
  - File-input via `useRef<HTMLInputElement>(null)` + hidden `<input type="file">` — see `ReferenceImageInput.tsx` lines 49-67 + `PropertiesPanel.tsx` line 53.
  - Upload pipeline: read file as base64 (`FileReader.readAsDataURL`) → `await uploadForAI(base64, "workflow-input")` from `@/utils/imageUpload` (already exported). Mirrors `PropertiesPanel.tsx` lines 60-66.
  - Tab/segmented-control switching between three modes — pattern reference: scope tabs in `AssetLibraryModal.tsx` lines 228-246 (button-group with active highlight).
  - Open `<AssetPickerModal>` (file #10) when user clicks "Из библиотеки" tab and picks a value.
- **Deviate:**
  - Do NOT depend on `useCanvasStore` (the editor analog does — line 12 of `ReferenceImageInput.tsx` neighbors). Workflows are decoupled from the canvas store.
  - Do NOT carry `onFilesAdded` side-channel callback (`ReferenceImageInput.tsx` lines 32-37). Workflows nodes hold a single value, not an asset-library mirror.
  - Do NOT roll your own image compression — `uploadForAI` already handles base64 → S3.
  - URL mode: validate with the same Zod `z.string().url()` from `nodeParamSchemas.ts` (file #6); accept `data:` URLs explicitly (CONTEXT D-15).

---

### 4. `platform-app/src/lib/workflow/connectionValidator.ts`

- **Analog:** `platform-app/src/lib/workflow/graphSchema.ts` (sibling — pure validator, no React).
- **Copy:**
  - File header JSDoc style — see `graphSchema.ts` lines 1-8 (3-5 line summary explaining consumers).
  - Single named export (`isValidConnection`), function declaration (not arrow exported as const) — matches `graphSchema.ts::emptyWorkflowGraph` lines 49-51.
  - Type imports: `import type { WorkflowNode } from "@/server/workflow/types";` and `import type { Connection } from "@xyflow/react";` — mirror the type-only import style of `graphSchema.ts` lines 11-16.
  - Use `NODE_REGISTRY[node.type]` lookup pattern — already used by `BaseNode.tsx` line 27 and `createGraphSlice.ts` line 29.
  - The CONTEXT snippet at lines 171-188 of `03-CONTEXT.md` is the **exact API contract** — planner should not invent a different signature.
- **Deviate:**
  - Do NOT reach for `react-flow` runtime — pass `nodes` in as a parameter (CONTEXT contract). Keeps the function pure and unit-testable from Node without jsdom.
  - Do NOT throw on missing nodes/ports — return `false`. xyflow expects a boolean.

---

### 5. `platform-app/src/lib/workflow/__tests__/connectionValidator.test.ts`

- **Analog:** `platform-app/src/lib/workflow/__tests__/graphSchema.test.ts` lines 1-73.
- **Copy:**
  - Imports: `import { describe, it, expect } from "vitest";` then path-aliased subject under test (`@/lib/workflow/connectionValidator`).
  - Single top-level `describe("isValidConnection", () => { ... })`.
  - One `it()` per branch: image→image valid, image→mask invalid, any→image valid, image→any valid, missing source node returns false, missing target node returns false, missing source port returns false, missing target port returns false. Cover the full PortType matrix (`image | mask | text | number | any`) since CONTEXT D-18 calls it out as the validator's purpose.
  - No `beforeEach`/`afterEach` (pure function — no state to reset). Matches `graphSchema.test.ts`.
- **Deviate:**
  - Don't import the React Flow runtime (`@xyflow/react`) — type-only import for `Connection` if needed (`import type { Connection } from "@xyflow/react";`). Tests must run in Node without DOM.

---

### 6. `platform-app/src/lib/workflow/nodeParamSchemas.ts`

- **Analog:** `platform-app/src/lib/workflow/graphSchema.ts` (same folder, same role).
- **Copy:**
  - JSDoc header (lines 1-8 of `graphSchema.ts` style) listing consumers (Inspector form, future executor validation).
  - `import { z } from "zod";` then type imports from `@/server/workflow/types`.
  - `satisfies z.ZodType<T>` narrowing pattern (lines 18-46 of `graphSchema.ts`) — pin each schema to its expected param shape so a future drift in `NODE_REGISTRY` defaults breaks at compile time.
  - One `export const ___ParamsSchema` per node type. CONTEXT lines 155-160 specifies the exact shapes (this is the v1.0 minimum).
  - One dispatch map: `export const NODE_PARAM_SCHEMAS: Record<WorkflowNodeType, z.ZodType<unknown>> = { imageInput: ..., removeBackground: ..., addReflection: ..., assetOutput: ... }` — mirrors the `nodeTypes` map in `components/workflows/nodes/index.tsx` lines 29-34.
- **Deviate:**
  - Don't extend `workflowGraphSchema` to validate params at the graph level — keep it separate so save-graph stays permissive (graph store can hold mid-edit params; only Inspector enforces per-node schemas at write time, per D-14).
  - Use Zod v4 syntax (project is on Zod v4 per CONTEXT D-14 rationale). Use `.refine(d => d.assetId || d.sourceUrl, ...)` for the `imageInput` "either-or" rule shown in CONTEXT line 157.

---

### 7. `platform-app/src/lib/workflow/__tests__/nodeParamSchemas.test.ts`

- **Analog:** `platform-app/src/lib/workflow/__tests__/graphSchema.test.ts` lines 1-73.
- **Copy:**
  - Same `vitest` imports, same top-level `describe` per schema export.
  - Test the four locked shapes from CONTEXT lines 155-160: defaults round-trip, enums reject unknown values, `imageInput` refine rejects when both `assetId` and `sourceUrl` are missing, `addReflection.intensity` clamps to `[0, 1]`.
  - Use `safeParse` and assert `result.success` boolean — matches `graphSchema.test.ts` lines 9-10.
- **Deviate:**
  - Don't snapshot test full schemas (brittle on Zod minor versions); assert specific field outcomes only.

---

### 8. `platform-app/src/store/workflow/clientHandlers.ts`

- **Analog:** `platform-app/src/server/workflow/helpers.ts` (function-export utility module). For the API/import shape, also reference `platform-app/src/store/workflow/createGraphSlice.ts` lines 1-15 (Zustand slice imports).
- **Copy:**
  - JSDoc header explaining the Phase 4 contract (CONTEXT D-17 wording).
  - Two named exports: `imageInput`, `assetOutput` — function declarations, not slice mutators. They are **NOT** Zustand slice creators despite living under `store/workflow/`; the location reflects "this is what the executor calls", not "this lives in the store state".
  - Each function takes a single object arg `{ params, ctx }` (or `{ inputs, params, ctx }`) — `ctx` carries `{ workspaceId: string }` so handlers stay store-agnostic and unit-testable.
  - tRPC client is the **vanilla** client (`createTRPCProxyClient`), not the React hook — handlers run outside React. Reference: search the codebase for the existing vanilla client setup; if absent, planner spec needs to add one. Acceptable alternative: pass tRPC caller in via `ctx.trpc` (more testable).
- **Deviate:**
  - Do NOT call `useWorkflowStore.getState()` inside handlers — they must be store-agnostic so the Phase 4 executor can call them with arbitrary params.
  - Do NOT import React or any hook (`use*`).
  - Do NOT swallow tRPC errors — let them propagate so the executor can map them to per-node `runState` (Phase 4 concern).
  - Do NOT make Phase 3 invoke these handlers anywhere. CONTEXT D-17 is explicit: ship + tests only.

---

### 9. `platform-app/src/store/workflow/__tests__/clientHandlers.test.ts`

- **Analog:** `platform-app/src/server/workflow/__tests__/helpers.test.ts` lines 1-164 (mock-heavy unit test).
- **Copy:**
  - `vi.mock(...)` declarations at the top of the file BEFORE any imports of the subject — see `helpers.test.ts` lines 3-31. Critical: tRPC must be mocked.
  - `beforeEach(() => { ...mockReset() })` — see `helpers.test.ts` lines 121-127.
  - Assert on the mock's call args (e.g. `expect(trpcMock.asset.getById.query).toHaveBeenCalledWith({ id: "asset-1" })`) and on the returned shape (e.g. `expect(out).toEqual({ imageUrl: "https://..." })`).
  - One `describe` per handler, multiple `it` blocks for happy path + each error branch (missing assetId AND sourceUrl, tRPC error rethrown, etc).
- **Deviate:**
  - Don't pull in `@trpc/client` real instance — fully mocked. Otherwise tests depend on a server.
  - No `crypto`/UUID mocking needed (handlers don't generate IDs).

---

### 10. `platform-app/src/components/assets/AssetPickerModal.tsx`

- **Analog:** `platform-app/src/components/editor/AssetLibraryModal.tsx` lines 1-429 (full file). This is a **rename + slim** extraction, NOT a from-scratch build.
- **Copy:**
  - The header / toolbar / grid / footer structure (lines 213-417) — visual baseline.
  - tRPC query: `trpc.asset.listByWorkspace.useQuery({ workspaceId, type: "IMAGE", limit: 200 }, { enabled: open && !!workspaceId })` (lines 67-70). This is the workspace-scoped fetch we want.
  - Search + sort controls (lines 254-305) — identical UX.
  - Loading / empty states (lines 309-322).
  - The asset grid card (`<button>` per asset, lines 328-364) — copy unchanged for visual continuity.
- **Deviate:**
  - **Drop these props/features (out of picker scope, per D-16):**

  | What to drop | Where it lives in `AssetLibraryModal.tsx` | Why |
  |--------------|-------------------------------------------|-----|
  | `projectId` prop | line 18 | Picker is workspace-scoped only |
  | `useCanvasStore` coupling | lines 12-13, 37-40 | Picker must not touch canvas state |
  | `selectedImageLayer` derivation | lines 47-53 | Canvas-coupled, irrelevant |
  | `addImageLayer` / `updateLayer` actions | lines 137-153 | Canvas-coupled |
  | "На холст" / "Применить к выделению" buttons | lines 376-400 | Replaced by single `onSelect(assetId)` callback |
  | `handleExport` (lines 155-170), `handleDelete` (lines 172-186) | | Out of picker scope; library mgmt stays in old modal |
  | `deleteMutation` (lines 103-108), `ConfirmDialog` (lines 419-426) | | Same — picker is read-only |
  | Project/workspace scope tabs (lines 228-246) | | D-16: workspace-only for v1.0 |
  | `trpc.project.getById` (lines 56-59) — only used to derive workspaceId | | Picker takes `workspaceId` as a prop |

  - **New prop interface** (per CONTEXT D-16 line 51):
    ```ts
    interface AssetPickerModalProps {
        open: boolean;
        onClose: () => void;
        onSelect: (assetId: string, asset: { id: string; url: string; filename: string }) => void;
        workspaceId: string;
        multiSelect?: false; // reserved for future, default false
    }
    ```
  - On asset card click: switch from "toggle into Set" to "fire `onSelect` immediately + close" (D-16 single-select semantics).
  - The old `AssetLibraryModal.tsx` stays in place for now; only its consumers that need workspace-scoped picking migrate to the new component. Full deletion is a follow-up.

---

## Edited files (non-creation)

### `platform-app/src/components/workflows/WorkflowEditor.tsx` (188 lines)

- **Current structure:**
  - `"use client"` + JSDoc (lines 1-12).
  - `toRFNode` / `toRFEdge` adapters (lines 41-58).
  - Inner `EditorCanvas` component using `useReactFlow` (lines 60-159).
  - Outer `WorkflowEditor` wrapping with `<ReactFlowProvider>` (lines 161-188).
- **Change surface for Phase 3:**
  - Add `import { isValidConnection } from "@/lib/workflow/connectionValidator";` near line 33.
  - Wrap a closure that injects current `nodes` (read from store via `useWorkflowStore.getState().nodes` inside the callback) — pass to `<ReactFlow isValidConnection={...} />` near line 152.
  - Add `<NodeInspector />` as a sibling to `<EditorCanvas />` inside the `<ReactFlowProvider>` flex container (line 178-184). Mirrors how `<NodePalette />` is placed on the left.
  - Adjust the flex container at line 178 from `flex min-h-0 flex-1` to keep three columns: palette (left) | canvas (center, `flex-1`) | inspector (right, fixed width per CONTEXT line 167).
- **Do NOT:** Touch `onConnect`, `onNodesChange`, `onEdgesChange`, `onMove`, `onDrop` callbacks. The connection validator gates BEFORE `onConnect` fires; xyflow handles the rejection.

### `platform-app/src/components/workflows/nodes/BaseNode.tsx` (76 lines)

- **Current structure:**
  - `"use client"` + JSDoc (lines 1-9).
  - `CATEGORY_ACCENT` map (lines 20-24).
  - `BaseNode({ type, selected })` returns a card with handles (lines 26-76).
  - `data-port-type={port.type}` already plumbed on Handle elements (lines 53, 67).
- **Change surface for Phase 3:**
  - Optional: add a small param-summary line below `displayName` (line 44) that reads selected param values to render a one-line preview (e.g. `addReflection: subtle • 0.3`). Driven by the new schemas in file #6.
  - The `// Phase 3 will read data-port-type to colour valid targets.` comment (line 52) is informational — D-18 explicitly defers this to Phase 5 ("Rich port-type-aware connection coloring"). Phase 3 should leave the `data-port-type` attribute in place but NOT add the highlight CSS.
- **Do NOT:** Add `onClick` handlers to forward selection. xyflow `selected` prop already plumbs through.

### `platform-app/src/server/workflow/types.ts` (154 lines)

- **Current structure:**
  - `WorkflowNodeType` union (lines 12-16).
  - `Port`, `WorkflowNode`, `WorkflowEdge`, `WorkflowGraph` interfaces (lines 20-52).
  - `NodeExecutor` discriminated union (lines 54-56).
  - `NodeDefinition` interface (lines 58-67).
  - `NODE_REGISTRY` constant (lines 69-110).
- **Change surface for Phase 3:**
  - Enrich `defaultParams` for each entry in `NODE_REGISTRY` (lines 70-110) to match the four shapes in CONTEXT lines 155-160 (e.g. `imageInput.defaultParams = { source: "asset" }`, `addReflection` already has `{ style: "subtle", intensity: 0.3 }` — unchanged).
  - Optionally add `displayName` and `description` strings in Russian per REQ-14 / D-20 (currently English at lines 72-73, 82-83, 92-93, 102-103).
- **Do NOT:** Add new node types, change `WorkflowNodeType` union, change `NodeExecutor` shape, or add new `PortType` values. CONTEXT line 101 is explicit: "Do NOT add new node types in Phase 3."

### `platform-app/src/app/page.tsx` (439 lines)

- **Current structure:** `generationTypes` array literal at lines 72-105 with 4 entries (banner / text / photo / video). Each entry has `{ id, icon, label, gradient, iconBg, image }`.
- **Change surface for Phase 3:**
  - Add a 5th entry per CONTEXT D-19 (lines 72-79):
    ```ts
    {
      id: "workflow" as const,
      icon: <Workflow size={20} strokeWidth={1.5} />,
      label: "AI\nWorkflows",
      gradient: "gradient-card-pink",
      iconBg: "bg-pink-100 text-pink-600 dark:bg-pink-500/20 dark:text-pink-400",
      image: "/cards/workflows.png",
    },
    ```
  - Add `Workflow` to the `lucide-react` import on line 6.
  - Update `handleTileClick` (lines 170-189): add `case "workflow": router.push("/workflows"); break;` — does NOT call `createProjectMutation`.
  - Grid columns at line 251 stay `grid-cols-4` won't fit five — update to `grid-cols-5` or `lg:grid-cols-5 grid-cols-2`. Planner picks; recommend `grid-cols-5` to match the existing flat row.
- **Do NOT:** Touch the `RecentTemplates` block, the `ProjectTab` filter, or the `ProjectCard` grid below.

### `platform-app/src/app/globals.css` (lines 247-283 are the relevant section)

- **Current structure:** 4 light-mode `.gradient-card-*` classes (lines 248-266) and 4 dark-mode overrides (lines 269-283).
- **Change surface for Phase 3:** Append two new rules (CONTEXT D-19 line 75):
  ```css
  .gradient-card-pink {
    background: linear-gradient(145deg, #FDF2F8 0%, #FCE7F3 100%);
    /* Pink 50 -> Pink 100 */
  }

  .dark .gradient-card-pink {
    background: linear-gradient(145deg, #2A1525 0%, #3A1830 100%);
  }
  ```
  Place after `.gradient-card-green` (line 266) and after `.dark .gradient-card-green` (line 283) respectively, to preserve light/dark grouping.
- **Do NOT:** Touch the existing 4 gradients or the `.ai-gradient-text` class above (line 240).

### `platform-app/src/components/dashboard/NewProjectModal.tsx` (219 lines)

- **Current structure:**
  - `goals` array (lines 20-50) with 4 entries — drives the `Тип проекта` selector (lines 144-176).
  - `handleCreate` (lines 63-113) creates a project via tRPC and routes to `/photo/:id` or `/editor/:id?mode=...`.
- **Change surface for Phase 3 (CONTEXT D-19 line 79 — "provisionally yes"):**
  - Add a 5th `goals` entry: `{ value: "workflow", label: "Workflow", description: "Визуальный редактор pipeline'ов", icon: <Workflow size={24} /> }`.
  - Add `Workflow` to the `lucide-react` import line 11.
  - Modify `handleCreate` to route to `/workflows/new` (or equivalent) when `goal === "workflow"` BEFORE calling `createProjectMutation`. Workflow creation has its own dedicated flow (CONTEXT D-19 line 78) — bypass the project-create path entirely.
  - Update `ProjectGoal` type (`@/types`) to include `"workflow"` if not already present. Planner: verify before editing.
  - Grid `grid-cols-4` at line 148 → `grid-cols-5` (or wrap; designer call).
- **Do NOT:** Touch the `mode` (wizard/studio) selector — it stays Banner-only.

---

## Shared patterns (apply to multiple new files)

### Russian-strings inline

- **Source:** every file in `platform-app/src/components/workflows/` already does this (`NodePalette.tsx` lines 13-17 `CATEGORY_LABELS`, `NodeTopbar.tsx` lines 26, 33, 56, 73).
- **Apply to:** all new components in `inspector/`, `AssetPickerModal.tsx`, `clientHandlers.ts` error messages.
- **Rule (CONTEXT D-20):** No i18n abstraction. String literals in JSX or in `const ___ = "..."` is fine.

### Test scaffold

- **Source:** `lib/workflow/__tests__/graphSchema.test.ts` (Zod), `server/workflow/__tests__/helpers.test.ts` (mocks).
- **Apply to:** all new `__tests__/*.test.ts` files in Phase 3.
- **Rule:**
  - First imports: `import { describe, it, expect } from "vitest";` (add `vi`, `beforeEach`, `afterEach` only when needed).
  - `vi.mock(...)` declarations come BEFORE the subject's import block (helpers.test.ts lines 3-31).
  - Use `@/...` path aliases for the subject under test (graphSchema.test.ts line 4).

### Tailwind palette in workflows/

- **Source:** `NodePalette.tsx` line 33, `BaseNode.tsx` line 33-34, `NodeTopbar.tsx` line 51, `WorkflowEditor.tsx` line 171.
- **Apply to:** `NodeInspector.tsx`, `inspector/*.tsx`, `AssetPickerModal.tsx` (when used from a workflow context).
- **Rule:** Use raw Tailwind palette (`bg-white`, `dark:bg-neutral-950`, `border-neutral-200`, `dark:border-neutral-800`, `text-neutral-500`, `text-blue-400`). Do **not** introduce `bg-bg-surface`, `text-text-primary`, etc. design-tokens that the editor subtree uses — workflows is a parallel design surface.

### Selector style for `useWorkflowStore`

- **Source:** `WorkflowEditor.tsx` lines 61-65.
- **Apply to:** `NodeInspector.tsx` and any new component reading from `useWorkflowStore`.
- **Rule:** Single-field selectors (`useWorkflowStore((s) => s.nodes)`, `useWorkflowStore((s) => s.updateNodeParams)`), one per call. Avoid `useShallow` + multi-field destructure.

### File header JSDoc

- **Source:** `WorkflowEditor.tsx` lines 3-12, `NodePalette.tsx` lines 3-8, `graphSchema.ts` lines 1-9.
- **Apply to:** every new `.ts` and `.tsx` file in Phase 3.
- **Rule:** 3-9 lines after `"use client"` (where applicable), explaining the file's role and noting future-phase boundaries when relevant. Use `*` block style.

---

## No analog found

| File | Reason |
|------|--------|
| (none) | All 10 new files have a workable analog in the codebase. |

---

## Metadata

**Analog search scope:** `platform-app/src/components/workflows/`, `platform-app/src/components/editor/`, `platform-app/src/components/dashboard/`, `platform-app/src/components/assets/` (none — folder doesn't exist yet), `platform-app/src/components/ui/`, `platform-app/src/lib/workflow/`, `platform-app/src/store/workflow/`, `platform-app/src/server/workflow/`, `platform-app/src/utils/`, `platform-app/src/app/`.

**Files scanned (Read):** WorkflowEditor.tsx, NodePalette.tsx, BaseNode.tsx, NodeTopbar.tsx, nodes/index.tsx, useWorkflowStore.ts, createGraphSlice.ts, graphSlice.test.ts, graphSchema.ts, graphSchema.test.ts, server/workflow/types.ts, server/workflow/__tests__/helpers.test.ts, AssetLibraryModal.tsx, NewProjectModal.tsx, page.tsx, globals.css (lines 240-285), CompactInput.tsx, PropertiesPanel.tsx (lines 1-100), Modal.tsx, ReferenceImageInput.tsx (lines 1-80), imageUpload.ts.

**Pattern extraction date:** 2026-04-24
