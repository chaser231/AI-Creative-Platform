---
slug: fix-undo-breaks-formats
created: 2026-04-22
status: complete
parent_design: .planning/mf6/DESIGN.md
---

# Fix: undo ломает форматы (ширина артборда от предыдущего формата, слои смешиваются)

## Симптом

Пользователь редактирует несколько форматов (например, Landing Header 1192×300 и Hero 540×225), делает undo. В панели форматов переключается активный формат (визуально чекбокс на правильном), но артборд на канвасе показывается **размером от предыдущего активного формата**, с поверх наложенными слоями от нового активного. Очень странная визуальная рассинхронизация.

Скриншоты: https://.../(2 приложены пользователем).

## Корневая причина

В `HistorySnapshot` **нет** `canvasWidth`/`canvasHeight`. А `undo`/`redo` (`createHistorySlice.ts:19-55`) восстанавливают `resizes`, `activeResizeId`, `layers` одним пакетом, но `canvasWidth/Height` — это отдельные поля, они остаются от состояния после push.

Плюс из §1.1-1.2 MF-6 DESIGN: в момент push `state.layers` и `resizes[active].layerSnapshot` часто рассинхронизированы (add/remove/duplicate/reorder/toggle/paste в `createLayerSlice` пишут только `state.layers`). Snapshot фиксирует рассинхрон и воспроизводит его при undo → инвариант I1 нарушен.

Комбинация: после undo `state.layers` от формата A (восстановлены из snapshot.layers — то что было активно при push), а `canvasWidth/Height` и `activeResizeId` от формата B (не поменялись или поменялись частично).

## Фикс (минимальная версия варианта D из DESIGN)

### 1. `types.ts` — расширить `HistorySnapshot`

Добавить `canvasWidth: number` и `canvasHeight: number`. Backward-compat не нужна — history in-memory, реалоад страницы очищает.

### 2. `createHistorySlice.ts` — `snapshotState`: last-chance reconcile

Перед сохранением снимка — подтянуть актуальные `state.layers` в `resizes[active].layerSnapshot`, чтобы snapshot был самосогласован. Даже если какой-то мутатор забыл синкнуть — на этапе push мы это чиним.

```ts
function snapshotState(state): HistorySnapshot {
  const resizes = state.resizes.map(r =>
    r.id === state.activeResizeId && r.layerSnapshot !== undefined
      ? { ...r, layerSnapshot: state.layers }
      : r
  );
  return { ..., resizes, canvasWidth: state.canvasWidth, canvasHeight: state.canvasHeight };
}
```

### 3. `createHistorySlice.ts` — `undo`/`redo`: атомарное восстановление

Восстанавливать `canvasWidth/Height` из snapshot. Для `layers` — если у восстановленного активного формата есть `layerSnapshot`, брать его (единый источник истины); иначе — fallback на `prev.layers` (legacy-путь для старых форматов без snapshot).

### 4. Unit-test

Проверить, что после сценария из §9 E1 DESIGN.md:
- `state.layers === resizes[active].layerSnapshot` после undo
- `canvasWidth === resizes[active].width` после undo

## Файлы

- `platform-app/src/store/canvas/types.ts` — расширить `HistorySnapshot`
- `platform-app/src/store/canvas/createHistorySlice.ts` — `snapshotState`, `undo`, `redo`
- `platform-app/src/store/canvas/__tests__/historyFormatInvariant.test.ts` — новый тест (NEW)

## Что НЕ входит в этот quick

Полный MF-6 (вариант D), включая:
- Дроп поля `layers` из `HistorySnapshot` (типовая миграция, ~6 файлов)
- `commitActiveLayers` helper + замена `set({layers})` во всех слайсах
- Cascade override tracking (§8 DESIGN)

Оставлено на отдельный полный phase MF-6 — этот таск **только снимает симптом**, обеспечив атомарность undo и гарантию I1 в момент push/undo через last-chance reconcile.
