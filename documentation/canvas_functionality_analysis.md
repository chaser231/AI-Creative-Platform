# AI Creative Platform — Анализ функциональности канваса

> Статус документа: инженерный разбор текущего состояния канваса.
> Метод: `код сейчас + docs`, с приоритетом кода как источника истины.
> Дата анализа: 2026-04-08.

---

## 1. Как читать этот документ

В документе используются три уровня достоверности:

- **Реализовано в коде**: подтверждено текущими компонентами, store, сервисами и API.
- **Описано в docs / запланировано**: заявлено в `PRODUCT.md`, `ARCHITECTURE.md`, `functional_documentation.md`, но не всегда полностью подтверждено кодом.
- **Расхождения и пробелы**: места, где docs и реализация не совпадают, либо фича реализована частично.

### Основные источники

Ключевые файлы, на которых основан анализ:

- `platform-app/src/app/editor/[id]/page.tsx`
- `platform-app/src/components/editor/canvas/Canvas.tsx`
- `platform-app/src/components/editor/Toolbar.tsx`
- `platform-app/src/components/editor/LayersPanel.tsx`
- `platform-app/src/components/editor/properties/*`
- `platform-app/src/components/editor/AIPromptBar.tsx`
- `platform-app/src/components/editor/ai-chat/AIChatPanel.tsx`
- `platform-app/src/components/wizard/WizardFlow.tsx`
- `platform-app/src/components/wizard/blocks/ImageEditorModal.tsx`
- `platform-app/src/store/canvas/*`
- `platform-app/src/services/snapService.ts`
- `platform-app/src/services/smartResizeService.ts`
- `platform-app/src/services/templateService.ts`
- `platform-app/src/services/slotMappingService.ts`
- `platform-app/src/server/actionRegistry.ts`
- `platform-app/src/server/agent/*`
- `platform-app/PRODUCT.md`
- `platform-app/ARCHITECTURE.md`
- `functional_documentation.md`

---

## 2. Общая карта канваса

## 2.1 Роль канваса в продукте

### Реализовано в коде

Редактор проекта делится на два режима:

- **Wizard / Мастер**: пошаговая работа с шаблоном, динамическими полями и предпросмотром.
- **Studio / Студия**: полноценный визуальный редактор с канвасом, слоями, свойствами, форматами, AI и экспортом.

Переход между режимами происходит прямо в `editor/[id]` через переключатель в верхней панели.

### Описано в docs / запланировано

Docs описывают ту же двухрежимную модель:

- Wizard для быстрого старта.
- Studio для ручной доработки.

### Расхождения и пробелы

- Docs подают Wizard как полноценный сценарий автогенерации контента через AI, что частично подтверждено кодом.
- Studio реализована значительно подробнее и является фактическим центром функциональности канваса.

## 2.2 Состав интерфейса редактора

### Реализовано в коде

Страница редактора включает:

- **TopBar**
  - название проекта с inline rename
  - статус проекта
  - undo/redo
  - переключатель Wizard / Studio
  - кнопки: ассеты, версии, поделиться, экспорт
- **Canvas**
  - сам холст на `Konva.Stage`
  - артборд
  - слои
  - snap guides
  - selection transformer
  - inline text editor
- **LayersPanel**
- **PropertiesPanel**
- **Toolbar**
- **ResizePanel**
- **AIPromptBar**
- **AIChatPanel**
- **TemplatePanel**
- **VersionHistoryPanel**
- **AssetLibraryModal**
- **Help / hotkeys**
- **Project settings**

### Описано в docs / запланировано

Docs заявляют примерно тот же состав: канвас, слои, свойства, шаблоны, форматы, AI-чат, AI prompt bar, экспорт, версии.

### Расхождения и пробелы

- В docs панель слоёв описана как место для блокировки, а в текущем row UI есть только visibility и delete; lock доступен через контекстное меню.
- В docs экспорт подаётся шире, чем фактический функционал UI.

---

## 3. Функциональность канваса по подсистемам

## 3.1 Объектная модель канваса

### Реализовано в коде

Канвас работает с пятью типами слоёв:

1. `text`
2. `rectangle`
3. `image`
4. `badge`
5. `frame`

Каждый слой имеет базовые поля:

