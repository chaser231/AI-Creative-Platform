# Phase 3 — Node Registry + Inspector + Client Handlers — PLAN

**Created:** 2026-04-24
**Branch:** `ai-workflows-creative`
**Depends on:** Phase 2 (xyflow canvas, NODE_REGISTRY skeleton, useWorkflowStore, autosave hook).
**Inputs:** `03-CONTEXT.md` (D-14…D-20), `03-PATTERNS.md` (file analogs), `REQUIREMENTS.md` (REQ-11..14).

## Goal

Turn Phase 2's empty xyflow canvas into a usable node editor:

- Selecting a node opens an auto-generated inspector with type-correct inputs.
- Connections are type-checked on the fly.
- ImageInput supports library / URL / upload; AssetOutput pushes back to assets.
- Bonus: "AI Workflows" card surfaces on the homepage.

The Run button stays disabled. Phase 4 wires the executor.

## Requirements claimed by this plan

- **REQ-11** — Типизированные соединения (`isValidConnection`).
- **REQ-12** — Inspector автогенерация формы.
- **REQ-13** — Node palette (Phase 2 shipped basics; Phase 3 polishes copy + tooltips).
- **REQ-14** — Per-node UX русификация.
- (Bonus) Homepage card discoverability — aligned with v1.0 milestone success criteria but not a numbered REQ.

## Verification gate (must all pass before commit)

```bash
cd platform-app
npx tsc --noEmit
npm run lint
npm run test -- --run
npm run build
```

Plus manual UAT (`tail-of-plan` section).

---

## Wave 1 — Shared `AssetPickerModal` extraction (D-16, blocking)

**Why first:** ImageInput inspector (Wave 4) consumes this. Extracting it later forces a mid-phase rewrite.

### W1.T1 · Create `AssetPickerModal` as a slim copy

- **File (new):** `platform-app/src/components/assets/AssetPickerModal.tsx`
- **Source:** Copy structure from `platform-app/src/components/editor/AssetLibraryModal.tsx`. Drop the canvas-coupled bits per PATTERNS section "Deviate" table (lines 178-192).
- **Props:**
- **Behaviour:**
  - tRPC: `trpc.asset.listByWorkspace.useQuery({ workspaceId, type: "IMAGE", limit: 200 }, { enabled: open && !!workspaceId })`.
  - Click on asset card → `onSelect(asset.id, { id, url, filename })` then `onClose()` immediately. **No multi-select toggle.**
  - Search + sort UI identical to original (lines 254-305).
  - Loading / empty states identical.
  - **Not** included: project tab, "На холст" / "Применить", delete, export, ConfirmDialog.
- **Russian copy** stays as-is from original where present.
- **Style** uses raw Tailwind (matches workflows subtree): `bg-white dark:bg-neutral-950 border-neutral-200 dark:border-neutral-800`.

### W1.T2 · Verify no consumers need migration in this phase

- The original `AssetLibraryModal` keeps existing consumers untouched (canvas-editor screens still need its full feature set).
- Phase 3 only **adds** `AssetPickerModal`; full deletion of duplicate code is out of scope (follow-up phase if/when canvas editor screens migrate).
- Action: grep `AssetLibraryModal` consumers, confirm none are workflow-related, document in commit message.

### W1.T3 · Commit

```
feat(workflows): extract slim AssetPickerModal from AssetLibraryModal

- Workspace-scoped, single-select, no canvas coupling.
- Reused by ImageInput node inspector in Wave 4.
- Old AssetLibraryModal remains for canvas editor (no migration this phase).

REQ-12 (precursor for inspector reuse).
```

**Verification:** `tsc` + `lint` clean. No runtime test yet — modal is mounted but unused after W1.

---

## Wave 2 — Per-node Zod param schemas (D-14, REQ-12 data layer)

### W2.T1 · `nodeParamSchemas.ts`

- **File (new):** `platform-app/src/lib/workflow/nodeParamSchemas.ts`
- **Exports:**
- **Important:** keep separate from `workflowGraphSchema` (graph save stays permissive — store can hold mid-edit invalid params; only Inspector enforces).

### W2.T2 · Update `NODE_REGISTRY.defaultParams` to match schema defaults

