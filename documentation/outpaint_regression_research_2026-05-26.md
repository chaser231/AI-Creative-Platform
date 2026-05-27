# Outpaint / expand regression research, 2026-05-26

## Short version

The current local branch mixes three different states:

- `fix/template-save-large-payload` is based on `origin/main` plus the template payload fix.
- The editor expand / inpaint UX fixes live only on `feat/inpaint-ux-fixes`.
- The GPT Image 2 wizard outpaint work is currently uncommitted local work on top of `fix/template-save-large-payload`.

That explains why some behavior looks "rolled back": the UX fixes were not reverted, they are simply not in the branch currently checked out.

## Git findings

Current branch:

```text
fix/template-save-large-payload
```

Commits that contain the expand/inpaint UX fixes:

```text
54892db fix(editor): inpaint and expand UX - reset, perf, handle drag
450a16f fix(editor): ignore bubbled drag events that shift frame on drop
```

Both are contained only by:

```text
feat/inpaint-ux-fixes
```

They are not contained by current `HEAD`, `origin/main`, or `fix/template-save-large-payload`.

Relevant diff from current branch to `feat/inpaint-ux-fixes`:

```text
platform-app/src/components/editor/canvas/Canvas.tsx        |  64 +++++-
platform-app/src/components/editor/canvas/ExpandOverlay.tsx | 228 +++++++++------------
platform-app/src/components/inpaint/InpaintMaskOverlay.tsx  | 143 +++++++------
platform-app/src/hooks/useCanvasEditMode.ts                 |  33 +++
platform-app/src/hooks/useInpaintMask.ts                    | 199 ++++++++++--------
platform-app/src/store/canvas/createEditModeSlice.ts        |  15 ++
platform-app/src/store/canvas/createSelectionSlice.ts       |  56 +++--
platform-app/src/store/canvas/editModeHelpers.ts            |  82 ++++++++
```

## Expand frame selection bug

Symptom:

- In editor expand mode, clicking/dragging expand handles clears the selected layer.
- The expand frame visually remains, so UI state and canvas selection diverge.

Most likely cause:

- Current `ExpandOverlay.tsx` does not mark handles/overlay as a dedicated expand control.
- Current handle nodes do not cancel pointer events.
- Stage-level `handleStageMouseDown` treats a handle click like an empty-canvas/layer-outside click and can clear selection.

The missing `feat/inpaint-ux-fixes` implementation added:

- `EXPAND_CONTROL_NAME = "expand-control"`.
- `stopExpandPointerEvent(e) { e.cancelBubble = true; }`.
- `name={EXPAND_CONTROL_NAME}` on the overlay group and handles.
- `listening={false}` on passive overlay rectangles/borders/labels.
- `isExpandControlNode(...)` in `Canvas.tsx`, so stage mousedown ignores expand controls.
- Central `exitCanvasEditModes` logic so selection changes reset edit modes intentionally instead of leaving orphan UI.

Conclusion:

This regression is branch drift, not a new outpaint algorithm bug.

## Why wizard still uses flux / legacy pipeline

The screenshot logs are definitive legacy signatures:

```text
[Wizard/Expand/pre-crop]
[outpaintPipeline] flux2-downscale-path
[Wizard/Expand/preserve-pipeline-armed]
[Wizard/Expand/outpaint-api-start] { model: "flux-2-pro-outpaint" }
[Wizard/Expand/preserve-upscale-start]
[outpaintPipeline] border-strips-prepared
```

The new GPT path would log:

```text
[Wizard/GPTOutpaint/gpt-outpaint-canvas-start]
[Wizard/GPTOutpaint/outpaint-api-start] { model: "gpt-image-2" }
[Wizard/GPTOutpaint/outpaint-api-done]
[Wizard/GPTOutpaint/preserve-composite-done]
```

In current source, wizard default is:

```ts
const WIZARD_OUTPAINT_ENGINE =
  process.env.NEXT_PUBLIC_WIZARD_OUTPAINT_ENGINE === "legacy"
    ? "legacy"
    : "gpt-image-2";
```

Local `.env`, `.env.local`, and `.env.example` do not contain `NEXT_PUBLIC_WIZARD_OUTPAINT_ENGINE`.

The process listening on `:3000` is in:

```text
/Users/gary-yakovlev/Work/Projects/AI Creative Platform/platform-app
```

