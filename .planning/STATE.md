# State — AI Creative Platform

> Живой файл текущего состояния GSD-процесса. Обновляется при переходах между фазами, между майлстоунами, а также в `/gsd-pause-work` / `/gsd-resume-work`.

## Current Position

- **Milestone:** v1.0 Workflow Automation — Product Reflection Scenario
- **Phase:** Not started (Phase 1 готова к `/gsd-plan-phase`)
- **Plan:** —
- **Status:** Bootstrap complete — PROJECT / MILESTONES / REQUIREMENTS / ROADMAP / research пакет (SUMMARY + 4 research docs) на месте. Готовность к запуску Phase 1.
- **Last activity:** 2026-04-24 — `/gsd-new-milestone` завершён: бутстрап GSD-артефактов + 4 research-документа + SUMMARY.md + REQUIREMENTS.md + ROADMAP.md.

## Accumulated Context

### Pre-GSD history (перенесено из памяти проекта)

**In-flight (не закрыто)**:
- **MF-6 Canvas State Consistency** — архитектурный фикс инварианта `state.layers ↔ resizes[active].layerSnapshot`. Дизайн готов (`.planning/mf6/DESIGN.md`), реализация частично начата (изменения в `createHistorySlice.ts`, `createSelectionSlice.ts`, `types.ts` — см. `git status`). **Решение:** продолжается параллельно майлстоуну v1.0; не считается частью v1.0 scope. При необходимости вынесем в отдельный именованный трек "MF-6: Canvas State" внутри `.planning/mf6/`.

**Quick fixes (задокументированы в `.planning/quick/`)**:
- `20260422-copy-matches-image` — без SUMMARY/PLAN, статус неясен.
- `20260422-fix-ai-template-apply-timeout` — без артефактов.
- `20260422-fix-outpaint-upload-head-timeout` — есть PLAN.md и SUMMARY.md.
- `20260422-fix-undo-breaks-formats` — есть PLAN.md и SUMMARY.md.

### Known uncommitted work (snapshot на момент бутстрапа 2026-04-24)

Из `git status` на старте:
- Изменения в auth/middleware (`WaitlistGuard`, `UserMenu`, `middleware.ts`, `devBypass.ts`, `TRPCProvider`, `trpc.ts`) — судя по всему, работа над dev-bypass и waitlist-потоком.
- Изменения в canvas store (`createHistorySlice.ts`, `createSelectionSlice.ts`, `types.ts`) + новый тест `historyFormatInvariant.test.ts` — это и есть in-flight MF-6 реализация.
- `ssrfGuard.ts` + тест — точечные улучшения безопасности.
- `useSignOutAndClearState.ts` — новый хук выхода.

**Действие:** эта работа не привязана к v1.0, и её не блокируем. При переходе на execute-фазу v1.0 — убедиться, что MF-6 либо вмержен, либо явно изолирован (чтобы workflow-phase не конфликтовал с canvas-slice рефакторингом).

## Known Blockers

Нет блокеров на уровне майлстоуна.

## Open Decisions (после research — закрыты)

- ✅ Node-editor библиотека — **@xyflow/react v12** (STACK.md). Отклонены tldraw (лицензия) и rete.js (застой).
- ✅ Storage workflow — **новая nullable колонка `AIWorkflow.graph: Json?`** (ARCHITECTURE.md), additive migration, legacy `steps` не трогаем.
- ✅ BG-removal — **Replicate bria/product-cutout primary + rembg + 851-labs fallback каскад** (STACK.md). Gemini Nano Banana исключён (нет alpha).
- ✅ Reflection — **Bria product-shadow primary + FLUX Kontext Pro fallback** (STACK.md).
- ✅ DAG runtime — **graphology + graphology-dag** (STACK.md).
- ✅ Scope v1.0 финализирован — см. REQUIREMENTS.md (28 REQ) и ROADMAP.md (6 фаз).

## Открытые вопросы (minor, переходят в фазы)

- Точное число runs/hour для rate-limit — плановое 20. Finalize в Phase 4.
- Drag-drop file прямо на canvas (auto-create ImageInput) — v1.0 или v1.1? Решается в Phase 5.
- Показ предварительной стоимости на кнопке Run — отложен на v1.1 (см. REQUIREMENTS.md "Требования, намеренно отложенные").
- Undo/redo в редакторе — отложен на v1.1.

## Environment

- **Local cwd:** `/Users/gary-yakovlev/Work/Projects/AI Creative Platform`
- **Branch:** main (needs verify)
- **GSD version:** v1 (`.planning/` layout). `gsd-sdk` CLI не установлен — команды исполняются вручную через Claude.
- **Researcher agents:** завершены. Итог: 4 research-документа в `.planning/research/` (STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md) + SUMMARY.md. Три из четырёх фоновых агентов зависли после биллинг-перерыва — их выводы были синтезированы мануально на основе STACK.md (завершённого успешно), карты кодовой базы (`.planning/codebase/`) и исходных task-specs.

## Next step

Запустить `/gsd-plan-phase` для **Phase 1 — DB + Server AI Actions**. Цель Phase 1: миграция `graph` column + action handlers + REST endpoint `/api/workflow/execute-node` с maxDuration=300.

---

*Last updated: 2026-04-24 — new-milestone complete (bootstrap + research + REQUIREMENTS + ROADMAP).*
