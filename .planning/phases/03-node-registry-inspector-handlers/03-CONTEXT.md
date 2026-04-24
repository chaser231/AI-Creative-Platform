# Phase 3 — Node Registry + Inspector + Client Handlers — CONTEXT

**Gathered:** 2026-04-24
**Status:** Ready for research → planning
**Source:** Conversational discovery (no /gsd-discuss-phase needed; user answered 5 gray-area questions inline + bonus card-design block)

## Phase Boundary

This phase builds the **UX layer** that turns Phase 2's empty xyflow canvas into a usable node editor. After this phase, a creator can:

1. Click any node on the canvas → see an auto-generated form for its params.
2. Edit params with type-correct inputs (text/number/enum/bool) and see them autosave via the existing `useWorkflowAutoSave` hook.
3. Connect nodes only when port types are compatible (`isValidConnection` blocks bad edges).
4. Use the `ImageInput` node to pick from the workspace asset library (or paste a URL, or upload a fresh image).
5. Use the `AssetOutput` node to push a computed image back into the asset library via tRPC.

**The only thing missing after Phase 3** is the actual run engine — Phase 4 wires the Phase 1 server actions into a DAG executor that walks the graph from sinks back to sources. Phase 3 deliberately ships the editor without a Run button enabled, so the UX can be validated independently of runtime concerns.

**Bonus scope (carried in from the conversation):** add an "AI Workflows" card to the homepage top-row alongside "Генерация баннеров / текстов / фото / видео". The card image is already in `platform-app/public/cards/workflows.png`; only wiring + a new pink gradient class are needed. This is a small visual integration task, not a separate phase, because it gates discoverability of everything Phase 2/3 just built.

## Implementation Decisions (Locked)

### D-14 · Inspector form library: hand-rolled switch

- **Decision:** Build the Zod → form mapping by hand with a `switch` on the Zod type def (`ZodString | ZodNumber | ZodEnum | ZodBoolean`).
- **Rejected:** `react-hook-form + @hookform/resolvers/zod` (extra deps, validation lib overkill for 4 primitive types). `@autoform/zod` and similar (unproven compat with Zod v4).
- **Rationale:** Roadmap explicitly recommends "start with simple switch by type, evolve". v1.0 only needs 4 input types — adding a form lib costs more than it saves.
- **Implication:** A small `renderField()` helper lives in `NodeInspector.tsx` (or a sibling file). Each branch returns a controlled component. Validation runs through Zod `safeParse` on every change — invalid values display an inline error and are NOT pushed to `updateNodeParams`.

### D-15 · ImageInput sources: library + URL + upload

- **Decision:** `ImageInput` node supports three input modes:
  1. **Library pick** (assetId) — opens the shared `AssetLibraryModal` (see D-16).
  2. **URL paste** (sourceUrl) — accepts `data:` URLs or `https://` URLs. SSRF is enforced on the server in Phase 4 (`safeFetch` already in place from Phase 1); Phase 3 only stores the URL.
  3. **Upload** — uses the existing `/api/upload/presign` flow, gets back an S3 URL, stores it as a fresh asset and writes its `assetId` into params.
- **Rejected:** Library-only (too restrictive; users want quick paste). Library + URL only (upload is a low-cost UX win since presign already exists).
- **Rationale:** Roadmap mentions "Library + URL + Upload" as the richest tier; the existing `presign` route + `imageUpload.ts` cover the upload backend with no new server work.
- **Implication:** Inspector for `imageInput` has three radio-tabs ("Из библиотеки" / "По URL" / "Загрузить файл"). The runtime resolution logic in the client handler (D-17) reads only `assetId` OR `sourceUrl` (precedence: assetId wins). Upload mode resolves to assetId at submit time.

### D-16 · AssetLibraryModal: extract to shared in Wave 1

- **Decision:** Refactor the existing `AssetLibraryModal` (currently coupled to whatever screen owns it today) into a shared component before the inspector consumes it. Extract task lives in **Wave 1** of the plan, blocking the ImageInput inspector work in subsequent waves.
- **Rejected:** "Try to reuse, decide on the fly" (high risk of mid-phase rewrite). "Build a separate workflow-only picker" (duplicates UI logic, drifts from the rest of the app).
- **Rationale:** Roadmap risk explicitly calls this out; doing it deliberately first is cheaper than discovering coupling at integration time.
- **Implication:** A research step is needed to map current `AssetLibraryModal` consumers and determine props surface. Wave 1 produces `src/components/assets/AssetPickerModal.tsx` (or similar) with a clean prop interface (`{ open, onClose, onSelect(assetId), workspaceId, multiSelect?: false }`). Old call sites migrate in the same wave.

### D-17 · Client handlers: thin wrappers, defer side-effects to Phase 4

- **Decision:** `src/store/workflow/clientHandlers.ts` exports two functions:
  - `imageInput({ params, ctx })` → resolves params to `{ imageUrl: string }`. If `params.assetId`, calls tRPC `asset.getById` and returns `asset.url`. If `params.sourceUrl`, returns it directly. Throws on neither.
  - `assetOutput({ inputs, params, ctx })` → calls tRPC `asset.createFromUrl` (or equivalent — research needs to confirm exact endpoint) and returns the new `assetId`.
