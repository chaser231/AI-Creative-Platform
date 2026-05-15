# Outpaint A/B Harness

Dev-time tool for visually comparing outpaint pipeline configurations on a
fixed reference set. Runs each (image, config) combination through fal.ai
directly (bypassing the Next.js auth layer) and writes a single HTML grid
gallery so you can eyeball seam quality, upscaler artefacts, and the
hard-vs-feathered composite step side by side.

The script consumes real fal.ai credits — it's a manual dev tool, not a CI
check. Type-checks and lints as part of the repo but **never runs from the
deploy pipeline**.

## Usage

1. Set `FAL_KEY` in your shell:

    ```bash
    export FAL_KEY=$(grep ^FAL_KEY .env.local | cut -d= -f2-)
    ```

2. Edit [`reference-images.json`](./reference-images.json) — the committed
    file ships with placeholder `https://example.com/...` URLs. Replace them
    with real ones:

    - **Yandex S3** URLs from your library (`https://storage.yandexcloud.net/...`).
    - **Public** URLs (anything reachable from the Node process).
    - **Local files** via `file:///absolute/path/to/image.png`.

3. Run from the `platform-app` directory:

    ```bash
    npx tsx scripts/outpaint-ab.ts
    ```

    Outputs are written to `tmp/outpaint-ab/`:

    - `inputs/{id}.png` — normalised references (PNG-encoded, cached).
    - `{id}-{config}.png` — each run's result.
    - `gallery.html` — generated after every run, even partial.

    Each `{id}-{config}.png` is cached. Delete a file to re-run that single
    combination; delete the whole directory to start clean.

4. Open the gallery:

    ```bash
    open tmp/outpaint-ab/gallery.html
    ```

## What it tests

| Config         | Outpaint model         | Upscale model | Composite | Notes                                          |
| -------------- | ---------------------- | ------------- | --------- | ---------------------------------------------- |
| `baseline`     | `bria-expand`          | `seedvr`      | hard      | What production used before Phases 1–5.        |
| `flux-only`    | `flux-2-pro-outpaint`  | `seedvr`      | hard      | Isolates the outpaint-model change.            |
| `feather-only` | `bria-expand`          | `seedvr`      | feather   | Isolates the composite change.                 |
| `topaz-only`   | `bria-expand`          | `topaz-hf-v2` | hard      | Isolates the upscaler change.                  |
| `full-stack`   | `flux-2-pro-outpaint`  | `topaz-hf-v2` | feather   | Current production wiring.                     |

The harness forces every reference through the full preserve pipeline
(downscale → outpaint → upscale → composite) by capping the intermediate
side at `HARNESS_MAX_FINAL_DIMENSION = 1500px` (production uses 4800, which
would skip the upscale step for typical banner-sized references and make
seedvr vs topaz indistinguishable in the gallery). Adjust the constant at
the top of `scripts/outpaint-ab.ts` if you want to mirror production
behaviour instead.

## Cost note

Per run (rough, 2026-05 fal.ai list pricing):

- `flux-2-pro-outpaint` ≈ $0.075 / image
- `bria-expand`         ≈ $0.045 / image
- `seedvr`              ≈ $0.06 / megapixel
- `topaz-hf-v2`         ≈ $0.16 / image (≤ 48 MP tier)

A full sweep of the bundled 8 references × 5 configs is roughly **$5 – $10**,
depending on image size and how much the per-file cache absorbs.

## Notes

- The harness skips the colour-match nudge that `compositeExpandResult` does
    on the browser. The feather alone covers the bulk of the visual gain; the
    extra sample-shift step adds complexity that isn't worth the parity here.
- `flux-2-pro-outpaint` has a 2048 px per-side cap. If a reference asks for
    a larger pad on any side, the harness errors out for that config and
    records the failure in the gallery (production has a multipass
    orchestrator for the same case — see Phase 5).
- `tmp/outpaint-ab/` is git-ignored via the per-folder `.gitignore` — feel
    free to commit `reference-images.json` overrides locally if you want a
    stable dev set.

## Acceptance / sanity

```bash
npx tsc --noEmit -p scripts/tsconfig.json
npx eslint scripts/outpaint-ab.ts
```

Both must exit 0. The script itself does **not** run as part of CI — it
costs paid API credits and is gated behind a manually-set `FAL_KEY`.
