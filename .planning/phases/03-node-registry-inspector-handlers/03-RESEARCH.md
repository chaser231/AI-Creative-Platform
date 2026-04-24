# Phase 3 — Research

**Spawned by:** /gsd-plan-phase
**Date:** 2026-04-24
**Domain:** Node-editor UX layer (Zod-driven inspector + xyflow connection validation + asset modal extract + client handlers)
**Confidence:** HIGH (most claims verified against project source; Zod v4 / xyflow v12 confirmed against vendored type definitions in `node_modules/`)

---

## Summary

Phase 3 wires the **UX layer** on top of the empty Phase 2 canvas: an auto-generated Zod-driven inspector, port-type-aware connection validation, three-mode `ImageInput` UX, an `AssetOutput` client handler, and (bonus) a fifth "AI Workflows" homepage card. The phase touches **8 net-new files** and **modifies 7 existing files**, with one **Wave 1 blocker** that must land before any inspector work: extracting the project-coupled `AssetLibraryModal` into a workspace-scoped `AssetPickerModal` consumable by both the existing canvas editor and the new workflow inspector.

The biggest sharp edges:

1. **`AssetLibraryModal` is project-scoped** (`projectId` required, internally derives `workspaceId` from `project.getById`). Workflows are **workspace-scoped**, not project-scoped — so the extract is not cosmetic. It needs a real API redesign.
2. **Zod v4 introspection differs from v3**: the discriminator is `_zod.def.type` (string literals like `"string"`, `"number"`, `"enum"`, `"optional"`), NOT v3's `_def.typeName` enum. Numeric constraints live on `_zod.bag.{minimum,maximum}` (a `LoosePartial` populated by `.min()`/`.max()` checks). `ZodEnum.def.entries` is the runtime source of truth for option lists.
3. **No `@testing-library/react` / `jsdom`** in the project — confirmed against `package.json`. Component-level tests stay manual; pure helpers (validator, Zod→form mapping, client handlers) get vitest unit tests like Phase 2 did for the slice.
4. The existing `presign` flow and `/api/upload` routes already cover the upload backend — no new server endpoints required for `D-15` upload mode.

**Primary recommendation:** Wave 1 = `AssetLibraryModal` extract + per-node Zod schemas + connection validator (parallelisable, all small, all unit-testable). Waves 2–3 = inspector renderer + ImageInput tabs + AssetOutput handler. Wave 4 = bonus homepage card. Defer all visual polish to a Phase 5 follow-up.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-node Zod param schemas | Shared (lib) | — | `src/lib/workflow/graphSchema.ts` already lives shared between client & server (D-08 from Phase 2). New per-node schemas slot here so future server-side validation reuses them. |
| Inspector form rendering | Browser/Client | — | Reads from Zustand `useWorkflowStore`, writes via `updateNodeParams`. Pure React. No SSR (the `/workflows/[id]` route is `next/dynamic({ssr:false})` per D-13). |
| `isValidConnection` validator | Browser/Client | — | xyflow callback runs in-browser during edge drag. Pure function over `NODE_REGISTRY`. |
| `imageInput` client handler | Browser/Client | API (tRPC `asset.getById`) | Resolves params → `{ imageUrl }`. Client-only because Phase 4 executor runs in the browser. |
| `assetOutput` client handler | Browser/Client | API (tRPC `asset.attachUrlToProject`) | Pushes a finished image into the workspace asset library. Server-side mutation for persistence. |
| Image upload (D-15 mode 3) | Browser/Client | API (`/api/upload/presign` → S3 PUT) | Existing `imageUpload.ts` helpers run in-browser; presign route + S3 PUT handle persistence. |
| Asset library picker | Browser/Client | API (tRPC `asset.list`/`listByWorkspace`) | Refactored modal stays a client React component; same tRPC backends as today. |
| Homepage workflow card | Frontend Server (RSC layout) → Client (interactive button) | — | `src/app/page.tsx` is `"use client"`. Card is presentational; navigation via `next/navigation` `useRouter`. |

**No tier mis-assignments expected.** Everything stays on the side it already lives on; Phase 3 only extends.

---

## A. AssetLibraryModal extract (D-16) — HIGHEST PRIORITY

### A1. Current location

- File: `platform-app/src/components/editor/AssetLibraryModal.tsx` (429 lines).
- Default export: named `AssetLibraryModal`.
- Imports from `@/store/canvasStore` and `@/store/canvas/types` directly — i.e., it is **not** a generic asset picker; it is a canvas-editor-coupled asset manager.

### A2. Consumers inventory

Single consumer in the entire repo (verified via project-wide grep):

| Caller | Path | Props passed | Selection callback |
|--------|------|--------------|--------------------|
| Banner editor page | `platform-app/src/app/editor/[id]/page.tsx:1011-1015` | `projectId={id}`, `open={assetLibraryOpen}`, `onClose={…}` | **None.** Selection result flows directly into `useCanvasStore` via `addImageLayer(asset.url, 400, 400)` (`AssetLibraryModal.tsx:135-140`) and `updateLayer(selectedImageLayer.id, { src: asset.url })` (`AssetLibraryModal.tsx:147-153`). The modal *owns* the side-effect on the canvas store. |

**Coupling diagnosis (ranked from worst to best):**

1. **Direct `useCanvasStore` import** (`AssetLibraryModal.tsx:12`). The modal calls `addImageLayer`, `updateLayer`, reads `selectedLayerIds`, `layers`. **Hard-blocks reuse** for any consumer that doesn't have a `useCanvasStore` (the workflow editor doesn't).
2. **`projectId` required** (`AssetLibraryModal.tsx:17-21`). Modal queries `trpc.project.getById` to derive `workspaceId` (`L56-60`) just to power the "Whole library" tab. Workflows have no `projectId` — they're owned by `workspaceId` directly.
3. **No `onSelect` callback at all.** All actions (add to canvas, replace selection, export, delete) are baked into the modal's footer (`L370-416`). A workflow inspector needs `onSelect(assetId)` and that's it.
4. **Action buttons are canvas-specific.** "На холст" (add to canvas), "Применить к выделению" (replace canvas layer src) — neither makes sense in the workflow context.
5. **Tightly-baked delete + export.** Both also live in the footer — but those are reusable across asset-management contexts.

### A3. Recommended shared API

Extract a new component `src/components/assets/AssetPickerModal.tsx` with this surface:

```typescript
// src/components/assets/AssetPickerModal.tsx
interface AssetPickerModalProps {
  open: boolean;
  onClose: () => void;

  // Workspace is the source of truth — use this when no projectId is available.
  workspaceId: string;

  // Optional project filter. When set, the modal opens on the "Этот проект" tab.
  // When omitted (e.g. workflow editor), only the "Вся библиотека" tab is shown.
  projectId?: string;

  // Required selection callback — modal closes itself on confirm.
  onSelect: (asset: AssetSelection) => void;

  // Filter to image-only by default (only image consumers exist today).
  type?: "IMAGE" | "VIDEO" | "AUDIO" | "FONT" | "LOGO" | "OTHER";

  // Single-select v1.0; multiSelect deferred (per D-16 implication).
  multiSelect?: false;
}

interface AssetSelection {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
}
```

**Justified deviations from the current modal:**

- **`onSelect` instead of internal canvas mutation** — pushes the side-effect to the caller. The banner editor wraps this with its existing `addImageLayer` / `updateLayer` logic in `editor/[id]/page.tsx`.
- **`workspaceId` becomes required** — eliminates the internal `trpc.project.getById` query when the caller already knows the workspace. The current `projectQuery` round-trip (`AssetLibraryModal.tsx:56-60`) is an avoidable extra fetch even for the editor case (the editor already loads the project; it can pass `workspaceId` directly).
- **`projectId` becomes optional** — the workflow editor passes only `workspaceId`. When `projectId` is omitted, the "Этот проект" tab is hidden (only `listByWorkspace` is queryable).
- **Footer actions become slot-based or removed in v1.0** — for Phase 3, just keep "Выбрать" (single-action footer when `onSelect` is set). Delete/export can move to a separate `<AssetActionsBar />` reused only by the editor caller. Or stay as optional render-props on the new modal. **Recommendation:** simplest path is to keep delete/export inside the new modal (they only fire if `selectedIds.size > 0` AND `projectId` is set), and add a primary "Выбрать" button when `onSelect` is provided. This minimises diff for the editor.

### A4. Migration cost

- **Breaking-call-site count: 1.** Only `editor/[id]/page.tsx` imports the current modal. Migration is mechanical: pass `workspaceId` (already available via `useWorkspace().currentWorkspace?.id`), wrap the existing `addImageLayer`/`updateLayer` in an `onSelect` callback.
- **Tests touched: 0.** No tests exist for `AssetLibraryModal` (verified via `grep -r "AssetLibraryModal" platform-app/src/**/__tests__/` — zero matches).
- **Cost classification: trivial-to-medium.** The diff is ~30 lines in the editor page + ~50 lines moved/refactored in the modal. Only risk is regressions in the canvas-side flow ("На холст" / "Применить к выделению"); cover with a manual smoke pass on the banner editor before declaring Wave 1 done.

### A5. Naming recommendation

**Recommended:** rename the file/component to `AssetPickerModal` and place it under `src/components/assets/` (a new directory; `src/components/editor/` stays for canvas-editor-specific UI). The old import path is updated in the single consumer.

**Rejected alternatives:**