- **Phase 4 contract:** The Phase 4 executor will call these functions for nodes whose `NODE_REGISTRY[type].execute.kind === "client"`. Phase 3 ships them with full unit-test coverage but **does not invoke them anywhere** — the Run button stays disabled.
- **Rationale:** Front-loading the contract keeps Phase 4 from being blocked on UX rework, and the unit tests pin the API down so the executor author has zero ambiguity.

### D-18 · Connection validation feedback: minimal

- **Decision:** Implement `isValidConnection` (checks `sourcePort.type === targetPort.type` OR either is `"any"`) and let xyflow render its built-in invalid-connection visual (red stroke during drag, no edge created on drop).
- **Rejected:** Rich PortType-aware coloring of all candidate handles (more code, low marginal UX value at v1.0). Tooltip explanations on invalid drop (nice-to-have, defer).
- **Rationale:** xyflow's default `isValidConnection` UX is industry-standard; users who've seen any node editor will recognise it. Custom theming can come in Phase 5+ when the editor visual identity is finalized.
- **Implication:** No new components — `WorkflowEditor.tsx` adds one prop `isValidConnection={validateConnection}` to `<ReactFlow>`. The validator function lives in `src/lib/workflow/connectionValidator.ts` and is unit-tested with the full port matrix.

### D-19 · "AI Workflows" homepage card

- **Decision:** Add a fifth card to the top-row card grid on `/` (homepage) and `/projects` ("Последние проекты" section), positioned after "Генерация видео".
- **Card spec:**
  - `id: "workflow"`
  - `icon: <Workflow size={20} strokeWidth={1.5} />` from `lucide-react`
  - `label: "AI\nWorkflows"` (two-line, matches existing pattern)
  - `gradient: "gradient-card-pink"` — **new** CSS class; light: `linear-gradient(145deg, #FDF2F8 0%, #FCE7F3 100%)`, dark: `linear-gradient(145deg, #2A1525 0%, #3A1830 100%)`. Add to `src/app/globals.css` next to the other 4 gradient-card classes.
  - `iconBg: "bg-pink-100 text-pink-600 dark:bg-pink-500/20 dark:text-pink-400"`
  - `image: "/cards/workflows.png"` — **already in repo** at `platform-app/public/cards/workflows.png` (256×256 PNG, transparent BG, 17 KB).
- **Click behaviour:** Navigates to `/workflows` (list page from Phase 2). Does NOT trigger the existing `createProjectMutation` flow that other cards use — workflow creation has its own dedicated `/workflows/new` flow.
- **Where:** The cards array currently lives in `platform-app/src/app/page.tsx` (top-row) and is duplicated in `NewProjectModal.tsx` (template grid in modal). Both call sites must be updated. Researcher should confirm whether the `NewProjectModal.tsx` modal should also include the Workflow card — provisionally **yes**, with the same nav-on-click semantic.

### D-20 · Russian strings stay inline

- **Decision:** v1.0 doesn't need an i18n setup. All Russian display names/descriptions/error messages live inline in `NODE_REGISTRY` and component JSX. A future i18n pass can lift them to translation files when a second locale becomes a real requirement.
- **Rationale:** REQ-14 only mandates Russian copy; nothing in v1.0 demands swap-ability.

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 2 artifacts (this builds directly on top)

- `.planning/phases/02-editor-canvas-trpc-crud/02-CONTEXT.md` — Phase 2 locked decisions (D-08…D-13).
- `.planning/phases/02-editor-canvas-trpc-crud/02-SUMMARY.md` — what shipped, what stubs are intentionally left for Phase 3+.

### Type / registry source of truth

- `platform-app/src/server/workflow/types.ts` — `WorkflowNodeType`, `Port`, `PortType`, `NODE_REGISTRY`. **All four nodes (`imageInput`, `removeBackground`, `addReflection`, `assetOutput`) already exist as definitions; Phase 3 enriches their `defaultParams` and adds per-node Zod schemas.** Do NOT add new node types in Phase 3.
- `platform-app/src/lib/workflow/graphSchema.ts` — `workflowGraphSchema`. The new per-node param schemas register with this file (extend or sit alongside; planner decides).

### State management

- `platform-app/src/store/workflow/useWorkflowStore.ts` — already exposes `updateNodeParams(id, patch)` (Phase 2). Inspector consumes this directly; no store API changes required.
- `platform-app/src/store/canvasStore.ts` — pattern reference for how slices compose. (Already cited in Phase 2 — keep handy.)

### Editor + canvas

- `platform-app/src/components/workflows/WorkflowEditor.tsx` — wires xyflow; `**isValidConnection` slots in here**. Edit, don't replace.
- `platform-app/src/components/workflows/NodePalette.tsx` — drag source. Update tooltip copy if D-14/D-20 require.
- `platform-app/src/components/workflows/nodes/BaseNode.tsx` — node card visual. Selection state already plumbed; inspector hooks into selection.