| Поле | Назначение |
|------|------------|
| `id` | идентификатор слоя |
| `type` | тип слоя |
| `name` | имя для UI и слоёв |
| `x`, `y` | позиция |
| `width`, `height` | размер |
| `rotation` | угол |
| `visible` | видимость |
| `locked` | блокировка |
| `opacity` | непрозрачность |
| `masterId` | связь с master component |
| `constraints` | поведение при resize |
| `slotId` | роль в шаблоне |
| `layoutSizingWidth`, `layoutSizingHeight` | sizing внутри auto-layout |
| `isAbsolutePositioned` | абсолютное позиционирование в auto-layout |
| `detachedSizeSync` | отвязка size sync для image instance |

Дополнительно существует master/instance модель:

- **MasterComponent**: источник истины по контенту.
- **ComponentInstance**: локальная версия для конкретного resize.
- При переключении на resize слой на холсте синхронизируется с instance.
- Для content-source свойств значение каскадирует из master в instance.

### Content-source свойства по типам

| Тип | Каскадируют из master |
|-----|------------------------|
| `text` | `text` |
| `image` | `src`, `width`, `height`, `objectFit` |
| `badge` | `label` |
| `rectangle` | ничего |
| `frame` | ничего |

### Описано в docs / запланировано

Docs и архитектура описывают ту же master/instance модель и multi-format логику.

### Расхождения и пробелы

- Docs подают master/instance как полностью зрелую систему для всех сценариев; в коде она реально работает, но часть UI вокруг неё всё ещё довольно инженерная и не полностью productized.

## 3.2 Типы слоёв и их свойства

### Реализовано в коде

#### `text`

| Группа | Свойства |
|--------|----------|
| Контент | `text` |
| Типографика | `fontSize`, `fontFamily`, `fontWeight`, `letterSpacing`, `lineHeight` |
| Цвет и видимость | `fill`, `fillEnabled`, `opacity` |
| Выравнивание | `align` |
| Контейнер | `textAdjust = auto_width / auto_height / fixed` |
| Поведение текста | `truncateText`, `verticalTrim`, `textTransform = none / uppercase / lowercase` |

Особенности поведения:

- Двойной клик открывает inline editor поверх canvas.
- `auto_width` рендерится без wrap.
- `fixed` может использовать `ellipsis`.

#### `rectangle`

| Группа | Свойства |
|--------|----------|
| Fill | `fill`, `fillEnabled` |
| Stroke | `stroke`, `strokeEnabled`, `strokeWidth` |
| Geometry | `cornerRadius`, `opacity` |

#### `image`

| Группа | Свойства |
|--------|----------|
| Source | `src` |
| Отображение | `objectFit = cover / contain / fill / crop` |
| Geometry | `width`, `height`, `opacity` |
| Resize sync | `detachedSizeSync` для instances |

Особенности поведения:

- Изображение рендерится через `computeImageFitProps`.
- `contain` и `crop` рисуются в клипнутой группе.

#### `badge`

| Группа | Свойства |
|--------|----------|
| Контент | `label` |
| Форма | `shape = pill / rectangle / circle` |
| Цвета | `fill`, `fillEnabled`, `textColor` |
| Типографика | `fontSize` |
| Geometry | `opacity` |

#### `frame`

| Группа | Свойства |
|--------|----------|
| Fill / Stroke | `fill`, `fillEnabled`, `stroke`, `strokeEnabled`, `strokeWidth` |
| Geometry | `cornerRadius`, `clipContent`, `opacity` |
| Вложенность | `childIds` |
| Auto-layout | `layoutMode = none / horizontal / vertical` |
| Отступы | `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`, `spacing` |
| Alignment | `primaryAxisAlignItems`, `counterAxisAlignItems` |
| Container sizing | `primaryAxisSizingMode`, `counterAxisSizingMode` |
| AI grouping | `groupSlotId` |

### Описано в docs / запланировано

`functional_documentation.md` в целом совпадает с текущим перечнем объектов и их свойств.

### Расхождения и пробелы

- Docs говорят про “логотип” и “главное фото” как slot roles, но это не отдельные типы объектов, а значения `slotId`.
- В docs “размер в авто-лейауте” звучит как универсальная UI-концепция; в коде это реализовано через отдельные поля layer sizing и ограничено контекстом frame auto-layout.

## 3.3 Инструменты канваса

### Реализовано в коде

Текущие инструменты тулбара:

| Инструмент | Как запускается | Что делает | Параметры / поведение |
|------------|------------------|------------|------------------------|
| `select` | клик по иконке `MousePointer2` | переводит редактор в режим выделения | очищает selection |
| `text` | клик по иконке `Type` | сразу создаёт текстовый слой | default: `Text`, `48px`, `Inter`, `600`, `auto_width`, `x=100`, `y=100` |
| `rectangle` | клик по иконке `Square` | сразу создаёт rectangle | default: `200x200`, fill `#E5E7EB` |
| `frame` | клик по иконке `SquareDashed` | сразу создаёт frame | default: `400x300`, white fill, gray stroke, `clipContent=true` |
| `badge` | клик по иконке `Award` | сразу создаёт badge | default: label `NEW`, pill, `120x36` |
| `image` | клик по иконке `ImagePlus` | открывает file picker, затем добавляет image | изображение сжимается, вставляется с max dimension `500` |
| `templates` | кнопка `LayoutTemplate` | открывает `TemplatePanel` | не инструмент рисования, а entrypoint в шаблоны |
| `AI` | кнопка `Sparkles` | открывает `AIPromptBar` | entrypoint в AI-потоки |
| `snapping` | кнопка `Magnet` | открывает настройки snap | object/artboard/pixel/grid snap, grid size |

### Важное поведение

- Инструменты создания не работают как “нажми и нарисуй”.
- Все create-tools в текущем UI работают как **instant insert**.
- После добавления слоя active tool сбрасывается в `select`.

### Настройки snapping

| Настройка | Что делает |
|-----------|------------|
| `objectSnap` | привязка к объектам |
| `artboardSnap` | привязка к краям и центру артборда |
| `pixelSnap` | округление до пикселя |
| `gridSnap` | привязка к сетке |
| `gridSize` | шаг сетки: `1 / 4 / 8 / 16 / 32 px` |

### Описано в docs / запланировано

Docs описывают тот же набор базовых инструментов.

### Расхождения и пробелы

- В docs инструментальная модель читается как более “десктопная”, но в коде нет draw-by-drag для shape/text/frame.
- В коде есть `activeTool`, но реальное поведение инструмента сегодня в основном выражается через instant layer creation.

## 3.4 Панель слоёв

### Реализовано в коде

`LayersPanel` поддерживает:

- древовидное отображение frame hierarchy
- раскрытие / сворачивание frame children
- selection
- multi-selection через `ctrl/cmd/shift`
- inline rename по double click
- visibility toggle
- delete
- drag-and-drop между слоями
- drop внутрь frame
- контекстное меню для single и multi selection

### Как работает drag-and-drop слоёв

- Drag слоя в панели сохраняет `draggedLayerId`.
- Drop на frame приводит к `moveLayerToFrame`.
- Если слой уже был в другом frame, он удаляется из старого parent.
- Для auto-layout frame drop position влияет на `dropIndex`.

### Контекстное меню

Для single layer доступны:

- duplicate
- remove
- bring to front
- send to back
- toggle visibility
- toggle lock
- export layer

Для multi-selection доступны:

- duplicate all
- remove all
- export all

### Описано в docs / запланировано

Docs заявляют rename, hide, lock, reorder по иерархии.

### Расхождения и пробелы

- Кнопки lock на row нет; блокировка доступна через context menu.
- Визуальный row UI не показывает reorder arrows; reorder делается DnD и клавиатурой в auto-layout кейсах.

## 3.5 Панель свойств

### Реализовано в коде

#### Состояния панели

- **Нет выделения**: показываются свойства артборда.
- **Один слой**: показываются общие и type-specific свойства.
- **Несколько слоёв**: панель показывает только count, без массового редактирования свойств.

#### Свойства артборда

| Свойство | Что делает |
|----------|------------|
| `fill` | фон артборда |
| `cornerRadius` | скругление артборда |
| `stroke`, `strokeWidth` | обводка |
| `clipContent` | обрезка содержимого по границам артборда |

#### Общие свойства выделенного слоя

| Группа | Свойства |
|--------|----------|
| Alignment | выравнивание по left / center / right / top / middle / bottom |
| Position | `x`, `y`, `rotation` |
| Size | `width`, `height` |
| Constraints | horizontal / vertical constraints |
| Slot | `slotId` |

#### Дополнительные общие свойства в отдельных контекстах

- Для image instance вне master:
  - toggle “Привязка размера к мастеру” через `detachedSizeSync`
- Для child внутри auto-layout frame:
  - `layoutSizingWidth`
  - `layoutSizingHeight`
  - `isAbsolutePositioned`
- Для frame:
  - `groupSlotId`

#### Type-specific UI

- `TextPropsGrouped`
- `RectPropsGrouped`
- `BadgePropsGrouped`
- `ImagePropsInline`
- `FramePropsGrouped`