- *Keep `AssetLibraryModal`, add a thin `AssetPickerModal` wrapper* — leaves the core component still coupled to `useCanvasStore`, defeats the point of D-16.
- *Two modals (one for editor, one for workflow)* — duplicates ~300 lines of grid/sort/search UI; explicitly rejected by D-16 ("Build a separate workflow-only picker — duplicates UI logic, drifts from the rest of the app").

---

## B. Inspector form rendering (D-14, REQ-12)

### B1. Zod v4 introspection mechanics

**Confirmed against vendored types** (`platform-app/node_modules/zod/v4/core/schemas.d.ts`):

- The runtime discriminator is the **`type` string literal** on `def`. From `schemas.d.ts:31`:
  ```typescript
  type: "string" | "number" | "int" | "boolean" | "bigint" | "symbol" | "null" | "undefined" | "void"
      | "never" | "any" | "unknown" | "date" | "object" | "record" | "file" | "array" | "tuple"
      | "union" | "intersection" | "map" | "set" | "enum" | "literal" | "nullable" | "optional"
      | "nonoptional" | "success" | "transform" | "default" | "prefault" | "catch" | "nan"
      | "pipe" | "readonly" | "template_literal" | "promise" | "lazy" | "function" | "custom";
  ```
- Access path on a schema instance: `schema._zod.def.type` (the public `_zod` internals namespace replaces v3's `_def`). Confirmed at `schemas.d.ts:101` (`type: "string"`), `:361` (`type: "number"`), `:393` (`type: "boolean"`), `:768` (`type: "enum"`), `:836` (`type: "optional"`), `:879` (`type: "default"`).
- The `classic/schemas.d.ts:7` **also** exposes a public alias `def: Internals["def"]` (and a back-compat `_def`) on every `ZodType`, so reading `schema.def.type` works without diving into `_zod`. **Recommended discriminant: `schema._zod.def.type`** (matches what Zod docs show; e.g. https://v4.zod.dev/json-schema `override` callback example uses `ctx.zodSchema._zod.def`).

**Important:** `.default(value)` wraps the schema in a `ZodDefault` whose `def.type === "default"`. The inspector renderer must **unwrap `default` and `optional` first**, then dispatch on the inner type:

```typescript
function unwrap(schema: z.ZodType): z.ZodType {
  let s = schema;
  while (s._zod.def.type === "optional" || s._zod.def.type === "default" || s._zod.def.type === "nullable") {
    s = (s._zod.def as { innerType: z.ZodType }).innerType;
  }
  return s;
}
```

[VERIFIED: `platform-app/node_modules/zod/v4/core/schemas.d.ts:837-838, 880-881, 863-864`] — `optional`/`default`/`nullable` all have `innerType: T` on their def.

### B2. Number range detection

`ZodNumber` checks (`.min()`, `.max()`, etc.) populate **`_zod.bag`**, a `LoosePartial<{ minimum, maximum, exclusiveMinimum, exclusiveMaximum, format, pattern }>`. From `schemas.d.ts:370-377`:

```typescript
bag: util.LoosePartial<{
    minimum: number;
    maximum: number;
    exclusiveMinimum: number;
    exclusiveMaximum: number;
    format: string;
    pattern: RegExp;
}>;
```

Read pattern in renderer:

```typescript
function getNumberBounds(schema: z.ZodNumber): { min?: number; max?: number } {
  const bag = schema._zod.bag as { minimum?: number; maximum?: number };
  return { min: bag.minimum, max: bag.maximum };
}
```

**Decision rule (from D-14 + REQ-12 acceptance):**
- If both `min` and `max` are defined AND `(max - min) <= 100` AND fractional default values likely → render `<input type="range">` (slider with inline value display).
- Otherwise → render `<input type="number" min={min} max={max}>`.
- For `addReflection.intensity` (`min(0).max(1)`) → slider with `step={0.05}` is the right call; for an unbounded `z.number()` → number input.

### B3. Enum value extraction

`ZodEnum.def.entries` is the runtime source of truth (Zod v4 stores entries on the def, not as a separate property). From `schemas.d.ts:767-770`:

```typescript
export interface $ZodEnumDef<T extends util.EnumLike = util.EnumLike> extends $ZodTypeDef {
    type: "enum";
    entries: T;  // For z.enum(["a","b","c"]) → { a: "a", b: "b", c: "c" }
}
```

The user-facing API also exposes `schema.enum` (an enum-like object) per Zod docs: https://v4.zod.dev/api?id=enums (`FishEnum.enum` → `{ Salmon: "Salmon", Tuna: "Tuna", Trout: "Trout" }`). For dropdown rendering use:

```typescript
function getEnumOptions(schema: z.ZodEnum): string[] {
  return Object.values(schema._zod.def.entries) as string[];
}
```

(Returns the runtime values in insertion order — what the `<select>` needs.)

### B4. Optional vs required

Detection rule:

- Schema is **optional** if traversing the unwrap chain hits a `def.type === "optional"` OR `"default"` OR `"nullable"` node.
- Schema is **required** if no such wrapper appears.

Renderer behaviour:

- Required field → label gets a red asterisk `<span className="text-red-500">*</span>`.
- Optional → no asterisk.
- Validation: `safeParse` on the **original (wrapped) schema** so `optional()` correctly accepts `undefined` and `default()` substitutes the default.

### B5. Error display strategy

**Recommendation: field-level inline errors**, displayed beneath each input in red text (`text-xs text-red-500 mt-1`).

**Justification from existing patterns:**
- `platform-app/src/app/settings/profile/page.tsx` shows save status (`saveStatus: "idle" | "saving" | "saved"`) inline next to the input — the codebase prefers per-field, low-key feedback over modal/toast errors.
- `AssetLibraryModal` uses a `ConfirmDialog` for destructive actions but inline messaging for filter/sort feedback.
- Header summary errors would conflict with the inspector's compact 320 px width.

Renderer pattern:

```typescript
const result = paramSchema.safeParse(localDraft);
const errorsByPath = result.success ? {} : indexZodErrorsByPath(result.error);
// In JSX, beneath each field:
{errorsByPath[fieldName] && (
  <p className="mt-1 text-xs text-red-500">{errorsByPath[fieldName]}</p>
)}
```

**Push-to-store rule (D-14 implication):** Only push to `updateNodeParams` when `result.success === true`. Invalid drafts stay local (`useState`), so the canvas doesn't re-render with bad data and auto-save doesn't fire on garbage.

### B6. Refinement / cross-field validation

The `imageInput` schema in CONTEXT.md uses `.refine(d => d.assetId || d.sourceUrl, "Выберите источник")`. In Zod v4, `.refine` errors arrive in `result.error.issues` with **empty `path: []`** (object-level error, not field-level).

Surfacing recommendation: render an **inline header error strip** *only* for object-level `path: []` issues, while still using field-level errors for everything else. Pattern:

```typescript
const objectLevelErrors = (result.error?.issues ?? []).filter(i => i.path.length === 0);
// At top of inspector body:
{objectLevelErrors.length > 0 && (
  <div className="mb-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
    {objectLevelErrors.map((e, i) => <p key={i}>{e.message}</p>)}
  </div>
)}
```

For `imageInput` specifically: the radio-tab UI (D-15) makes the refine almost-impossible to violate (each tab has its own input that writes the right field). Treat this as defence-in-depth, not the primary UX control.

### B7. Controlled-component subtlety

Two locations of state:

1. **`useWorkflowStore.nodes[].data.params`** — the canonical, persisted shape. Updated via `updateNodeParams(id, patch)` (`createGraphSlice.ts:50-57`), which **shallow-merges** the patch into existing params. Confirmed by inspecting the slice: `data: { params: { ...n.data.params, ...patch } }`.
2. **Inspector local draft** — `useState<Record<string, unknown>>` initialised from the selected node's params on selection-change.

**Recommendation:**
- Inspector mounts/remounts on `selectedNodeId` change (key the component by node id) — clean draft state per node, no stale residue.
- On every input change: update local draft, run `safeParse`, **only on success** call `updateNodeParams` with the changed key (the slice already shallow-merges, so passing only `{intensity: 0.7}` is correct).
- **No debouncing in the inspector itself.** `useWorkflowAutoSave` already debounces saves at 2 s (D-10, see `useWorkflowAutoSave.ts:38-90`). Adding inspector-level debounce would double-debounce typing and cause the canvas re-render to lag behind the input cursor.
- **Performance escape hatch:** If rapid typing in a `text` field causes visible re-render lag (canvas re-renders the BaseNode subtree on every store change), wrap `BaseNode` in `React.memo` and/or use `React.useDeferredValue` on the input. v1.0 is unlikely to need this with 4 nodes on screen — defer until measured.

---

## C. Image upload integration (D-15)

### C1. Existing upload contract

**`/api/upload/presign` (GET)** — `platform-app/src/app/api/upload/presign/route.ts:54-99`:

| Aspect | Value |
|--------|-------|
| Method | GET |
| Auth | `auth()` session check (`L56-58`); throws 401 if missing |
| Query params | `mimeType` (default `"image/png"`), `projectId` (default `"tmp"`) |
| Allowed MIME | `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/svg+xml` (set at `L46-52`) |
| Output | `{ uploadUrl, publicUrl, key }` — `uploadUrl` valid 10 min (`expiresIn: 600`, `L92`) |
| ACL check | If `projectId !== "tmp"`, calls `requireSessionAndProjectAccess(userId, projectId, "write")` (`L65-72`) |
| Object key shape | `canvas-images/${projectId}/${uuid}.${ext}` (`L83-84`) |

**`/api/upload` (POST)** — `platform-app/src/app/api/upload/route.ts:51-75`:

| Aspect | Value |
|--------|-------|
| Method | POST JSON |
| Auth | Same `auth()` check |
| Body | `{ base64?, url?, mimeType?, projectId?, skipAssetRecord? }` |
| `url` mode | Server-side fetches via `safeFetch` (SSRF-guarded), re-uploads to S3 (`L80-100`) |
| `base64` mode | Decodes base64 and PUTs to S3 directly |
| Asset record | If `projectId && !skipAssetRecord`, **creates an `Asset` row** under that project (`L154-171`). Otherwise just returns `{ url }`. |

**`src/utils/imageUpload.ts:86-130`** (`uploadImageToS3`):
- Tries presigned PUT first, falls back to `/api/upload` legacy proxy.
- Has a **session-wide kill switch** (`presignDisabled`, `L25`) that flips after the first CORS/network failure to avoid retrying expensive preflights.
- Returns `string | null` (the public URL or `null` on failure).
- Caches by base64 prefix to avoid re-uploading the same image (`L19, L91-93`).

### C2. Recommended upload UX flow for `ImageInput` inspector

For the **"Загрузить файл"** tab inside the inspector:

```
┌──────────────────────────────────────────┐
│ [Из библиотеки] [По URL] [Загрузить]     │
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │      Drag-drop zone or click         │ │
│ │   📤  Перетащите PNG / JPG / WEBP   │ │
│ │      или нажмите для выбора файла    │ │
│ └──────────────────────────────────────┘ │
│ Macro state: idle → uploading → done     │
└──────────────────────────────────────────┘
```

- **Single drop zone, also click-to-open.** No separate file-input button — the dropzone IS the file input (`<label>` wrapping a hidden `<input type="file" accept="image/png,image/jpeg,image/webp,image/gif">`).
- **Progress indicator:** simple spinner + "Загрузка…" text. The existing `uploadImageToS3` doesn't expose a progress callback (it uses `fetch` PUT, not XHR), and adding one is out of scope — accept binary "uploading | done | failed" UX.
- **Compression:** call `compressImageFile(file, 2000)` from `imageUpload.ts:343` BEFORE upload to keep payload reasonable (existing helper, returns webp data URL).

**On success:**
- Persist via `uploadImageToS3(base64, "tmp", mimeType)` → returns S3 `publicUrl`.
- Then call `trpc.asset.attachUrlToProject` with `projectId: "tmp"`? **No — workflows don't have a project.** Use a **new mutation** `asset.attachToWorkspace` OR write the raw `sourceUrl` into params and skip Asset row creation.
- **Recommendation:** for v1.0, write `sourceUrl: <S3 publicUrl>` into params — the file is still on our S3, the workflow doesn't strictly need an Asset row, and it dodges the "no project context" problem. Document this as a known limitation: uploaded images won't appear in the workspace asset library; if the user wants that, they should pre-upload via the canvas editor and pick from "Из библиотеки".

### C3. New tRPC procedures needed

**`asset.createFromUrl`** is mentioned in `ROADMAP.md:151` for the `assetOutput` handler but **does not exist** in `src/server/routers/asset.ts`. The closest existing procedures:

- `saveGeneratedImage` (`asset.ts:169-217`) — requires `projectId`, persists with `metadata.source = "photo-generation"` by default.
- `attachUrlToProject` (`asset.ts:229-277`) — requires `projectId`, idempotent per (projectId, url).

**Both are project-scoped.** The workflow `assetOutput` node has only a workspaceId.

**Recommendation: add a new procedure** `asset.attachToWorkspace` in `src/server/routers/asset.ts`:

```typescript
attachToWorkspace: protectedProcedure
  .input(z.object({
    workspaceId: z.string(),
    url: z.string().url(),
    filename: z.string().optional(),
    mimeType: z.string().default("image/png"),
    sizeBytes: z.number().int().nonnegative().default(0),
    source: z.string().default("workflow-output"),
    width: z.number().optional(),
    height: z.number().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    await assertWorkspaceAccess(ctx, input.workspaceId, "CREATOR");
    // Idempotent per (workspaceId, url)
    const existing = await ctx.prisma.asset.findFirst({
      where: { workspaceId: input.workspaceId, url: input.url, projectId: null },
      select: { id: true },
    });
    if (existing) return existing;

    const filename = input.filename ?? `${input.source}-${Date.now()}.${input.mimeType.split("/")[1] ?? "png"}`;
    return ctx.prisma.asset.create({
      data: {
        type: "IMAGE",
        filename, url: input.url, mimeType: input.mimeType, sizeBytes: input.sizeBytes,
        metadata: { source: input.source, ...(input.width && { width: input.width }), ...(input.height && { height: input.height }) },
        workspaceId: input.workspaceId,
        uploadedById: ctx.user.id,
        projectId: null,  // ⚠️ verify Asset.projectId is nullable in schema before relying on this
      },
      select: { id: true },
    });
  }),
```

**⚠️ Validation step before adopting:** confirm `Asset.projectId` is nullable in `prisma/schema.prisma`. Quick check from `WorkspaceAssetGrid.tsx` and `attachUrlToProject` shows `projectId` is always passed; the planner should `Read prisma/schema.prisma:311` (Asset model) and confirm. If it's `String` not `String?`, this is a Wave 1 schema migration — add to plan.

This adds a new server-side deliverable to Phase 3 (small but real). Document it in the plan.

---

## D. Connection validator (D-18, REQ-11)

### D1. xyflow `isValidConnection` API (v12)

**Confirmed against vendored types** (`@xyflow/react@12.10.2`):

- Signature (`@xyflow/react/dist/esm/types/general.d.ts:178`): `IsValidConnection<EdgeType extends Edge = Edge> = (edge: EdgeType | Connection) => boolean`
- Props location (`@xyflow/react/dist/esm/types/component-props.d.ts:600-607`): `<ReactFlow isValidConnection={...}>`
- Invocation timing: called **during connection drag** (every tick that the cursor enters a candidate target handle). The xyflow runtime uses the return value to set the `connectionStatus` data attribute on the edge to `"valid"` or `"invalid"` (per `edges.d.ts:207-208`), which xyflow's default styles then colour green/red. Returning `false` prevents the drop from creating an edge.
- Underlying `system` type (`@xyflow/system/dist/esm/types/general.d.ts:109`): `IsValidConnection = (edge: EdgeBase | Connection) => boolean`. The handle-level alternative is **explicitly deprecated in favour of the ReactFlow-prop version for performance reasons** (`component-props.d.ts:603-606`).

This matches CONTEXT.md D-18 verbatim — no surprises.

### D2. `Connection` type fields

`Connection` (xyflow v12) carries:

```typescript
{
  source: string;          // source node id, never null
  target: string;          // target node id, never null
  sourceHandle: string | null;  // ⚠ nullable
  targetHandle: string | null;  // ⚠ nullable
}
```

**Reliability:** `sourceHandle` / `targetHandle` are passed reliably **only when the source/target node has multiple handles**. With a single handle, xyflow may pass `null` (it falls back to the implicit handle). For our case, **all four nodes use explicit handle IDs (`"image-in"`, `"image-out"`)** — see `BaseNode.tsx:46-72` where every Handle gets `id={port.id}`. So in practice these are non-null, but the validator MUST defensively handle the `null` case (return `false`).

### D3. Test strategy

Pure-function unit tests in `src/lib/workflow/__tests__/connectionValidator.test.ts`. Cover the full port-type matrix:

| Source port type | Target port type | Expected |
|------------------|------------------|----------|
| image | image | true |
| image | mask | false |
| image | text | false |
| image | number | false |
| image | any | true |
| any | image | true |
| any | any | true |
| text | text | true |
| (missing source node) | * | false |
| (missing source handle id) | * | false |
| `null` sourceHandle | image-in | false |

Plus integration cases using actual `NODE_REGISTRY` entries:

- `imageInput.image-out` → `removeBackground.image-in` → `true`
- `imageInput.image-out` → `imageInput.image-in` → false (no inputs on imageInput)
- `removeBackground.image-out` → `addReflection.image-in` → true
- `addReflection.image-out` → `assetOutput.image-in` → true

This mirrors the Phase 2 graphSlice test pattern (vitest, no DOM, pure logic). 11–15 cases in one file.

---

## E. Homepage card integration (D-19)

### E1. `page.tsx` cards array — verbatim

`platform-app/src/app/page.tsx:72-105`:

```typescript
const generationTypes = [
  {
    id: "banner" as const,
    icon: <ImageIcon size={20} strokeWidth={1.5} />,
    label: "Генерация\nбаннеров",
    gradient: "gradient-card-purple",
    iconBg: "bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400",
    image: "/cards/banner.png",
  },
  {
    id: "text" as const,
    icon: <Type size={20} strokeWidth={1.5} />,
    label: "Генерация\nтекстов",
    gradient: "gradient-card-blue",
    iconBg: "bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400",
    image: "/cards/text.png",
  },
  {
    id: "photo" as const,
    icon: <Camera size={20} strokeWidth={1.5} />,
    label: "Генерация\nфото",
    gradient: "gradient-card-peach",
    iconBg: "bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400",
    image: "/cards/photo.png",
  },
  {
    id: "video" as const,
    icon: <Video size={20} strokeWidth={1.5} />,
    label: "Генерация\nвидео",
    gradient: "gradient-card-green",
    iconBg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400",
    image: "/cards/video.png",
  },
];
```

Insertion point: **append a fifth entry** after the `video` card. The render loop (`page.tsx:251-276`) uses `grid-cols-4` — adding a fifth tile means **also updating the grid to `grid-cols-5`** OR moving to `grid-cols-2 md:grid-cols-3 lg:grid-cols-5` for responsive sanity. **Recommendation:** `grid-cols-2 md:grid-cols-3 lg:grid-cols-5` — preserves desktop density while not breaking small screens. Coordinate the change with the design-system rule `.cursor/rules/design-system-contrast.mdc`.

The new card entry:

```typescript
{
  id: "workflow" as const,
  icon: <Workflow size={20} strokeWidth={1.5} />,  // import from "lucide-react"
  label: "AI\nWorkflows",
  gradient: "gradient-card-pink",
  iconBg: "bg-pink-100 text-pink-600 dark:bg-pink-500/20 dark:text-pink-400",
  image: "/cards/workflows.png",
},
```

### E2. `globals.css` — gradient block

Existing pattern at `src/app/globals.css:248-283`:

```css
.gradient-card-purple {
  background: linear-gradient(145deg, #F5F3FF 0%, #EDE9FE 100%);
}
.gradient-card-blue { background: linear-gradient(145deg, #F0F9FF 0%, #E0F2FE 100%); }
.gradient-card-peach { background: linear-gradient(145deg, #FFF7ED 0%, #FFEDD5 100%); }
.gradient-card-green { background: linear-gradient(145deg, #F0FDF4 0%, #DCFCE7 100%); }

/* Dark mode gradient cards */
.dark .gradient-card-purple { background: linear-gradient(145deg, #1E1530 0%, #2A1C40 100%); }
.dark .gradient-card-blue   { background: linear-gradient(145deg, #1A1C30 0%, #1C2535 100%); }
.dark .gradient-card-peach  { background: linear-gradient(145deg, #2A1E15 0%, #302018 100%); }
.dark .gradient-card-green  { background: linear-gradient(145deg, #152A1E 0%, #1C2A12 100%); }
```

**New rules to add (CONTEXT D-19 spec, verbatim):**

```css
.gradient-card-pink {
  background: linear-gradient(145deg, #FDF2F8 0%, #FCE7F3 100%);
  /* Pink 50 -> Pink 100 */
}

/* Then in the dark block: */
.dark .gradient-card-pink {
  background: linear-gradient(145deg, #2A1525 0%, #3A1830 100%);
}
```

Insertion: append `.gradient-card-pink` after `.gradient-card-green` (line ~267) and `.dark .gradient-card-pink` after `.dark .gradient-card-green` (line ~283).

### E3. `NewProjectModal.tsx` — secondary call site

**Reality check vs CONTEXT.md:** `NewProjectModal.tsx` does **not** mirror `page.tsx`'s cards array. It has a different data structure called `goals` (`NewProjectModal.tsx:20-50`) — a list of project-creation type buttons rendered as a 4-column grid (`L148`). The `goals` array entries have shape `{ value, label, description, icon }` — **no `image`, no `gradient`** — they're small icon-and-label tiles, not full gradient cards.

**Recommendation:** Do **NOT** add the workflow card to `NewProjectModal`. The modal is specifically a "create project" wizard; workflows have a separate creation flow at `/workflows/new`. Adding it would be confusing — clicking "AI Workflows" inside "Новый проект" wouldn't actually create a project. The user-facing entry point for workflows should be:

1. The new homepage card → routes to `/workflows`.
2. The "Создать новый workflow" button on `/workflows` page (Phase 2 deliverable, already exists).

**Override CONTEXT D-19's "provisionally yes" stance** with: "After inspecting the modal, the cards array doesn't exist there — the modal uses a `goals` array tied to project creation, not generic generation tiles. Adding a workflow entry would create a non-functional click target. Skip the modal change."

This is a research finding that contradicts an inline CONTEXT assumption — flagged for planner & user.

### E4. Click semantics

The current `handleTileClick` (`page.tsx:170-189`) branches by `tileId`: `"banner"` opens the modal, `"photo"` triggers `createProjectMutation`, `"text"`/`"video"` show a toast.

**Cleanest expression of the workflow card's nav:** add another case to the switch:

```typescript
case "workflow":
  router.push("/workflows");
  break;
```

`router` is already in scope (`page.tsx:110`). No new field on the card definition needed — the `id`-based switch is the established pattern. **Rejected alternatives:**
- Adding `href` to each card definition — would force refactoring the existing four cards for a single new case.
- Adding `onClick` per card — same issue, plus inconsistent with existing structure.

### E5. Image asset

✅ Confirmed: `platform-app/public/cards/workflows.png` exists (16,954 bytes, modified 2026-04-24 02:37). The other four card images (`banner.png`, `text.png`, `photo.png`, `video.png`) are siblings in the same directory. Path reference `/cards/workflows.png` is correct (Next.js serves `public/` at the root).

---

## F. Test infrastructure

### F1. Phase 2 Zustand test pattern

`platform-app/src/store/workflow/__tests__/graphSlice.test.ts:1-135` shows the pattern:

- Direct `useWorkflowStore.getState()` calls — no React rendering.
- Manual `resetStore()` helper in `beforeEach` (Zustand v5 stores are module-singletons, state persists across tests).
- Vitest `describe`/`it`/`expect` only.
- Schema round-trip verified via `workflowGraphSchema.safeParse(serialized)`.

This pattern applies directly to:
- `src/store/workflow/__tests__/clientHandlers.test.ts` (mock `trpc.asset.getById` via `vi.mock` and assert handler outputs).
- `src/lib/workflow/__tests__/connectionValidator.test.ts` (pure function, no mocks needed).
- `src/lib/workflow/__tests__/perNodeSchemas.test.ts` (Zod schema validity, default value coverage).
- `src/components/workflows/__tests__/inspectorIntrospection.test.ts` (test the `unwrap` / `getEnumOptions` / `getNumberBounds` helpers as pure functions, decoupled from React rendering).

### F2. Component-level testing

**Confirmed via `package.json:61-76`:** no `@testing-library/react`, no `jsdom`, no `happy-dom`. Phase 2's `useWorkflowAutoSave.test.tsx` (mentioned in `02-SUMMARY.md:117`) sidesteps this by **re-implementing the scheduling loop in the test file** — a deliberate fragility documented at `useWorkflowAutoSave.ts:17-21`.

**Recommendation:** **Do not add jsdom in Phase 3.** The component-level surface (inspector form, ImageInput tabs) stays manual-only via the dev server. Pure helpers extracted from the components ARE testable and SHOULD be tested. Wave 5 of the plan should include a manual smoke-test checklist (open each node type → tweak each input → verify auto-save status → reload → verify persistence).

### F3. Per-deliverable test plan

| Deliverable | Test type | Notes |
|-------------|-----------|-------|
| Per-node Zod schemas | Unit | Default values valid; required fields reject empties; enum values match `NODE_REGISTRY` |
| `connectionValidator` | Unit | Full port-type matrix + missing-handle defensive cases |
| `clientHandlers.imageInput` | Unit | Mock `asset.getById`; assert `{imageUrl}` resolution paths (assetId, sourceUrl, neither-throws) |
| `clientHandlers.assetOutput` | Unit | Mock `asset.attachToWorkspace`; assert returned `assetId` |
| Inspector introspection helpers | Unit | `unwrap`, `getEnumOptions`, `getNumberBounds` over fixture schemas |
| `AssetPickerModal` | Manual | Smoke pass via existing editor + new workflow inspector |
| `NodeInspector` rendering | Manual | Per-node param edit roundtrip in dev server |
| `ImageInput` three tabs | Manual | Each tab → smoke test the source resolution end-to-end |
| Homepage card | Manual | Visual inspection (light + dark theme) + click → navigates to /workflows |

---

## G. Risk register

### G1. Net-new risks introduced by Phase 3

| # | Risk | Mitigation | Early signal |
|---|------|------------|--------------|
| R-3.1 | **Zod v4 introspection breaks for an edge case** (e.g. `.refine` wrappers, `z.coerce.number()`, `z.preprocess`). Our renderer assumes a small set of `def.type` values; a future schema using `pipe`/`transform` would not render. | Document supported types explicitly. The renderer's `default` branch shows a "Unsupported field type: X" warning rather than crashing. Unit tests cover the supported set explicitly. | Console warning fires in dev; QA notices empty inspector field. |
| R-3.2 | **`AssetPickerModal` extract regresses banner editor flow** (lost canvas-store mutation, broken delete/export). | Migration is a single call site; manual smoke checklist before declaring Wave 1 done (open banner editor → select layer → open library → add to canvas → replace src → delete → export). Keep delete/export inside the modal to minimise diff. | Banner editor test feedback in dev session. |
| R-3.3 | **Inspector re-render thrash on text typing.** Every keystroke updates Zustand → BaseNode subtree re-renders → input cursor lags. | Inspector keeps invalid drafts local; only valid changes flow to store. Wrap `BaseNode` in `React.memo`. If still slow, use `useDeferredValue` on text inputs. | Visible cursor lag in dev when typing fast in `assetOutput.name`. |
| R-3.4 | **No `Asset.workspaceId`-only support today** — all asset creation procedures require `projectId`. The new `attachToWorkspace` mutation needs `Asset.projectId` to be nullable in Prisma schema. | Wave 1 task: read `prisma/schema.prisma` Asset model. If non-nullable, schema migration required (`npx prisma migrate dev --name asset-projectid-nullable`). | Discovered at the moment the planner reads the schema file. |
| R-3.5 | **Upload-mode flow may not produce a library-visible asset** for workflow-uploaded files (no projectId). User expectation might differ. | Document: uploaded files via the workflow `ImageInput.upload` tab are S3-persistent but won't show in the workspace library. To get library visibility, upload via the canvas editor first, then pick from "Из библиотеки". Add an inline help tooltip in the upload tab. | User feedback during D-15 manual test. |
| R-3.6 | **Presign CORS kill switch (`presignDisabled` in `imageUpload.ts:25`)** could fire silently in dev if S3 CORS isn't configured. The fallback `/api/upload` legacy path still works but hits the server. | Document in plan. If CORS errors appear in console during dev, configure the bucket — but the code-path is resilient. | Console error `[imageUpload] Direct-to-S3 upload disabled for this session …`. |
| R-3.7 | **Pink gradient contrast may fail WCAG AA** for the icon over the light pink background (`#FDF2F8` → text-pink-600 `#DB2777`). | Run a contrast check during dev — `.cursor/rules/design-system-contrast.mdc` requires AA. If failing, switch icon to `text-pink-700` (`#BE185D`) on light. | Lighthouse / contrastometer report after Wave 4. |
| R-3.8 | **`grid-cols-4` → `grid-cols-5` change** on the homepage may push the cards too narrow on medium-width screens. | Use responsive `grid-cols-2 md:grid-cols-3 lg:grid-cols-5` instead of bare `grid-cols-5`. | Manual visual check at viewport widths 768, 1024, 1280, 1440. |
| R-3.9 | **The CONTEXT.md "provisionally yes" for `NewProjectModal` card** is wrong (Section E3 finding). Adding it would create a non-functional click target. | Skip the modal modification entirely. Document in Wave 4 deliverables: "do NOT modify NewProjectModal — its data shape is unrelated to the homepage cards array." | Already discovered during research; planner should not retry. |
| R-3.10 | **xyflow's default invalid-connection styling** may not be obvious enough at our colour palette (the default red is fairly subtle). | Acceptable for v1.0 per D-18 ("xyflow's default `isValidConnection` UX is industry-standard"). If user testing flags it, post-v1.0 polish. | Manual UX review after Wave 1. |

---

## Standard Stack (additions for Phase 3)

### Already available — no installs

| Library | Version | Purpose | Why standard |
|---------|---------|---------|--------------|
| `@xyflow/react` | `^12.10.2` | Canvas + `isValidConnection` prop | Phase 2 dep (`package.json:40`) |
| `zod` | `^4.3.6` | Per-node param schemas + introspection | Already in use (`package.json:58`) |
| `lucide-react` | `^0.563.0` | `Workflow` icon for D-19 card | Already in use (`package.json:48`) |
| `@radix-ui/react-tabs` | `^1.1.13` | Three-tab UI for `ImageInput` source | Already in use (`package.json:31`) |
| `vitest` | `^4.1.4` | Unit tests for validator + handlers + helpers | Already in use (`package.json:75`) |

### Not installed, NOT recommended

- ❌ `react-hook-form` + `@hookform/resolvers/zod` — explicitly rejected by D-14.
- ❌ `@autoform/zod`, `@auto-form/zod` — unproven Zod v4 compatibility.
- ❌ `jsdom` / `happy-dom` / `@testing-library/react` — Phase 2 explicitly avoided these (`02-SUMMARY.md:117-122`); not adding them in Phase 3.

---

## Architecture Patterns

### System architecture diagram

```
                                  ┌──────────────────────────────┐
   ┌─────────────────┐            │   /workflows/[id] page       │
   │ NODE_REGISTRY   │            │  (next/dynamic ssr:false)    │
   │ types.ts        │◀──reads───┤                              │
   │                 │            │  ┌─────────────────────────┐ │
   │ + perNodeParams │◀──reads───┤  │  WorkflowEditor          │ │
   │   Zod schemas   │            │  │  (ReactFlowProvider)     │ │
   │ (NEW — graphSchema.ts        │  │                          │ │
   └─────────────────┘            │  │  ┌──────┐ ┌─────────┐    │ │
                                  │  │  │ React│ │ NodeInsp│◀───┼─┼──── selectedNode
                                  │  │  │ Flow │ │ ector   │    │ │     (from Zustand)
                                  │  │  │      │ │ (NEW)   │    │ │
                                  │  │  └──┬───┘ └────┬────┘    │ │
                                  │  │     │          │          │ │
                                  │  │     ▼          ▼          │ │
                                  │  │ isValidConnection   updateNodeParams
                                  │  │  (NEW pure fn)         │  │
                                  │  └─────────────────────────┘  │
                                  └──────────────┬───────────────┘
                                                 │
                                ┌────────────────┼────────────────────┐
                                ▼                ▼                    ▼
                       ┌──────────────┐  ┌──────────────┐    ┌──────────────────┐
                       │ useWorkflow  │  │ AssetPicker  │    │ clientHandlers   │
                       │ Store        │  │ Modal (NEW   │    │ (NEW)            │
                       │ (Zustand)    │  │ extracted    │    │ - imageInput()   │
                       │              │  │ from Asset   │    │ - assetOutput()  │
                       │ + dirty flag │  │ LibraryModal)│    │                  │
                       └──────┬───────┘  └──────┬───────┘    └─────┬────────────┘
                              │                 │                  │
                              ▼                 ▼                  ▼
                       useWorkflowAuto     trpc.asset.list,   trpc.asset.getById,
                       Save (debounce      listByWorkspace    trpc.asset.attachToWorkspace
                       2s) → trpc                              (NEW server proc)
                       .workflow                                       │
                       .saveGraph                                      ▼
                                                              prisma.asset.create
                                                              workspaceId, projectId: null

(Phase 4 future addition: executor.ts dispatches per-node;
 client handlers above already shipped & tested.)
```

### Recommended file additions / moves

```
platform-app/src/
├── components/
│   ├── assets/                          # NEW directory
│   │   └── AssetPickerModal.tsx         # NEW — extracted from editor/AssetLibraryModal
│   ├── editor/
│   │   └── AssetLibraryModal.tsx        # ⚠ DELETED (consumer migrated to AssetPickerModal)
│   └── workflows/
│       ├── NodeInspector.tsx            # NEW — selected-node form renderer
│       ├── inspector/                   # NEW directory
│       │   ├── renderField.tsx          # NEW — switch over def.type
│       │   ├── introspection.ts         # NEW — unwrap/getEnumOptions/getNumberBounds helpers
│       │   ├── ImageInputInspector.tsx  # NEW — three-tab UI for imageInput node
│       │   └── __tests__/
│       │       └── introspection.test.ts # NEW — pure-helper unit tests
│       └── WorkflowEditor.tsx           # MODIFIED — pass isValidConnection prop, mount NodeInspector
├── lib/
│   └── workflow/
│       ├── connectionValidator.ts       # NEW — pure isValidConnection function
│       ├── perNodeSchemas.ts            # NEW — Zod schemas keyed by WorkflowNodeType
│       ├── graphSchema.ts               # MODIFIED — use perNodeSchemas inside workflowNodeSchema
│       └── __tests__/
│           ├── connectionValidator.test.ts # NEW
│           └── perNodeSchemas.test.ts      # NEW
├── store/
│   └── workflow/
│       ├── clientHandlers.ts            # NEW — imageInput + assetOutput handlers
│       ├── useWorkflowStore.ts          # MODIFIED — add `selectedNodeId` slice + setter
│       └── __tests__/
│           └── clientHandlers.test.ts   # NEW
├── server/
│   ├── routers/
│   │   └── asset.ts                     # MODIFIED — add attachToWorkspace mutation
│   └── workflow/
│       └── types.ts                     # MODIFIED — enrich defaultParams per node
└── app/
    ├── page.tsx                         # MODIFIED — add 5th card + grid-cols update
    ├── editor/[id]/page.tsx             # MODIFIED — migrate AssetLibraryModal → AssetPickerModal
    └── globals.css                      # MODIFIED — add .gradient-card-pink (light + dark)
```

### Pattern 1: Auto-rendering form from Zod schema (renderField switch)

```typescript
// src/components/workflows/inspector/renderField.tsx
import { z } from "zod";
import { unwrap, getEnumOptions, getNumberBounds } from "./introspection";

interface RenderFieldArgs {
  fieldName: string;
  schema: z.ZodType;
  value: unknown;
  onChange: (next: unknown) => void;
  error?: string;
}

export function renderField({ fieldName, schema, value, onChange, error }: RenderFieldArgs) {
  const inner = unwrap(schema);
  const type = inner._zod.def.type;

  switch (type) {
    case "string":
      return (
        <input
          type="text"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      );
    case "number": {
      const { min, max } = getNumberBounds(inner as z.ZodNumber);
      const isSlider = min != null && max != null && (max - min) <= 100;
      return isSlider ? (
        <input type="range" min={min} max={max} step={(max - min) / 100} value={Number(value ?? min)} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
      ) : (
        <input type="number" min={min} max={max} value={Number(value ?? min ?? 0)} onChange={(e) => onChange(Number(e.target.value))} className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
      );
    }
    case "enum": {
      const options = getEnumOptions(inner as z.ZodEnum);
      return (
        <select value={(value as string) ?? options[0]} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
          {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    }
    case "boolean":
      return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    default:
      console.warn(`[NodeInspector] Unsupported Zod type: ${type}`);
      return <p className="text-xs text-amber-600">Unsupported field: {type}</p>;
  }
  // error display handled by caller
}
```

### Pattern 2: Connection validator (verbatim from CONTEXT.md, with defensive nulls)

```typescript
// src/lib/workflow/connectionValidator.ts
import { NODE_REGISTRY } from "@/server/workflow/types";
import type { WorkflowNode } from "@/server/workflow/types";
import type { Connection } from "@xyflow/react";

export function isValidConnection(connection: Connection, nodes: WorkflowNode[]): boolean {
  // Defensive: xyflow may pass null handles when a node has a single implicit handle.
  // We always set explicit ids, so null here means a developer mistake or a misconfigured node.
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
    return false;
  }

  const source = nodes.find((n) => n.id === connection.source);
  const target = nodes.find((n) => n.id === connection.target);
  if (!source || !target) return false;

  const sourcePort = NODE_REGISTRY[source.type].outputs.find((p) => p.id === connection.sourceHandle);
  const targetPort = NODE_REGISTRY[target.type].inputs.find((p) => p.id === connection.targetHandle);
  if (!sourcePort || !targetPort) return false;

  if (sourcePort.type === "any" || targetPort.type === "any") return true;
  return sourcePort.type === targetPort.type;
}
```

### Pattern 3: Client handler contract (D-17)

```typescript
// src/store/workflow/clientHandlers.ts
import type { TRPCClient } from "@/lib/trpc"; // adjust to actual export

export interface ClientHandlerCtx {
  workspaceId: string;
  trpc: TRPCClient;
}

export async function imageInput(
  { params }: { params: { source: "asset" | "url" | "upload"; assetId?: string; sourceUrl?: string }; ctx: ClientHandlerCtx },
): Promise<{ imageUrl: string }> {
  if (params.assetId) {
    const asset = await ctx.trpc.asset.getById.query({ id: params.assetId });
    return { imageUrl: asset.url };
  }
  if (params.sourceUrl) return { imageUrl: params.sourceUrl };
  throw new Error("ImageInput requires either assetId or sourceUrl");
}

export async function assetOutput(
  { inputs, params, ctx }: {
    inputs: { "image-in": { imageUrl: string } };
    params: { name: string; folder?: string };
    ctx: ClientHandlerCtx;
  },
): Promise<{ assetId: string }> {
  const { id } = await ctx.trpc.asset.attachToWorkspace.mutate({
    workspaceId: ctx.workspaceId,
    url: inputs["image-in"].imageUrl,
    filename: params.name,
    source: "workflow-output",
  });
  return { assetId: id };
}
```

### Anti-patterns to avoid

- **❌ Using `(schema as any)._def.typeName`** (Zod v3 idiom) — Zod v4 dropped this. Always use `_zod.def.type`.
- **❌ Calling `updateNodeParams` on every keystroke even when invalid** — leaks bad state to canvas + auto-save. Buffer in local state, only push valid updates.
- **❌ Adding `useDeferredValue` proactively** — measure first; with 4 nodes the canvas re-render is cheap.
- **❌ Reusing the canvas-coupled `AssetLibraryModal` directly** — the `useCanvasStore` import (`AssetLibraryModal.tsx:12`) will break compilation in any non-canvas context.
- **❌ Passing `projectId="tmp"` to `asset.saveGeneratedImage` from the workflow upload flow** — that procedure requires a real project for ACL; use the new `attachToWorkspace` mutation instead.

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Form-from-schema generation | A general Zod→form library | A bespoke 4-case switch on `def.type` (D-14) | Only 4 primitive types; v1.0 doesn't need extensibility |
| Edge validation visualisation | Custom edge-color logic | xyflow's built-in `connectionStatus` data attribute → CSS | Industry-standard UX (D-18); custom theming can come later |
| Connection-drag preview line | Custom drag handlers | xyflow's built-in `<ConnectionLine>` | Comes free with `<ReactFlow>` |
| Modal primitives | Custom dialog | Existing `src/components/ui/Modal.tsx` (Radix-based) | Already used by `NewProjectModal` |
| Tab UI | Custom radio-button group | `@radix-ui/react-tabs` (already a dep) | Accessible, keyboard-navigable |
| Image upload pipeline | New presign/PUT logic | Existing `src/utils/imageUpload.ts:86-130` (`uploadImageToS3`) | Has CORS kill switch + fallback already |
| File compression | sharp/Pica integration | Existing `compressImageFile()` (`imageUpload.ts:343-383`) | Returns webp, ≤2000 px max dim |
| Asset deduplication | Manual cache | Existing `attachUrlToProject` idempotency (`asset.ts:248-253`) — add same pattern to new `attachToWorkspace` | Proven idempotency pattern |
| Drag-drop file zones | A library | Native `onDragOver` + `onDrop` + `<input type="file">` (mirrors `WorkflowEditor.tsx:117-135` palette drag pattern) | <30 LOC; no dep |

---

## Common Pitfalls

### Pitfall 1: Stale draft state when switching selected node

**What goes wrong:** User selects node A, edits a field, switches to node B without committing → the inspector shows node A's draft on top of node B's params.

**How to avoid:** Key the inspector component by selected node id (`<NodeInspector key={selectedNodeId} ... />`). React unmounts/remounts on key change, resetting all `useState` cleanly.

### Pitfall 2: Unbounded slider for unbounded number

**What goes wrong:** A future node defines `z.number()` (no `.min`/`.max`). The renderer's `getNumberBounds` returns `{ min: undefined, max: undefined }`; rendering a `<input type="range">` requires concrete bounds.

**How to avoid:** Render slider **only if** both bounds are defined. Otherwise fall back to `<input type="number">` (browsers handle unbounded number input fine).

### Pitfall 3: `default()` masking required-ness

**What goes wrong:** A schema like `z.string().default("")` looks "required" because the inner `def.type === "string"`, but actually accepts `undefined` (substitutes `""`). The inspector would show a red asterisk for a field that doesn't need it.

**How to avoid:** Treat `default` and `optional` as the same un-required wrapper (per Section B4). The asterisk reflects whether the schema would reject `undefined`.

### Pitfall 4: SSRF guard rejection on data URLs

**What goes wrong:** User pastes `data:image/png;base64,…` into the URL tab. Phase 4 executor will pass this to `safeFetch` which **may** reject it depending on policy.

**How to avoid:** Verify the SSRF guard's data: URL handling. Per `REQUIREMENTS.md REQ-23`: "data-URL → success (для drag-drop base64)" — confirmed allowed. Phase 3 only stores the URL; Phase 4 invokes `safeFetch`. Document for the executor author that data: URLs are expected.

### Pitfall 5: Zod v4 enum ordering not guaranteed cross-runtime

**What goes wrong:** `Object.values(schema._zod.def.entries)` relies on JS object insertion order (guaranteed since ES2015 for string keys). Numeric keys order before string keys, which would scramble dropdown options.

**How to avoid:** Per Zod docs, `z.enum([...])` always uses string entries → safe. Don't pass numeric-string keys (`z.enum(["1","2","3"])`) — those would sort numerically. Our four schemas only use natural-language string enums; safe.

### Pitfall 6: `crypto.randomUUID` unavailability in tests

**What goes wrong:** Phase 2's `makeId` (`createGraphSlice.ts:11-15`) deliberately avoids `crypto.randomUUID()` for jsdom/Node compat. New code should follow suit if generating ids client-side.

**How to avoid:** Reuse the existing `makeId` pattern or import from a shared util if extracted later. The `attachToWorkspace` mutation generates filenames server-side via `Date.now()` (matches existing `saveGeneratedImage`/`attachUrlToProject` patterns).

### Pitfall 7: `selectedNodeId` not yet in store

**What goes wrong:** Phase 2 store doesn't expose `selectedNodeId`. The inspector needs to know which node is selected to render. Adding selection state requires a small slice extension.

**How to avoid:** Add `selectedNodeId: string | null` + `setSelectedNodeId(id)` to the graph slice (or a new `selectionSlice`). xyflow's `onSelectionChange` callback on `<ReactFlow>` provides this; mirror to the store. Keep the existing `selected` boolean on `NodeProps` (xyflow-managed) for visual styling — the store mirror is purely for inspector mounting.

---

## Code Examples

### Example: Per-node Zod schemas (D-14 minimum surface)

```typescript
// src/lib/workflow/perNodeSchemas.ts
import { z } from "zod";
import type { WorkflowNodeType } from "@/server/workflow/types";

export const imageInputParamsSchema = z.object({
  source: z.enum(["asset", "url", "upload"]).default("asset"),
  assetId: z.string().optional(),
  sourceUrl: z.string().url().optional(),
}).refine(
  (d) => Boolean(d.assetId) || Boolean(d.sourceUrl),
  { message: "Выберите изображение из библиотеки, по URL или загрузите файл" },
);

export const removeBackgroundParamsSchema = z.object({
  model: z.enum(["fal-bria", "replicate-bria-cutout", "replicate-rembg"]).default("fal-bria"),
});

export const addReflectionParamsSchema = z.object({
  style: z.enum(["subtle", "strong", "mirror"]).default("subtle"),
  intensity: z.number().min(0).max(1).default(0.3),
  prompt: z.string().max(500).optional(),
});

export const assetOutputParamsSchema = z.object({
  name: z.string().min(1).max(120).default("Workflow output"),
  folder: z.string().optional(),
});

export const PER_NODE_PARAM_SCHEMAS: Record<WorkflowNodeType, z.ZodType<Record<string, unknown>>> = {
  imageInput: imageInputParamsSchema,
  removeBackground: removeBackgroundParamsSchema,
  addReflection: addReflectionParamsSchema,
  assetOutput: assetOutputParamsSchema,
};
```

### Example: NodeInspector skeleton

```typescript
// src/components/workflows/NodeInspector.tsx
"use client";
import { useMemo, useState, useEffect } from "react";
import { z } from "zod";
import { useWorkflowStore } from "@/store/workflow/useWorkflowStore";
import { NODE_REGISTRY } from "@/server/workflow/types";
import { PER_NODE_PARAM_SCHEMAS } from "@/lib/workflow/perNodeSchemas";
import { renderField } from "./inspector/renderField";

export function NodeInspector() {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const node = useWorkflowStore((s) => s.nodes.find((n) => n.id === selectedNodeId) ?? null);
  const updateNodeParams = useWorkflowStore((s) => s.updateNodeParams);

  if (!selectedNodeId || !node) {
    return (
      <aside className="w-80 shrink-0 border-l border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950">
        Выберите узел, чтобы редактировать параметры.
      </aside>
    );
  }

  const definition = NODE_REGISTRY[node.type];
  const schema = PER_NODE_PARAM_SCHEMAS[node.type] as z.ZodObject<z.ZodRawShape>;
  return <NodeInspectorBody key={selectedNodeId} node={node} definition={definition} schema={schema} updateNodeParams={updateNodeParams} />;
}

function NodeInspectorBody({ node, definition, schema, updateNodeParams }) {
  const [draft, setDraft] = useState(node.data.params);
  const result = schema.safeParse(draft);
  const errorsByPath: Record<string, string> = {};
  const objectLevelErrors: string[] = [];
  if (!result.success) {
    for (const issue of result.error.issues) {
      if (issue.path.length === 0) objectLevelErrors.push(issue.message);
      else errorsByPath[String(issue.path[0])] = issue.message;
    }
  }
  // Push valid changes to store; invalid drafts stay local.
  useEffect(() => { if (result.success) updateNodeParams(node.id, result.data); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [JSON.stringify(draft)]);

  const fields = Object.entries(schema.shape);
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{definition.displayName}</h3>
      <p className="mb-3 text-xs text-neutral-500">{definition.description}</p>
      {objectLevelErrors.length > 0 && (
        <div className="mb-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {objectLevelErrors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}
      <div className="space-y-3">
        {fields.map(([name, fieldSchema]) => (
          <div key={name}>
            <label className="mb-1 block text-xs font-medium text-neutral-700 dark:text-neutral-300">{name}</label>
            {renderField({
              fieldName: name,
              schema: fieldSchema as z.ZodType,
              value: draft[name],
              onChange: (v) => setDraft({ ...draft, [name]: v }),
              error: errorsByPath[name],
            })}
            {errorsByPath[name] && <p className="mt-1 text-xs text-red-500">{errorsByPath[name]}</p>}
          </div>
        ))}
      </div>
      <button
        onClick={() => { setDraft(definition.defaultParams); updateNodeParams(node.id, definition.defaultParams); }}
        className="mt-4 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
      >
        Сбросить параметры
      </button>
    </aside>
  );
}
```

(The above is a sketch — planner refines, but the **lifecycle (key by selectedNodeId, local draft, valid-only push)** is the contract.)

---

## State of the Art

| Old (Zod v3) | Current (Zod v4.3.6) | When changed | Impact |
|--------------|---------------------|--------------|--------|
| `schema._def.typeName === ZodFirstPartyTypeKind.ZodString` | `schema._zod.def.type === "string"` | Zod 4.0 | All inspector introspection differs from Zod v3 tutorials |
| `schema._def.checks.find(c => c.kind === "min")?.value` | `schema._zod.bag.minimum` | Zod 4.0 | Number bound extraction simpler in v4 |
| `schema.options` on `ZodEnum` | `schema._zod.def.entries` (or public `schema.enum`) | Zod 4.0 | Enum option extraction differs |
| `schema._def.innerType` for `optional` | `schema._zod.def.innerType` (same shape, new namespace) | Zod 4.0 | Cosmetic |

**Deprecated/outdated patterns to avoid:**
- ❌ `ZodFirstPartyTypeKind` enum — gone in Zod v4. Use string discriminator.
- ❌ `(schema as any)._def.typeName` — gone in Zod v4.
- ❌ `schema.options` on ZodEnum — replaced by `def.entries` in v4 internals (the public `.enum` property still works).

---

## Validation Architecture

### Test framework

| Property | Value |
|----------|-------|
| Framework | `vitest@^4.1.4` |
| Config file | None at project root visible — vitest default config used. Confirmed by Phase 2 test files importing only `vitest`. |
| Quick run command | `npx vitest run src/lib/workflow src/store/workflow` |
| Full suite command | `npm test` (runs `vitest run`) |

### Phase requirements → test map

| Req ID | Behavior | Test type | Automated command | File exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-11 | `isValidConnection` blocks incompatible drops | unit | `npx vitest run src/lib/workflow/__tests__/connectionValidator.test.ts` | ❌ Wave 0 — file to create |
| REQ-11 | Visual feedback during drag | manual | dev server smoke | n/a |
| REQ-12 | Form fields render per Zod type | unit (helpers) + manual (rendering) | `npx vitest run src/components/workflows/inspector/__tests__/introspection.test.ts` + manual smoke | ❌ Wave 0 |
| REQ-12 | Invalid input shows error and is not saved | unit (validate-only-push logic) + manual | covered by introspection tests + manual | ❌ Wave 0 |
| REQ-13 (full) | All 4 nodes have Russian display names + descriptions | unit (NODE_REGISTRY shape) | `npx vitest run src/server/workflow/__tests__/nodeRegistry.test.ts` (NEW) | ❌ Wave 0 |
| REQ-14 | Russian copy across NODE_REGISTRY + components | code review + manual | n/a | n/a |
| D-17 contract | clientHandlers resolve correctly | unit | `npx vitest run src/store/workflow/__tests__/clientHandlers.test.ts` | ❌ Wave 0 |

### Sampling rate

- **Per task commit:** `npx vitest run` (entire test suite — currently ~113 tests; Phase 3 adds ~20 more, still under 5 s).
- **Per wave merge:** `npx tsc --noEmit && npx vitest run && next build` (matches Phase 2 verification gates).
- **Phase gate:** Full suite green + manual smoke checklist.

### Wave 0 gaps

- [ ] `src/lib/workflow/__tests__/connectionValidator.test.ts` — covers REQ-11
- [ ] `src/lib/workflow/__tests__/perNodeSchemas.test.ts` — covers per-node schema integrity
- [ ] `src/components/workflows/inspector/__tests__/introspection.test.ts` — covers Zod helpers
- [ ] `src/store/workflow/__tests__/clientHandlers.test.ts` — covers D-17 contract
- [ ] (Optional) `src/server/workflow/__tests__/nodeRegistry.test.ts` — sanity check display names + execute kinds

No framework install needed — vitest already available.

---

## Security Domain

### Applicable ASVS categories

| ASVS Category | Applies | Standard control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing `auth()` session check on all server routes; no Phase 3 changes |
| V3 Session Management | no | No new session surface |
| V4 Access Control | yes | New `attachToWorkspace` mutation MUST call `assertWorkspaceAccess(ctx, workspaceId, "CREATOR")` (matches existing patterns in `asset.ts:184` etc.) |
| V5 Input Validation | yes | All inspector inputs validated through per-node Zod schemas; tRPC input schemas validate server-side |
| V6 Cryptography | no | No new crypto |

### Known threat patterns for this stack

| Pattern | STRIDE | Standard mitigation |
|---------|--------|---------------------|
| Cross-workspace asset write via spoofed `workspaceId` | Tampering | `assertWorkspaceAccess` check on `attachToWorkspace` (already required); REQ-24 enforced |
| Malicious URL paste in ImageInput | Tampering / SSRF | Phase 3 only stores the URL; SSRF check happens in Phase 4 executor's `safeFetch` (existing helper). Do NOT fetch URLs in Phase 3. |
| Oversized file upload (DoS) | DoS | Existing `compressImageFile` caps at 2000 px; presigned URL has no server-side size check at the moment — relies on browser-side compression. Acceptable for v1.0; document as known. |
| Inspector input XSS | Spoofing | All renders use React (auto-escapes); no `dangerouslySetInnerHTML` planned |
| Open redirect via D-19 router.push | Tampering | Hard-coded `"/workflows"` route; no user input in nav target — safe |

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build & test | ✓ | (project std) | — |
| `@xyflow/react` | Editor | ✓ | 12.10.2 | — |
| `zod` | Schema introspection | ✓ | 4.3.6 | — |
| Yandex S3 + bucket CORS | Upload tab | ⚠ partial | — | Legacy `/api/upload` proxy fallback already wired (`imageUpload.ts:25-39`) |
| `lucide-react` `Workflow` icon | Card | ✓ | 0.563.0 | — |
| `prisma` (for `attachToWorkspace` mutation) | Server | ✓ | 6.19.2 | If `Asset.projectId` is non-nullable, requires migration (R-3.4) |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** S3 CORS may need bucket-side configuration in dev; existing fallback to legacy upload proxy means features still work, just with a server hop (acceptable for dev).

---

## Project Constraints (from .cursor/rules/)

`.cursor/rules/design-system-contrast.mdc` — must be followed for:
- Inspector text/background contrast (WCAG AA).
- New `.gradient-card-pink` light + dark text contrast for the icon and label.
- Slider/input borders in dark mode must remain visible on `bg-neutral-950`.

`.cursor/rules/deploy-pipeline.mdc` — read for any deployment-affecting changes (none expected; Phase 3 is application-layer only).

---

## Sources

### Primary (HIGH confidence)
- **Project source code** (read directly):
  - `platform-app/src/server/workflow/types.ts` (NODE_REGISTRY, ports, executor kinds)
  - `platform-app/src/lib/workflow/graphSchema.ts` (current schema shape)
  - `platform-app/src/store/workflow/createGraphSlice.ts` (`updateNodeParams` semantics)
  - `platform-app/src/store/workflow/types.ts` (slice composition)
  - `platform-app/src/hooks/workflow/useWorkflowAutoSave.ts` (debounce contract)
  - `platform-app/src/components/workflows/WorkflowEditor.tsx` (`isValidConnection` slot)
  - `platform-app/src/components/workflows/{NodePalette,nodes/BaseNode,nodes/index}.tsx` (visual baselines)
  - `platform-app/src/components/editor/AssetLibraryModal.tsx` (extract source)
  - `platform-app/src/utils/imageUpload.ts` + `src/app/api/upload{,/presign}/route.ts` (upload contract)
  - `platform-app/src/server/routers/asset.ts` (existing asset procedures)
  - `platform-app/src/app/page.tsx` (homepage cards)
  - `platform-app/src/components/dashboard/NewProjectModal.tsx` (cards-array contradiction)
  - `platform-app/src/app/globals.css` (gradient class pattern)
  - `platform-app/package.json` (dep manifest — confirmed no `@testing-library/react`/jsdom)
- **Vendored type definitions** (read directly):
  - `platform-app/node_modules/zod/v4/core/schemas.d.ts` — Zod v4 `def.type` discriminator + `bag.minimum`/`maximum`
  - `platform-app/node_modules/zod/v4/classic/schemas.d.ts` — public `.def`/`_def` aliases + `.min()`/`.max()` signatures
  - `platform-app/node_modules/@xyflow/react/dist/esm/types/{component-props,general,store,edges}.d.ts` — `IsValidConnection` signature + invocation timing
  - `platform-app/node_modules/@xyflow/system/dist/esm/types/general.d.ts` — base `IsValidConnection` type

### Secondary (MEDIUM confidence)
- Zod v4 official docs (https://v4.zod.dev/) — confirmed `_zod.def.type` access pattern via the JSON Schema override example; confirmed `.enum`/`.options` semantics. Cross-checked against vendored types.
- xyflow v12 docs implicit via the inline JSDoc on the vendored `.d.ts` files (HIGH confidence — these ARE the official typings shipped with the package).

### Tertiary (LOW confidence — flagged for validation)
- None. All claims grounded in either local source or vendored types.

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | `Asset.projectId` is nullable in `prisma/schema.prisma` (required for the `attachToWorkspace` mutation to set `projectId: null`) | C3, R-3.4 | Wave 1 needs a Prisma migration, slight schedule slip |
| A2 | Adding a workflow card to `NewProjectModal` is the wrong choice (CONTEXT says provisionally yes; Section E3 contradicts) | E3, R-3.9 | Minor scope debate with user/PM; either way takes <30 min to revisit |
| A3 | Zod v4 dropdown enum ordering will always preserve insertion order for our string-key enums | Pitfall 5 | Dropdowns might render in unexpected order; quick fix once spotted |
| A4 | Inspector re-render performance is acceptable without memoisation at 4 nodes | B7, R-3.3 | Need to add `React.memo` post-hoc if measured slow |
| A5 | Manual smoke testing is sufficient for component-level UI (no jsdom install in Phase 3) | F2 | Bugs slip through; mitigated by 4-node small surface area |

---

## Open Questions

1. **Should the `Asset` table store `workspaceId`-only rows (projectId null) or do we need a parallel `WorkspaceAsset` model?**
   - What we know: existing `Asset` has both `workspaceId` and `projectId` columns; `WorkspaceAssetGrid` queries `listByWorkspace` which uses `workspaceId` filter alone (server-side accepts it).
   - What's unclear: whether `projectId` is nullable. Need to read `prisma/schema.prisma:311` to confirm.
   - Recommendation: read schema as the FIRST task of Wave 1; if non-nullable, write a small migration before the new mutation. Either way, no architectural change.

2. **Should the upload tab in `ImageInput` create a workspace-scoped Asset row, or just persist the S3 URL into `params.sourceUrl`?**
   - What we know: persisting the URL is simpler; creating an Asset row gives library visibility.
   - What's unclear: user expectation. Current recommendation in C2 is "persist URL only, document the limitation."
   - Recommendation: ship the simpler path in v1.0; if users complain in feedback, add the `attachToWorkspace` call from the upload success handler.

3. **Should `selectedNodeId` live in a new `selectionSlice` or inside `GraphSlice`?**
   - What we know: Phase 2's slice composition follows `canvasStore` convention.
   - What's unclear: whether selection deserves its own slice or stays inside graph.
   - Recommendation: extend `GraphSlice` with `selectedNodeId` for v1.0 (single field, no need for a slice); split later if `selectionSlice` grows multi-select / hover state in Phase 5+.

---

## Implementation hints for the planner

A bullet list of concrete pointers to feed into `03-PLAN.md`:

1. **Wave 0 — schema check:** Before touching anything, read `platform-app/prisma/schema.prisma:311` (the `Asset` model) and confirm `projectId` is nullable. If not, add a `npx prisma migrate dev --name asset-projectid-nullable` task to Wave 1.
2. **Wave 1 must be parallelisable:** `AssetPickerModal extract`, `connectionValidator + tests`, `perNodeSchemas + tests`, and the (conditional) Prisma migration are independent. Run them concurrently.
3. **`AssetLibraryModal` migration is a single-consumer rename** — only `src/app/editor/[id]/page.tsx:1011-1015` needs updating. Pass `workspaceId` from `useWorkspace()` and wrap `addImageLayer` in an `onSelect` callback.
4. **Add `selectedNodeId: string | null`** to `GraphSlice` in `src/store/workflow/types.ts` + `createGraphSlice.ts` (mirror xyflow `onSelectionChange` from `<ReactFlow>` into the store). Keep xyflow's `selected` boolean prop on `NodeProps` for visual styling.
5. **NodeInspector mounts via `key={selectedNodeId}`** — this is the cleanest way to discard stale draft state on selection change.
6. **Renderer dispatches on `_zod.def.type` after unwrap** — Zod v4 idiom; do NOT use v3 `_def.typeName`. Concretely: `function unwrap(s) { while (s._zod.def.type === "optional" || ... === "default" || ... === "nullable") s = s._zod.def.innerType; return s; }`.
7. **Number bounds:** `(schema as ZodNumber)._zod.bag.minimum` / `.maximum`. Render slider only if both defined AND `(max-min) <= 100`.
8. **Enum options:** `Object.values(schema._zod.def.entries)` (string-key enums only — our four schemas are safe).
9. **Validation push rule:** `safeParse` on every change; only call `updateNodeParams` if `result.success`. Object-level errors (`path: []`) render in a small header strip; field-level errors render under the field.
10. **`isValidConnection` wiring:** add `isValidConnection={(c) => connValidator(c, useWorkflowStore.getState().nodes)}` as a prop on `<ReactFlow>` in `WorkflowEditor.tsx:139`. The function reads `nodes` from `getState()` to avoid re-creating the callback on every render.
11. **Three-tab UI for ImageInput** uses `@radix-ui/react-tabs` (already a dep). Tabs map 1:1 to the `source` enum value; switching tabs writes `params.source` to the store.
12. **Upload flow:** `compressImageFile(file, 2000)` → `uploadImageToS3(base64, "tmp", mimeType)` → write returned URL to `params.sourceUrl`. Mark `params.source = "upload"` (still used for routing through the inspector tabs; the runtime resolution sees only `sourceUrl`).
13. **`asset.attachToWorkspace`:** new tRPC mutation in `src/server/routers/asset.ts` — copy idempotency pattern from `attachUrlToProject:248-253`. Use `assertWorkspaceAccess(ctx, workspaceId, "CREATOR")`.
14. **D-17 client handlers** are pure functions accepting `{params, ctx}` / `{inputs, params, ctx}`. Phase 3 ships them with unit tests and **does NOT call them** anywhere — Phase 4 wires the executor.
15. **Homepage card:** modify `src/app/page.tsx:72-105` (append fifth card), `:170-189` (add `case "workflow"`), `:251` (responsive grid `grid-cols-2 md:grid-cols-3 lg:grid-cols-5`). Add `Workflow` to the lucide imports at `:6`. Add `.gradient-card-pink` rules at `globals.css:267, :283`. **Do NOT touch `NewProjectModal`** (research finding contradicts CONTEXT.md provisional yes).

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all confirmed against vendored types and `package.json`
- Architecture: HIGH — directly grounded in existing Phase 2 source
- Pitfalls: MEDIUM-HIGH — derived from source inspection + Zod v4 docs; performance pitfalls (R-3.3) flagged as needing measurement
- Asset modal extract: HIGH — single consumer confirmed; migration path mechanical
- `attachToWorkspace` mutation viability: MEDIUM — depends on A1 (schema nullability check)

**Research date:** 2026-04-24
**Valid until:** 2026-05-08 (xyflow v12 + Zod v4 stable; project source state captured at this commit)