The current `.next/dev` wizard chunk contains both the new GPT path and the legacy path. Therefore, if the browser still uses flux after a hard reload, likely causes are:

- the dev server inherited `NEXT_PUBLIC_WIZARD_OUTPAINT_ENGINE=legacy` from the shell that started it;
- the browser tab was running an older compiled chunk before the GPT changes;
- there are multiple open tabs/sessions and the screenshot came from an older runtime state.

## How to verify GPT Image 2 wizard expand

Restart the dev server with `NEXT_PUBLIC_WIZARD_OUTPAINT_ENGINE` unset.

In DevTools console, expected logs:

```text
[Wizard/GPTOutpaint/gpt-outpaint-canvas-start]
[Wizard/GPTOutpaint/outpaint-api-start]
[Wizard/GPTOutpaint/outpaint-api-done]
[Wizard/GPTOutpaint/preserve-composite-done]
```

In Network, the `/api/ai/image-edit` request should have:

```json
{
  "action": "inpaint",
  "intent": "edit",
  "model": "gpt-image-2",
  "scale": "high",
  "imageSize": { "width": "...", "height": "..." }
}
```

If the request has `action: "outpaint"` or `model: "flux-2-pro-outpaint"`, it is still legacy.

## Image stretching / distortion hypotheses

There are two separate mechanisms to watch:

1. Legacy path:

   - `outpaintImage(...)` works in source-image pixels, may downscale to fit flux caps, then optionally upscales strips and composites.
   - The visible seam can be uneven because legacy does colour matching, feathering, downscale/upscale, and border-only upscale. Each step can introduce small mismatch around the preserved original.
   - The screenshot shows exactly this path: `final-canvas-capped`, `preserve-upscale-start`, `border-strips-prepared`.

2. GPT path:

   - After successful GPT expand, wizard sets image view to:

     ```ts
     { objectFit: "fill", focusX: 0.5, focusY: 0.5 }
     ```

   - This was intended to prevent `cover` from hiding the newly generated edges after the layer geometry grows.
   - It is only safe if the generated bitmap aspect ratio exactly matches the new layer rect aspect ratio.
   - If the planner uses a source size whose pixel scale differs on X/Y, or if the image load/derivative preparation falls back unexpectedly, `fill` can visibly stretch the bitmap.

Potential GPT-specific causes:

- `computePackOutpaintPlan` converts master padding to pixels using separate `scaleX` and `scaleY`.
- That is fine when the working derivative has the same aspect as the layer.
- If derivative prep fails or returns a source whose aspect does not match the visible layer, `scaleX !== scaleY` and `objectFit: "fill"` can distort.
- The 3:1 GPT request aspect cap can add extra top/bottom padding to wide banners; that changes the resulting layer rect even when formats did not explicitly ask for that vertical growth.

## Black fill / bad GPT result hypothesis

The GPT helper builds:

- a transparent padded PNG with the source image placed into the center;
- an alpha mask where padding is transparent/editable and the source core is opaque/preserved;
- a 24 px soft transition band.

That matches the intended OpenAI-style mask contract, but it is still fragile because the editable padding in the input image is fully transparent. Some providers/models may treat transparent padding as black/empty context, which can explain a left-side black fill result.

Possible mitigations to test later:

- prefill editable padding with blurred/extended edge pixels instead of leaving it fully transparent;
- keep the mask transparent for editable areas, but give the model visual context in the underlying image;
- log and snapshot the exact padded input PNG and mask PNG for one failing wizard run;
- add a debug download/asset registration path for `paddedCanvas`, `mask`, `gpt raw result`, and final composite.

## Recommended next work

1. Merge or cherry-pick the expand/inpaint UX fixes from `feat/inpaint-ux-fixes` into the current working branch.
2. Restart dev server and verify wizard expand uses GPT path by console/network signatures above.
3. Add temporary debug instrumentation for GPT outpaint artifacts:
   - plan diagnostics;
   - source derivative size;
   - padded input URL;
   - mask URL;
   - raw GPT output URL;
   - final composite URL.
4. Add a guard against `fill` distortion:
   - assert output bitmap aspect matches `nextMasterRect` aspect within tolerance;
   - if not, either adjust `nextMasterRect` from actual bitmap aspect or use a non-stretch fit mode with explicit geometry correction.
5. Improve GPT input canvas:
   - prefill transparent padding with edge-extended/blurred context before calling GPT Image 2;
   - keep the original center preserved by deterministic composite afterward.