### Text properties UI

- font family
- custom font upload (`.ttf`, `.otf`, `.woff`, `.woff2`)
- weight
- font size
- letter spacing
- line height
- container mode
- truncate text
- vertical trim
- text color on/off
- align left/center/right
- uppercase toggle
- opacity

### Rectangle properties UI

- opacity
- fill on/off
- stroke on/off
- corner radius

### Badge properties UI

- label
- shape
- opacity
- fill on/off
- text color

### Image properties UI

- replace source from file
- `objectFit` mode:
  - `cover`
  - `contain`
  - `fill`
  - `crop`

### Frame properties UI

- auto-layout mode
- symmetric vertical/horizontal paddings
- spacing
- primary axis align
- counter axis align
- main/cross sizing mode
- opacity
- fill on/off
- stroke on/off
- corner radius
- `clipContent`

### Описано в docs / запланировано

Docs корректно отражают основную идею panel-driven editing.

### Расхождения и пробелы

- Массового редактирования нескольких объектов через PropertiesPanel сейчас нет.
- В docs свойства подаются более “продуктово”, а в коде часть controls всё ещё довольно низкоуровневая.

## 3.6 Форматы и resize

### Реализовано в коде

Resize subsystem поддерживает:

- обязательный resize `master`
- пользовательские дополнительные resize
- переключение active resize
- rename resize
- remove resize
- toggle instance mode (`instancesEnabled`)
- sync canvas layers to active resize
- smart resize по шаблону и slot mapping

#### Что такое `master`

- `master` всегда является источником правды.
- При переключении обратно на `master` layers собираются из `masterComponents`.
- При переключении на другой resize layers собираются из `componentInstances`.

#### Как работает instance mode

`instancesEnabled = true`:

- контентные поля берутся из master
- layout остаётся локальным для resize

`instancesEnabled = false`:

- instance перестаёт получать content cascade от master

#### Добавление формата

Текущий `ResizePanel` позволяет добавить **кастомный формат**:

- имя
- width
- height

При добавлении для каждого master автоматически создаётся instance:

- если у master есть `slotId`, используется layout engine
- иначе применяется `constraints`

#### Smart Resize

Smart resize работает так:

1. Пользователь открывает `TemplatePanel`.
2. Выбирает шаблон.
3. Может запустить `SlotMappingModal`.
4. `autoMap()` пытается сопоставить masters:
   - exact `slotId + type`
   - same type + similar name
   - same type fallback
5. `generateSmartResizes()` создаёт новые instances для всех target resizes шаблона.
6. В новые instances переносится:
   - layout из template resize
   - content из текущих masters

### Поддерживаемые слот-роли

- `headline`
- `subhead`
- `cta`
- `background`
- `image-primary`
- `logo`
- `none`

### Описано в docs / запланировано

Docs обещают широкий multi-format сценарий с preset formats вроде Instagram, Facebook, баннеры IAB, Full HD.

### Расхождения и пробелы

- В коде есть `PRESET_FORMATS`, но текущий `ResizePanel` не даёт выбрать готовый preset из списка; он добавляет только custom size вручную.
- Docs формулируют Smart Resize как user-facing feature “из коробки”; в коде он уже есть, но UX по-прежнему технический и опирается на slot mapping.

## 3.7 Взаимодействия на холсте

### Реализовано в коде

#### Selection

- click по layer выбирает слой
- `shift` добавляет/убирает слой из selection
- marquee selection по пустому месту
- `Escape` снимает выделение

#### Deep select внутри frame

Поведение по умолчанию:

- click по child внутри frame выбирает сам frame

Deep-select включается, если:

- удерживать `cmd/ctrl`
- или сделать special double click по нетекстовому child

#### Inline text editing

- double click по text layer
- появляется HTML `textarea` поверх канваса
- `Enter` подтверждает
- `Escape` отменяет
- `blur` коммитит

#### Drag & drop на canvas

- можно тащить один или несколько выбранных слоёв
- при drag работают snap guides, spacing guides и Alt-distance measurement
- если слой брошен в frame, он становится child
- если drop вне frame, layer удаляется из parent frame

Для auto-layout frame:

- drop index рассчитывается по позиции относительно siblings

#### Resize / transform

- работает через Konva Transformer
- при transform происходит live edge snapping
- на end:
  - scale сбрасывается в width/height
  - rotation и new bounds записываются в store

Для frame без auto-layout:

- resize frame пересчитывает children через `computeConstrainedPosition`

#### Marquee selection

- drag по пустому месту stage создаёт selection box
- все видимые и незалоченные слои, пересекающие box, добавляются в selection
- clip bounds frame/artboard учитываются

#### Clipping

Клики и selection блокируются, если pointer находится:

- за пределами `clipContent` артборда
- за пределами `clipContent` родительского frame

#### Pan / zoom

- `Space` временно включает panning
- wheel без `ctrl` панит stage
- `ctrl + wheel` масштабирует относительно pointer
- zoom ограничен диапазоном `0.1 ... 3`

#### Distance measurement

- `Alt` показывает расстояния
- если курсор над объектом: расстояния до hovered object
- иначе: расстояния до краёв артборда

#### File drag-and-drop

- drag image file over canvas
- файл сжимается
- добавляется как image layer

#### Keyboard shortcuts

| Комбинация | Действие |
|------------|----------|
| `Cmd/Ctrl + Z` | undo |
| `Cmd/Ctrl + Shift + Z` | redo |
| `Cmd/Ctrl + D` | duplicate selected |
| `Delete` / `Backspace` | delete selected |
| `Escape` | clear selection |
| `Arrow keys` | nudge на `1px` |
| `Shift + Arrow keys` | nudge на `10px` |

Особенность для auto-layout children:

- стрелки могут не просто двигать слой, а менять порядок внутри frame через `reorderLayer`

#### Context menu на canvas

- right click по selected area может открыть multi-selection menu
- right click по layer:
  - duplicate
  - remove
  - bring to front
  - send to back
  - toggle visibility
  - toggle lock
  - export

### Описано в docs / запланировано

Docs заявляют snap, контекстное меню, nested frames, auto-layout, keyboard-driven editing.

### Расхождения и пробелы

- Docs не акцентируют clip-bound blocking, а в коде это важная часть реального поведения.
- Selection и deep-select логика сейчас достаточно сложная и ближе к Figma-подобной модели, чем это видно из продуктового описания.

## 3.8 AI-подсистема канваса

### Реализовано в коде

AI в редакторе делится на три слоя:

1. **AIPromptBar**: быстрые генерации.
2. **ImageEditorModal**: AI-редактирование выбранной картинки.
3. **AIChatPanel**: агентный чат с планом и canvas actions.

### 3.8.1 AIPromptBar

Поддерживает:

- генерацию текста
- генерацию изображения
- открытие AI image editor для выбранного image layer
- apply-to-selection
- выбор модели
- выбор aspect ratio
- выбор resolution
- reference images для vision-capable моделей
- style presets

#### Текстовые модели

| Модель | Название |
|--------|----------|
| `deepseek` | DeepSeek V3 |
| `gemini-flash` | Gemini 2.5 Flash |

#### Модели генерации изображений

| Модель | Название |
|--------|----------|
| `nano-banana-2` | Nano Banana 2 |
| `nano-banana-pro` | Nano Banana Pro |
| `nano-banana` | Nano Banana |
| `flux-2-pro` | Flux 2 Pro |
| `seedream` | Seedream 4.5 |
| `gpt-image` | GPT Image 1.5 |
| `qwen-image` | Qwen Image |
| `flux-schnell` | Flux Schnell |
| `flux-dev` | Flux Dev |
| `flux-1.1-pro` | Flux 1.1 Pro |
| `dall-e-3` | DALL-E 3 |

#### Выходы prompt bar

- Если `applyToSelection=false`:
  - text result создаёт новый text layer
  - image result создаёт новый image layer
- Если `applyToSelection=true`:
  - обновляется первый выбранный слой
  - для text обновляется `text`
  - для image обновляется `src`

#### Ограничения и особенности

- `applyToSelection` работает только с первым выбранным слоем.
- Обновление image делается без строгой проверки типа слоя.
- Генерация изображений сразу пытается сохранить результат в S3.

### 3.8.2 ImageEditorModal

Доступен только когда выбран `image` слой.

Инструменты:

| Инструмент | Что делает |
|------------|------------|
| `remove-bg` | удаление фона |
| `inpaint` | маска кистью + prompt |
| `text-edit` | редактирование картинки текстовым описанием |
| `outpaint` | расширение изображения до нового формата |

#### Модели AI-редактирования

