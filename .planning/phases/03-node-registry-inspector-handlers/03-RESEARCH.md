# Phase 3 — Research

**Spawned by:** /gsd-plan-phase
**Date:** 2026-04-24
**Researcher:** gsd-phase-researcher
**Confidence:** HIGH (95% read directly from project source; only Zod-v4 introspection details and xyflow `isValidConnection` semantics involved doc reading)

---

## TL;DR for the planner

1. **AssetLibraryModal has exactly ONE consumer** (`platform-app/src/app/editor/[id]/page.tsx:1011`). The "shared extract" task in D-16 is much smaller than the roadmap risk implies. Recommended: introduce a *new* `AssetPickerModal` with a slim "single-select with onSelect callback" API; **leave the existing `AssetLibraryModal` alone**. They have fundamentally different responsibilities (browse-and-act-on-canvas vs. pick-one-asset-and-return).
2. **Zod v4 introspection is `schema._zod.def.type`**, NOT `_def.typeName` (that was Zod v3). Wrappers (`optional`, `default`, `nullable`) expose the inner schema via `def.innerType`. Number constraints live in `_zod.def.checks[]` with `def.check === "greater_than" | "less_than"` (and `inclusive` flag), or — much simpler — on `_zod.bag.minimum / .maximum` after `.min()/.max()` calls.
3. **xyflow `isValidConnection` signature** (`@xyflow/react@12.10.2`): `(edge: EdgeBase | Connection) => boolean`. Receives `Connection` with `sourceHandle: string | null` and `targetHandle: string | null`. Slot it as a single new prop on `<ReactFlow>` in `WorkflowEditor.tsx:139`. Default visual feedback (red stroke during drag, no edge created on drop) is industry-standard and matches D-18.
4. **`asset.createFromUrl` does NOT exist.** Closest fit is `asset.attachUrlToProject` (`asset.ts:229`), but it requires `projectId` — `AIWorkflow` belongs to a *workspace*, not a project, so this won't work as-is. Phase 3 must add a new workspace-scoped procedure (recommended name: `asset.createFromUrl`) or repurpose `attachUrlToProject` with optional `projectId`. **This is a Phase-3 server deliverable not currently called out in CONTEXT.**
5. **`NewProjectModal.tsx` does NOT mirror the homepage card grid.** It has a goal-icon grid (banner/text/photo/video) inside a `Modal`. Adding a "Workflow" card there *as an icon-tile that navigates instead of creating* changes its semantics — recommended: leave NewProjectModal alone for Phase 3, add the card only on `/page.tsx` and (if applicable) `/projects/page.tsx`. CONTEXT D-19 left this provisional with "yes" — research recommends switching that to "no" for Phase 3 to keep blast radius minimal.
6. **Image upload contract** (`utils/imageUpload.ts`) returns a public S3 URL only — does **not** auto-create an `Asset` row when `skipAssetRecord: true` is passed (which the workflow upload should). Workflow upload mode must call `asset.attachUrlToProject` (or new `createFromUrl`) explicitly to register the result. Two-step: `uploadImageToS3()` → returns S3 URL → `asset.createFromUrl()` → returns `assetId`.
7. **No `@testing-library/react` is installed** (confirmed against current `platform-app/package.json` — `vitest@4.1.4`, `@vitest/coverage-v8@4.1.4` only). Phase 3 component-level UI tests are NOT feasible without adding `@testing-library/react` + `jsdom`. Recommended: keep all UI verification manual; unit-test only the pure `connectionValidator`, `clientHandlers`, and Zod-introspection helpers.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-11 (P0) | Типизированные соединения / `isValidConnection` blocks bad edges | Section D below — `IsValidConnection = (edge: EdgeBase \| Connection) => boolean`; slot in `WorkflowEditor.tsx:139`; pure validator in `src/lib/workflow/connectionValidator.ts` per CONTEXT spec |
| REQ-12 (P0) | Inspector автогенерация формы from Zod schema (text / number / enum / boolean) | Section B below — Zod v4 introspection via `schema._zod.def.type`; per-node schemas live in `graphSchema.ts` extension or new `nodeParamSchemas.ts` |
| REQ-13 (P0, P2+P3) | Node palette polish (Russian display names, descriptions) | Phase 2 already shipped palette infra; Phase 3 enriches `NODE_REGISTRY.displayName` / `.description` (D-20 Russian inline copy) |
| REQ-14 (P1) | Per-node UX русификация (display names, params, errors) | Russian labels live inline in `NODE_REGISTRY` and inspector field-label maps (D-20) |
</phase_requirements>

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-14** Inspector form library: hand-rolled switch (`switch` on `ZodString | ZodNumber | ZodEnum | ZodBoolean`). NO `react-hook-form`, NO `@autoform/zod`. Validation via Zod `safeParse` on every change; invalid → inline error, not pushed to `updateNodeParams`.
- **D-15** ImageInput supports three modes: library pick (assetId) / URL paste / upload. Upload mode resolves to `assetId` at submit time. Inspector exposes three radio-tabs ("Из библиотеки" / "По URL" / "Загрузить файл").
- **D-16** Extract `AssetLibraryModal` to shared component **in Wave 1** before inspector consumes it. Output: `src/components/assets/AssetPickerModal.tsx` with `{ open, onClose, onSelect(assetId), workspaceId, multiSelect?: false }`.
- **D-17** Client handlers `src/store/workflow/clientHandlers.ts`:
  - `imageInput({ params, ctx })` → `{ imageUrl }`. assetId → `asset.getById`; sourceUrl → direct; throws on neither.
  - `assetOutput({ inputs, params, ctx })` → calls tRPC `asset.createFromUrl` (CONTEXT itself flags this as "research needs to confirm exact endpoint" — see Section C3 below, **endpoint does NOT exist**).
  - Phase 3 ships handlers + unit tests but does NOT invoke them; Run button stays disabled.
- **D-18** Connection validation: `isValidConnection` only (no rich coloring, no tooltips). Validator in `src/lib/workflow/connectionValidator.ts`. xyflow's default invalid-drop visual is sufficient.
- **D-19** "AI Workflows" homepage card. New `gradient-card-pink` class in globals.css. Image at `public/cards/workflows.png` (already in repo, 16,954 bytes). Click navigates to `/workflows` (does NOT trigger `createProjectMutation`).
- **D-20** Russian strings inline in `NODE_REGISTRY` and JSX. No i18n setup in v1.0.

### Claude's Discretion

- Exact field-render component split (one file with switch vs. one file per type) — D-14 prescribes inline switch in `NodeInspector.tsx` or sibling.
- Inspector layout details (header style, footer button placement) — CONTEXT prescribes ~320 px right panel, definition.displayName + category badge header, "Сбросить параметры" button at footer.
- Exact extract approach for AssetLibraryModal — research recommends new `AssetPickerModal` (do NOT rename existing) — see Section A5.
- Whether to add the Workflow card to `NewProjectModal` — research recommends NO (see Section E3).

### Deferred Ideas (OUT OF SCOPE)

- Run button enable / DAG executor → Phase 4
- Preset library + `?preset=` resolution → Phase 5
- Inspector advanced inputs (color picker, JSON editor, code mirror, file drop on non-image nodes) → Phase 5+
- i18n infrastructure (translation files, locale switcher) → only when second locale arrives
- Rich port-type-aware connection coloring (highlight all compatible handles during drag) → Phase 5 visual polish
- Tooltip-on-invalid-drop explanation → Phase 5 visual polish
- AssetLibraryModal multi-select → only if a future node demands it
- Node grouping / sub-graphs → out of v1.0
</user_constraints>

---

## A. AssetLibraryModal extract — HIGHEST PRIORITY (Wave 1 blocker)

### A1. Current location

**File:** `platform-app/src/components/editor/AssetLibraryModal.tsx`
**Size:** 430 lines
**Phase author:** preexisting (created during the canvas/editor work, not Phase 1/2 of this milestone).

Component signature (lines 17–29):

```17:29:platform-app/src/components/editor/AssetLibraryModal.tsx
interface AssetLibraryModalProps {
    projectId: string;
    open: boolean;
    onClose: () => void;
}

type SortBy = "createdAt" | "filename" | "sizeBytes";
type SortOrder = "asc" | "desc";
type Scope = "project" | "workspace";

// ─── Component ──────────────────────────────────────────────────────────────

export function AssetLibraryModal({ projectId, open, onClose }: AssetLibraryModalProps) {
```

### A2. Consumers inventory

Grep across `platform-app/src/` for `AssetLibraryModal` returns **exactly one consumer**:

| Caller | Line | Props passed | Selection callback | Coupling |
|--------|-----:|--------------|-------------------:|----------|
| `platform-app/src/app/editor/[id]/page.tsx` | 1011 | `projectId={id}`, `open={assetLibraryOpen}`, `onClose={() => setAssetLibraryOpen(false)}` | **None — modal acts on canvas via `useCanvasStore` directly** (no `onSelect` prop) | Hard-coupled to `useCanvasStore` (lines 37–53, 135–153): mutates `addImageLayer` / `updateLayer` directly |

The modal is currently **action-oriented, not pick-oriented**:
- "На холст" button → adds selected assets as new image layers via `useCanvasStore.addImageLayer`
- "Применить к выделению" button → replaces `src` of the canvas's currently-selected `ImageLayer` via `updateLayer`
- "Экспорт" button → triggers browser download
- "Удалить" button → calls `asset.deleteMany`

There is **no `onSelect(assetId)` callback** — the modal performs the action itself. This is a fundamentally different flow from what Phase 3's inspector needs.

### A3. Recommended target shared API

The workflow inspector needs a strict pick-one-and-return picker. The existing browse-and-act modal does too much.

**Proposed `AssetPickerModal` (new file `platform-app/src/components/assets/AssetPickerModal.tsx`):**

