# Phase 3 — Node Registry + Inspector + Client Handlers — SUMMARY

**Status:** ✅ DONE
**Branch:** `ai-workflows-creative`
**Date:** 2026-04-24
**Execution mode:** inline (no subagents — D-21, per user request to avoid context burn)

## What shipped

A polished node editor experience built on top of the Phase 2 shell:

- A workspace-scoped, single-select asset picker that decouples library
  browsing from canvas editing.
- A complete per-node parameter contract (Zod) that the inspector renders
  automatically and the executor will rely on.
- A connection validator that blocks incompatible port types at the React
  Flow level (red stroke during drag, no edge created on drop).
- A right-side Inspector panel with hand-rolled form rendering for every
  node type, plus a composite picker for ImageInput supporting library /
  URL / direct upload sources.
- Thin client-side handler contracts (`imageInput`, `assetOutput`) and a
  workspace-scoped `asset.attachUrlToWorkspace` mutation that Phase 4
  will plug into the executor.
- A new "AI Workflows" tile on the dashboard top panel and matching
  option in the new-project modal — both deep-link to the existing
  `/workflows` routes.

## Decisions executed

| ID | Decision | Outcome |
|----|---------|---------|
| D-14 | Inspector form: hand-rolled switch by Zod field type | `pickFieldKind` + `RenderField` cover string/textarea/number/slider/enum/boolean. No extra dependency. |
| D-15 | ImageInput sources: library + URL + upload | `ImageSourceInput` tabs; upload uses `uploadForAI` presigned PUT and stores the resulting S3 url in `sourceUrl`. |
| D-16 | Extract a slim `AssetPickerModal` in Wave 1 | Lives in `components/assets/`, no canvas coupling, single-select only. Old `editor/AssetLibraryModal` untouched (no migration this phase). |
| D-17 | Client handlers as thin contracts, not invoked yet | `store/workflow/clientHandlers.ts` exposes `imageInput` / `assetOutput` with injected `ClientHandlerDeps`. Phase 4 owns the executor that calls them. |
| D-18 | Connection validation visual: minimal | `isValidConnection` returns false for incompatible ports; xyflow's built-in invalid-connection visual is the only feedback. Hover-ring deferred to Phase 5+. |
| D-19 | "AI Workflows" homepage tile | Added 5th tile (`gradient-card-pink`, `Workflow` icon) navigating to `/workflows`. Mirrored in `NewProjectModal`. |
| D-20 | Russian strings inline, no i18n | All labels, error messages, node display names, descriptions, port labels are in Russian directly in source. |
| D-21 (process) | Inline execution to save tokens | All 7 waves implemented in the parent conversation thread without spawning subagents. |

## Commits (in order)

1. `3e845af` — `feat(workflows): extract slim AssetPickerModal from AssetLibraryModal`
2. `8f2cef6` — `feat(workflows): per-node Zod param schemas + russified NODE_REGISTRY`
3. `43276d6` — `feat(workflows): isValidConnection blocks incompatible port types`
4. `e0f45fb` — `feat(workflows): NodeInspector with auto-form + ImageSourceInput`
5. `5cd5945` — `feat(workflows): client handler contracts + workspace-scoped asset attach`
6. `cb86b97` — `feat(dashboard): add AI Workflows card to home + new-project modal`

## Files changed

**Added (16):**

- `platform-app/src/components/assets/AssetPickerModal.tsx`
- `platform-app/src/components/workflows/NodeInspector.tsx`
- `platform-app/src/components/workflows/inspector/ImageSourceInput.tsx`
- `platform-app/src/components/workflows/inspector/renderField.tsx`
- `platform-app/src/components/workflows/inspector/fieldKind.ts`
- `platform-app/src/components/workflows/inspector/__tests__/fieldKind.test.ts`
- `platform-app/src/lib/workflow/nodeParamSchemas.ts`
- `platform-app/src/lib/workflow/connectionValidator.ts`
- `platform-app/src/lib/workflow/__tests__/nodeParamSchemas.test.ts`
- `platform-app/src/lib/workflow/__tests__/connectionValidator.test.ts`
- `platform-app/src/store/workflow/clientHandlers.ts`
- `platform-app/src/store/workflow/__tests__/clientHandlers.test.ts`
- `platform-app/public/cards/workflows.png`
- `.planning/phases/03-node-registry-inspector-handlers/03-CONTEXT.md`
- `.planning/phases/03-node-registry-inspector-handlers/03-PATTERNS.md`
- `.planning/phases/03-node-registry-inspector-handlers/03-PLAN.md`

**Edited (5):**

- `platform-app/src/server/workflow/types.ts` — Russian labels + defaults
- `platform-app/src/server/routers/asset.ts` — `attachUrlToWorkspace` mutation
- `platform-app/src/components/workflows/WorkflowEditor.tsx` — selection wiring + Inspector mount + `isValidConnection`
- `platform-app/src/app/page.tsx` — 5th tile, grid expand
- `platform-app/src/app/globals.css` — `gradient-card-pink` (light + dark)
- `platform-app/src/components/dashboard/NewProjectModal.tsx` — 5-column goal grid + workflow path

## Verification

- `npx tsc --noEmit` → clean
- `npx vitest run` → **154/154 tests pass** (added: 9 fieldKind, 8 connectionValidator, 15 nodeParamSchemas, 9 clientHandlers = 41 new)
- `npx next build` → success, all `/workflows` routes present (`/workflows`, `/workflows/[id]`, `/workflows/new`)
- `npm run lint` → 7 pre-existing errors in unrelated files (TemplateSettingsModal, useImage, ReferenceImageInput, customFonts); 0 new errors in any Phase 3 file

## Known follow-ups (handed to Phase 4)

1. **Executor wires `clientHandlers`** — Phase 4 imports `imageInput` / `assetOutput`, injects tRPC bindings, runs the topo-sorted graph.
2. **Server-action handlers** — `removeBackground` and `addReflection` still need their server-side `actionId` handlers (`remove_background`, `add_reflection`); the registry already declares them.
3. **AssetLibraryModal migration** — current canvas editor still uses the heavier modal. A later refactor can swap to `AssetPickerModal` once a multi-select mode lands (deliberately out of scope for v1).
4. **Hover-ring for valid drop targets** — currently rejected at drop but no positive affordance during drag. Tracked under D-18 as Phase 5+.
5. **Inspector validation ergonomics** — Inspector currently writes invalid intermediate values to the store and surfaces inline errors. If Phase 4 finds this too lossy, a "stash bad value, only commit on blur" mode is straightforward to add.

## Risks closed in this phase

- ❌ ~~`asset.createFromUrl` may not exist~~ → solved by adding `asset.attachUrlToWorkspace` (workspace twin of the existing project mutation).
- ❌ ~~Zod v3 field introspection patterns may not work in v4~~ → confirmed v4, rewrote `pickFieldKind` against the public Zod v4 surface (`def.type`, `minValue`/`maxValue`, `maxLength`, `options`).
- ❌ ~~Workflows tile would force a "name first" wizard~~ → bypasses `NewProjectModal`'s create flow entirely; routes to `/workflows/new` which owns its own naming UX.