| Модель | Поддерживаемые операции |
|--------|--------------------------|
| `nano-banana-2` | remove-bg, inpaint, text-edit |
| `nano-banana-pro` | remove-bg, inpaint, text-edit |
| `nano-banana` | remove-bg, inpaint, text-edit |
| `flux-2-pro` | remove-bg, text-edit |
| `seedream` | remove-bg, text-edit |
| `gpt-image` | remove-bg, text-edit |
| `qwen-image-edit` | remove-bg, text-edit |
| `flux-fill` | remove-bg, inpaint |
| `bria-expand` | outpaint |

#### Важные детали реализации

- `remove-bg` фактически всегда вызывает `rembg`, независимо от выбранной edit-model.
- `inpaint` использует `flux-fill` или совместимую модель через mask.
- `text-edit`:
  - если модель поддерживает `edit`, выполняется нативное image editing
  - иначе fallback в генерацию изображения
- `outpaint` умеет два режима:
  - ratio mode
  - padding mode
- Для padding mode создаётся expanded canvas и mask, после чего запускается inpaint через `flux-fill`.

### 3.8.3 AIChatPanel

AI chat поддерживает:

- ввод natural language запроса
- reference images
- план шагов
- ответы в виде text/image
- template choices
- fallback actions
- preset choices
- text variants
- add to canvas

#### Canvas actions, которые чат умеет исполнять на клиенте

| Canvas action | Что делает |
|---------------|------------|
| `add_text` | создаёт text layer |
| `add_image` | создаёт image layer |
| `load_template` | загружает template pack в canvas |
| `update_layer` | обновляет слой по `slotId` / master relation |

#### Action registry текущего AI-агента

| Action id | Назначение |
|-----------|------------|
| `generate_headline` | короткий заголовок |
| `generate_subtitle` | подзаголовок |
| `generate_image` | изображение |
| `place_on_canvas` | разложить результат на canvas |
| `search_templates` | поиск шаблонов |
| `apply_and_fill_template` | применить и заполнить шаблон |
| `create_project` | создать проект |
| `search_style_presets` | предложить style presets |

#### Как работает orchestration

1. Пользователь пишет запрос.
2. При наличии reference images запускается `visionAnalyzer`.
3. `orchestrator` строит tool plan.
4. `executeAction` исполняет шаги последовательно.
5. Клиент получает:
   - `textResponse`
   - `plan.steps`
   - `canvasActions`
6. Панель добавляет сообщения в UI и при необходимости меняет canvas.

#### Persistence

- AI messages хранятся через `useAISessionSync`.
- Ephemeral сообщения типа plan/template choices не сохраняются в БД.
- Для завершённых платных AI-шагов учитывается примерная стоимость.

### 3.8.4 Реестр моделей и capabilities

В `ai-models.ts` модели описываются capability-first.

Основные caps:

- `generate`
- `edit`
- `remove-bg`
- `inpaint`
- `outpaint`
- `text`
- `vision`

Для image models в реестре также задаются:

- `maxRefs`
- `aspectRatios`
- `resolutions`
- `costPerRun`

### Описано в docs / запланировано

Docs заявляют:

- text generation
- image generation
- image editing
- AI chat / agent
- brand-aware prompting

### Расхождения и пробелы

- Product docs упоминают провайдеры вроде Yandex GPT, OpenAI GPT-4o, Flux, SDXL, DALL-E. В текущем UI-реестре основной акцент уже смещён на `Nano Banana`, `Flux 2 Pro`, `Seedream`, `GPT Image`, `Qwen`.
- Docs обещают “AI agent с доступом к канвасу”, но текущий action registry ограничен генерацией, шаблонами и базовыми canvas instructions; полноценного произвольного редактирования холста через агент пока не видно.
- В `AIPromptBar` есть состояние `outpaint`, но в текущем UI этот режим не вынесен как отдельная tab; outpaint фактически доступен через `ImageEditorModal`.

## 3.9 Шаблоны

### Реализовано в коде

`TemplatePanel` поддерживает:

- просмотр backend templates + local templates
- два режима каталога:
  - `single`
  - `pack`
- импорт шаблона из JSON
- экспорт шаблона в JSON
- сохранение текущего canvas как template
- сохранение как single template
- сохранение как pack
- destructive apply template
- smart resize apply template

#### Формат template pack

Template pack содержит:

- `masterComponents`
- `componentInstances`
- `resizes`
- `layerTree`
- metadata (в v2)

#### Hydration / apply

При apply template:

- template гидратируется
- master IDs и layer IDs регенерируются
- если есть `layerTree`, сохраняется frame nesting
- canvas store загружается через `loadTemplatePack`