- **File (edit):** `platform-app/src/server/workflow/types.ts` (lines 70-110)
- Apply defaults to each `defaultParams`:
  - `imageInput.defaultParams = { source: "asset" }`
  - `removeBackground.defaultParams = { model: "fal-bria" }`
  - `addReflection.defaultParams` — already correct, leave.
  - `assetOutput.defaultParams = { name: "Workflow output" }`
- Also russify display strings (REQ-14):
  - `imageInput.displayName = "Изображение"`, description: "Источник: ассет, URL или загрузка."
  - `removeBackground.displayName = "Удалить фон"`, description: "AI-модель удаляет фон, оставляя альфа-канал."
  - `addReflection.displayName = "Добавить отражение"`, description: "AI-генерация мягкого отражения под продуктом."
  - `assetOutput.displayName = "Сохранить в библиотеку"`, description: "Записывает результат как Asset воркспейса."

### W2.T3 · Tests

- **File (new):** `platform-app/src/lib/workflow/__tests__/nodeParamSchemas.test.ts`
- Cover for each schema: defaults round-trip, enum rejects unknown, `imageInput.refine` rejects when both `assetId` and `sourceUrl` missing, `addReflection.intensity` rejects out-of-range.
- Use `safeParse` boolean assertions (mirror `graphSchema.test.ts`).

### W2.T4 · Commit

```
feat(workflows): per-node Zod param schemas + russified NODE_REGISTRY

- 4 schemas (imageInput / removeBackground / addReflection / assetOutput).
- defaultParams aligned with schema defaults.
- Russian display names + descriptions (REQ-14).
- Schemas live separately from graphSchema to keep graph save permissive.

REQ-12, REQ-14.
```

**Verification:** `tsc` + `npm run test -- --run nodeParamSchemas` clean.

---

## Wave 3 — Connection validator (D-18, REQ-11)

### W3.T1 · Pure validator function

- **File (new):** `platform-app/src/lib/workflow/connectionValidator.ts`
- Exact signature per CONTEXT lines 171-188:
- **Pure** — no React, no store. Accepts nodes as parameter.

### W3.T2 · Wire into `<ReactFlow>`

- **File (edit):** `platform-app/src/components/workflows/WorkflowEditor.tsx`
- Add import near line 33:
- Inside `EditorCanvas`, add closure:
- Pass to `<ReactFlow>` near line 152: `isValidConnection={isValidConn}`.
- xyflow handles the rejection visual (red stroke + no edge created on drop).
- **Do not touch** `onConnect` — it only fires on accepted drops.

### W3.T3 · Tests

- **File (new):** `platform-app/src/lib/workflow/__tests__/connectionValidator.test.ts`
- Cases:
  - image→image valid, image→mask invalid, text→text valid.
  - any→image valid, image→any valid.
  - missing source node → false.
  - missing target node → false.
  - missing source port id → false.
  - missing target port id → false.
- Use type-only import for `Connection`. No DOM.

### W3.T4 · Commit

```
feat(workflows): isValidConnection blocks incompatible port types

- Pure validator in lib/workflow/connectionValidator.ts.
- Wired into <ReactFlow isValidConnection={...} /> in WorkflowEditor.
- xyflow renders the default invalid-connection UX (red stroke, no drop).

REQ-11.
```

**Verification:** unit test green; manual smoke (drag from imageInput out → assetOutput in works; drag two image-out → image-out is rejected by xyflow naturally).

---

## Wave 4 — NodeInspector + form rendering (D-14, REQ-12)

### W4.T1 · Selection plumbing

- **Decision:** Use xyflow's per-node `selected` flag from `useStore` (the React Flow store) inside `NodeInspector`.
- Inspector lives **inside** `<ReactFlowProvider>` so it can read RF's selection store.
- Selector: `useStore((s) => s.nodes.find(n => n.selected)?.id)` from `@xyflow/react`.
- The selected node's **data** is read from `useWorkflowStore((s) => s.nodes.find(n => n.id === selectedId))` — single source of truth for params is our store, not RF's.

### W4.T2 · `renderField.tsx` helper

