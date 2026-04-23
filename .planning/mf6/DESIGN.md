# MF-6: Canvas State Consistency — Design

> Architectural fix для системного бага «undo/resize-switch затирает слои одного формата данными другого». Дизайн-документ, не код.

---

## 1. Root cause

Твой предварительный анализ подтверждён чтением кода и углублён. Баг — это **два связанных дефекта** поверх одной архитектурной проблемы (двойной источник истины `state.layers` ↔ `resizes[i].layerSnapshot`):

### 1.1 Инвариант «layers = resizes[active].layerSnapshot» систематически нарушается

«Активная» копия слоёв хранится в `state.layers`. Каноническая копия того же формата — в `resizes[active].layerSnapshot`. Эти копии должны совпадать всегда, но синхронизируются они только в точке `setActiveResize` при уходе с формата (`createResizeSlice.ts:194-198`) и частично в `updateLayer` через `syncSnapshotFormats` (`createLayerSlice.ts:84-155`, запись на строке 121-122).

Все остальные мутации **пишут только в `state.layers`**, не трогая `resizes[active].layerSnapshot`:

| Место | Что делает |
|---|---|
| `createLayerSlice.addTextLayer/addRectangleLayer/addImageLayer/addBadgeLayer/addFrameLayer` (194-201, 227-233, 262-268, 297-303, 332-338) | `set({ layers: [...s.layers, finalLayer] })` — без синка |
| `createLayerSlice.removeLayer` (531-536), `deleteSelectedLayers` (587-593) | `set({ layers: newLayers })` — без синка |
| `createLayerSlice.duplicateLayer/duplicateSelectedLayers` (670-675, 760-765) | без синка |
| `createLayerSlice.bringToFront/sendToBack/reorderLayers/reorderLayer` (778, 790, 804, 845) | без синка |
| `createLayerSlice.toggleLayerVisibility/toggleLayerLock` (903, 909-911) | без синка |
| `createLayerSlice.moveLayerToFrame/removeLayerFromFrame` (876-877, 891-892) | без синка |
| `createLayerSlice.pasteLayers/wrapInAutoLayoutFrame` (1004-1009, 1118-1124) | без синка |
| `createComponentSlice.promoteToMaster/updateMasterComponent` (41-47, 100-104) | без синка |
| `createSelectionSlice.alignSelectedLayers/batchUpdateLayers` (160-164, 220-224) | без синка |

Итого **~20 точек**, где инвариант пробивается. Пока пользователь не сменит формат, `resizes[active].layerSnapshot` остаётся «на шаг позади».

### 1.2 `HistorySnapshot` фиксирует разошедшиеся копии

`snapshotState` (`createHistorySlice.ts:58-68`) копирует **и** `state.layers`, **и** полный `state.resizes` (включая `layerSnapshot` **всех** форматов — активного и неактивных) одним пакетом. Ключевая комбинация, дающая баг:

- В момент push в `state.layers` могут лежать свежие правки активного формата, а `resizes[active].layerSnapshot` — стейл (см. 1.1).
- Для **не**активных форматов `resizes[i].layerSnapshot` — это снепшот, записанный когда-то давно (либо при `setActiveResize` ухода с `i`, либо через cascade из `updateLayer`/palette).

При `undo` (`createHistorySlice.ts:19-36`) восстанавливается **одним пакетом** `layers: prev.layers` + `resizes: prev.resizes` + `activeResizeId: prev.activeResizeId`. Последствие: **все `layerSnapshot` других форматов возвращаются в то состояние, в котором они были в момент push** — даже если пользователь с тех пор редактировал другой формат. Эти редактирования других форматов, если они случились между прошлым push и текущим, **не покрыты снимками и теряются**.

Конкретный сценарий (воспроизводит «мастер затёр B»):

