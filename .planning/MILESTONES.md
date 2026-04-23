# Milestones

> Bootstrap note (2026-04-24): Проект существовал и разрабатывался без формального GSD-процесса. Этот файл создан в момент запуска первого формального майлстоуна v1.0. Предыдущая работа (v0.x, MVP+) не разбита на отдельные GSD-майлстоуны — её состояние зафиксировано в `PROJECT.md` как "Validated Requirements".

## v0.x — MVP+ (pre-GSD, 2025 → 2026-04)

**Status:** Ретроактивно признан как "shipped pre-milestone" состояние.

**Что было построено (до формализации):**
- Canvas-редактор (Konva + master/instance биндинги + resize).
- LLM-агент с tool-calling и 9 действиями.
- AI-провайдеры с fallback (Yandex GPT / OpenAI / Replicate / Gemini).
- NextAuth v5 + workspace RBAC.
- Asset library (S3 presign).
- Template catalog + brand kit + style presets.
- Figma import.
- Prisma-модели: `AIWorkflow` (заготовка без UI/runtime), `AISession`, `AIMessage`, `AIPreset`.
- Недавние quick-фиксы (см. `.planning/quick/`): outpaint upload, undo breaks formats, AI template apply timeout, copy matches image.
- MF-6 design (canvas state consistency) — `.planning/mf6/DESIGN.md` (in-progress, не в рамках GSD-майлстоуна).

## v1.0 — Workflow Automation: Product Reflection Scenario (current)

**Started:** 2026-04-24
**Status:** Planning complete (REQUIREMENTS + ROADMAP заданы) → готов к `/gsd-plan-phase` для Phase 1.

**Goal:** Визуальный редактор AI-воркфлоу (node-based) + runtime + первый пресет-сценарий генерации продукта с AI-отражением на прозрачном фоне.

**Key deliverables:**
- Node-editor на @xyflow/react v12 с типизированными портами.
- Workflow runtime (client orchestrate + server execute для AI/S3) на graphology + graphology-dag.
- Миграция `AIWorkflow.graph: Json?` (additive, nullable).
- 4 базовые ноды: ImageInput, RemoveBackground, AddReflection, AssetOutput.
- Страницы `/workflows` (list) и `/workflows/[id]` (editor).
- Пресет "Product Reflection".

**Scope fixed:**
- Runtime: hybrid (client orchestrate + server AI nodes через REST endpoint с maxDuration=300).
- Bg-remove: Replicate bria/product-cutout primary + rembg + 851-labs fallback каскад (Gemini исключён — нет alpha).
- Reflection: Bria product-shadow primary + FLUX Kontext Pro fallback.
- Entry point: `/workflows` section.
- Rate-limit: 20 runs/hour per user (v1.0).
- Cost tracking: per-node via AIMessage (existing pattern).

**Phases (по ROADMAP.md):**
1. DB + Server AI Actions (Phase 1)
2. Editor Canvas + tRPC CRUD (Phase 2)
3. Node Registry + Inspector + Client Handlers (Phase 3)
4. Runtime / Executor / Run Button (Phase 4)
5. Preset + UX Polish + E2E Test (Phase 5)
6. QA / Hardening — optional (Phase 6)

**Estimated effort:** 15-20 рабочих дней (критический путь 5 фаз; Phases 1-2 параллелизуются).

**Links:**
- `.planning/PROJECT.md` (current milestone section).
- `.planning/REQUIREMENTS.md` — 28 REQ-ID.
- `.planning/ROADMAP.md` — 6 фаз с зависимостями.
- `.planning/research/SUMMARY.md` + 4 research docs (STACK / FEATURES / ARCHITECTURE / PITFALLS).

---

*Template for future entries:*

```
## vX.Y — <Name> (YYYY-MM → YYYY-MM)

**Goal:** ...
**Phases:** N/M completed.
**Requirements covered:** RX-Y, ...
**Key outcomes:** ...
**Learnings:** ...
```