```typescript
interface AssetPickerModalProps {
    open: boolean;
    onClose: () => void;
    /** Called with the picked asset (full row, not just id, so caller has url). */
    onSelect: (asset: AssetRow) => void;
    workspaceId: string;
    /** Optional project scope; when provided, default tab is "project". */
    projectId?: string;
    /** Future-proofing; default false. */
    multiSelect?: false;
    /** Override default title. */
    title?: string; // default "Выбрать изображение"
    /** Restrict to a single asset type. Default: "IMAGE". */
    assetType?: "IMAGE" | "VIDEO" | "AUDIO";
}

interface AssetRow {
    id: string;
    url: string;
    filename: string;
    sizeBytes: number;
    mimeType: string;
    createdAt: Date;
}
```

**Differences from existing `AssetLibraryModal`:**
- `onSelect(asset)` replaces all "actions" (no canvas mutation, no delete, no export, no replace).
- `workspaceId` becomes a required prop (current modal derives it from `project.getById`); the inspector knows its own workspace via `useWorkspace()`.
- `projectId` is optional — workflow inspector won't have one for v1.0.
- Selection model: single-select with click-to-pick (no checkboxes, no bulk actions). Click an asset → `onSelect(asset)` → `onClose()` automatically.
- No "Apply to selection" path (canvas-store-coupled — irrelevant outside the editor).
- Reuses the same tRPC queries (`asset.listByWorkspace`, optionally `asset.listByProject`).
- Reuses same scope tabs ("Этот проект" / "Вся библиотека") only when `projectId` is provided; else just shows workspace assets.

### A4. Migration cost

| Item | Cost | Notes |
|------|-----:|-------|
| Create new `AssetPickerModal.tsx` (~250 lines, derived from existing 430) | Medium | ~60% code reuse from existing modal; strip canvas/action code |
| Update `editor/[id]/page.tsx` consumer | **None** | Existing `AssetLibraryModal` stays as-is for the canvas editor |
| Tests for `AssetPickerModal` | None feasible | No `@testing-library/react`; manual verification only |
| Update `editor/[id]/page.tsx` import | **None** | No change |

**Total blast radius: 1 new file. Zero changes to existing code.**

This is dramatically smaller than the CONTEXT.md D-16 risk implied. The extract was framed as "refactor existing modal into a shared component" — research found it's better to **fork the simplified picker**, not refactor the full-featured one. Roadmap note about "AssetLibraryModal coupling — if hard to reuse, extract minimal sub-modal" was prescient.

### A5. Naming recommendation

**Recommended: Add new `AssetPickerModal.tsx` alongside existing `AssetLibraryModal.tsx`. Do NOT rename.**

Rationale:
- The existing modal is a *workflow library manager* (browse + bulk actions on canvas). Renaming it `AssetPickerModal` would mislead future readers — that name should mean "single pick, returns asset".
- Forking instead of extracting avoids touching `editor/[id]/page.tsx` at all (zero risk to the canvas editor).
- Future evolution: if a third consumer needs the same picker, it reuses `AssetPickerModal`. If a third needs the full library, it reuses `AssetLibraryModal`. Clear separation.
- The 60% code overlap is acceptable for v1.0 — both files are <500 lines. Deduplication can land in Phase 5+ when patterns crystallize.

**Alternative considered & rejected:** Extract the grid + search/sort UI into a `AssetGrid` component shared by both modals. **Rejected** because it triples the surface area and adds a "what does this prop mean again?" tax for v1.0. Land it later if both modals diverge along the same lines.