### Auto-save

- `platform-app/src/hooks/workflow/useWorkflowAutoSave.ts` — already debounce-saves on `dirty`. Inspector edits flip `dirty` via `updateNodeParams` → no new save plumbing needed.

### Asset library (D-16 extract target)

- Researcher: locate the current `AssetLibraryModal` component. Likely candidates: `platform-app/src/components/assets/`, `platform-app/src/components/dashboard/`. Read its current consumers and prop surface before drafting the extract task.

### Image upload (D-15 upload mode)

- `platform-app/src/app/api/upload/presign/route.ts` — already in place (referenced by `next build` route list).
- `platform-app/src/utils/imageUpload.ts` — modified file in current dirty tree (visible in initial git status). Researcher should diff to understand current upload contract.

### Homepage card grid (D-19)

- `platform-app/src/app/page.tsx` lines ~70-105 — `cards` array literal. Editing this is the primary integration point.
- `platform-app/src/components/dashboard/NewProjectModal.tsx` — secondary call site; include the new card here too.
- `platform-app/src/app/globals.css` lines ~247-283 — `.gradient-card-`* classes. Add `.gradient-card-pink` here (light + dark).

### Requirements (every plan MUST claim its REQ-IDs)

- `.planning/REQUIREMENTS.md`:
  - **REQ-11** (P0, Phase 3) — Типизированные соединения / `isValidConnection`.
  - **REQ-12** (P0, Phase 3) — Inspector автогенерация формы.
  - **REQ-13** (P0, Phase 2+3) — Node palette (Phase 2 shipped basics; Phase 3 polishes if needed for D-20 Russian strings).
  - **REQ-14** (P1, Phase 3) — Per-node UX русификация.

### Code-style rules

- `.cursor/rules/design-system-contrast.mdc` — colour contrast rules apply to inspector chrome and the new pink gradient.

## Specific Ideas / Concrete Targets

### Per-node param schemas (D-14 + REQ-12 minimum surface)


| Node               | Params (Zod)                                                                                                                                                            | UI render                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `imageInput`       | `z.object({ source: z.enum(["asset","url","upload"]).default("asset"), assetId: z.string().optional(), sourceUrl: z.string().url().optional() }).refine(d => d.assetId  |                          |
| `removeBackground` | `z.object({ model: z.enum(["fal-bria", "replicate-bria-cutout", "replicate-rembg"]).default("fal-bria") })`                                                             | enum → select            |
| `addReflection`    | `z.object({ style: z.enum(["subtle","strong","mirror"]).default("subtle"), intensity: z.number().min(0).max(1).default(0.3), prompt: z.string().max(500).optional() })` | enum + slider + textarea |
| `assetOutput`      | `z.object({ name: z.string().min(1).max(120).default("Workflow output"), folder: z.string().optional() })`                                                              | text + text              |


Planner is free to refine the exact schema *content* during planning, but **the four shapes above are the v1.0 minimum** — anything more is Phase 5+.

### Inspector layout

Right-hand panel, fixed width ~320 px, only visible when exactly one node is selected (multi-selection = empty state). Header shows `definition.displayName` + `category` badge. Body = auto-rendered form. Footer = small "Сбросить параметры" button that calls `updateNodeParams(id, definition.defaultParams)`.

### Connection validator

```typescript
// src/lib/workflow/connectionValidator.ts
export function isValidConnection(
  connection: Connection,
  nodes: WorkflowNode[]
): boolean {
  const source = nodes.find(n => n.id === connection.source);
  const target = nodes.find(n => n.id === connection.target);
  if (!source || !target) return false;
  const sourcePort = NODE_REGISTRY[source.type].outputs
    .find(p => p.id === connection.sourceHandle);
  const targetPort = NODE_REGISTRY[target.type].inputs
    .find(p => p.id === connection.targetHandle);
  if (!sourcePort || !targetPort) return false;
  if (sourcePort.type === "any" || targetPort.type === "any") return true;
  return sourcePort.type === targetPort.type;
}
```

(Planner will produce the actual file; this snippet is the API contract.)

## Deferred Ideas (out of Phase 3 scope)

- **Run button enable / DAG executor** → Phase 4.
- **Preset library + ?preset= resolution** → Phase 5.
- **Inspector advanced inputs** (color picker, file drop in non-imageInput nodes, JSON editor, code mirror) → Phase 5+.
- **i18n infrastructure** (translation files, locale switcher) → only when second locale becomes a real requirement.
- **Rich port-type-aware connection coloring** (highlight all compatible handles during drag) → Phase 5 visual polish.
- **Tooltip-on-invalid-drop explanation** → Phase 5 visual polish.
- **AssetLibraryModal multi-select** → only if a future node demands picking multiple assets at once.
- **Node grouping / sub-graphs** → out of v1.0.

---

*Phase: 03-node-registry-inspector-handlers*
*Context gathered: 2026-04-24 via inline conversational discovery*