### Wizard и шаблоны

В Wizard:

- можно выбрать template
- автоматически подтягиваются dynamic fields
- для text slots идёт генерация по имени slot-а
- image slots можно заполнять upload-ом
- дальше возможен preview и переход в Studio

### Описано в docs / запланировано

Docs описывают template lifecycle, pack structure, save/apply/catalogization/versioning.

### Расхождения и пробелы

- Docs говорят о template versioning как зрелой функции; в текущем коде есть save/apply/import/export, но явной template diff/version UI нет.
- Smart resize уже есть в коде, но UX зависит от ручного сопоставления slot-ов.

## 3.10 Дополнительные функции вокруг канваса

### Экспорт

#### Реализовано в коде

`ExportModal` поддерживает три режима:

1. **Single**
   - экспорт текущего artboard
   - экспорт конкретного frame
   - формат: PNG
   - scale: `1x` или `2x`

2. **Batch**
   - экспорт выбранных resizes
   - переключает active resize по очереди
   - собирает ZIP из PNG

3. **Template**
   - экспорт текущего canvas как `template-pack.json`

Кроме этого, canvas context menu умеет:

- export single layer
- export selected layers в ZIP

#### Расхождения с docs

- Docs обещают `PNG/JPEG/PDF/SVG`.
- Реально подтверждённый UI-экспорт: **PNG + ZIP PNG + template JSON**.

### История версий

#### Реализовано в коде

`VersionHistoryPanel` поддерживает:

- просмотр version snapshots проекта
- создание новой версии с optional label
- restore выбранной версии

После restore editor page делает `window.location.reload()` для перезагрузки canvas state.

### Ассеты

#### Реализовано в коде

`AssetLibraryModal` поддерживает:

- список ассетов проекта
- поиск
- сортировку по:
  - date
  - filename
  - size
- multi-select
- select all
- add selected to canvas
- export selected
- delete selected

### Autosave и сохранение состояния

#### Реализовано в коде

`useCanvasAutoSave` делает:

- debounce autosave через `1.5s`
- синхронизацию `canvasState` в БД
- создание thumbnail из Konva stage
- миграцию base64 / temp images в S3 перед save
- sync save через `sendBeacon` при уходе со страницы

Что сохраняется:

- `layers`
- `masterComponents`
- `componentInstances`
- `resizes`
- `artboardProps`
- `canvasWidth`
- `canvasHeight`

### Project settings рядом с канвасом

#### Реализовано в коде

Из editor page доступны:

- project name
- status
- artboard background color
- readonly business unit
- readonly goal
- share by URL

---

## 4. Сценарии работы с канвасом

## 4.1 Создание креатива с нуля в Studio

### Реализовано в коде

1. Пользователь открывает проект в `studio`.
2. Через toolbar добавляет text / rectangle / frame / badge / image.
3. Настраивает свойства в `PropertiesPanel`.
4. Управляет иерархией в `LayersPanel`.
5. Сохраняет автоматически через autosave.
6. Экспортирует PNG или batch ZIP.

## 4.2 Быстрый старт с шаблоном через Wizard

### Реализовано в коде

1. Пользователь выбирает template в Wizard.
2. Заполняет текстовые и image fields.
3. Может вызвать AI generation для текстовых полей.
4. Видит preview.
5. Применяет шаблон.
6. Переходит в Studio для ручной доработки.

## 4.3 Сборка композиции через frame / auto-layout

### Реализовано в коде

1. Создаётся frame.
2. Внутрь frame перетаскиваются child layers.
3. Для frame включается `horizontal` или `vertical` auto-layout.
4. Настраиваются paddings, spacing, alignment, sizing.
5. Child layers могут быть `fixed`, `fill`, `hug`, либо absolute-positioned.

## 4.4 Адаптация под несколько форматов

### Реализовано в коде

1. Пользователь добавляет custom resize.
2. Для каждого master создаются instances.
3. Можно переключаться между format-ами.
4. Можно отвязать resize от content cascade.
5. Для image instance можно отвязать sync размеров.

## 4.5 Smart Resize по шаблону

### Реализовано в коде

1. Пользователь выбирает шаблон в `TemplatePanel`.
2. Открывает `SlotMappingModal`.
3. Автомаппинг связывает текущие masters со слотами шаблона.
4. При необходимости mapping правится вручную.
5. `applySmartResize` создаёт новые resizes и instances.
6. Пользователь получает новые format-specific layouts с сохранённым контентом.