**File location:** `platform-app/src/components/assets/AssetPickerModal.tsx` (CONTEXT D-16 prescribes this folder; the folder doesn't exist yet — create it).

---

## B. Inspector form rendering (D-14, REQ-12)

### B1. Zod v4 introspection mechanics

**Critical correction to common Zod-v3-era knowledge:** Zod v4 abandoned `_def.typeName`. The new discriminant is `schema._zod.def.type` (a string union).

Verified directly from `platform-app/node_modules/zod/v4/core/schemas.d.ts:31`:

```31:31:platform-app/node_modules/zod/v4/core/schemas.d.ts
    type: "string" | "number" | "int" | "boolean" | "bigint" | "symbol" | "null" | "undefined" | "void" | "never" | "any" | "unknown" | "date" | "object" | "record" | "file" | "array" | "tuple" | "union" | "intersection" | "map" | "set" | "enum" | "literal" | "nullable" | "optional" | "nonoptional" | "success" | "transform" | "default" | "prefault" | "catch" | "nan" | "pipe" | "readonly" | "template_literal" | "promise" | "lazy" | "function" | "custom";
```

The discriminator function for the inspector switch:

```typescript
import type { z } from "zod";

type Kind =
    | "string"
    | "number"
    | "boolean"
    | "enum"
    | "optional-string"
    | "optional-number"
    | "optional-boolean"
    | "optional-enum"
    | "unsupported";

function detectKind(schema: z.ZodTypeAny): Kind {
    // Cast to `any` to reach the runtime _zod metadata; Zod's TS types intentionally hide it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const def = (schema as any)._zod?.def;
    if (!def) return "unsupported";

    if (def.type === "optional" || def.type === "default" || def.type === "nullable") {
        const inner = detectKind(def.innerType);
        return inner === "unsupported" ? "unsupported" : (`optional-${inner}` as Kind);
    }

    switch (def.type) {
        case "string": return "string";
        case "number": case "int": return "number";
        case "boolean": return "boolean";
        case "enum": return "enum";
        default: return "unsupported";
    }
}
```

**Source / verification:**
- `platform-app/node_modules/zod/v4/core/schemas.d.ts:360–406` — `$ZodNumberDef.type === "number"`, `$ZodBooleanDef.type === "boolean"`
- `platform-app/node_modules/zod/v4/core/schemas.d.ts:767–784` — `$ZodEnumDef.type === "enum"`, `def.entries: T` carries the enum members
- `platform-app/node_modules/zod/v4/core/schemas.d.ts:835–850` — `$ZodOptionalDef.type === "optional"`, `def.innerType` is the wrapped schema

`[VERIFIED: read from platform-app/node_modules/zod/v4/core/schemas.d.ts on 2026-04-24]`

### B2. Number range detection

Two routes — **prefer route 2 for the inspector, since it's a single property read.**

**Route 1 — read the checks array:**
```typescript
// schema._zod.def.checks: Array<{ _zod: { def: { check: "greater_than" | "less_than", value: number, inclusive: boolean } } }>
```
Verified at `platform-app/node_modules/zod/v4/core/checks.d.ts:24–49`:

```24:49:platform-app/node_modules/zod/v4/core/checks.d.ts
export interface $ZodCheckLessThanDef extends $ZodCheckDef {
    check: "less_than";
    value: util.Numeric;
    inclusive: boolean;
}
export interface $ZodCheckLessThanInternals<T extends util.Numeric = util.Numeric> extends $ZodCheckInternals<T> {
    def: $ZodCheckLessThanDef;
    issc: errors.$ZodIssueTooBig<T>;
}
export interface $ZodCheckLessThan<T extends util.Numeric = util.Numeric> extends $ZodCheck<T> {
    _zod: $ZodCheckLessThanInternals<T>;
}
export declare const $ZodCheckLessThan: core.$constructor<$ZodCheckLessThan>;
export interface $ZodCheckGreaterThanDef extends $ZodCheckDef {
    check: "greater_than";
    value: util.Numeric;
    inclusive: boolean;
}
```

**Route 2 — read the bag (recommended):**
```typescript
// schema._zod.bag: { minimum?: number, maximum?: number, exclusiveMinimum?: number, exclusiveMaximum?: number, ... }
```
Verified at `platform-app/node_modules/zod/v4/core/schemas.d.ts:370–377`:

```370:377:platform-app/node_modules/zod/v4/core/schemas.d.ts
    bag: util.LoosePartial<{
        minimum: number;
        maximum: number;
        exclusiveMinimum: number;
        exclusiveMaximum: number;
        format: string;
        pattern: RegExp;
    }>;
```

**Helper:**
```typescript
function getNumberRange(schema: z.ZodTypeAny): { min?: number; max?: number } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bag = (schema as any)._zod?.bag ?? {};
    return { min: bag.minimum, max: bag.maximum };
}
```

**Slider vs. number-input rule:** render slider when both `min` and `max` are defined AND `(max - min) <= 100`; otherwise render a number input. (Inspector's UX heuristic — not enforced by Zod.)

### B3. Enum value extraction

`$ZodEnumDef.entries` is the source of truth (lines 767–770). For `z.enum(["a","b","c"])` it's `{ a: "a", b: "b", c: "c" }`:

```typescript
function getEnumOptions(schema: z.ZodTypeAny): string[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries = (schema as any)._zod?.def?.entries;
    if (!entries) return [];
    return Object.values(entries) as string[];
}
```

**Russian-label mapping (D-20):** the inspector renders raw enum values for now (e.g. `"subtle"` / `"strong"` / `"mirror"`). Per-enum Russian labels can live in a per-node `enumLabels: Record<string, string>` map next to the schema, or be deferred to a Phase 5 polish pass. Recommended: **add the labels inline next to the schema in Phase 3**, since CONTEXT.specifics already shows Russian-friendly enum values like `"subtle"|"strong"|"mirror"`. Example:

```typescript
export const addReflectionParamsSchema = z.object({
    style: z.enum(["subtle", "strong", "mirror"]).default("subtle"),
    intensity: z.number().min(0).max(1).default(0.3),
    prompt: z.string().max(500).optional(),
});

export const addReflectionLabels = {
    style: "Стиль отражения",
    intensity: "Интенсивность",
    prompt: "Доп. подсказка",
} as const;

export const addReflectionEnumLabels = {
    style: { subtle: "Мягкое", strong: "Сильное", mirror: "Зеркало" },
} as const;
```

### B4. Optional vs required

Detection: `def.type === "optional"` OR `def.type === "default"` OR `def.type === "nullable"` → not required. Inner type via `def.innerType`.

UI:
- **Required** → label gets a red `*` suffix; field error if empty after blur.
- **Optional** → label without `*`; empty value is valid and removed from the params patch (`updateNodeParams(id, { foo: undefined })` — but the Zustand spread will keep the key; recommended: special-case empty optional values to use `delete patch.foo` semantics).

`.default(...)` participates in detection (it counts as not-required because Zod will fill the default). The inspector should **read** the default value when an unmounted node first renders, but writes happen only when the user touches the field.

### B5. Error display strategy

**Recommendation: field-level inline errors below each input.**

Existing form pattern in `platform-app/src/components/ui/Input.tsx:8` already supports an `error?: string` prop and renders it below the input as `<p className="text-xs text-red-500">{error}</p>` (line 47). Match this convention.

Profile page (`platform-app/src/app/settings/profile/page.tsx`) uses a "save status" pattern but no field-level validation today — there's no precedent for header summaries in the codebase. Field-level is the only existing pattern.

**For enums (Select)** — error renders below the trigger; `Select` (`platform-app/src/components/ui/Select.tsx:66–126`) doesn't support an `error` prop today, so the inspector wrapper will render the error string below itself in a `<p className="text-xs text-red-500">`.

### B6. Refinement / cross-field validation

`imageInput` schema has `.refine(d => d.assetId || d.sourceUrl, { message: "Выберите изображение" })`. Field-level rendering can't show a refine error at any single field's location.

**Recommendation:** render refine/object-level errors at the **top of the inspector body, above the fields**, in a small banner:

```tsx
{topLevelErrors.length > 0 && (
    <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
        {topLevelErrors[0]}
    </div>
)}
```

`safeParse(params).error?.issues` contains issues; filter by `issue.path.length === 0` for object-level errors.

**Special case for ImageInput:** since the radio-tabs UI splits the schema into mutually-exclusive modes ("library" / "url" / "upload"), the refine error effectively means "you switched to 'library' tab but didn't pick anything". The inspector can suppress the refine error until the user attempts a save (mark the form as "submitted" once any field is touched, or use the existing dirty-flag plumbing).

### B7. Controlled-component subtlety

Architecture facts:
- `updateNodeParams(id, patch)` (`createGraphSlice.ts:50–57`) does a shallow spread merge: `{ ...n.data.params, ...patch }`.
- Setting `dirty: true` triggers `useWorkflowAutoSave` (`hooks/workflow/useWorkflowAutoSave.ts:67–90`), which debounces save by 2000 ms.

**Recommended update strategy:**
1. Inspector keeps a **local controlled-input state** (`useState`) for each field — updates immediately on every keystroke.
2. After `safeParse` succeeds AND value differs from current `node.data.params[fieldName]`, call `updateNodeParams(id, { [fieldName]: value })`.
3. **Do NOT debounce inside the inspector.** The store's auto-save already debounces. Sending param patches on every keystroke costs nothing (it's a synchronous Zustand `set`).
4. **For numeric sliders / range inputs**: this gives smooth dragging (50+ updates/sec into the store, but only one save after 2s of idle).

**Performance note:** `updateNodeParams` recreates the entire `nodes` array via `state.nodes.map(...)` each time. For 100+ nodes this becomes expensive. v1.0 won't hit this scale (4-node typical workflow), but flag it as a Phase-5+ optimization (use a Map<id, node> if it ever matters).

**No need for `useDeferredValue` / `useTransition`** at v1.0 scale. Re-renders are cheap.

---

## C. Image upload integration (D-15)

### C1. Upload contract (read from current code)

#### `platform-app/src/utils/imageUpload.ts` (`uploadImageToS3`, lines 86–130)

| Aspect | Value |
|--------|-------|
| Input | `base64: string` (data: URI or raw base64), `projectId: string`, `mimeType?: string = "image/png"` |
| Output | `Promise<string \| null>` — public S3 URL or `null` on failure |
| Asset DB row | **NOT created** when `skipAssetRecord: true`. The function uses `getPresignedUrl` (direct S3 PUT) on the happy path, which never touches the DB. The legacy fallback path at `imageUpload.ts:136–158` posts to `/api/upload` with `skipAssetRecord: true` (line 149), so still no DB row. |
| Error modes | Returns `null` on any failure. CORS errors flip a session-wide kill switch (`presignDisabled`, line 25) so subsequent calls skip presign. |
| Allowed MIME types | `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/svg+xml` (per `presign/route.ts:46–52`). |
| Caching | Yes — `uploadCache` at `imageUpload.ts:19` keyed on `base64.slice(0,64)+length`. |
| Progress reporting | **None** — no progress callbacks. The `fetch(...)` call is fire-and-forget. |
| Auth | Yes — `presign/route.ts:56` checks `auth()`; rejects unauth'd. |
| Project access | If `projectId !== "tmp"`, `requireSessionAndProjectAccess(userId, projectId, "write")` is enforced (`presign/route.ts:65–72`). |

#### `compressImageFile(file: File, maxDim = 2000)` — `imageUpload.ts:343–383`
Returns a base64 data URL (WebP, quality 0.82). Use this to compress an uploaded `File` before calling `uploadImageToS3`.

#### `platform-app/src/app/api/upload/presign/route.ts`

GET endpoint, query params `mimeType` + `projectId`. Returns `{ uploadUrl, publicUrl, key }`. `uploadUrl` valid 10 minutes.

### C2. Recommended inspector upload UX flow

**Component layout** for the "upload" tab of `imageInput` inspector:

1. **File input + drag-drop zone** — a single area that accepts both. Use a hidden `<input type="file" accept="image/*">` and a styled label/dropzone wrapping it. The dropzone catches `onDragOver` / `onDrop` and forwards the file to the same handler.
2. **Preview thumbnail** — once a file is selected, show an inline preview (use `URL.createObjectURL(file)` for instant preview before upload completes; revoke on unmount).
3. **Upload state** — three states:
   - `idle` → "Перетащите файл или нажмите для выбора"
   - `uploading` → spinner + "Загрузка..." (no progress bar — the util doesn't expose progress)
   - `success` → preview + small green checkmark; assetId is now in params
   - `error` → red text + retry button
4. **No progress bar** — the existing util doesn't expose upload progress. Adding it would require XHR (not fetch) — out of scope for v1.0. Show indeterminate spinner instead.
5. **Compression**: call `compressImageFile(file, 2000)` BEFORE `uploadImageToS3()`. This matches existing canvas-editor convention and prevents 10 MB JSON payloads.

**On-success behavior:**
1. Get the S3 URL back from `uploadImageToS3()`.
2. **Call `asset.createFromUrl` (NEW endpoint, see C3) or `asset.attachUrlToProject` (existing, but needs projectId)** to register an Asset row.
3. Get back the new `assetId`.
4. `updateNodeParams(nodeId, { assetId, sourceUrl: undefined, source: "upload" })`.
5. Switch the radio-tab to "library" mode for the user's next interaction (visual confirmation).

**Why prefer assetId over sourceUrl:** D-15 specifies precedence "assetId wins", and storing the assetId persists the upload to the workspace asset library (visible elsewhere in the app). Storing only `sourceUrl` would orphan the upload — it would be on S3 but invisible in the library.

### C3. New tRPC procedure needed: `asset.createFromUrl`

**Status: DOES NOT EXIST** — confirmed via grep across `platform-app/src/server/routers/asset.ts`. The closest match is:

```229:277:platform-app/src/server/routers/asset.ts
  attachUrlToProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        url: z.string().url(),
        filename: z.string().optional(),
        mimeType: z.string().default("image/png"),
        sizeBytes: z.number().int().nonnegative().default(0),
        source: z.string().default("upload"),
        width: z.number().optional(),
        height: z.number().optional(),
        type: z
          .enum(["IMAGE", "VIDEO", "AUDIO", "FONT", "LOGO", "OTHER"])
          .default("IMAGE"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await assertProjectAccess(ctx, input.projectId, "USER");
      ...
```

`attachUrlToProject` requires a `projectId` — but **`AIWorkflow` belongs to a `workspaceId`, not a `projectId`** (per `prisma/schema.prisma:410–427`). Asset rows have `projectId: String?` (optional, line 328 of schema). So the procedure could be reused if a fallback path (workspace-only, no projectId) is added.

**Two implementation options for Phase 3:**

**Option A — Add a new procedure `asset.createFromUrl` (RECOMMENDED).**
Cleaner semantically — the workflow flow is workspace-scoped. New procedure takes:
```typescript
asset.createFromUrl: protectedProcedure
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
      // Idempotency: check existing by (workspaceId, url) WITHOUT projectId.
      const existing = await ctx.prisma.asset.findFirst({
          where: { workspaceId: input.workspaceId, url: input.url, projectId: null },
          select: { id: true },
      });
      if (existing) return existing;
      // ...create...
  });
```

**Option B — Extend `attachUrlToProject` to make `projectId` optional.**
More backward-compatible but mangles the procedure name (it no longer "attaches to a project"). Rejected.

**Phase 3 server deliverable:** Add `asset.createFromUrl` in Wave 2 (alongside the per-node Zod schemas), unit-test it (workspace access guard, idempotency, missing workspace 404). This is **NOT explicitly called out in CONTEXT D-17**, but it's required to ship the `assetOutput` client handler. Flag this to the planner as an additional task.

**Workflow upload flow needs `attachUrlToProject` only if the workflow is opened with a `?projectId=xxx` query param** — which v1.0 doesn't support (workflows are workspace-only). For the upload mode of `imageInput`, the same `asset.createFromUrl` is used.

---

## D. Connection validator (D-18, REQ-11)

### D1. xyflow `isValidConnection` API

Verified directly from project's installed `@xyflow/react@12.10.2`:

`platform-app/node_modules/@xyflow/system/dist/esm/types/general.d.ts:109`:
```typescript
export type IsValidConnection = (edge: EdgeBase | Connection) => boolean;
```

`platform-app/node_modules/@xyflow/react/dist/esm/types/general.d.ts:178`:
```typescript
export type IsValidConnection<EdgeType extends Edge = Edge> = (edge: EdgeType | Connection) => boolean;
```

Slot in `<ReactFlow>` per `platform-app/node_modules/@xyflow/react/dist/esm/types/store.d.ts:82` and the docstring at `handles.d.ts:46–51`:

> Called when a connection is dragged to this handle. You can use this callback to perform some custom validation logic based on the connection target and source, for example. Where possible, we recommend you move this logic to the `isValidConnection` prop on the main ReactFlow component for performance reasons. **connection becomes an edge if isValidConnection returns true**

**When invoked:** xyflow calls `isValidConnection` continuously as the user drags a candidate edge over potential targets — the function drives the in-drag visual state (handles glow / line stroke red on `false`). On drop, if the function returned `true` for the final target, the edge is created via the `onConnect` handler; if `false`, no edge is created.

**Default visual feedback:** xyflow renders the in-progress connection line in red when `isValidConnection` returns `false`. No edge is created on drop. Matches D-18 ("xyflow's default invalid-connection UX").

`[VERIFIED: read from platform-app/node_modules/@xyflow/system/dist/esm/types/general.d.ts on 2026-04-24]`

### D2. `Connection` type fields

`platform-app/node_modules/@xyflow/system/dist/esm/types/general.d.ts:64–73`:

```typescript
export type Connection = {
    /** The id of the node this connection originates from. */
    source: string;
    /** The id of the node this connection terminates at. */
    target: string;
    /** When not `null`, the id of the handle on the source node that this connection originates from. */
    sourceHandle: string | null;
    /** When not `null`, the id of the handle on the target node that this connection terminates at. */
    targetHandle: string | null;
};
```

`sourceHandle` and `targetHandle` are **`string | null`**. Validator must handle the `null` case (treat as invalid — Phase 2's nodes always specify handle ids per `BaseNode.tsx:51,66`, so `null` only happens with mis-configured nodes).

### D3. Recommended test strategy

**Pure-function unit test** (`src/lib/workflow/__tests__/connectionValidator.test.ts`).

Build a small test matrix covering every `PortType` pairing. PortType union is `"image" | "mask" | "text" | "number" | "any"` (`server/workflow/types.ts:18`):

| Source | Target | Expected | Reason |
|--------|--------|---------:|--------|
| image  | image  | true     | exact match |
| image  | mask   | false    | type mismatch |
| image  | text   | false    | type mismatch |
| image  | number | false    | type mismatch |
| image  | any    | true     | any wildcard |
| mask   | image  | false    | type mismatch |
| any    | image  | true     | any wildcard |
| any    | any    | true     | wildcard both sides |
| (missing source node) | * | false | guard |
| (missing source handle id) | * | false | guard |
| (sourceHandle === null) | * | false | guard |

Plus integration touching the Phase-2 NODE_REGISTRY:
- `imageInput.image-out` → `removeBackground.image-in` → true
- `imageInput.image-out` → `assetOutput.image-in` → true
- `assetOutput` has no outputs → trying to drag from it is impossible (no source handle) — verify by trying `target=assetOutput, source=...` instead

Existing test infra: pure Vitest, no jsdom needed (validator is a pure function over plain objects). Pattern matches `platform-app/src/store/workflow/__tests__/graphSlice.test.ts`.

---

## E. Homepage card integration (D-19) — bonus

### E1. Cards array in `page.tsx`

Verbatim from `platform-app/src/app/page.tsx:72–105`:

```72:105:platform-app/src/app/page.tsx
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

**Insertion point:** push a new entry at the end of the array (after `video`). New entry:

```typescript
{
    id: "workflow" as const,
    icon: <Workflow size={20} strokeWidth={1.5} />,
    label: "AI\nWorkflows",
    gradient: "gradient-card-pink",
    iconBg: "bg-pink-100 text-pink-600 dark:bg-pink-500/20 dark:text-pink-400",
    image: "/cards/workflows.png",
}
```

Don't forget to import `Workflow` from `lucide-react` (extend the existing import on line 6).

**Grid layout consideration:** the current grid uses `grid-cols-4` (line 251 of page.tsx, inside the cards row). Adding a fifth card breaks the symmetric layout — it'll render 4-and-1 on the second row. Recommended: change to `grid-cols-5` for v1.0 (the new fixed layout with 5 cards is what the user intended per D-19). Alternative: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` for responsive — matches the rest of the app's tendency.

### E2. `gradient-card-pink` CSS

Verbatim existing rule template from `platform-app/src/app/globals.css:248–251`:

```248:251:platform-app/src/app/globals.css
.gradient-card-purple {
  background: linear-gradient(145deg, #F5F3FF 0%, #EDE9FE 100%);
  /* Violet 50 -> Violet 100 */
}
```

And dark mode pair from `globals.css:269–271`:

```269:271:platform-app/src/app/globals.css
.dark .gradient-card-purple {
  background: linear-gradient(145deg, #1E1530 0%, #2A1C40 100%);
}
```

**Proposed `gradient-card-pink` block** (insert after `.gradient-card-green` at line 266 and after `.dark .gradient-card-green` at line 283):

```css
.gradient-card-pink {
  background: linear-gradient(145deg, #FDF2F8 0%, #FCE7F3 100%);
  /* Pink 50 -> Pink 100 */
}

/* (after dark green) */
.dark .gradient-card-pink {
  background: linear-gradient(145deg, #2A1525 0%, #3A1830 100%);
}
```

Colors taken verbatim from CONTEXT D-19. Tailwind palette reference: Pink-50 = `#FDF2F8`, Pink-100 = `#FCE7F3`.

### E3. `NewProjectModal.tsx` — does NOT mirror page.tsx grid

**Important finding contrary to CONTEXT.md note:** `NewProjectModal.tsx` does **not** have a card grid that mirrors the homepage. It has a `goals` array (`NewProjectModal.tsx:20–50`) of 4 small icon-tile buttons (banner, photo, video, text — each a `<button>` with a 2×2 grid layout, line 148: `grid grid-cols-4 gap-2`). These tiles act as a *form input* — clicking sets a local `goal` state; the actual project creation runs on the "Создать" button.

**Adding a "Workflow" tile here would change the modal's semantics:** the modal is for creating a `Project`, but the Workflow flow doesn't create a project — it navigates to `/workflows`. Inserting a Workflow tile would either:
1. (a) act as a navigation hijack (click sets goal=workflow → triggers `router.push("/workflows")` instead of `createOnBackend`), or
2. (b) be a non-functional decorative entry.

**Recommendation:** **Do NOT add the Workflow card to `NewProjectModal.tsx` for Phase 3.** The modal's purpose is project creation, not navigation. CONTEXT D-19 left this provisional with "yes" — research advises switching that to **no**.

If a future phase wants a unified "What do you want to create?" launcher, it can either:
- Replace NewProjectModal with a hybrid project-or-workflow launcher (Phase 5+ scope)
- Add the Workflow card to a different surface (a sidebar, e.g.)

Phase 3 ships:
- New card on `/page.tsx` (homepage top row)
- Optionally also on `/projects/page.tsx` if such a page exists with the same top-row pattern (verify presence before assuming)

### E4. Click semantics

The existing cards trigger different behaviors via `handleTileClick(tileId)` (`page.tsx:170–189`):
- `banner` → `setModalOpen(true)` (opens NewProjectModal)
- `text` / `video` → toast "В разработке"
- `photo` → calls `createProjectMutation` directly

The Workflow card needs `router.push("/workflows")`. Three implementation options:

**Option 1 — Add a case to `handleTileClick`:**
```typescript
case "workflow":
    router.push("/workflows");
    break;
```
Smallest diff. **Recommended.**

**Option 2 — Add an optional `onClick` field to each card object:**
```typescript
{
    id: "workflow",
    onClick: () => router.push("/workflows"),
    // ...
}
```
Then `<button onClick={type.onClick ?? (() => handleTileClick(type.id))}>`. More flexible but introduces a parallel control path.

**Option 3 — Add an optional `href` field and change the wrapping element to `<Link>` when present:**
Mixes two element types; introduces SSR-render concerns and a11y differences.

**Recommended: Option 1.** Keeps the existing pattern (single `handleTileClick` switch) and adds one case.

### E5. Image asset — verified

```bash
$ ls -la platform-app/public/cards/
-rw-r--r--  1 ...  71635 Apr 13 11:38 banner.png
-rw-r--r--  1 ...  79439 Apr 13 11:38 photo.png
-rw-r--r--  1 ...  91116 Apr 13 11:38 text.png
-rw-r--r--  1 ...  77317 Apr 13 11:38 video.png
-rw-r--r--  1 ...  16954 Apr 24 02:37 workflows.png
```

`workflows.png` exists, 16,954 bytes (matches the ~17 KB CONTEXT note). Path `"/cards/workflows.png"` is correct (Next.js serves `public/` at root). The file is currently in `git status` as untracked — Phase 3 must commit it.

---

## F. Test infrastructure (cross-cutting)

### F1. Phase 2 Zustand-slice test pattern

Pattern from `platform-app/src/store/workflow/__tests__/graphSlice.test.ts:7–17`:

```typescript
function resetStore() {
    useWorkflowStore.setState({
        nodes: [],
        edges: [],
        name: "",
        description: "",
        dirty: false,
        viewport: { x: 0, y: 0, zoom: 1 },
        runState: {},
    });
}
```

Each test calls `resetStore()` in `beforeEach`. Direct `getState()` + assertion calls, no React rendering. Phase 3 should reuse this exact pattern for any new state-shape tests (none expected — the store API doesn't change, only consumers).

### F2. Component test feasibility

`package.json` confirms (verified 2026-04-24):
- `vitest@^4.1.4` ✅
- `@vitest/coverage-v8@^4.1.4` ✅
- `@testing-library/react` ❌ NOT installed
- `jsdom` / `happy-dom` ❌ NOT installed

**Component-level tests of the inspector / picker / upload UI are NOT feasible in Phase 3 without adding `@testing-library/react` + `jsdom`.** This matches Phase 2's note in `02-SUMMARY.md:117–122`. Adding these dependencies is a meaningful detour and out of D-14..D-20 scope.

### F3. Per-deliverable test plan recommendation

| Deliverable | Test type | Justification |
|-------------|-----------|---------------|
| `connectionValidator.ts` | Unit (Vitest, full port matrix) | Pure function, easy to verify, REQ-11 critical |
| `clientHandlers.ts` (`imageInput`, `assetOutput`) | Unit (Vitest, mocked tRPC) | Pure logic + mocks; D-17 explicitly mandates "full unit-test coverage" |
| Per-node Zod schemas | Unit (Vitest, `safeParse` matrix) | Easy to test, catches schema drift |
| Zod-introspection helpers (`detectKind`, `getNumberRange`, `getEnumOptions`) | Unit (Vitest) | Pure functions, easy to verify, prevent regressions when Zod patches |
| `NodeInspector.tsx` rendering | **Manual** | No `@testing-library/react`; manual smoke (drop each node type, verify form renders) |
| `AssetPickerModal.tsx` | **Manual** | Same constraint |
| ImageInput inspector with library/url/upload tabs | **Manual** | Same constraint; verify in dev server |
| `isValidConnection` integration with xyflow | **Manual** | Drag invalid edge, verify red stroke + no edge |
| Homepage card click → `/workflows` | **Manual** | Trivial; verify in dev server |
| Russian copy correctness | **Manual** | Native-speaker eyeball pass |

---

## G. Risk register — net-new for Phase 3

### G1. Risk: Zod v4 introspection differs from training data
- **What goes wrong:** Inspector reads `_def.typeName` (Zod v3) instead of `_zod.def.type` (Zod v4) — types come back undefined, every field renders as "unsupported".
- **Probability:** Medium (Zod v4 was released late 2024 / 2025; training data still leans v3).
- **Mitigation:** Confirm with the discriminator helper in B1 immediately on first inspector commit; use `console.log(schema._zod?.def)` during development on a known-good `z.string()` to verify.
- **Early signal:** Form renders nothing for any field; "unsupported" badge appears for everything.

### G2. Risk: `AssetLibraryModal` extract triggers a chain reaction
- **What goes wrong:** Researcher missed a consumer; renaming or refactoring breaks the canvas editor.
- **Probability:** **Very low** — research found exactly one consumer, and the recommended path leaves it untouched (fork pattern).
- **Mitigation:** Don't touch `AssetLibraryModal.tsx`. Create a new `AssetPickerModal.tsx`. Run `tsc --noEmit` before committing to catch any accidental import drift.
- **Early signal:** TypeScript errors on existing canvas-editor files; visual regression in `/editor/[id]` asset library.

### G3. Risk: Inspector re-render performance on rapid typing
- **What goes wrong:** Every keystroke triggers `updateNodeParams` → re-renders all nodes via `applyNodeChanges` round-trip.
- **Probability:** Low at v1.0 scale (4-node typical workflow).
- **Mitigation:** None for v1.0. Selector-based subscription (`useWorkflowStore((s) => s.nodes)`) already keeps the editor canvas re-renders bounded. If observed, switch inspector to React Hook Form's uncontrolled-input pattern.
- **Early signal:** Visible input lag when typing in a `prompt` field on a 10+ node graph.

### G4. Risk: Upload flow + presign env-var mismatch in dev
- **What goes wrong:** S3 credentials missing or CORS not configured; presign returns 500 or PUT fails. The util has a session-wide kill switch (`presignDisabled` at `imageUpload.ts:25`) that disables presign on first failure → fallback to legacy `/api/upload` path → that path also requires S3 creds.
- **Probability:** Medium for fresh dev env; low if creds were already set up for canvas editor uploads.
- **Mitigation:** Document required env vars in plan: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT` (defaults to Yandex), `S3_BUCKET` (defaults `acp-assets`). Verify by uploading once via the existing canvas editor before working on workflow upload.
- **Early signal:** Browser console: "Direct-to-S3 upload disabled for this session (CORS / network)" logged from `imageUpload.ts:34`.

### G5. Risk: Missing `asset.createFromUrl` endpoint blocks `assetOutput` handler
- **What goes wrong:** D-17 unit-tests can't be written until the endpoint exists.
- **Probability:** **High** — research confirms endpoint does not exist (Section C3).
- **Mitigation:** Add `asset.createFromUrl` as a Phase 3 server deliverable (Wave 2 alongside per-node schemas, BEFORE the `clientHandlers.ts` task). This is **NOT in CONTEXT** — flag it to the planner explicitly.
- **Early signal:** Tests for `assetOutput` handler fail with "asset.createFromUrl is not a function" / typecheck error in `trpc.asset.createFromUrl.useMutation`.

### G6. Risk: Selection state not flowing to the inspector
- **What goes wrong:** The current store doesn't track `selected` state — `applyNodeChanges` produces it but `onNodesChange` strips it out via the `toRFNode` round-trip (`WorkflowEditor.tsx:73–85`).
- **Probability:** **High** — verified by reading the store + editor.
- **Mitigation:** Two options:
  1. **`onSelectionChange` prop** on `<ReactFlow>` (verified at `node_modules/@xyflow/react/dist/esm/components/SelectionListener/index.d.ts`): `onSelectionChange={({nodes}) => setSelectedNodeId(nodes[0]?.id ?? null)}`. Inspector reads `selectedNodeId` from a new slice or local state in `WorkflowEditor`. **Recommended.**
  2. Extend `onNodesChange` in `WorkflowEditor.tsx:73-85` to preserve `selected` on each WorkflowNode — but that pollutes the persisted graph shape.
- **Early signal:** Inspector always shows empty state; `selected` never propagates from canvas click.

### G7. Risk: Bonus card increases scope ambiguity
- **What goes wrong:** D-19 mixes a UX feature (homepage card) into a phase about node editor UX. If anything goes wrong during card integration (e.g. grid-cols change breaks responsive layout), it eats time from the actual REQ-11/12/13/14 deliverables.
- **Probability:** Low; the card change is small.
- **Mitigation:** Make the card task its own wave in the plan (last wave, after main deliverables work). If the card causes regressions, it can be reverted independently.
- **Early signal:** Visual regression on `/` or `/projects` after Wave 5.

### G8. Risk: Russian copy drift between NODE_REGISTRY and inspector labels
- **What goes wrong:** D-20 puts strings inline; if the plan splits "node display names" (NODE_REGISTRY) from "inspector field labels" (per-schema labels file), copy can drift (e.g. "Удалить фон" in registry, "Удаление фона" in inspector header).
- **Probability:** Low (small surface).
- **Mitigation:** Single source of truth — inspector reads `definition.displayName` for the header. Per-schema label maps cover *field* names only. Document this in the plan.
- **Early signal:** UAT reveals inconsistent terminology; manual eyeball pass catches it.

---

## Implementation hints for the planner

A condensed list of concrete pointers — feed these into 03-PLAN.md as task-level guidance:

1. **Where `isValidConnection` slots in:** `platform-app/src/components/workflows/WorkflowEditor.tsx:139` — add `isValidConnection={validateConnection}` next to `onConnect`. The validator is a pure function in a new file `platform-app/src/lib/workflow/connectionValidator.ts`. Use the snippet in CONTEXT `<specifics>` verbatim.

2. **Where the inspector mounts:** The `WorkflowEditor` returns a flex layout `<div className="flex min-h-0 flex-1">` at line 178. Currently `<NodePalette />` (left) + `<EditorCanvas />` (center). Add `<NodeInspector selectedNodeId={selectedId} />` (right) — wrap the existing canvas in `min-w-0 flex-1` (already there). Add `selectedId` state via `onSelectionChange` on `<ReactFlow>`.

3. **`onSelectionChange` wiring:** Add `onSelectionChange={({ nodes }) => setSelectedNodeId(nodes[0]?.id ?? null)}` to `<ReactFlow>` at line 139. Empty selection → null → inspector renders empty state.

4. **Per-node schemas live separately, not in `graphSchema.ts`:** `graphSchema.ts` is the *graph* schema (nodes/edges shape). Per-node param schemas should go in a new file `platform-app/src/lib/workflow/nodeParamSchemas.ts`, exported as `nodeParamSchemas: Record<WorkflowNodeType, z.ZodTypeAny>` and `nodeFieldLabels: Record<WorkflowNodeType, Record<string, string>>` and `nodeEnumLabels: Record<WorkflowNodeType, Record<string, Record<string, string>>>`. The inspector imports this map and renders `nodeParamSchemas[node.type]`.

5. **Update `NODE_REGISTRY.defaultParams`:** `platform-app/src/server/workflow/types.ts:69–110` — currently most nodes have `{}` defaults. Per Section B and CONTEXT specifics, update to:
   - `imageInput: { source: "asset" }`
   - `removeBackground: { model: "fal-bria" }`
   - `addReflection: { style: "subtle", intensity: 0.3 }` (already correct)
   - `assetOutput: { name: "Workflow output" }`
   These must match the schema `.default(...)` calls so newly-dropped nodes pass validation immediately.

6. **Russian display names update:** Same file (`server/workflow/types.ts`), update `displayName` and `description` per REQ-14:
   - `imageInput`: "Изображение" / "Источник изображения из библиотеки или URL"
   - `removeBackground`: "Удалить фон" / "AI-удаление фона с alpha-каналом"
   - `addReflection`: "Добавить отражение" / "Сгенерировать мягкое отражение под продуктом"
   - `assetOutput`: "Сохранить в библиотеку" / "Сохранить результат как ассет"

7. **`asset.createFromUrl` endpoint to add (Phase 3 deliverable):** `platform-app/src/server/routers/asset.ts` — add new `createFromUrl` procedure (workspace-scoped, idempotent on `(workspaceId, url, projectId: null)`). See Section C3 Option A for the signature. Test in `platform-app/src/server/routers/__tests__/asset.test.ts` (file may need creating).

8. **Wave 1 = AssetPickerModal extract** — single new file `platform-app/src/components/assets/AssetPickerModal.tsx`. Don't touch existing `AssetLibraryModal.tsx`. Manual verification: drop the picker into a temporary test page or use Storybook-style throwaway route.

9. **Inspector input components:** Reuse `Input` (`platform-app/src/components/ui/Input.tsx`) for text/number, `Select` (`platform-app/src/components/ui/Select.tsx`) for enum, plain `<input type="checkbox">` for boolean, `<input type="range">` for sliders (no existing slider component). For radio-tabs in ImageInput inspector, consider `SegmentedControl` (`platform-app/src/components/ui/SegmentedControl.tsx`).

10. **Inspector update strategy:** call `useWorkflowStore.getState().updateNodeParams(nodeId, { [field]: value })` synchronously on every valid input change. The store's auto-save debounce handles the network throttling. Do NOT add an inspector-level debounce.

11. **ImageInput refine error placement:** render at the top of the inspector body in a small banner (not at any field), since the constraint is cross-field. Use `safeParse(params).error?.issues.filter(i => i.path.length === 0)`.

12. **xyflow Connection.sourceHandle is `string | null`:** validator must early-return `false` when either handle id is null (Section D2).

13. **Homepage card grid breaks symmetry:** changing `grid-cols-4` to `grid-cols-5` at `page.tsx:251` is the cleanest fix. Or use `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` for responsive.

14. **`Workflow` icon:** `lucide-react` exports `Workflow`. Add to the existing import at `page.tsx:6`.

15. **NewProjectModal does NOT need updating** — see Section E3. CONTEXT D-19 allows research to recommend; research recommends NO.

16. **`useWorkspace()` hook gives the workspaceId** for the AssetPickerModal — usage already established in `WorkflowEditor.tsx:164`.

17. **No new package installs required** — all needed deps (`zod`, `@xyflow/react`, `lucide-react`, `@radix-ui/react-select`) are present in `package.json`. Do NOT add `@testing-library/react` for Phase 3.

18. **xyflow visual feedback on invalid drop:** xyflow renders the in-progress connection line in red automatically when `isValidConnection` returns false; no edge is created. No CSS work required to satisfy REQ-11. (REQ-11 acceptance mentions "зелёная подсветка для совместимых, красная для несовместимых" — D-18 explicitly defers the GREEN highlight to Phase 5+. The red is xyflow default.)

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Node parameter schemas (Zod) | Browser / Client | API (validation only) | Inspector renders forms, validates inline. Server validates same schemas at save time via `workflowGraphSchema` (Phase 2 already does this). |
| Connection validation | Browser / Client | — | Pure UX concern; xyflow drives in-drag state. Server already has its own constraints in `workflowGraphSchema`. |
| AssetPickerModal | Browser / Client | API (`asset.listByWorkspace`) | Pick UX is client; data fetched via tRPC. |
| Image upload flow | Browser / Client | Backend (presign + S3 PUT + asset registration) | Browser drives upload; server signs and registers. |
| `imageInput` client handler | Browser / Client | API (`asset.getById`) | Resolves params at runtime; server only provides asset lookup. |
| `assetOutput` client handler | Browser / Client | API (`asset.createFromUrl` — NEW) | Posts result URL to workspace asset library. |
| Homepage card | Browser / Client (Next.js client component) | — | Pure navigation tile in `"use client"` page. |
| Russian copy | Browser / Client (inline strings) | — | D-20 explicitly defers i18n. |

**No tier-misassignment risks identified** — all Phase 3 work is client-side rendering and a single new server procedure that is correctly placed in the asset router (workspace-scoped).

---

## Standard Stack

### Core (already installed — no new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@xyflow/react` | `^12.10.2` | Canvas, IsValidConnection prop, useReactFlow, NodeProps | Phase 2 chose it; it's the de facto React node-editor. |
| `zod` | `^4.3.6` | Per-node param schemas, runtime introspection for inspector | Already used; v4-specific introspection covered in B1. |
| `lucide-react` | `^0.563.0` | `Workflow` icon for homepage card | Same icon set already used by all other cards. |
| `@radix-ui/react-select` | `^2.2.6` | Enum dropdown via existing `Select` component | Already in use across the app. |
| `@trpc/react-query` | `^11.13.0` | `asset.getById`, `asset.createFromUrl`, `asset.listByWorkspace` calls from client handlers and picker | Standard data layer. |

### Supporting (use as-is — no need to add)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `clsx` / `tailwind-merge` | latest | `cn()` helper at `lib/cn.ts` | All component class composition |
| `class-variance-authority` | `^0.7.1` | `Select` already uses it | Don't introduce for Phase 3 forms — keep them simple |

### Alternatives Considered & Rejected

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled Zod-switch | `react-hook-form` + `@hookform/resolvers/zod` | Extra deps + 1500-LOC validation lib for 4 primitive types. **Rejected by D-14.** |
| Hand-rolled Zod-switch | `@autoform/zod`, `react-jsonschema-form` | Unproven Zod-v4 compat; opinionated styling. **Rejected by D-14.** |
| Zod introspection via `_zod.def.type` | `z.toJSONSchema()` (Zod v4 built-in) → render JSONSchema | Could be cleaner but adds a translation layer; D-14 prescribes direct switch. |
| Fork `AssetPickerModal` | Refactor existing `AssetLibraryModal` | Refactor risks breaking canvas editor; fork is zero-risk (Section A4). |

---

## Code Examples

### Connection validator (per CONTEXT specifics, verbatim) — drop into `src/lib/workflow/connectionValidator.ts`

```typescript
// src/lib/workflow/connectionValidator.ts
import type { Connection } from "@xyflow/react";
import { NODE_REGISTRY } from "@/server/workflow/types";
import type { WorkflowNode } from "@/server/workflow/types";

export function isValidConnection(
    connection: Connection,
    nodes: WorkflowNode[],
): boolean {
    if (!connection.sourceHandle || !connection.targetHandle) return false;
    const source = nodes.find((n) => n.id === connection.source);
    const target = nodes.find((n) => n.id === connection.target);
    if (!source || !target) return false;
    const sourcePort = NODE_REGISTRY[source.type].outputs.find(
        (p) => p.id === connection.sourceHandle,
    );
    const targetPort = NODE_REGISTRY[target.type].inputs.find(
        (p) => p.id === connection.targetHandle,
    );
    if (!sourcePort || !targetPort) return false;
    if (sourcePort.type === "any" || targetPort.type === "any") return true;
    return sourcePort.type === targetPort.type;
}
```

Wire-up in `WorkflowEditor.tsx`:
```typescript
const validateConnection = useCallback(
    (conn: Connection | Edge) => {
        // xyflow's `IsValidConnection` accepts `EdgeBase | Connection`; Edge has source/target/handles.
        return isValidConnection(conn as Connection, useWorkflowStore.getState().nodes);
    },
    [],
);
// ...
<ReactFlow ... isValidConnection={validateConnection} />
```

### Zod-discriminator helper (Section B1)

```typescript
// src/lib/workflow/zodIntrospection.ts
import type { z } from "zod";

export type FieldKind = "string" | "number" | "boolean" | "enum";

export interface FieldDescriptor {
    kind: FieldKind;
    optional: boolean;
    defaultValue?: unknown;
    min?: number;
    max?: number;
    enumOptions?: string[];
}

export function describeField(schema: z.ZodTypeAny): FieldDescriptor | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const root = (schema as any)._zod;
    if (!root?.def) return null;

    let optional = false;
    let defaultValue: unknown;
    let inner = root;

    while (inner.def.type === "optional" || inner.def.type === "default" || inner.def.type === "nullable") {
        if (inner.def.type === "optional" || inner.def.type === "nullable") optional = true;
        if (inner.def.type === "default" && "defaultValue" in inner.def) {
            defaultValue = typeof inner.def.defaultValue === "function"
                ? inner.def.defaultValue()
                : inner.def.defaultValue;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inner = (inner.def.innerType as any)._zod;
    }

    switch (inner.def.type) {
        case "string":
            return { kind: "string", optional, defaultValue };
        case "number":
        case "int": {
            const bag = inner.bag ?? {};
            return {
                kind: "number",
                optional,
                defaultValue,
                min: bag.minimum,
                max: bag.maximum,
            };
        }
        case "boolean":
            return { kind: "boolean", optional, defaultValue };
        case "enum": {
            const entries = inner.def.entries ?? {};
            return {
                kind: "enum",
                optional,
                defaultValue,
                enumOptions: Object.values(entries) as string[],
            };
        }
        default:
            return null; // unsupported (object, array, refine-only, etc.)
    }
}
```

`[VERIFIED: Zod v4 internals confirmed in platform-app/node_modules/zod/v4/core/schemas.d.ts and checks.d.ts]`

### Per-node schema map sketch — `src/lib/workflow/nodeParamSchemas.ts`

```typescript
import { z } from "zod";
import type { WorkflowNodeType } from "@/server/workflow/types";

export const imageInputParamsSchema = z
    .object({
        source: z.enum(["asset", "url", "upload"]).default("asset"),
        assetId: z.string().optional(),
        sourceUrl: z.string().url().optional(),
    })
    .refine((d) => !!d.assetId || !!d.sourceUrl, {
        message: "Выберите изображение",
    });

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

export const nodeParamSchemas: Record<WorkflowNodeType, z.ZodTypeAny> = {
    imageInput: imageInputParamsSchema,
    removeBackground: removeBackgroundParamsSchema,
    addReflection: addReflectionParamsSchema,
    assetOutput: assetOutputParamsSchema,
};

export const nodeFieldLabels: Record<WorkflowNodeType, Record<string, string>> = {
    imageInput: {
        source: "Источник",
        assetId: "Из библиотеки",
        sourceUrl: "URL изображения",
    },
    removeBackground: {
        model: "Модель",
    },
    addReflection: {
        style: "Стиль отражения",
        intensity: "Интенсивность",
        prompt: "Доп. подсказка",
    },
    assetOutput: {
        name: "Имя ассета",
        folder: "Папка (опц.)",
    },
};
```

### Client handler signatures — `src/store/workflow/clientHandlers.ts`

```typescript
import type { trpc } from "@/lib/trpc";

interface ImageInputParams {
    source?: "asset" | "url" | "upload";
    assetId?: string;
    sourceUrl?: string;
}

interface ImageInputCtx {
    trpcClient: ReturnType<typeof trpc.useUtils>;
}

export async function imageInput(args: {
    params: ImageInputParams;
    ctx: ImageInputCtx;
}): Promise<{ imageUrl: string }> {
    const { params, ctx } = args;
    if (params.assetId) {
        const asset = await ctx.trpcClient.asset.getById.fetch({ id: params.assetId });
        return { imageUrl: asset.url };
    }
    if (params.sourceUrl) {
        return { imageUrl: params.sourceUrl };
    }
    throw new Error("imageInput: нужен assetId или sourceUrl");
}

interface AssetOutputParams {
    name: string;
    folder?: string;
}

interface AssetOutputCtx {
    workspaceId: string;
    trpcClient: ReturnType<typeof trpc.useUtils>;
}

export async function assetOutput(args: {
    inputs: { image?: { imageUrl: string } };
    params: AssetOutputParams;
    ctx: AssetOutputCtx;
}): Promise<{ assetId: string }> {
    const url = args.inputs.image?.imageUrl;
    if (!url) throw new Error("assetOutput: вход 'image' пуст");
    const asset = await args.ctx.trpcClient.asset.createFromUrl.fetch({
        workspaceId: args.ctx.workspaceId,
        url,
        filename: args.params.name,
        source: "workflow-output",
    });
    return { assetId: asset.id };
}
```

(Adjust to `mutate` instead of `fetch` for tRPC mutations — sketch only.)

---

## Common Pitfalls

### Pitfall 1: Reading `_def` instead of `_zod.def`
- **What goes wrong:** Inspector renders nothing for any field.
- **Why it happens:** Zod v3 used `schema._def.typeName`. Zod v4 changed to `schema._zod.def.type`.
- **How to avoid:** Use the `describeField` helper from this research; never reach into `_def` directly.
- **Warning signs:** All `detectKind` results are "unsupported" or undefined.

### Pitfall 2: Stripping `selected` state in `onNodesChange`
- **What goes wrong:** Inspector never sees a selected node — clicking a node does nothing.
- **Why it happens:** `WorkflowEditor.tsx:73-85`'s `onNodesChange` re-builds nodes from `byId` map without preserving the `selected` field that `applyNodeChanges` puts on RF nodes.
- **How to avoid:** Use `onSelectionChange` prop on `<ReactFlow>` to track selection separately (don't pollute the persisted graph).
- **Warning signs:** `selectedNodeId` never updates; inspector shows empty state forever.

### Pitfall 3: Calling `asset.createFromUrl` before adding the procedure
- **What goes wrong:** Compile error or runtime "is not a function".
- **Why it happens:** Procedure doesn't exist (Section C3).
- **How to avoid:** Add the procedure FIRST in Wave 2 of the plan, before the `clientHandlers.ts` task.
- **Warning signs:** TS error: "Property 'createFromUrl' does not exist on type 'CreateTRPCReact<assetRouter,...>'".

### Pitfall 4: Inspector debounces saves on top of the existing auto-save debounce
- **What goes wrong:** First few keystrokes are lost; values appear to "snap back".
- **Why it happens:** Adding a 200 ms inspector debounce that calls `updateNodeParams`, on top of a 2000 ms auto-save debounce, creates a race when user types-then-clicks-save.
- **How to avoid:** Inspector calls `updateNodeParams` synchronously on every keystroke. Auto-save handles debouncing.
- **Warning signs:** Save button click misses recent edits.

### Pitfall 5: Refine errors disappear when switching radio-tabs
- **What goes wrong:** ImageInput refine error "Выберите изображение" appears, user switches mode, error stays visible (or disappears unpredictably).
- **Why it happens:** `safeParse` returns the same refine error regardless of which mode is active — until either `assetId` or `sourceUrl` is set.
- **How to avoid:** Render refine errors only after the user has interacted with the form (track a `submitted`/`touched` flag). Or scope the validation to the active mode and re-validate on tab switch.
- **Warning signs:** User reports "the error is yelling at me before I've done anything".

### Pitfall 6: Forgetting to add `Workflow` icon import
- **What goes wrong:** Build fails with "Workflow is not defined".
- **How to avoid:** Add `Workflow` to the existing `lucide-react` import at `page.tsx:6`.

### Pitfall 7: Grid-cols-4 stays after adding a fifth card
- **What goes wrong:** Cards wrap to a new row 4-and-1, looks broken.
- **How to avoid:** Change to `grid-cols-5` at `page.tsx:251`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-drop file zone | Custom drop handler with browser quirks | `<input type="file" accept="image/*">` + label, plus a small `onDragOver`/`onDrop` wrapper | Native `input` handles a11y and OS file dialogs for free |
| File-to-base64 conversion | `FileReader` boilerplate | `compressImageFile()` from `utils/imageUpload.ts:343` | Already battle-tested with WebP compression |
| Image upload | Custom `XMLHttpRequest` with CORS dance | `uploadImageToS3()` from `utils/imageUpload.ts:86` | Includes presign + fallback + caching |
| Modal infrastructure | Custom backdrop / escape-key / focus-trap | Existing `AssetLibraryModal` pattern (the visual structure, not the actions) | Already styled, animated, accessible |
| Select dropdown | Native `<select>` | `Select` component at `components/ui/Select.tsx` | Already styled, supports same prop pattern |
| Confirmation dialog | Custom modal | `ConfirmDialog` at `components/ui/ConfirmDialog.tsx` | Standard pattern |

---

## Validation Architecture

> `.planning/config.json` not located in this research; assuming nyquist_validation enabled per default.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest@4.1.4` |
| Config file | `platform-app/vitest.config.*` (verify exists; Phase 2 used it) |
| Quick run command | `npx vitest run --no-coverage` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-11 | `isValidConnection` blocks bad type pairs | unit | `npx vitest run src/lib/workflow/__tests__/connectionValidator.test.ts` | ❌ Wave 0 — NEW |
| REQ-12 | Inspector renders correct field for each Zod kind | unit (helper test) + manual (inspector render) | `npx vitest run src/lib/workflow/__tests__/zodIntrospection.test.ts` | ❌ Wave 0 — NEW |
| REQ-12 | Per-node schemas accept default params | unit | `npx vitest run src/lib/workflow/__tests__/nodeParamSchemas.test.ts` | ❌ Wave 0 — NEW |
| REQ-12 | `clientHandlers.imageInput` resolves assetId/sourceUrl correctly | unit (mocked tRPC) | `npx vitest run src/store/workflow/__tests__/clientHandlers.test.ts` | ❌ Wave 0 — NEW |
| REQ-12 | `clientHandlers.assetOutput` calls `asset.createFromUrl` | unit (mocked tRPC) | same file as above | ❌ Wave 0 — NEW |
| REQ-12 | Server: `asset.createFromUrl` workspace access + idempotency | integration | `npx vitest run src/server/routers/__tests__/asset.createFromUrl.test.ts` | ❌ Wave 0 — NEW |
| REQ-13 | Palette renders Russian display names | manual | open `/workflows/new` | n/a |
| REQ-14 | All user-facing strings in Russian | manual eyeball | dev server | n/a |

### Sampling Rate
- **Per task commit:** `npx vitest run --no-coverage` (~3-5 s)
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green + `tsc --noEmit` clean before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/lib/workflow/__tests__/connectionValidator.test.ts` — covers REQ-11 (port matrix)
- [ ] `src/lib/workflow/__tests__/zodIntrospection.test.ts` — covers REQ-12 helper
- [ ] `src/lib/workflow/__tests__/nodeParamSchemas.test.ts` — covers REQ-12 schemas
- [ ] `src/store/workflow/__tests__/clientHandlers.test.ts` — covers D-17 unit-test mandate
- [ ] `src/server/routers/__tests__/asset.createFromUrl.test.ts` — covers new endpoint
- (No new framework install needed; vitest is already configured.)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | NextAuth `auth()` already enforced on tRPC + presign route. No new auth surface in Phase 3. |
| V3 Session Management | no | Re-uses existing session. |
| V4 Access Control | yes | New `asset.createFromUrl` MUST call `assertWorkspaceAccess(ctx, workspaceId, "CREATOR")` before insert. Mirror `attachUrlToProject:246`. |
| V5 Input Validation | yes | All inspector inputs validated client-side via Zod before `updateNodeParams`. Server validates same schemas at save time via `workflowGraphSchema`. |
| V6 Cryptography | no | No new crypto code; presign uses AWS SDK. |
| V8 Data Protection | partial | Presign-route already enforces MIME allowlist (`presign/route.ts:46-52`). New `asset.createFromUrl` does NOT need SSRF — the URL is already an S3 URL we just generated, not an attacker-controlled URL. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-workspace asset write | Elevation of Privilege | `assertWorkspaceAccess(ctx, workspaceId, "CREATOR")` on `asset.createFromUrl` |
| Persisted XSS via Zod refine messages | Tampering | Russian strings are app-defined, not user input — safe |
| Presign URL leak | Information Disclosure | Existing 10-min TTL on presigned URLs; not changed by Phase 3 |
| Storing attacker URL as `sourceUrl` in node params | Tampering / SSRF | Phase 3 only stores; SSRF guard fires in Phase 4 (`safeFetch` already in `/api/upload/route.ts:87`). For v1.0 inspector, validate `z.string().url()` only — no fetch happens client-side. |
| Inspector triggers many `updateNodeParams` → DoS via auto-save | DoS | 2 s debounce in `useWorkflowAutoSave` already throttles. Acceptable. |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `node` | All tooling | ✓ (assumed Phase 2 worked) | per package.json `"engines"` not pinned | — |
| `npm` | Install | ✓ | — | — |
| `prisma` | Generated client (already generated by Phase 1/2) | ✓ | `^6.19.2` | — |
| `vitest` | Tests | ✓ | `^4.1.4` | — |
| `S3 / Yandex Object Storage` | Upload mode | external | — | If unreachable in dev, upload mode fails — fall back to URL-paste during development. Document required env vars: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_BUCKET`. |

**No new external dependencies for Phase 3.**

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `AssetLibraryModal` has only one consumer | A2 | Verified by grep across `src/`. Risk only if a consumer was added between research and planning. **Verified 2026-04-24.** |
| A2 | Zod v4 introspection uses `_zod.def.type` not `_def.typeName` | B1 | Verified directly from `node_modules/zod/v4/core/schemas.d.ts`. **Verified 2026-04-24.** |
| A3 | `asset.createFromUrl` doesn't exist | C3 | Verified by reading `server/routers/asset.ts`. **Verified 2026-04-24.** |
| A4 | xyflow renders red stroke on invalid connection automatically | D1 | Documented in `node_modules/@xyflow/system/dist/esm/types/handles.d.ts:46-51` and standard xyflow behavior. **VERIFIED via type defs; visual behavior is xyflow library default — recommend manual verification on first integration.** |
| A5 | `NewProjectModal` does NOT mirror page.tsx card grid | E3 | Verified by reading `NewProjectModal.tsx` end-to-end. **Verified 2026-04-24.** |
| A6 | `selected` state on RF nodes is stripped by current `onNodesChange` | G6 | Verified by reading `WorkflowEditor.tsx:73-85`. **Verified 2026-04-24.** |
| A7 | `@testing-library/react` not installed | F2 | Verified by reading `package.json`. **Verified 2026-04-24.** |
| A8 | Workflow card image already exists at `public/cards/workflows.png` | E5 | Verified by `ls`. **Verified 2026-04-24.** |
| A9 | Phase 2 `vitest.config` works without modification | F1 | Inferred from "113/113 pass" in Phase 2 summary. Risk: if config needs jsdom for any reason, that's news. Recommend planner verify on first wave-0 commit. |
| A10 | `imageUpload.ts` is NOT actually dirty in git tree (CONTEXT note was stale) | C1 | `git diff --stat HEAD` shows no diff. **Verified 2026-04-24.** |

---

## Open Questions

1. **Should the inspector render a "Run this node" preview button (e.g. for ImageInput, show preview thumbnail)?**
   - What we know: D-17 says Phase 3 ships handlers but doesn't invoke them.
   - What's unclear: Does "doesn't invoke" forbid even a preview-only invocation in the inspector?
   - Recommendation: NO. Keep handlers fully unwired in Phase 3. Image preview in ImageInput uses `<img src={resolvedUrl}>` with `assetId` looked up via `asset.getById.useQuery` (read-only, harmless).

2. **Should the inspector show an "Export from registry" preview of `defaultParams` for empty-state debugging?**
   - Recommendation: NO; not on REQ list.

3. **Folder field on assetOutput — what does "folder" actually mean in v1.0?**
   - The `Asset` model in Prisma has no folder concept. CONTEXT.specifics lists `folder: z.string().optional()` for assetOutput.
   - Recommendation: Store as a metadata key on the Asset (`metadata: { source: "workflow-output", folder?: string }`) so it's not lost. UI surfaces "folder" as a virtual category in a future phase. For v1.0, accept the value but don't act on it server-side.

4. **Does an `/projects` page exist with the same card row?**
   - CONTEXT D-19 says "duplicated in NewProjectModal.tsx (template grid in modal). Both call sites must be updated." But research shows NewProjectModal doesn't have such a grid (Section E3). The CONTEXT may have meant `/projects/page.tsx` instead.
   - Recommendation: planner verify whether `platform-app/src/app/projects/page.tsx` exists and contains a card grid; if so, mirror the homepage change there.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zod v3 `_def.typeName` discriminator | Zod v4 `_zod.def.type` discriminator | Zod 4.0 (mid-2024+) | All Zod-introspecting code must be rewritten; Phase 3 is greenfield so no cost |
| RF node `data: any` for params | `data: { params: Record<string, unknown> }` (Phase 2 convention) | Phase 2 of this milestone | Inspector reads `node.data.params`, not `node.data` |

**Deprecated/outdated:**
- Don't use `JSONSchemaGenerator` from Zod core (`zod/v4/core/json-schema-generator.d.ts:7` — explicitly deprecated). Use `toJSONSchema` if a JSONSchema route is ever needed (it isn't for D-14).

---

## Project Constraints (from `.cursor/rules/`)

From `.cursor/rules/design-system-contrast.mdc`:
- Inspector chrome: don't use `text-text-primary` on solid `bg-accent-lime` / `bg-white` surfaces. Use `text-accent-lime-text` / `text-on-light` instead.
- New pink card `iconBg: "bg-pink-100 ..."` is a tint (not solid), so theme-aware text tokens are fine.
- Design system tokens (`bg-bg-surface`, `text-text-primary`, etc.) are the standard for inspector panels — match the existing `Input` / `Select` component style.

From `.cursor/rules/deploy-pipeline.mdc`: not loaded — not relevant to Phase 3 (no deploy work).

---

## Sources

### Primary (HIGH confidence — read directly from project source)

- `platform-app/src/components/editor/AssetLibraryModal.tsx` (430 lines) — Section A
- `platform-app/src/app/editor/[id]/page.tsx:1011` — Section A2 (sole consumer)
- `platform-app/src/server/workflow/types.ts` (154 lines) — Section B5 hints, registry shape
- `platform-app/src/lib/workflow/graphSchema.ts` (52 lines) — Section B per-node schema integration point
- `platform-app/src/components/workflows/WorkflowEditor.tsx` (189 lines) — Section D1 wire-up site
- `platform-app/src/store/workflow/createGraphSlice.ts` — Section B7 update strategy
- `platform-app/src/hooks/workflow/useWorkflowAutoSave.ts` — Section B7 debounce confirmation
- `platform-app/src/utils/imageUpload.ts` (384 lines) — Section C1 upload contract
- `platform-app/src/app/api/upload/presign/route.ts` (101 lines) — Section C1 server contract
- `platform-app/src/app/api/upload/route.ts` (187 lines) — Section C1 fallback contract
- `platform-app/src/server/routers/asset.ts` (lines 1–510 reviewed) — Section C3 procedure inventory
- `platform-app/src/app/page.tsx` (439 lines) — Section E1, E4 cards array
- `platform-app/src/components/dashboard/NewProjectModal.tsx` (220 lines) — Section E3 finding
- `platform-app/src/app/globals.css:248–283` — Section E2 gradient classes
- `platform-app/prisma/schema.prisma:410–427, 320–336` — workspace/project relation finding
- `platform-app/package.json` — Section F2 deps inventory
- `platform-app/node_modules/zod/v4/core/schemas.d.ts` — Section B1 introspection (lines 31, 360–406, 767–784, 835–850)
- `platform-app/node_modules/zod/v4/core/checks.d.ts:24–49` — Section B2 check shapes
- `platform-app/node_modules/@xyflow/system/dist/esm/types/general.d.ts:64–73, 109` — Section D1, D2 Connection + IsValidConnection types
- `platform-app/node_modules/@xyflow/system/dist/esm/types/handles.d.ts:46–51` — Section D1 docstring
- `platform-app/node_modules/@xyflow/react/dist/esm/components/SelectionListener/index.d.ts` — Section G6 selection listener

### Secondary (MEDIUM confidence — read via grep)

- `platform-app/src/components/workflows/BaseNode.tsx`, `nodes/index.tsx`, `NodePalette.tsx` — selection plumbing context
- `platform-app/src/store/workflow/__tests__/graphSlice.test.ts` — Section F1 test pattern
- `platform-app/src/components/ui/Input.tsx`, `Select.tsx`, `SegmentedControl.tsx` — Section B5, hint #9 component reuse

### Tertiary (LOW confidence — none for this phase)

All findings are verified against project source. No web research was needed because Zod v4 internals and xyflow types are present in `node_modules`.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified package versions and import sites
- Architecture (consumer inventory, selection plumbing, store API): HIGH — verified file-by-file
- Zod v4 introspection: HIGH — verified directly from installed `.d.ts`
- xyflow `isValidConnection` semantics: HIGH for type signature; MEDIUM for visual feedback (recommend first-integration manual confirmation)
- `asset.createFromUrl` non-existence: HIGH — searched router source
- `NewProjectModal` finding (no card grid mirror): HIGH — read entire file
- Pitfalls catalog: HIGH for items 1–5 (derived from verified facts), MEDIUM for items 6–7 (general care items)

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (1 month — internals stable; Zod 4.4 release could shift introspection slightly)
