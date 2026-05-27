# Outpaint handoff, 2026-05-26

## Status

Previous thread: `Проверить и завершить outpaint`
Thread id: `019e508b-e5a6-7ef3-9088-e45a52aa8aec`
Rollout log: `/Users/gary-yakovlev/.codex/sessions/2026/05/22/rollout-2026-05-22T19-36-46-019e508b-e5a6-7ef3-9088-e45a52aa8aec.jsonl`

The previous thread reached a failed remote context compaction state after the useful implementation work had already been applied locally. The last successful agent summary in that thread said:

- `npx tsc --noEmit --pretty false` passed.
- `npm test` passed: 57 files, 428 tests.
- Browser smoke on `http://localhost:3000` opened without console errors.
- `npm run lint` still failed on pre-existing lint debt, mostly React hooks rules in older code.

Current branch: `fix/template-save-large-payload`.

## Implemented outpaint work in the working tree

- Wizard expand defaults to the GPT Image 2 pack-aware path.
- Legacy wizard expand remains available behind `NEXT_PUBLIC_WIZARD_OUTPAINT_ENGINE=legacy`.
- Added `computePackOutpaintPlan(...)` for master-layer padding, resize format projection, request sizing, and diagnostics.
- Added `prepareWizardWorkingImage(...)` for visible crop and working derivative creation from `objectFit` and focus.
- Added `outpaintWithGptImage2PackPlan(...)` for padded canvas/mask generation, GPT Image 2 edit request, and deterministic source-preserving composite.
- Added `imageSize?: { width; height }` through `/api/ai/image-edit` and Fal `gpt-image-2/edit` payloads.
- Nano Banana 2 `2K` / `4K` generation now can store a source asset separately and put a derivative into the wizard layer.
- Added focused tests for pack planning, request budgets, mask alpha, Fal payload forwarding, and agent prompt compaction.

## Files with local progress

Modified tracked files:

- `platform-app/src/app/api/ai/image-edit/route.ts`
- `platform-app/src/components/wizard/WizardContentWorkspace.tsx`
- `platform-app/src/lib/__tests__/falProviderLora.test.ts`
- `platform-app/src/lib/ai-providers.ts`
- `platform-app/src/server/agent/llmProviders.ts`

New untracked files:

- `documentation/banner_canvas_backlog.md`
- `documentation/outpaint_handoff_2026-05-26.md`
- `platform-app/src/server/agent/llmProviders.test.ts`
- `platform-app/src/utils/gptImageOutpaint.test.ts`
- `platform-app/src/utils/gptImageOutpaint.ts`
- `platform-app/src/utils/packOutpaintPlan.test.ts`
- `platform-app/src/utils/packOutpaintPlan.ts`
- `platform-app/src/utils/wizardExpand.test.ts`
- `platform-app/src/utils/wizardImageDerivative.ts`

## Context compaction diagnosis

The failed old thread had:

- `model_context_window`: 258400 tokens.
- Last API response before the failure: about 225167 total tokens.
- Failed compact request model-visible bytes: about 1027064 bytes.
- Error: `stream disconnected before completion` while calling `https://chatgpt.com/backend-api/codex/responses/compact`.

The previous global Codex config had:

```toml
model_auto_compact_token_limit = 220000
```

That starts compaction very late for this model/window and lets the compact payload grow large enough to be fragile.

Updated global config:

```toml
model_auto_compact_token_limit = 120000
model_auto_compact_token_limit_scope = "body_after_prefix"
tool_output_token_limit = 16000
```

Backup created at:

`/Users/gary-yakovlev/.codex/config.toml.backup-20260526-compact-fix`

## Suggested next verification

Run focused checks from `platform-app`:

```bash
npx vitest run src/utils/packOutpaintPlan.test.ts src/utils/gptImageOutpaint.test.ts src/lib/__tests__/falProviderLora.test.ts src/server/agent/llmProviders.test.ts
npx tsc --noEmit --pretty false
```

Then manually validate the screenshot pack case:

- master `1192x300`
- vertical `470x762`
- top banner `853x92`

Acceptance criteria:

- one GPT Image 2 edit request for wizard expand;
- no legacy upscale/multipass in default wizard path;
- center/source pixels remain stable except the soft band;
- layer rect updates only from planner `prev` / `next`;
- resize formats are covered after cascade.
