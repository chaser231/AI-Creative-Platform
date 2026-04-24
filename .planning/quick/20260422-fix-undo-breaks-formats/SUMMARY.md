---
slug: fix-undo-breaks-formats
status: complete
completed: 2026-04-22
---

# SUMMARY — undo ломает форматы

## Что сделано

Закрыли острый пользовательский баг, описанный в MF-6 DESIGN §1.2, **минимальным патчем** — без миграции всей инфраструктуры истории (полный MF-6 вариант D остаётся на отдельный phase).

Симптом: после undo панель форматов показывает новый активный формат, но артборд на канвасе остаётся размером от предыдущего формата, и на него накладываются слои от «активного» формата — визуальная каша.

## Корневая причина

`HistorySnapshot` не содержал `canvasWidth`/`canvasHeight`, поэтому `undo`/`redo` восстанавливали `resizes`/`activeResizeId`/`layers` пакетом, а `canvasWidth/Height` оставались на значениях **после** push-а. Плюс при push в `state.layers` и `resizes[active].layerSnapshot` часто была рассинхронизация, которую snapshot фиксировал и воспроизводил при undo.

## Изменения

### `platform-app/src/store/canvas/types.ts`

- `HistorySnapshot` расширен обязательными полями `canvasWidth: number`, `canvasHeight: number`. JSDoc ссылается на MF-6 §1.2.

### `platform-app/src/store/canvas/createHistorySlice.ts`

- `snapshotState()` теперь выполняет **last-chance reconcile**: перед сохранением — синкает `state.layers` в `resizes[active].layerSnapshot`, чтобы снимок был внутренне согласован.
- `snapshotState()` сохраняет `canvasWidth/canvasHeight` из текущего state.
- `undo()` / `redo()`:
  - Восстанавливают `canvasWidth/canvasHeight` атомарно вместе с `resizes` и `activeResizeId`.
  - `layers` теперь **выводятся** из `restoredResizes[activeResizeId].layerSnapshot` через helper `resolveLayersFromSnapshot` — это гарантирует инвариант I1 в момент восстановления. Fallback на `snap.layers` оставлен для легаси-форматов без snapshot.
  - Добавлены `resolveLayersFromSnapshot` / `resolveCanvasSizeFromSnapshot` helper'ы с защитой от некорректных snapshot'ов (старые/легаси).

### `platform-app/src/store/canvas/createSelectionSlice.ts`

- `alignSelectedLayers` и `batchUpdateLayers` формируют `HistorySnapshot` inline, обходя `pushSnapshot`. Новые обязательные поля добавлены (`canvasWidth/Height`), плюс в этих двух местах тоже делается last-chance reconcile для `resizes[active].layerSnapshot`.

### `platform-app/src/store/canvas/__tests__/historyFormatInvariant.test.ts` (NEW)

Три regression-теста, которые воспроизводят сценарий пользователя (master 1192×300 → hero 540×225 → edit → undo):

1. `undo restores canvasWidth/canvasHeight along with active resize` — проверяет, что после undo `canvasWidth === resizes[active].width`.
2. `undo after a cross-format sequence does not mix layers between formats` — проверяет, что master-snapshot не «вытекает» в hero после undo, и обратно; инвариант I1 держится.
3. `redo symmetrically restores canvasWidth/canvasHeight and invariant I1` — симметрия для redo.

## Верификация

- `npx tsc --noEmit` — чисто (0 ошибок).
- `npx vitest run src/store/ src/server/security/` — **39/39 passed** (наши 3 новых + 33 SSRF + 3 существующих store).

## Что НЕ сделано (и почему)

Полный MF-6 вариант D (см. `.planning/mf6/DESIGN.md`) требует:
- Дроп поля `layers` из `HistorySnapshot` (типовая миграция).
- Helper `commitActiveLayers` и замена `set({layers})` во всех ~20 местах `createLayerSlice` / `createComponentSlice` / `createPaletteSlice`.
- Manual-override tracking для cascade (§8).

Это тянет на отдельный phase. Текущий quick — минимальный, безопасный фикс, который закрывает видимый user-facing баг. Last-chance reconcile в `snapshotState()` + атомарность undo обеспечивают, что даже без перехода на `commitActiveLayers` в существующих ~20 точках — snapshot всегда пишется и восстанавливается согласованно на уровне активного формата. Остаточный риск — потеря ручных правок в неактивных форматах при каскаде от мастера (§1.2 — «cascadeB_v2 затёрл edited_B_v1»), этот сценарий НЕ закрыт этим патчем.

## Следующие шаги (на усмотрение)

1. Полный MF-6 phase (вариант D) — когда появится окно для более широкой миграции.
2. До того — добавить `console.warn` в `setActiveResize`, если мастер каскадит поверх `layerSnapshot`, где пользователь что-то трогал (track override). Простая диагностика без архитектурных изменений.

## Ссылки

- Parent design: `.planning/mf6/DESIGN.md` (детальный анализ и варианты A/B/C/D).
- Инвариант I1: `.planning/mf6/DESIGN.md` §4.
- Сценарий E1: `.planning/mf6/DESIGN.md` §9 (воспроизводится первым тестом).