1. Мастер `L_m0`. Редактирование → pushSnapshot: `snapA = {layers:L_m0, resizes:[{m:L_m0,isMaster:t},{B:L_B0,bindings:[...]}], active:m}`. После правок: `layers=L_m1`, `resizes[m]=L_m1`. Если master `isMaster=true` и у B есть bindings, `syncSnapshotFormats` **дополнительно** каскадит в `resizes[B].layerSnapshot = cascadeB_v1` (`createLayerSlice.ts:125-152`).
2. `setActiveResize("B")` — истории **не** трогает. `resizes[m]` уже `L_m1`. Загружает `layers=cascadeB_v1`. Потом отрабатывает блок 231-280: второй каскад мастер→B (часто no-op, если cascadeB_v1 уже содержит мастеровские значения, но см. §1.3).
3. Пользователь вручную правит B (например меняет `text`, который bound через `syncContent`). `updateLayer` делает pushSnapshot `snapB = {..., resizes[B]=cascadeB_v1, ...}`, затем `layers=edited_B_v1, resizes[B]=edited_B_v1`. Поскольку `activeResize=B` и `B.isMaster !== true`, `syncSnapshotFormats` пишет только свой же `layerSnapshot` (линия 118-123).
4. `setActiveResize("master")` — снимка нет. `resizes[B].layerSnapshot = edited_B_v1` (на 194-198). Загружает `layers=resizes[m].layerSnapshot=L_m1`. active=m.
5. Пользователь правит мастер. `updateLayer` → pushSnapshot `snapC = {layers:L_m1, resizes:[{m:L_m1},{B:edited_B_v1}], active:m}`. После правки: `layers=L_m2, resizes[m]=L_m2`. `syncSnapshotFormats` (master `isMaster=true`, B bindings) **каскадит в B**: `resizes[B].layerSnapshot = cascade(edited_B_v1, L_m2, bindings) = cascadeB_v2` — **затирает `edited_B_v1` полем `text` из мастера**. Редактирование пользователя в B потеряно в текущем состоянии.
6. Пользователь делает undo. Pop `snapC` → `{layers:L_m1, resizes:[{m:L_m1},{B:edited_B_v1}], active:m}`. Формально `edited_B_v1` восстановлен ✅ — НО только если undo происходит до следующей мутации мастера и до save. Если пользователь сохранил проект (`useProjectSync.getCanvasStateForSave` в 36-54 сериализует **текущие** snapshot'ы, поверх перезатёртых) — **`edited_B_v1` уходит в БД как `cascadeB_v2`**. После reload файл мертвец.

Итог 1.1+1.2: **любое редактирование мастера с `isMaster=true` каскадит в bound-форматы и без трассировки "ручного override" безусловно затирает ручные правки**. Плюс, даже если пользователь укладывается в undo-окно, `snapshotState` возвращает именно то состояние, которое было в момент push — не то, которое было реально «в голове» пользователя перед последним действием.

### 1.3 Дополнительный каскад в `setActiveResize` (231-280)

Блок 231-280 **повторно** применяет cascade каждый раз при переключении **в** bound-формат. Для сценария, где B уже был каскаден из мастера (через `syncSnapshotFormats`) — чаще всего no-op. Но для `imageSyncMode=relative_size` в `bindingCascade.applyCascade` (`helpers.ts:151-172`), который требует `prevMasterLayers` для вычисления дельты — `prevMasterLayers` **не передаётся** в вызове на 251-256 → дельта не считается, фейл безмолвный. Для других режимов это лишнее дублирование работы + ещё одна точка, где ручные правки B гарантированно затираются даже если `updateLayer`-каскад их не затёр (например из-за throttle). Этот блок нужно удалить — его семантика уже полностью покрывается `syncSnapshotFormats`.

### 1.4 Побочный риск — палитра

`createPaletteSlice.updateSwatch/removeSwatch` (232-235, 247-251, 350-360, 416-426) проходит по **всем** `resizes[i].layerSnapshot` и пишет `{ ...r, layerSnapshot: next }`. Это корректно на данный момент (палитра — глобальная ось, bind-агностичная), но **любое изменение `layerSnapshot` неактивных форматов в момент между `pushSnapshot` и следующей мутацией → тот же класс багов, что 1.2**. MF-6 должен это учесть (инвариант держим для активного формата; для неактивных — делаем consistency-check при восстановлении из истории).

---

## 2. Чужие места, которые задевает баг

Все R/W операции над `state.layers` и `resizes[*].layerSnapshot`:

### Writes в `state.layers`

| Место | Статус | Нужно менять? |
|---|---|---|
| `createLayerSlice.updateLayer` (375-500) — через `syncSnapshotFormats` | **safe** (синкает snapshot) | нет |
| `createLayerSlice.*` (add*/remove/duplicate*/reorder*/toggle*/frame*/paste/wrap) | **broken today** — пишут `layers` без синка | **да** |
| `createComponentSlice.promoteToMaster/updateMasterComponent` | **broken** | **да** |
| `createSelectionSlice.alignSelectedLayers/batchUpdateLayers` | **broken** + обходят `pushSnapshot` (вручную пишут `history`) | **да** |
| `createResizeSlice.setActiveResize` (lines 217, 266-273) | **safe** — синкает и для source, и для target | нет (но удалим блок 231-280) |
| `createResizeSlice.syncLayersToResize` (291, 309, 347) | **at-risk** — перезаписывает `layers`, не синкает snapshot. Вызывается только из legacy-пути и `loadTemplatePack`/`applySmartResize`, где после вызова `layerSnapshot` всё равно пересобирается | лучше унифицировать |
| `createHistorySlice.undo/redo` | **broken** — пункт 1.2 | **да** |
| `createTemplateSlice.resetCanvas/loadTemplatePack` | safe — сбрасывают всё | нет |

### Writes в `resizes[i].layerSnapshot`

| Место | Статус |
|---|---|
| `createResizeSlice.addResize` (41-46, 97-100, 105-107) — создаёт новый формат со снепшотом | safe |
| `createResizeSlice.setActiveResize.194-198` — сохраняет уходящий | safe |
| `createResizeSlice.setActiveResize.266-273` — каскад на switch | **broken** — удалить блок |
| `createResizeSlice.duplicateResize.164` — клонирует | safe |
| `createResizeSlice.setFormatBindings.392-433` — первичный cascade при установке bindings | at-risk (аналогичен 231-280, но тут он логичен — явное действие пользователя) |
| `createLayerSlice.syncSnapshotFormats` | **at-risk** — каскадит в бaund-форматы при каждом edit мастера, затирает ручные override-ы |
| `createPaletteSlice.updateSwatch/removeSwatch/applyColorSwatchToLayer/applyBackgroundSwatchToImageLayer` | at-risk (см. 1.4) — пишут в все snapshot'ы, интерферируют с history |
| `createHistorySlice.undo/redo` (pop `prev.resizes`) | **broken** — пункт 1.2 |

### Reads `state.layers`

- `components/editor/canvas/Canvas.tsx:301` — основной consumer. Использует прямой доступ `s.layers`.
- `components/editor/canvas/ExpandOverlay.tsx`, `transformers.tsx`, `AssetLibraryModal.tsx`, `ai-chat/AIChatPanel.tsx`, `TemplatePanel.tsx` — все читают `useCanvasStore(s => s.layers)`.
- Вычисление derived state не завязано на `resizes[active].layerSnapshot` — всё идёт через `state.layers`.

### Reads `resizes[i].layerSnapshot`

- `useProjectSync.getCanvasStateForSave` (38-42) — сериализует для БД.
- `app/editor/[id]/page.tsx` (180-189) — template save.
- `app/templates/page.tsx` (303) — template save.
- `services/templateService.ts` (334-337) — применение content overrides.
- `components/wizard/WizardFlow.tsx` (286, 287, 639-645) — wizard читает snapshot всех форматов.
- `components/editor/ResizePanel.tsx`, `BindToMasterModal.tsx` — UI для форматов.
- `services/templateService.ts`, `api/template/[id]/route.ts`, `server/routers/template.ts` — сериализация шаблонов.
- `lib/figma/importWorker.ts:291` — импорт из Figma (создаёт snapshot).

---

## 3. Варианты и tradeoff-анализ

| Variant | Scope | Risk | Perf | Migration | Test effort |
|---|---|---|---|---|---|
| A — partial history + per-mutation sync + убрать switch-cascade | ~5 файлов, ~120 LOC | low | ≈0 | none (формат БД не меняется) | medium |
| B — single source of truth (удалить `state.layers`) | ~15 файлов, ~400-600 LOC | high — любой consumer сломается | -/+ зависит от memo | optional in-memory | high |
| C — derived через middleware `mutateActiveLayers` | ~10 файлов, ~200 LOC | medium — требует дисциплины у всех слайсов | ≈0 | none | medium |
| D (новый) — A + **дроп `layers` из `HistorySnapshot`** + **partial snapshots per format** | ~6 файлов, ~150 LOC | low-medium | ≈0 | none | medium |

### Детализация

**A**. «Минимально достаточный» патч:
- `snapshotState` сохраняет `resizes` целиком, но для неактивных форматов **отбрасывает** `layerSnapshot`. На restore — merge: `resizes[i].layerSnapshot` неактивных форматов берётся из **текущего** `state.resizes`, а не из `prev.resizes`.
- Каждая мутация `state.layers` обязана писать `resizes[active].layerSnapshot` тем же значением. Вводим `commitActiveLayers(state, newLayers)` helper, переписываем все точки.
- Блок 231-280 (cascade on switch) удаляется. `syncSnapshotFormats` оставляем (он — законная семантика bindings, см. §8 про ручные override как отдельную задачу).
- Плюсы: фокус на одном инварианте, минимальный blast radius, не ломает персист/консьюмеров.
- Минусы: требует проставить sync в ~15 местах (дисциплина). Если кто-то добавит новый мутатор `state.layers` и забудет sync — инвариант снова сломается. Митигация: pre-commit lint правило или wrapped API.

**B**. Полное removal `state.layers`. Правильно архитектурно, но:
- Нужно переписать ~6 компонентов-consumer'ов (Canvas.tsx и др.).
- Все мутации слайсов работают через `resizes[active].layerSnapshot` — везде длинные цепочки типа `state.resizes.map(r => r.id === state.activeResizeId ? { ...r, layerSnapshot: ... } : r)`.
- Перф: можно добавить `useActiveLayers()` селектор с `zustand/shallow`, но каждое touch триггерит переход через find(). На 1k-layer сцене риск регрессии.
- Риск регрессии на масштабе всего редактора — слишком большой для bug-fix milestone.
- Осталось бы: отдельная оптимизация / мега-рефакторинг на будущее.

**C**. Помогает ужесточить дисциплину через единую функцию-мутатор. Но не устраняет корневую причину (всё ещё две копии в стейте). По сути это А с лучшим DX. Тратим +80 LOC на обёртку, получаем чуть меньше дуплирования в слайсах. Приемлемо, но не решает главное.

**D (proposed)**. Суть — A + **дроп самого поля `layers` из `HistorySnapshot`**:
- `HistorySnapshot` теперь содержит только `{ resizes (без layerSnapshot неактивных), activeResizeId, selectedLayerIds, masterComponents, componentInstances, palette, artboardProps }`.
- На restore: `layers` **вычисляется** как `prev.resizes.find(r => r.id === prev.activeResizeId)?.layerSnapshot ?? []`. Это гарантирует инвариант by construction в history-слое (в «живом» стейте инвариант держит `commitActiveLayers`).
- Неактивные формат'ы сохраняют свой **live** `layerSnapshot` при undo — те правки, что были сделаны в других форматах и в активном формате *после* push, не теряются.
- Плюсы over A: невозможно снапшотом вернуть `layers` в состояние, отличное от `resizes[active].layerSnapshot` — два источника истины на уровне history схлопываются до одного.
- Минусы: требует миграции структуры `HistorySnapshot` (типы + undo/redo restore-логика). Но это in-memory only, формат persisted state не задет.

**D выигрывает**. А — необходимый минимум, но не закрывает 1.2 системно (инвариант держится только пока все мутации прошли через commitActiveLayers; history всё равно хранит «двойную правду»). D закрывает 1.2 конструктивно.

---

## 4. Выбранный вариант + обоснование

**Вариант D.**

Почему:
1. **Устраняет корневую причину 1.2** — history больше не хранит `layers` как независимое поле, разошедшееся с `resizes[active].layerSnapshot`. Невозможно через undo получить `state.layers ≠ resizes[active].layerSnapshot`.
2. **Минимальный scope** — ~6 файлов, типы и undo/redo. Никаких изменений в Canvas.tsx и прочих consumer'ах. Персист-формат остаётся прежним (useProjectSync сериализует текущий стейт, не HistorySnapshot).
3. **Никакой двусмысленности для контрибьютора** — новый мутатор, который забудет `commitActiveLayers`, сломает инвариант в живом стейте, но **не** сможет его сломать через undo. Это локализует будущие регрессии.
4. **Migration-free** — DB/wire формат не меняется. `HistorySnapshot` — внутренняя структура in-memory истории, её не видят ни сервер, ни URL, ни сериализация для шаблонов.
5. **Совместим с будущими улучшениями** (manual-override tracking для cascade — §8, per-format selection set, multi-user OT и т.п.) — потому что активный формат теперь имеет единственную каноническую запись в стейте.

Почему не другие:
- **A** — оставляет мину: новый разработчик может ошибиться и снова разнести history-слой. D делает это невозможным конструктивно.
- **B** — слишком широкий blast radius для bug-fix milestone. Нельзя оценить регрессии Canvas.tsx/transformers без отдельного перф-тестирования. Откладываем в бэклог как «MF-N: single source of truth».
- **C** — добавляет обёртку, но не лечит history-слой. Плюсы C включены в D (helper `commitActiveLayers`).

---

## 5. Invariants (контракт)

### I1. Active-layer mirror

```
∀ state after mutation:
  state.layers === state.resizes.find(r => r.id === state.activeResizeId)?.layerSnapshot
```

Где поддерживать: в `commitActiveLayers(set, get, newLayers, extra?)` helper'е в `createHistorySlice.ts` (или отдельно `canvas/helpers.ts`). Все мутации `state.layers` обязаны пройти через этот helper.

Исключения (явно):
- **I1-E1**: во время `useLoadCanvasState` (useProjectSync.ts:528-538) допустимо временное нарушение внутри одного `setState`. После set state консистентен потому, что `layers` и `resizes[i]` приходят из одного payload. Реализация: `setState` получает `{ layers, resizes, activeResizeId }` одним объектом и пост-проверяет инвариант (в dev — assert, в prod — warn + auto-heal).
- **I1-E2**: `resetCanvas`, `loadTemplatePack`, `applySmartResize` — сбрасывают/заменяют весь стейт атомарно. После них инвариант должен держаться.

Как тестировать: unit тест, пробегающий по **каждой** публичной экшен-функции стора, вызывающий её на базовом стейте и проверяющий I1 (см. §9, E5).

### I2. History snapshot shape

```
HistorySnapshot does NOT contain `layers`.
HistorySnapshot.resizes[i].layerSnapshot is present for ALL formats i.
```

Где поддерживать: в `snapshotState` (`createHistorySlice.ts`) и в типе `HistorySnapshot` (`types.ts`).

Замечание по объёму: раньше `snapshotState` хранил и `layers`, и `resizes[*].layerSnapshot` для активного формата — дублирование. Теперь хранит только `resizes[*].layerSnapshot`. Экономия памяти на active format, но мы хотим покрыть также неактивные, чтобы undo откатывал все форматы. Разумный компромисс: **полные snapshot'ы всех форматов** (как сейчас, минус `layers`), MAX_HISTORY=50.

Как тестировать: shape-тест (`HistorySnapshot` не имеет поля `layers` по типу).

### I3. Undo/redo атомарность

```
∀ history entry:
  после undo/redo state.layers === state.resizes[state.activeResizeId].layerSnapshot
```

Где поддерживать: `undo`/`redo` в `createHistorySlice.ts`. В одном `set()` восстанавливается `resizes`, `activeResizeId`, а `layers` — вычисляется из них.

Как тестировать: см. §9, E1-E3, E6.

### I4. Format meta vs format content

Metadata формата (id, width, height, name, label, isMaster, layerBindings, instancesEnabled) и content (`layerSnapshot`) — разные «оси». `snapshotState` должен фиксировать **обе** оси для всех форматов. Изменение ширины/высоты формата (resizeFormat) тоже должно попадать в историю — оно уже попадает, т.к. snapshot хранит полный `resizes[]`.

---

## 6. План изменений по файлам

### 6.1 `platform-app/src/store/canvas/types.ts`

- **Изменить `HistorySnapshot`**: удалить поле `layers: Layer[]`. Оставить `resizes: ResizeFormat[]` (все форматы с полным `layerSnapshot`).
  ```diff
   export interface HistorySnapshot {
  -    layers: Layer[];
       masterComponents: MasterComponent[];
       componentInstances: ComponentInstance[];
       selectedLayerIds: string[];
       palette: TemplatePalette;
       artboardProps: ArtboardProps;
       resizes: ResizeFormat[];
       activeResizeId: string;
   }
  ```
- Добавить JSDoc комментарий про инвариант I1 (с формулой).

### 6.2 `platform-app/src/store/canvas/createHistorySlice.ts`

- **`snapshotState`**: убрать копирование `state.layers` (его больше нет в типе). Перед сохранением гарантированно подтянуть `state.layers` в `resizes[active].layerSnapshot` — так мы фиксируем in-flight состояние, если вдруг какая-то мутация ещё не прошла через `commitActiveLayers`. Это «last-chance» reconcile:
  ```pseudocode
  function snapshotState(state): HistorySnapshot {
    const resizes = state.resizes.map(r =>
      r.id === state.activeResizeId
        ? { ...r, layerSnapshot: state.layers }
        : r
    );
    return {
      masterComponents, componentInstances, selectedLayerIds,
      palette, artboardProps, resizes, activeResizeId
    };
  }
  ```
- **`undo`**:
  ```pseudocode
  undo: () => {
    const state = get();
    if (state.history.length === 0) return;
    const prev = state.history[state.history.length - 1];
    const currentSnapshot = snapshotState(state);
    const activeResize = prev.resizes.find(r => r.id === prev.activeResizeId);
    const nextLayers = activeResize?.layerSnapshot ?? [];
    const nextCanvas = activeResize
      ? { canvasWidth: activeResize.width, canvasHeight: activeResize.height }
      : {};
    set({
      history: state.history.slice(0, -1),
      layers: nextLayers,
      masterComponents: prev.masterComponents,
      componentInstances: prev.componentInstances,
      selectedLayerIds: prev.selectedLayerIds,
      palette: prev.palette,
      artboardProps: prev.artboardProps,
      resizes: prev.resizes,
      activeResizeId: prev.activeResizeId,
      ...nextCanvas,
      future: [currentSnapshot, ...state.future].slice(0, MAX_HISTORY),
    });
  }
  ```
  Симметрично `redo`.
- Добавить экспорт нового helper'а `commitActiveLayers`:
  ```pseudocode
  export function commitActiveLayers(
    set: (partial: Partial<CanvasStore> | ((s: CanvasStore) => Partial<CanvasStore>)) => void,
    get: () => CanvasStore,
    nextLayers: Layer[],
    extra?: Partial<CanvasStore>,
  ): void {
    set((state) => ({
      layers: nextLayers,
      resizes: state.resizes.map(r =>
        r.id === state.activeResizeId
          ? { ...r, layerSnapshot: nextLayers }
          : r
      ),
      ...extra,
    }));
  }
  ```
  Замечание по взаимодействию с `syncSnapshotFormats`: сейчас `updateLayer` сам собирает `resizes` через `syncSnapshotFormats` (каскадит в bound-форматы). Этот путь **не заменяем** `commitActiveLayers` — `updateLayer` продолжает пользоваться полной функцией. `commitActiveLayers` — для всех остальных мутаций, где нет cascade-логики.

### 6.3 `platform-app/src/store/canvas/createLayerSlice.ts`

Для **каждой** мутации, которая сейчас делает `set({ layers: ... })`, заменить на `commitActiveLayers(set, get, newLayers, { ...extra })`:
- `addTextLayer` (194-201), `addRectangleLayer` (227-233), `addImageLayer` (262-268), `addBadgeLayer` (297-303), `addFrameLayer` (332-338)
- `removeLayer` (531-536)
- `deleteSelectedLayers` (587-593)
- `duplicateLayer` (670-675), `duplicateSelectedLayers` (760-765)
- `bringToFront` (778), `sendToBack` (790), `reorderLayers` (804), `reorderLayer` (845)
- `toggleLayerVisibility` (903), `toggleLayerLock` (909-911)
- `moveLayerToFrame` (876-877), `removeLayerFromFrame` (891-892)
- `pasteLayers` (1004-1009), `wrapInAutoLayoutFrame` (1118-1124)

`updateLayer` (343-501) — уже делает синк через `syncSnapshotFormats`, не трогаем. Единственное — проверить что возврат `{ layers: newLayers, resizes: syncedResizes, ... }` действительно гарантирует `newLayers === syncedResizes.find(r => r.id === activeResizeId).layerSnapshot`. Да, гарантирует (строки 118-122 в `syncSnapshotFormats`).

### 6.4 `platform-app/src/store/canvas/createComponentSlice.ts`

- `promoteToMaster` (41-47): заменить `set((s) => ({ layers: ..., masterComponents: ..., componentInstances: ... }))` на `commitActiveLayers(set, get, newLayers, { masterComponents, componentInstances })`.
- `updateMasterComponent` (100-104): аналогично, но внимательно — там return из set-callback включает `layers: newLayers`. Собирать updated resizes внутри того же set-колбэка (не через `commitActiveLayers`, потому что там `set((state) => ...)` уже используется). Вариант: inline логика `resizes: state.resizes.map(r => r.id === activeResizeId ? { ...r, layerSnapshot: newLayers } : r)`.

### 6.5 `platform-app/src/store/canvas/createSelectionSlice.ts`

- `alignSelectedLayers` (51-165) и `batchUpdateLayers` (168-226) обходят `pushSnapshot` — вручную формируют `HistorySnapshot` с полем `layers` (65, 173). Типовой `HistorySnapshot` меняется → TypeScript заставит починить. Переписать на:
  1. `pushSnapshot(set, get)` в начале (как в остальных action'ах).
  2. Финальный `set(...)` вернёт `{ layers: newLayers, resizes: resizes-с-обновлённым-layerSnapshot-active, ...без истории }`. Историю уже положили через pushSnapshot. Альтернативно — оставить inline-push, но без `layers` в snapshot.

### 6.6 `platform-app/src/store/canvas/createResizeSlice.ts`

- **Удалить блок 231-280** (cascade on switch). Комментарий над блоком: «// MF-6: removed — cascade now happens only on master edit via syncSnapshotFormats, and on explicit setFormatBindings».
- Удалить ненужные `console.log` диагностики в setActiveResize (184-190, 260-265, 275-277) или оставить behind dev-guard — на усмотрение.
- Проверить `syncLayersToResize` (283-349): сейчас пишет `set({ layers: applyAllAutoLayouts(...) })`. Переписать через `commitActiveLayers` — либо inline `resizes`-обновление.
- `setCanvasSize` (360-371) — не трогает layers, оставляем как есть.
- `setActiveResize` (172-281) после удаления блока 231-280 становится чище: save source + load target. Add post-set assertion (только в dev): `console.assert(get().layers === get().resizes.find(r=>r.id===get().activeResizeId)?.layerSnapshot)`.

### 6.7 `platform-app/src/store/canvas/createTemplateSlice.ts`

- `loadTemplatePack` (79-95): сейчас ставит `layers: initialLayers` и `resizes: finalResizes`. Нужно пост-синкать: `resizes[active].layerSnapshot = initialLayers`. Либо: после set вызвать `commitActiveLayers(set, get, get().layers)` — reconcile.
- `applySmartResize` (111-117): не меняет `layers`, оставляем.
- `resetCanvas` (15-33): выставляет пустой `resizes: [DEFAULT_RESIZE]`. DEFAULT_RESIZE без `layerSnapshot` — legacy path. После reset инвариант: `state.layers=[]`, `resizes[master].layerSnapshot=undefined`. Это исключение I1 — ОК, потому что legacy mode. На первом же switch инвариант восстановится (setActiveResize сконструирует `layerSnapshot`).

  Альтернатива: установить `resizes: [{ ...DEFAULT_RESIZE, layerSnapshot: [] }]` — тогда I1 держится сразу. **Предпочтительно** — делаем.

### 6.8 `platform-app/src/store/canvas/createPaletteSlice.ts`

Не меняем по сути, но учесть:
- `updateSwatch`/`removeSwatch`/`applyColorSwatchToLayer`/`applyBackgroundSwatchToImageLayer` касадят в `resizes[*].layerSnapshot` (включая активный). После их работы `resizes[active].layerSnapshot` != `state.layers` (потому что они мапят `layers` отдельно, а потом снапшоты отдельно — но семантически значения совпадают, т.к. оба применяют одну трансформацию к одинаковому layer'у).
- **Проверка**: в `updateSwatch`, строки 228 (layers) и 231-235 (resizes) — обе трансформации идемпотентны относительно друг друга на active formatе (cascadeLayers над одними и теми же слоями даёт один результат). Так что I1 держится.
- Аналогично для `removeSwatch` (330-360) и `applyColorSwatchToLayer` (480-485).
- **Добавить** post-set assert в dev-режиме (или тест E5) — гарантированно поймаем будущие регрессии, если кто-то сломает параллельную трансформацию.

### 6.9 `platform-app/src/hooks/useProjectSync.ts`

- `getCanvasStateForSave` (36-54) — **не менять**. Уже делает правильное: пересинкает `resizes[active].layerSnapshot = store.layers` перед сериализацией. С новой инвариантой это no-op (значения совпадают), но защитный код оставляем.
- `useLoadCanvasState` (466-554) — **не менять**. Формат загружаемых данных не изменился. Но добавить на строке 528-538 (перед `setState`) **защитное поле**: если загруженный `state.resizes` не содержит `layerSnapshot` для активного формата, построить его из `state.layers`:
  ```pseudocode
  const loadedResizes = (state.resizes ?? defaultResizes);
  const activeResize = loadedResizes.find(r => r.id === activeResizeId);
  const resizes = activeResize && activeResize.layerSnapshot === undefined
    ? loadedResizes.map(r => r.id === activeResizeId
        ? { ...r, layerSnapshot: state.layers as Layer[] }
        : r)
    : loadedResizes;
  ```
  Это покрывает старые проекты, где `layerSnapshot` активного формата — undefined (legacy мастер-формат), и новый код всё равно ожидает snapshot.

### 6.10 Суммарно

| Файл | LOC меняется |
|---|---|
| `types.ts` | ~5 (HistorySnapshot) |
| `createHistorySlice.ts` | ~40 (undo/redo/snapshotState/commitActiveLayers) |
| `createLayerSlice.ts` | ~40 (~15 вызовов `set({layers}) → commitActiveLayers`) |
| `createComponentSlice.ts` | ~10 |
| `createSelectionSlice.ts` | ~20 (inline snapshot → pushSnapshot + sync) |
| `createResizeSlice.ts` | ~50 (удалить блок 231-280, добавить assertions) |
| `createTemplateSlice.ts` | ~10 |
| `createPaletteSlice.ts` | 0 (только новые тесты) |
| `useProjectSync.ts` | ~8 (load-reconcile) |
| **Итого** | ~180 LOC |

Плюс тесты: ~150 LOC в новом файле `__tests__/canvasStore.mf6.test.ts`.

---

## 7. Migration / backward compat

### 7.1 Формат persisted state в БД

**Не меняется.** `saveState` принимает `canvasState: { layers, masterComponents, componentInstances, resizes, artboardProps, canvasWidth, canvasHeight, palette }`. Ровно то же самое и сохраняется после MF-6.

### 7.2 Проекты, уже в БД

Старые `canvasState` с возможно-рассинхроненным `state.layers ≠ resizes[active].layerSnapshot` — нужно heal-ить на load. См. §6.9 — патчим `useLoadCanvasState`. Никакой отдельной DB-миграции не нужно (чтение/запись идёт в `canvasState: Json`).

### 7.3 In-memory sessions после деплоя

Клиент перезагружает страницу → `useLoadCanvasState` пересобирает стейт из БД. История при этом очищается (она in-memory). В момент загрузки `history=[], future=[]`. Нет старых snapshot'ов с устаревшей формой `HistorySnapshot` — проблема миграции history отсутствует.

### 7.4 Template format

Шаблоны (`services/templateService.ts`, `server/routers/template.ts`, `lib/figma/importWorker.ts`) хранят `resizes[*].layerSnapshot`. Формат не задет. MF-6 не трогает template logic.

### 7.5 Нужно ли поле schema version

Нет. Изменения чисто in-memory. Персист-схема сохраняется. Если в будущем захотим подчистить — можно ввести `canvasState.schemaVersion`, но не в рамках MF-6.

### 7.6 Старые history-записи в рамках одной сессии

Если пользователь имел открытый редактор до деплоя, его клиент получит новый код при следующей загрузке страницы. История очищается вместе с `useLoadCanvasState`. Значит, нет риска получить `HistorySnapshot` старой формы в новом коде.

Но если деплой — hot-reload для активной сессии (без reload страницы) — нужен defensive code: `undo`/`redo` должны уметь прочитать старый `HistorySnapshot` с полем `layers`. Это крайний кейс. Простейшее решение: в начале `undo`/`redo` — если `prev.layers` определён, использовать его (legacy path), иначе — новый путь. Дополнительно 5 LOC, повышает безопасность.

---

## 8. Cascade fix (C2)

### 8.1 Что удаляем

Блок `setActiveResize` строки 231-280 (cascade on switch). Причины:
1. Дублирует работу `syncSnapshotFormats` (который уже применил cascade при правке мастера).
2. `prevMasterLayers` не передаётся, поэтому `relative_size` mode для image-layer не работает корректно.
3. Любой ручной override пользователя в target-формате гарантированно затирается каждый раз, когда пользователь просто «переключился посмотреть».

### 8.2 Что оставляем

- `syncSnapshotFormats` (`createLayerSlice.ts:84-155`) — каскадит при правке мастера. Это **основная** cascade-семантика. Срабатывает только если `activeResize.isMaster`.
- `setFormatBindings` (`createResizeSlice.ts:392-434`) — единовременный cascade при установке bindings. Это явное действие пользователя в UI («связать формат с мастером»), поэтому корректно.

### 8.3 Что оставляем на потом (не MF-6)

Проблема: `syncSnapshotFormats` всё ещё затирает ручные правки в bound-форматах при каждом `updateLayer` мастера. Варианты решения:

- **Вариант C2-a**: Явный opt-in — ввести `resizes[i].bindingEnabled: boolean`. По умолчанию true после установки bindings. Пользователь может тумблером выключить для конкретного формата.
- **Вариант C2-b**: Manual-override tracking — на каждом `updateLayer` в bound-формате записывать в `resizes[i].manualOverrides: { [layerId]: Set<propName> }` набор свойств, которые были изменены вручную. `applyCascade` игнорирует эти props.
- **Вариант C2-c**: Diff-merge — при cascade сравнивать текущий `layerSnapshot[i]` с «последним известным мастером» и сохранять diff. Сложно, overkill.

Рекомендация: **C2-a** как первый шаг (1-2 часа работы), **C2-b** как долгосрочный (плотно сплетён с UI «разблокировать поле»).

В рамках MF-6 делаем **только удаление блока 231-280**. Это закрывает худший кейс (потеря per-format правок при простом переключении). Каскад-на-правке-мастера (C2-a/b) — отдельный тикет **MF-7: Binding Override Protection**.

### 8.4 UX-предупреждение (опционально)

Если захотим UX-полировку в рамках MF-6: когда пользователь впервые редактирует bound-формат после того, как мастер тоже редактировался, показывать toast «У этого формата есть bindings — правки мастера могут их переопределить. Открыть настройки bindings?». Нет-блокер для MF-6, если тайминг плотный.

---

## 9. Тест-план

Файл: `platform-app/src/store/canvas/__tests__/canvasStore.mf6.test.ts` (новый).

Стиль — как в `__tests__/computeConstrainedPosition.test.ts` (vitest, `describe`/`it`).

### E0. Helper

Создать `createTestStore()` функцию, которая собирает Zustand store из `useCanvasStore` с чистым стартовым стейтом. Использовать `store.getState()`/`store.setState({...})` напрямую без React.

### E1. «undo восстанавливает формат без затирания других» (основной кейс пользователя)

```
it("undo после правки B не затирает ручные правки мастера", () => {
  // Setup: master + B format, B bound to master
  store.setActiveResize("master");
  store.addRectangleLayer({ id: "rect-1", fill: "#ff0000" });
  store.setActiveResize("B");
  store.addRectangleLayer({ id: "rect-2", fill: "#00ff00" });
  store.updateLayer("rect-2", { fill: "#0000ff" });  // edit in B

  store.undo(); // undo B edit (fill change)

  // После undo: в B видно старое значение fill
  expect(store.layers.find(l => l.id === "rect-2")?.fill).toBe("#00ff00");
  // Инвариант I1:
  expect(store.layers).toEqual(
    store.resizes.find(r => r.id === store.activeResizeId)?.layerSnapshot
  );
  // Мастеровский слой не задет
  const master = store.resizes.find(r => r.id === "master");
  expect(master?.layerSnapshot.find(l => l.id === "rect-1")?.fill).toBe("#ff0000");
});
```

### E2. «двойной undo с переключением форматов»

Сценарий: edit master → switch → edit B → switch → edit master → undo x2. Проверяем что промежуточные состояния каждого формата восстанавливаются в правильном порядке без cross-format затирания.

### E3. «cascade-on-switch не затирает ручные правки в bound-формате»

```
it("switch-back не применяет cascade заново", () => {
  // Setup master isMaster=true, B bound with syncStyle=true
  store.setActiveResize("master");
  store.updateLayer("shape", { fill: "#master-color" });
  store.setActiveResize("B");
  store.updateLayer("shape", { fill: "#b-manual-color" }); // manual override in B

  store.setActiveResize("master");
  store.setActiveResize("B");

  // Без MF-6: fill вернётся к "#master-color" (затёрся). С MF-6: остаётся "#b-manual-color".
  expect(store.layers.find(l => l.id === "shape")?.fill).toBe("#b-manual-color");
});
```

Важно: это тест на удаление блока 231-280. Правка `fill` через мастер при bound=syncStyle потом (в MF-7) всё равно затрёт ручную — но это отдельная задача.

### E4. «duplicate resize изолирует snapshot»

```
it("duplicateResize клонирует snapshot по значению, не по ссылке", () => {
  store.duplicateResize("master");
  const copyId = store.resizes[store.resizes.length - 1].id;
  expect(store.resizes.find(r => r.id === copyId)?.layerSnapshot)
    .not.toBe(store.layers); // не та же ссылка
  expect(store.resizes.find(r => r.id === copyId)?.layerSnapshot)
    .toEqual(store.layers); // но те же значения (глубоко)
  store.setActiveResize(copyId);
  store.updateLayer("rect-1", { fill: "#changed" });
  // Мастер не задет
  expect(store.resizes.find(r => r.id === "master")?.layerSnapshot
    .find(l => l.id === "rect-1")?.fill).toBe("#original");
});
```

### E5. «инвариант I1 держится после каждой публичной мутации»

```
describe("Invariant I1 after each mutation", () => {
  const MUTATIONS: Array<[string, (s: CanvasStore) => void]> = [
    ["addTextLayer", s => s.addTextLayer({})],
    ["addRectangleLayer", s => s.addRectangleLayer({})],
    ["addImageLayer", s => s.addImageLayer("https://...", 100, 100)],
    ["updateLayer", s => s.updateLayer(s.layers[0]?.id, { x: 10 })],
    ["removeLayer", s => s.removeLayer(s.layers[0]?.id)],
    ["duplicateLayer", s => s.duplicateLayer(s.layers[0]?.id)],
    ["reorderLayer", s => s.reorderLayer(s.layers[0]?.id, "up")],
    ["toggleLayerVisibility", s => s.toggleLayerVisibility(s.layers[0]?.id)],
    ["batchUpdateLayers", s => s.batchUpdateLayers([...])],
    ["alignSelectedLayers", s => s.alignSelectedLayers("left")],
    ["pasteLayers", s => s.pasteLayers([...])],
    ["wrapInAutoLayoutFrame", s => s.wrapInAutoLayoutFrame()],
    ["updateSwatch", s => s.updateSwatch("sw-1", { value: "#000" })],
    ["removeSwatch", s => s.removeSwatch("sw-1", "detach")],
    ["applyColorSwatchToLayer", s => s.applyColorSwatchToLayer("rect", "sw-1")],
    ["undo", s => s.undo()],
    ["redo", s => s.redo()],
    ["setActiveResize", s => s.setActiveResize("B")],
    ["duplicateResize", s => s.duplicateResize("master")],
    // ...и далее все публичные мутации
  ];
  MUTATIONS.forEach(([name, fn]) => {
    it(`${name} preserves I1`, () => {
      const store = setupBaseState();
      fn(store);
      expect(store.layers).toBe(
        store.resizes.find(r => r.id === store.activeResizeId)?.layerSnapshot
      ); // ===, а не toEqual — мы хотим ссылочное равенство, раз sync атомарный
    });
  });
});
```

### E6. «undo/redo stress — 3 формата, 10+ правок»

Генерация рандомной серии операций (50 шагов) с чередованием форматов + undo/redo. Проверка I1 после каждого шага. Этот тест ловит нерегрессию для широкого класса сценариев.

### E7. «load → mutate → save round-trip не теряет snapshot неактивных форматов»

```
it("save-load round-trip preserves per-format snapshots", async () => {
  // Setup state
  store.setActiveResize("master"); /* правки */
  store.setActiveResize("B"); /* правки */
  store.setActiveResize("master"); // вернулись на мастер

  const serialized = getCanvasStateForSave(store.getState());
  // Проверка: в serialized.resizes каждый формат имеет свой layerSnapshot
  expect(serialized.resizes.find(r => r.id === "B").layerSnapshot).toHaveLength(N);

  // Имитируем load:
  const freshStore = createTestStore();
  freshStore.setState({
    layers: serialized.layers,
    resizes: serialized.resizes,
    activeResizeId: "master",
    // ...
  });
  expect(freshStore.resizes.find(r => r.id === "B").layerSnapshot).toEqual(N-layers);
});
```

### E8 (бонус). «cascade-on-master-edit всё ещё работает»

Проверка, что удаление блока 231-280 не сломало штатную cascade-семантику: правим мастер → `resizes[B].layerSnapshot` получает cascade через `syncSnapshotFormats`. (Важно: после MF-7 этот тест может ослабеть, если введём manual-override.)

---

## 10. Risks / open questions

### 10.1 Риски

1. **Ссылочное равенство `layers === resizes[active].layerSnapshot`**. `commitActiveLayers` создаёт один и тот же `nextLayers` массив и присваивает его в оба поля. Если в дальнейшем мутация по невнимательности сделает `{ ...state, layers: [...state.layers] }` без обновления `resizes` — инвариант вернётся в «semantically equal, referentially different». Для E5 мы проверяем `toBe` (ссылочное), это поймает такую регрессию.
2. **`_updateHistoryTimer` throttle** в `updateLayer` (createLayerSlice.ts:26). Подсознательно: серия быстрых правок пушит один snapshot. Это взаимодействует с новой схемой history, но без отрицательных последствий — snapshot всё равно валиден (single truth через `resizes`).
3. **Legacy формат `layerSnapshot === undefined`** в `DEFAULT_RESIZE` (types.ts:135-142) и master-формате старых проектов. После MF-6 дефолтный мастер получит `layerSnapshot: []` в `resetCanvas` и в `useLoadCanvasState`. Проверить что не ломает logic ветки `isTargetSnapshotBased = targetResize.layerSnapshot !== undefined` (createResizeSlice.ts:203) — после MF-6 она всегда true на свежем стейте, legacy ветка станет недоступной в новых сессиях. **Open question**: сохраняем ли её? Предлагаю оставить код legacy-ветки (она триггерится если БД вернёт проект совсем без snapshot'ов).
4. **Каскад палитры** (createPaletteSlice) независимо от active format пишет в `resizes[*].layerSnapshot`. После MF-6 это всё ещё работает, но нужно гарантировать что cascaded `layerSnapshot` для active format совпадает с обновлённым `state.layers`. Добавить assert в dev + покрыть в E5.
5. **`syncLayersToResize` в legacy пути**. Вызывается в `loadTemplatePack` и `setActiveResize` для legacy форматов. Пишет `layers`, не трогая `resizes[active].layerSnapshot`. Нужно привести к `commitActiveLayers` (см. §6.6).
6. **Batch/align slice** (createSelectionSlice) имеет собственный pushSnapshot inline. После MF-6 это должно быть унифицировано с `pushSnapshot`-helper'ом, иначе мы получим две разные реализации (оставленная inline — c устаревшим полем `layers`).

### 10.2 Open questions к оркестратору

1. **`syncSnapshotFormats` в MF-6 или MF-7?** Сейчас предлагаю оставить в MF-6 без изменений — каскад на master-edit не противоречит ядру I1, но сохраняет поведение «мастер перекрывает B при каждой правке». Если пользователь воспринимает это тоже как баг — нужно включить в MF-6 минимум флаг opt-out. **Рекомендую: оставить в MF-7**, ограничить MF-6 удалением 231-280.
2. **`state.activeResizeId` при загрузке**. `useLoadCanvasState` устанавливает активным либо `isMaster`, либо `"master"`, либо первый. После MF-6 ожидается, что у этого формата гарантированно есть `layerSnapshot`. Если по ошибке активным становится legacy-формат без snapshot'а (редко, но), будет `state.layers = [...]` из БД, `resizes[active].layerSnapshot = undefined` → I1 не держится. Фикс в §6.9 решает (синк при load). **Подтвердить, что heal-on-load приемлем**.
3. **Удалять ли debug `console.log` в `setActiveResize` (184-190, 260-265)?** Они информативные для диагностики cascade. Рекомендую обернуть в `if (process.env.NODE_ENV !== "production")`.
4. **Порядок деплоя**. Требуется ли совместимость с старыми вкладками во время rollout? Если да — добавляем в `undo`/`redo` legacy-branch для snapshots с полем `layers` (5 LOC, §7.6). Рекомендую: да, дешево, страхует.
5. **AI-сервисы, которые трогают `state.layers` вне стора** (`AIChatPanel`, `ExpandOverlay`, `imageUpload.migrateImagesToS3Map`) — нужно ли их аудировать отдельно? Из grep (п. 2) все read-only на `s.layers`. Записей нет. Подтвердить — не часть MF-6.

### 10.3 Не-факты (need verification)

- В `useProjectSync` строка 234-239 — прямой `useCanvasStore.setState((state) => ({ layers: newLayers }))` при S3 migration. Это ещё один writer `state.layers` без `commitActiveLayers`. Нужно включить в §6.9 патч: `{ layers: newLayers, resizes: state.resizes.map(r => r.id === state.activeResizeId ? { ...r, layerSnapshot: newLayers } : r) }`.
- `page.tsx:1042-1043` и `WizardFlow.tsx:639-645` — пишут в `r.layerSnapshot` напрямую через mutable presumed-immutability. Проверить, что после MF-6 эти writers не обходят I1 для active format'а (если это активный — должны одновременно обновить `store.layers`).

---

## Appendix A. Доказательство, что баг пользователя перестаёт воспроизводиться

**Сценарий пользователя**:
1. Мастер, правки → `state.layers = L_m1`, `resizes[m].layerSnapshot = L_m1` (через `commitActiveLayers`).
2. Switch → B. `setActiveResize` сохраняет `resizes[m] = L_m1` (no-op) и загружает `state.layers = resizes[B].layerSnapshot = L_B0`.
3. Правки в B → `state.layers = L_B1`, `resizes[B].layerSnapshot = L_B1`. `updateLayer` через `syncSnapshotFormats`.
4. Undo. Pop prev snapshot `snapB = { resizes: [{m:L_m1},{B:L_B0},...], activeResizeId:B, ... }`. Вычисляем `nextLayers = prev.resizes.find(r=>r.id===prev.activeResizeId).layerSnapshot = L_B0`. Set: `{ layers:L_B0, resizes: prev.resizes, activeResizeId: B }`. Состояние: `{ layers:L_B0, resizes[m]:L_m1, resizes[B]:L_B0, active:B }`. **I1 держится**. Мастер нетронут.
5. Switch → master. `setActiveResize`: сохраняет `resizes[B] = L_B0` (no-op), загружает `layers = resizes[m] = L_m1`. **Мастер = L_m1, как и был**. Баг «затёр мастер данными B» невозможен, потому что master snapshot никогда не принимал значение `L_B*`.

Обратный сценарий (undo на master, потом switch на B):
1-2. Master, `L_m0 → L_m1`. Switch → B. Switch → master.
3. Undo master edit. Pop `snapM = { resizes:[{m:L_m0},{B:L_B0}], activeResizeId:m }`. `nextLayers = L_m0`. Set: `{ layers:L_m0, resizes:..., active:m }`. **B snapshot остался L_B0 (каким и был в snapM)**.
4. Switch → B. Load `resizes[B].layerSnapshot = L_B0`. Без MF-6 блока 231-280 cascade не запускается → `L_B0` остаётся как есть. **B не перезаписан master-данными**.

Оба направления бага закрыты.

---

_Конец документа._