## 4.6 AI-генерация текста и изображения

### Реализовано в коде

1. Пользователь открывает `AIPromptBar`.
2. Выбирает text или image mode.
3. При image mode задаёт:
   - model
   - aspect ratio
   - resolution
   - style preset
   - reference images, если модель vision-capable
4. Нажимает generate.
5. Результат:
   - добавляется как новый layer
   - или применяется к выбранному слою

## 4.7 AI-редактирование выбранного изображения

### Реализовано в коде

1. Пользователь выделяет image layer.
2. Открывает `ImageEditorModal`.
3. Выбирает model и tool.
4. При `inpaint` рисует маску кистью.
5. При `text-edit` задаёт prompt.
6. При `outpaint` задаёт ratio или paddings.
7. Применяет результат обратно в layer.

## 4.8 Работа с AI-чатом

### Реализовано в коде

1. Пользователь открывает `AIChatPanel`.
2. Пишет запрос и при необходимости прикладывает reference images.
3. Агент строит план.
4. Клиент показывает step-by-step response.
5. Результаты могут:
   - создать text layer
   - создать image layer
   - применить template
   - обновить слой по slot role

## 4.9 Экспорт

### Реализовано в коде

- export artboard as PNG
- export frame as PNG
- export batch of resizes as ZIP
- export selected layers as ZIP
- export template as JSON

## 4.10 Версии и сохранение

### Реализовано в коде

1. Canvas changes автоматически сохраняются.
2. Пользователь вручную создаёт version snapshot.
3. При необходимости restore version.
4. После restore editor перезагружается и подтягивает сохранённое состояние.

---

## 5. Что заявлено в docs, но не подтверждено полностью текущим кодом

Ниже перечислены возможности, которые явно описаны в docs, но по текущему коду выглядят либо частично реализованными, либо не имеют полного UI-подтверждения:

- экспорт в `JPEG`, `PDF`, `SVG`
- “полный” AI-агент с широким произвольным редактированием canvas
- template versioning / diff view
- более широкий productized preset picker для formats
- комментарии и stakeholder review flow
- полный brand-kit injection во все AI сценарии как прозрачная продуктовая функция
- более зрелый workflow builder для AI

---

## 6. Ключевые расхождения между кодом и docs

## 6.1 Инструменты рисования

- **Docs**: редактор читается как Figma/Canva-подобный с классическими инструментами.
- **Код**: toolbar в основном работает как набор instant insert actions, а не режимы draw-by-drag.

## 6.2 Экспорт

- **Docs**: PNG/JPEG/PDF/SVG.
- **Код**: подтверждены PNG, batch ZIP из PNG, layer export PNG/ZIP, template JSON.

## 6.3 Панель слоёв

- **Docs**: lock выглядит как штатное действие панели.
- **Код**: lock живёт в контекстном меню, а не в row actions.

## 6.4 Форматы

- **Docs**: готовые продуктовые форматы как явный сценарий.
- **Код**: в текущем `ResizePanel` пользователь вручную вводит имя и размер; preset registry существует, но не экспонирован напрямую в этом UI.

## 6.5 AI агент

- **Docs**: создаётся впечатление полнофункционального “chat with canvas”.
- **Код**: агент уже умеет план, генерацию, template search/apply, placement и некоторые canvas actions, но action registry пока довольно узкий.

## 6.6 AI редактирование изображения

- **Docs**: image editing описан концептуально.
- **Код**: эта часть уже весьма насыщенная и даже детальнее, чем docs: remove-bg, inpaint, text-edit, outpaint, model caps, refs, style presets.

---

## 7. Итог

### Что реально есть уже сейчас

Канвас AI Creative Platform — это рабочий визуальный редактор на `Konva + Zustand`, который уже поддерживает:

- слойную модель с вложенными frame
- auto-layout для frame
- master/instance multi-format architecture
- resize sync и smart resize
- rich selection / drag / transform / snapping / clipping
- AI text and image generation
- AI image editing
- AI chat with plan and canvas actions
- шаблоны, импорт/экспорт template pack
- version history
- autosave с S3 image migration
- asset library

### Что выглядит зрелым

- базовая canvas interaction model
- frame nesting + auto-layout
- master/instance resize architecture
- AI prompt bar + image editor
- template hydration / smart resize backend logic

### Что ещё ощущается переходным

- product UX вокруг format presets
- широта canvas-агентности в AI chat
- bulk editing в properties
- различие между “обещано в docs” и “выведено в стабильный UI”