- **File (new):** `platform-app/src/components/workflows/inspector/renderField.tsx`
- Single export:
- Dispatch via `schema._def.typeName`:
  - `ZodString` → `<input type="text">`. Russian placeholder: "Введите значение".
  - `ZodNumber` → if both `min` and `max` present in `schema._def.checks`, render `<input type="range">` + numeric readout; else `<input type="number">`.
  - `ZodEnum` → `<select>` with `schema._def.values` as options. Labels = raw values for v1.0 (no translation map yet — copy is short). Per node, the inspector caller can pass a label override map in a future iteration; not in v1.0.
  - `ZodBoolean` → `<input type="checkbox">`.
  - `ZodOptional` → unwrap to `_def.innerType` and recurse; render with no asterisk.
  - `ZodEffects` (refinements) → unwrap `_def.schema` and recurse (used by `imageInput` schema's `.refine`).
  - **Default branch** → `<code>unsupported field</code>` + `console.error(...)` (non-blocking; defensive).
- Below the input, render `error` in red (`text-red-500 text-xs`) if present.
- All inputs are **controlled**; caller owns state.
- No store reads; no React Flow imports.

### W4.T3 · `NodeInspector.tsx`

- **File (new):** `platform-app/src/components/workflows/NodeInspector.tsx`
- `"use client"`, file header JSDoc.
- Reads:
  - `selectedId` via `useStore` from `@xyflow/react`.
  - `selectedNode` via `useWorkflowStore((s) => s.nodes.find(n => n.id === selectedId))`.
  - `updateNodeParams` via `useWorkflowStore((s) => s.updateNodeParams)`.
- If `selectedId` is undefined OR more than one node selected → empty state ("Выберите ноду чтобы редактировать параметры.").
- If `selectedNode` resolved:
  - Header: `definition.displayName` + small category badge (use `CATEGORY_LABELS` constant — copy from `NodePalette.tsx` lines 13-17 OR move to a shared `nodes/categoryLabels.ts`).
  - Body: iterate over `definition` keys of the schema's `.shape`. For each key:
    1. Get the field schema via `schema.shape[key]`.
    2. Get current value from `selectedNode.data.params[key]`.
    3. On change: build `next = { ...selectedNode.data.params, [key]: newValue }`.
    4. `safeParse(next)` against the full schema. If fail → store the error message keyed by field, **do not** call `updateNodeParams`. If success → `updateNodeParams(selectedId, next)`.
    5. Pass `value`, `onChange`, `error` into `renderField`.
  - **Special handling for `imageInput`:** when iterating, intercept the trio (`source`, `assetId`, `sourceUrl`) and replace with a single `<ImageSourceInput>` composite (W4.T4). Other nodes use the generic loop.
  - Footer: small "Сбросить параметры" button → `updateNodeParams(selectedId, definition.defaultParams)`.
- Width: fixed `w-80` (320 px), `border-l border-neutral-200 dark:border-neutral-800`, scroll vertical (`overflow-y-auto`).
- Russian inline copy throughout.

### W4.T4 · `ImageSourceInput.tsx` composite

- **File (new):** `platform-app/src/components/workflows/inspector/ImageSourceInput.tsx`
- Props:
- Three radio-tabs at top: "Из библиотеки" | "По URL" | "Загрузить".
- Below tab content:
  - **asset:** read-only display of currently picked asset (filename + thumbnail via `trpc.asset.getById.useQuery({ id: assetId }, { enabled: !!assetId })`); "Выбрать" button opens `<AssetPickerModal>` (W1).
    - On `onSelect(assetId)` → `onChange({ source: "asset", assetId, sourceUrl: undefined })`.
  - **url:** `<input type="url" placeholder="https://… or data:image/…" />`. On change → `onChange({ source: "url", sourceUrl: e.target.value, assetId: undefined })`.
  - **upload:** Hidden `<input type="file" accept="image/*">` + visible button "Выбрать файл". On file picked:
    1. Read as base64 via `FileReader.readAsDataURL`.
    2. Call `await uploadForAI(base64, "workflow-input")` from `@/utils/imageUpload` (already exported).
    3. Receive `{ assetId }` (or whatever the contract returns — confirm during impl).
    4. `onChange({ source: "upload", assetId, sourceUrl: undefined })` then immediately switch UI back to read-only "asset" preview (the upload mode is a one-shot action; persisted state is `{ source: "upload", assetId }`).
    5. Show inline progress / spinner during upload.
- Validation error from parent rendered below as red text.

### W4.T5 · Insert `<NodeInspector>` into editor layout

- **File (edit):** `platform-app/src/components/workflows/WorkflowEditor.tsx`
- In the JSX flex container at line 178:
- Add import.

### W4.T6 · Tests

- **No** RTL component tests (project lacks `@testing-library/react` setup; same constraint as Phase 2).
- **Yes** unit test for `renderField` dispatch logic — extract a small helper `pickFieldKind(schema): "string" | "number" | "slider" | "enum" | "boolean" | "unsupported"` and unit-test it. This is the part most likely to break across Zod minor versions.
  - **File (new):** `platform-app/src/components/workflows/inspector/__tests__/pickFieldKind.test.ts`.
- Document in inspector source: "Manual UAT covers full UI; field-kind dispatch is unit-tested separately."

### W4.T7 · Commit

```
feat(workflows): NodeInspector with auto-form from Zod schemas

- renderField dispatches by Zod typeName (string/number/enum/boolean/optional/effects).
- ImageSourceInput composite: library / URL / upload tabs.
- Selection driven by xyflow's per-node `selected` flag.
- updateNodeParams gated by Zod safeParse — invalid values stay local.
- Inspector mounted as 3rd column in WorkflowEditor.

REQ-12, REQ-14.
```

**Verification:** `tsc` + `lint` + unit tests; manual UAT (see end of plan).

---

## Wave 5 — Client handlers (D-17, contract for Phase 4)

### W5.T1 · `clientHandlers.ts`

- **File (new):** `platform-app/src/store/workflow/clientHandlers.ts`
- Two named exports, **store-agnostic**:
- `**imageInput` logic:**
  - If `params.assetId` → `await ctx.trpc.asset.getById.query({ id: params.assetId })` → return `{ imageUrl: asset.url }`.
  - Else if `params.sourceUrl` → return `{ imageUrl: params.sourceUrl }` (server-side SSRF guard runs in Phase 4 executor).
  - Else throw `Error("ImageInput: укажите ассет или URL")`.
- `**assetOutput` logic:**
  - Confirm during impl whether the procedure is `asset.createFromUrl` or `asset.create` (search server router; if neither exists, **add a TODO + plan a follow-up task** — do not invent the procedure here).
  - If procedure exists: call it with `{ workspaceId, sourceUrl: inputs["image-in"].imageUrl, name: params.name, folder: params.folder }`.
  - Return `{ assetId }`.
  - **If procedure missing:** add a deliverable to W5 — see W5.T1a.
- **No React, no Zustand reads, no `useWorkflowStore.getState()`.**

### W5.T1a · (Conditional) Add `asset.createFromUrl` procedure

- **Triggered only if** the existing `assetRouter` lacks an endpoint to create an Asset from a remote URL.
- **File (likely edit):** `platform-app/src/server/routers/asset.ts` (path TBD — verify during impl).
- Add `createFromUrl` mutation: input `{ workspaceId, sourceUrl, name, folder? }`, downloads via existing `safeFetch` (SSRF), persists to S3 via existing util, creates Prisma `Asset` row, returns `{ assetId }`.
- Auth: `assertWorkspaceAccess(workspaceId, "CREATOR")`.
- Add basic test stub in `assetRouter.test.ts` if file exists.
- **If this branch fires, split into its own commit** before W5.T2 to keep commits atomic.

### W5.T2 · Vanilla tRPC client / caller pattern

- Search codebase for existing vanilla tRPC client (`createTRPCProxyClient` / `createTRPCClient`).
- If found: import that.
- If not found: handlers accept `ctx.trpc` from outside (the future executor in Phase 4 wires it). For Phase 3 unit tests, `ctx.trpc` is fully mocked.
- **Recommended:** the second option (caller from outside). Keeps Phase 3 from inventing infrastructure that Phase 4 might prefer differently.

### W5.T3 · Tests

- **File (new):** `platform-app/src/store/workflow/__tests__/clientHandlers.test.ts`
- Mock `ctx.trpc.asset.getById.query` and `ctx.trpc.asset.createFromUrl.mutate` (or whatever name resolves).
- Cases:
  - `imageInput` happy path with assetId → returns asset.url.
  - `imageInput` happy path with sourceUrl → returns sourceUrl.
  - `imageInput` neither → throws.
  - `assetOutput` happy path → returns `{ assetId }`.
  - `assetOutput` tRPC error → rethrows (does NOT swallow).
- `vi.mock` declarations precede subject import (mirror `helpers.test.ts`).

### W5.T4 · Commit

```
feat(workflows): client handlers for imageInput + assetOutput

- Pure async functions, no Zustand/React deps.
- imageInput resolves assetId via tRPC asset.getById; passes through sourceUrl.
- assetOutput creates Asset from imageUrl via tRPC asset.createFromUrl.
- Phase 4 executor will invoke; Phase 3 ships handlers + tests only.

REQ — contract for Phase 4 executor.
```

**Verification:** `npm run test -- --run clientHandlers`. `tsc` clean.

---

## Wave 6 — Homepage card "AI Workflows" (D-19, bonus discoverability)

### W6.T1 · Add `.gradient-card-pink` CSS

- **File (edit):** `platform-app/src/app/globals.css` (around lines 247-283)
- After `.gradient-card-green` block, append:
- After `.dark .gradient-card-green` block, append:

### W6.T2 · Insert "AI Workflows" card on homepage

- **File (edit):** `platform-app/src/app/page.tsx`
- Add `Workflow` to `lucide-react` import (line 6).
- In `generationTypes` array (lines 72-105), add **5th entry** after the "video" card:
- In `handleTileClick` (lines 170-189), add a branch BEFORE the `createProjectMutation` call:
- Update grid columns at line 251: `grid-cols-4` → `grid-cols-5` (recommended). Confirm responsive behaviour on `< sm` — if card row gets cramped, use `grid-cols-2 lg:grid-cols-5` instead.

### W6.T3 · Insert into `NewProjectModal`

- **File (edit):** `platform-app/src/components/dashboard/NewProjectModal.tsx`
- Add `Workflow` to `lucide-react` import (line 11).
- Add 5th `goals` entry:
- In `handleCreate` (lines 63-113), add an early branch:
- Update `ProjectGoal` type if needed (search `@/types`); if `"workflow"` not in the union, add it. **Verify before editing.**
- Grid `grid-cols-4` (line 148) → `grid-cols-5`.

### W6.T4 · Commit

```
feat(dashboard): "AI Workflows" card on homepage + NewProjectModal

- New gradient-card-pink CSS class (light + dark).
- 5th tile in homepage top row → routes to /workflows.
- 5th option in NewProjectModal → routes to /workflows/new.
- Card image at public/cards/workflows.png (already added).

D-19 (Phase 3 bonus).
```

**Verification:** `npm run build` + manual visit `/` and Open New Project modal.

---

## Wave 7 — Verification + SUMMARY

### W7.T1 · Full verification gate

```bash
cd platform-app
npx tsc --noEmit
npm run lint
npm run test -- --run
npm run build
```

Fix anything red. Commit fixes per-file (no scope creep).

### W7.T2 · Manual UAT checklist

1. Open `/` → see 5 cards in top row, including "AI Workflows" with pink gradient. Click → routes to `/workflows`.
2. Open `/workflows` → list page renders.
3. Open New Project modal from anywhere → see Workflow option. Click → routes to `/workflows/new`.
4. Create a new workflow → editor opens with palette, canvas, inspector (empty state).
5. Drag `imageInput` node onto canvas. Click it → inspector shows three-tab "Из библиотеки / По URL / Загрузить".
  - Click "Из библиотеки" → `AssetPickerModal` opens. Pick an image. Modal closes. Inspector shows thumbnail + filename.
    - Click "По URL" → paste `https://example.com/image.png`. Field accepts. Auto-save status flashes.
    - Click "Загрузить" → pick a file. Upload spinner. On success, falls back to library preview with new asset.
6. Drag `removeBackground` node. Click it → inspector shows "Модель" select with 3 options. Switch → auto-save flashes.
7. Drag `addReflection` node. Inspector shows: Стиль (enum), Интенсивность (slider), Промпт (textarea-as-text). Drag slider → save. Type out-of-range value (impossible via slider but try via dev tools edit) — no save, error shows.
8. Drag `assetOutput` node. Inspector shows Имя + Папка. Edit → save.
9. Connect imageInput → removeBackground (image→image). Edge created.
10. Try to connect imageInput out → assetOutput in (image→image). Edge created.
11. Try to drag from `imageInput.image-out` to itself or to a non-existent target — xyflow blocks.
12. (No real cross-type test possible until v2 nodes have non-image ports; document the validator works for `any` matching by manual `console` test.)
13. Click "Сбросить параметры" in inspector → values revert to defaults; auto-save flashes.
14. Refresh page → graph + params persist.

### W7.T3 · Write `03-SUMMARY.md`

- Mirror structure of `02-SUMMARY.md`.
- Sections: Goal recap, deliverables shipped, decisions executed (D-14..D-20), files changed (with line count deltas from `git diff --stat`), test results, manual UAT outcomes, known limitations, deferred to Phase 4 / 5.

### W7.T4 · Commit + push

```
chore(workflows): Phase 3 verification + SUMMARY

- All gates green: tsc + lint + tests + build.
- Manual UAT pass (14 steps documented in SUMMARY).
- Phase 3 marked complete in ROADMAP (separate commit if needed).
```

`git push origin ai-workflows-creative`.

---

## Risks (net-new in Phase 3)


| Risk                                                                                              | Likelihood | Mitigation                                                                                                                                                             | Early signal                                                               |
| ------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Zod v4 introspection differs from v3 (`_def.typeName` deprecated?)                                | Medium     | Extract `pickFieldKind` and unit-test it. If `_def.typeName` is unstable, fall back to `instanceof z.ZodString` etc.                                                   | First `renderField` test fails or returns "unsupported" for known types.   |
| `AssetLibraryModal` couples deeper than expected when reading source                              | Low        | Wave 1 first; if extraction balloons, ship a thin wrapper around the original instead of a copy.                                                                       | Wave 1 takes >1 day.                                                       |
| `asset.createFromUrl` doesn't exist in tRPC router                                                | Medium     | W5.T1a contingency adds it; bump Wave 5 estimate by half a day.                                                                                                        | Codebase grep returns nothing matching.                                    |
| Inspector re-renders thrash on rapid typing                                                       | Low        | Each input is controlled-local; `updateNodeParams` only fires on safeParse success. If still bad, debounce 100ms inside `NodeInspector`.                               | UI lags on text fields.                                                    |
| `selected` flag from xyflow store doesn't propagate cleanly across `<ReactFlowProvider>` siblings | Medium     | Inspector lives **inside** the provider. If it still doesn't, use `useOnSelectionChange` xyflow hook to push selection into our store.                                 | `useStore((s) => s.nodes.find(n => n.selected))` always returns undefined. |
| Upload mode in `ImageSourceInput` hits CORS / S3 cred issues in dev                               | Medium     | The presign route is already in production; verify `.env.local` has S3 creds. If broken, ship inspector with library + URL only and gate upload behind a feature flag. | First upload attempt fails.                                                |
| Grid `grid-cols-5` breaks on small screens                                                        | Low        | Use `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`.                                                                                                                       | Visual check on iPhone-width.                                              |


## Out of scope (deferred)

- Run button enable / DAG executor — Phase 4.
- Preset library / `?preset=` resolution — Phase 5.
- Rich port-type-aware connection coloring — Phase 5.
- AssetPickerModal multi-select — when a future node needs it.
- i18n infrastructure — when 2nd locale becomes a real requirement.
- Inspector advanced inputs (color picker, JSON editor) — Phase 5+.
- Old `AssetLibraryModal` deletion / canvas-editor migration — separate refactor.

---

*Phase: 03-node-registry-inspector-handlers*
*Estimated effort: 3-4 days (matches roadmap estimate).*