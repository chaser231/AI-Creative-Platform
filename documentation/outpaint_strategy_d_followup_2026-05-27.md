# Outpaint Strategy D follow-up (after PR #101)

## Context

PR #101 (`fix/wizard-outpaint-single-pass`) ships Strategy A from the
2026-05-27 outpaint research:

- single-pass GPT Image 2 outpaint without client composite
- `aspectCapStrategy: "downscale-request"` so the master rect no longer
  inflates with symmetric padding for extreme-aspect packs
- `objectFit: "fill"` everywhere with explicit nextRect adjustment
  instead of `cover` cropping fresh padding

Strategy A keeps `gpt-image-2` as the wizard default. The remaining
open question is what to do for banner formats whose required output
aspect exceeds the GPT 3:1 envelope. With the new
`downscale-request` strategy the planner emits a
`request-aspect-out-of-range` diagnostic in that case and the wizard
will surface whatever fal returns — possibly a 422 if the provider
rejects the request, possibly a result of unknown quality if it
accepts.

## Strategy D in one sentence

Hybrid router: keep `gpt-image-2` for `nextMasterRect` aspects inside
3:1 / 1:3, switch to `flux-fill` (`fal-ai/flux-pro/v1/fill`) for
formats that fall outside the envelope. flux-fill uses the same
binary B/W mask contract we already build, so the runner can stay
shared.

## Pre-requisite probe

We can't justify the integration without a one-call probe of
flux-fill on the actual extreme aspects we ship:

| Probe | Canvas | Source rect | Notes |
|------|--------|-------------|-------|
| 853x275 strip | 853x275 | source 800x250 centered | check seam quality, latency |
| 3840x412 banner | 3840x412 | 3000x400 left-anchored | check long-edge handling, queue time |
| 540x1920 vertical | 540x1920 | 500x300 top-anchored | check 1:3.5 vertical |

Each probe is one POST to `/api/ai/image-edit` with
`model: "flux-fill"`, `action: "inpaint"`, the same padded canvas +
binary mask we already produce in `outpaintWithGptImage2PackPlan`,
and `recordMessage: false` if applicable.

Probes must run with a real `FAL_KEY`. Capture latency, returned
image dimensions, visual quality of the seam, and whether fal
accepts the aspect at all.

## Implementation sketch (after probes pass)

1. Extract the pipeline body of `outpaintWithGptImage2PackPlan` into
   a private `runPackOutpaintPass({ engine: "gpt-image-2" | "flux-fill" })`.
   Both engines use the same binary mask, edge-extended padding, and
   uniform-rescale-to-output flow.
2. Add an engine-router in `WizardContentWorkspace.tsx` right after
   `computePackOutpaintPlan`:
   ```
   const aspect = nextRect.width / nextRect.height
   const engine = aspect > GPT_IMAGE2_MAX_ASPECT
     || aspect < 1 / GPT_IMAGE2_MAX_ASPECT
     ? "flux-fill" : "gpt-image-2"
   ```
3. Pipe `engine` through to the runner. fal model id for flux-fill is
   already wired via `FAL_MODEL_MAP_INPAINT` in `lib/ai-providers.ts`.
4. For `flux-fill` use `aspectCapStrategy: "off"` in the planner —
   flux-fill has no documented 3:1 cap, so we don't need to downscale
   the request canvas.
5. Tests:
   - `packOutpaintPlan.test.ts`: case for `aspectCapStrategy: "off"`
     producing a request whose aspect matches the output exactly.
   - new `gptImageOutpaintRouter.test.ts` (or extend existing): given a
     pack with one wide-and-tall format, the router selects flux-fill;
     given a normal pack, it sticks to gpt-image-2.
   - integration: stub fal response for both engines and assert the
     wizard updates layer rect correctly.

## Risk

- flux-fill image quality on very long photographic banners is
  unknown — probe data needed before committing.
- Hybrid path doubles the test surface for outpaint quality.
- Cost analysis: GPT Image 2 is flat $0.15/run, flux-fill is
  $0.05/MP. For a 3840x412 banner ($0.05 * 1.58 MP ≈ $0.08) flux-fill
  is cheaper; for a 1356x899 banner ($0.05 * 1.22 MP ≈ $0.06) about
  the same. No regression expected on cost.

## Out of scope (will not be done in this follow-up)

- Switching the wizard default away from `gpt-image-2` for normal
  packs. Strategy A keeps the proven path.
- Multi-pass outpaint (Strategy B from the research). Doubles
  latency, breaks "single pass" requirement from the user.

## Acceptance criteria

- one fresh fal call for the probe canvases above logged with raw
  image URLs;
- engine router respects `GPT_IMAGE2_MAX_ASPECT`;
- existing screenshot pack regression tests still pass;
- new ultra-wide pack scenario produces a single flux-fill API call
  with no symmetric padding inflation.
