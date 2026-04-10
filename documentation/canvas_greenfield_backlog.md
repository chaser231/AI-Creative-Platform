# Canvas Greenfield Backlog

## Цель документа

Этот backlog раскладывает greenfield-разработку canvas-редактора на понятные эпики и задачи. Фокус на том, чтобы:

- видеть, как большие части системы декомпозируются;
- развести frontend, backend, shared и research scope;
- заранее зафиксировать advanced scope для `smart resize` и `AI agent`.

## Как читать backlog

- `Priority`: условный порядок исполнения.
- `Stream`: кто в основном владеет задачей.
- `Epic`: крупный блок системы.
- `Why now`: зачем задача нужна именно на этом этапе.
- `Acceptance`: критерий завершённости.

## Epic Map

- `E1` Product and Architecture Contracts
- `E2` Editor Shell and Canvas Core
- `E3` Layers, Properties and Tooling
- `E4` Persistence, Assets and Versioning
- `E5` Templates, Frames and Slot Semantics
- `E6` Multi-Format and Export
- `E7` Smart Resize
- `E8` AI Generation Layer
- `E9` AI Agent Layer
- `E10` Hardening, Observability and Security

## E1. Product and Architecture Contracts

### Goal

Согласовать доменную модель и контракты до активной реализации editor и backend-платформы.

| ID | Priority | Stream | Epic | Task | Why now | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| E1-01 | P0 | Shared | E1 | Описать `CanvasDocument` schema v1 | Без этого FE и BE разойдутся по модели документа | Есть согласованная схема документа с версиями и примерами |
| E1-02 | P0 | Shared | E1 | Зафиксировать layer contracts для `text`, `image`, `rect`, `frame`, `badge` | Это базовый язык редактора | Все типы слоёв имеют schema, defaults и validation rules |
| E1-03 | P0 | Shared | E1 | Зафиксировать `FormatInstance` и inheritance model | Multi-format сильно влияет на архитектуру заранее | Описаны master/instance и override semantics |
| E1-04 | P0 | Shared | E1 | Описать `Template` и `SlotRole` schema | Это фундамент template-driven editing и smart resize | Есть schema template, slot taxonomy и примеры |
| E1-05 | P0 | BE | E1 | Выбрать storage strategy для document/assets/previews | Иначе дальше всё будет временным | Документирована storage architecture |
| E1-06 | P1 | Shared | E1 | Описать action schema для editor и AI agent | Нужно заранее заложить action model | Есть action vocabulary и JSON contracts |
| E1-07 | P1 | Shared | E1 | Определить event taxonomy для analytics/audit | Иначе будет трудно измерять editor usage и AI behavior | Список доменных событий согласован |

### Exit criteria

- FE и BE разрабатываются по одной схеме.
- Есть fixtures для моков и API contract tests.
- Команда понимает, какие сущности являются “ядром” системы.

## E2. Editor Shell and Canvas Core

### Goal

Поднять визуальный каркас редактора и базовый interaction engine.

| ID | Priority | Stream | Epic | Task | Why now | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| E2-01 | P0 | FE | E2 | Собрать app shell редактора | Нужен визуальный каркас для всей дальнейшей разработки | Есть редактор с canvas area и основными панелями |
| E2-02 | P0 | FE | E2 | Реализовать viewport с pan/zoom | Без этого нельзя полноценно работать с канвасом | Viewport стабильно двигается и масштабируется |
| E2-03 | P0 | FE | E2 | Реализовать selection engine | Это центральная editor-механика | Single select, multi-select и clear selection работают |
| E2-04 | P0 | FE | E2 | Реализовать marquee selection | Нужна для нормального canvas UX | Выделение рамкой работает на нескольких слоях |
| E2-05 | P1 | FE | E2 | Реализовать snapping/guides foundation | Лучше заложить рано, чем переписывать трансформации | Есть snap lines и базовые align rules |
| E2-06 | P1 | FE | E2 | Собрать keyboard shortcut system | Ускоряет работу и стабилизирует interaction layer | Базовые shortcuts поддерживаются централизованно |
| E2-07 | P1 | Shared | E2 | Определить editor state boundaries | Нужно развести transient UI state и document state | Согласована карта editor state |

### Exit criteria

- Есть рабочий canvas shell.
- Пользователь может перемещаться по канвасу и выделять объекты.
- Interaction model не завязан на случайные локальные состояния компонентов.

## E3. Layers, Properties and Tooling

### Goal

Сделать полноценный базовый редактор слоёв и инструментов.

| ID | Priority | Stream | Epic | Task | Why now | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| E3-01 | P0 | FE | E3 | Инструмент `select` | Базовая точка входа редактора | Выделение и drag работают через toolbar mode |
| E3-02 | P0 | FE | E3 | Инструмент `text` и inline editing | Текст почти всегда критичен для креативов | Текст создаётся и редактируется на холсте |
| E3-03 | P0 | FE | E3 | Инструмент `rectangle` | Нужен для shape-based composition | Прямоугольник создаётся и редактируется |
| E3-04 | P0 | FE | E3 | Инструмент `image place` | Нужен реальный asset workflow в редакторе | Изображение добавляется на холст |
| E3-05 | P0 | FE | E3 | Инструмент `frame` | Основа композиции, шаблонов и resize | Frame создаётся как контейнер |
| E3-06 | P0 | FE | E3 | Layer panel | Без неё редактор трудно использовать системно | Панель показывает структуру слоёв и selection |
| E3-07 | P0 | FE | E3 | Properties panel v1 | Без неё нельзя управлять объектами точно | Видны и редактируются базовые свойства |
| E3-08 | P1 | FE | E3 | Transform handles: resize/rotate | Это обязательная часть direct manipulation UX | Слои можно ресайзить и вращать |
| E3-09 | P1 | FE | E3 | Visibility/lock/rename in layers | Это даёт управляемость документом | Есть rename, hide, lock и delete |
| E3-10 | P1 | Shared | E3 | Определить property groups по типам слоёв | Нужно синхронизировать UI и schema | Список property groups согласован |

### Exit criteria

- Базовые инструменты работают стабильно.
- Есть слойный и property-based контроль.
- Single-format editor уже полезен для реальной сборки простых креативов.

## E4. Persistence, Assets and Versioning

### Goal

Сделать document lifecycle: save/load/autosave/assets/version history.

| ID | Priority | Stream | Epic | Task | Why now | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| E4-01 | P0 | BE | E4 | Document CRUD API | FE должен перестать жить только на локальных моках | Документы создаются, читаются, обновляются |
| E4-02 | P0 | BE | E4 | Asset upload API | Без него image workflow неполный | Upload возвращает asset ref и metadata |
| E4-03 | P0 | BE | E4 | Asset processing pipeline | Нужны размеры, preview и валидность | После upload есть normalized metadata |
| E4-04 | P0 | BE | E4 | Autosave strategy and endpoint | Это ключевой editor expectation | Документ сохраняется автоматически по стратегии |
| E4-05 | P1 | BE | E4 | Version snapshot model | Основа для истории и rollback | Версии создаются и доступны для чтения |
| E4-06 | P1 | FE | E4 | Save/load integration in editor | Нужно замкнуть end-to-end workflow | Editor открывает и сохраняет документ через API |
| E4-07 | P1 | FE | E4 | Asset picker / replace UX | Нужно быстро использовать уже загруженные assets | Asset можно выбрать и заменить через UI |
| E4-08 | P1 | Shared | E4 | Определить version diff payload | Это пригодится для AI и agent later | Есть schema diff между версиями |

### Exit criteria

- Документы и assets живут на реальном backend.
- Autosave работает.
- Есть базовая версия документа.

## E5. Templates, Frames and Slot Semantics

### Goal

Перейти от свободных слоёв к повторно используемым структурированным композициям.

| ID | Priority | Stream | Epic | Task | Why now | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| E5-01 | P0 | FE | E5 | Nested frames and child hierarchy | Нужен структурный редактор, а не только плоский canvas | Frame может содержать дочерние слои |
| E5-02 | P0 | FE | E5 | Frame clipping and internal selection | Это база контейнерного поведения | Внутри frame можно выделять и редактировать элементы |
| E5-03 | P0 | FE | E5 | Auto-layout foundation | Без него templates и resize будут хрупкими | Frame поддерживает базовую layout-модель |
| E5-04 | P0 | Shared | E5 | Slot role taxonomy | Это опора для smart resize и AI mapping | Есть список slot roles и правила использования |
| E5-05 | P1 | FE | E5 | Slot editing UI | Пользователь должен видеть и менять роли | Slot roles назначаются через properties/UI |
| E5-06 | P1 | BE | E5 | Template persistence and catalog API | Нужен reusable workflow | Template сохраняется и читается из каталога |
| E5-07 | P1 | FE | E5 | Apply template flow | Нужен реальный template entrypoint в editor | Template можно применить к документу |
| E5-08 | P1 | FE | E5 | Save as template flow | Пользователь может повторно использовать композицию | Документ сохраняется как template |
| E5-09 | P2 | BE | E5 | Template thumbnail generation | Нужен удобный catalog UX | У template есть preview |

### Exit criteria

- Документы можно делать template-driven.
- Появляется семантика слотов.
- Команда готова к multi-format и resize logic.

## E6. Multi-Format and Export

### Goal

Добавить master/instance-модель форматов и production-экспорт.

| ID | Priority | Stream | Epic | Task | Why now | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| E6-01 | P0 | Shared | E6 | Подтвердить master/instance inheritance rules | Это центральное решение для format model | Документирован inheritance contract |
| E6-02 | P0 | FE | E6 | Formats panel | Пользователю нужен контроль над форматами | Есть список форматов и переключение |
| E6-03 | P0 | FE | E6 | Create/remove/rename format UX | Это базовый multi-format workflow | Формат можно создать, удалить, переименовать |
| E6-04 | P0 | FE | E6 | Override indicators and editing model | Нужно прозрачно показывать отличия от master | Override state виден в UI |
| E6-05 | P1 | BE | E6 | Multi-format persistence | FE должен сохранять не один артборд, а набор инстансов | Format instances сериализуются и восстанавливаются |
| E6-06 | P1 | BE | E6 | Export job orchestration | Экспорт лучше не держать целиком на фронте | Экспорт работает через jobs |
| E6-07 | P1 | FE | E6 | Batch export UX | Пользователю нужен понятный экспорт всех форматов | Есть bulk export flow |
| E6-08 | P2 | BE | E6 | Export artifact storage and history | Это полезно для повторного скачивания и аудита | Экспортные результаты сохраняются |

### Exit criteria

- Multi-format document model работает.
- Пользователь может экспортировать несколько форматов.
- FE и BE одинаково трактуют inheritance/override behavior.

## E7. Smart Resize

### Goal

Сделать адаптацию форматов управляемой и “умной”, а не просто геометрическим масштабированием.

| ID | Priority | Stream | Epic | Task | Why now | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| E7-01 | P1 | Research | E7 | Исследовать resize strategies и quality metrics | Нельзя сразу прыгать в реализацию без метрик качества | Есть критерии оценки quality для resize |
| E7-02 | P1 | Shared | E7 | Определить `ResizeMapping` schema | Нужен контракт между UI и engine | Схема mapping согласована |
| E7-03 | P1 | BE | E7 | Реализовать heuristic mapping engine v1 | Это сердце smart resize | Engine возвращает mapping proposals |
| E7-04 | P1 | BE | E7 | Реализовать rule layer для slot-aware resize | Семантика должна влиять на результат | Resize учитывает roles/constraints |
| E7-05 | P1 | FE | E7 | Построить resize preview UI | Пользователь должен видеть результат до принятия | Есть preview результата resize |
| E7-06 | P1 | FE | E7 | Построить mapping review UI | Иначе система будет “магической” | Пользователь видит проблемные места и может подтвердить |
| E7-07 | P2 | BE | E7 | Confidence scoring per layer and document | Это задел под explainability и agent flows | Resize возвращает confidence scores |
| E7-08 | P2 | Research | E7 | Alternate layout proposals | Это уже advanced differentiator | Система умеет возвращать несколько вариантов адаптации |
| E7-09 | P2 | Shared | E7 | Log accepted/rejected resize decisions | Это нужно для learning loop | Хранятся результаты пользовательских решений |

### Exit criteria

- Resize воспринимается как контролируемый инструмент, а не black box.
- Есть понятные confidence/exception states.
- Появляется база для agent-assisted adaptation.

## E8. AI Generation Layer

### Goal

Добавить AI как встроенную часть canvas workflow.

| ID | Priority | Stream | Epic | Task | Why now | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| E8-01 | P1 | FE | E8 | Prompt bar and generation entrypoints | Нужна единая входная точка AI в editor | Prompt bar доступен в редакторе |
| E8-02 | P1 | BE | E8 | Provider abstraction layer | Нужно избежать жёсткой привязки к одному провайдеру | Генерации идут через единый gateway |
| E8-03 | P1 | BE | E8 | Text generation API | Это быстрый win для creative workflow | Можно получить текстовые варианты |
| E8-04 | P1 | BE | E8 | Image generation API | Это ключевой AI сценарий платформы | Генерируются изображения по prompt |
| E8-05 | P1 | FE | E8 | Apply result to canvas / selection UX | AI должен встраиваться в редактор, а не жить рядом | Результат можно применить к слою или добавить на холст |
| E8-06 | P1 | FE | E8 | Reference image and style controls | Нужно качество и управляемость generation | В UI доступны refs/style/aspect controls |
| E8-07 | P1 | BE | E8 | Usage tracking and cost accounting | AI без экономики не масштабируется | Учёт токенов/генераций хранится |
| E8-08 | P1 | BE | E8 | Moderation and safety policy | Нужен production guardrail | Небезопасные запросы корректно блокируются или маркируются |
| E8-09 | P2 | FE | E8 | Generation history and retry UX | Нужно возвращаться к результатам и повторять операции | Пользователь видит историю генераций |
| E8-10 | P2 | Shared | E8 | Generation artifact schema | Нужно согласовать результат между UI и backend | Схема generation result стандартизирована |

### Exit criteria

- AI integrated into editor UX.
- Результаты generation применяются к канвасу быстро и предсказуемо.
- Есть учёт, модерация и история.

## E9. AI Agent Layer

### Goal

Перевести AI из режима single-shot generation в режим управляемых действий над документом.

| ID | Priority | Stream | Epic | Task | Why now | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| E9-01 | P2 | Shared | E9 | Определить canvas action vocabulary | Без языка действий агент не будет надёжен | Список действий согласован и типизирован |
| E9-02 | P2 | Shared | E9 | Описать scene graph / canvas AST | Нужна структурная модель документа для reasoning | Есть абстракция поверх raw layers |
| E9-03 | P2 | BE | E9 | Построить action registry and tool execution layer | Агент должен вызывать стабильные tools, а не UI хаки | Есть runtime layer для безопасного вызова действий |
| E9-04 | P2 | BE | E9 | Построить orchestration engine | Нужен движок plan -> execute -> recover | Агент исполняет многошаговые планы |
| E9-05 | P2 | FE | E9 | Agent panel with plan preview | Пользователь должен понимать, что собирается делать агент | UI показывает шаги и ожидаемые изменения |
| E9-06 | P2 | FE | E9 | Approval/reject/undo flows | Без этого доверие к агенту будет низким | Каждое действие подтверждается и может быть отменено |
| E9-07 | P2 | BE | E9 | Audit log and reasoning trace | Нужна прозрачность и поддержка | Есть trace по шагам выполнения |
| E9-08 | P3 | Research | E9 | Brand/policy constraints for agent | Это важный differentiator для enterprise и quality control | Агент учитывает ограничители бренда и контента |
| E9-09 | P3 | Research | E9 | Agent-assisted smart resize | Это синергия двух сильных направлений | Агент умеет объяснимо адаптировать композицию |
| E9-10 | P3 | FE | E9 | Diff view for agent changes | Это усиливает explainability | Пользователь видит визуальный diff до применения |

### Exit criteria

- Агент выполняет ограниченный, но надёжный набор действий.
- Пользователь понимает план, последствия и историю выполнения.
- Система готова к дальнейшей automation-expansion.

## E10. Hardening, Observability and Security

### Goal

Подготовить систему к производственной эксплуатации и росту нагрузки.

| ID | Priority | Stream | Epic | Task | Why now | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| E10-01 | P1 | FE | E10 | Performance profiling for large documents | Нужно заранее понять лимиты editor engine | Есть метрики и perf budget |
| E10-02 | P1 | BE | E10 | Queue resilience and retries | Экспорт и AI jobs не должны падать хаотично | Есть retry policy и failure handling |
| E10-03 | P1 | BE | E10 | Observability dashboards | Без мониторинга система будет непрозрачной | Есть dashboards по API, jobs и AI |
| E10-04 | P1 | BE | E10 | Permissions and workspace access model | Это критично для реального продукта | Доступ к документам и assets ограничивается корректно |
| E10-05 | P2 | FE | E10 | Error recovery UX | Нужен trustable editor experience | Ошибки сохранения, AI и export обрабатываются в UI |
| E10-06 | P2 | BE | E10 | Rate limits and usage quotas | Нужно контролировать стоимость и злоупотребления | Ограничения применяются на уровне API |
| E10-07 | P2 | Shared | E10 | QA matrix for editor/multi-format/AI | Нужна системная проверка сложных flows | Есть тестовая матрица ключевых сценариев |
| E10-08 | P2 | FE | E10 | Accessibility and keyboard completeness | Это влияет на качество продукта и adoption | Основные editor flows доступны с клавиатуры |

### Exit criteria

- Система мониторится и операционно поддерживаема.
- Есть защита от перегрузок и ошибок.
- Качество редактора не деградирует при росте сложности.

## Sync Milestones

Ниже точки, в которых frontend и backend должны синхронизироваться явно.

| Milestone | Что должно быть готово | FE focus | BE focus |
| --- | --- | --- | --- |
| M1 | Contracts frozen | Editor на моках | API/spec/storage design |
| M2 | Save/load stable | Реальный document lifecycle | CRUD/autosave/assets |
| M3 | Template model stable | Template and frame UX | Template persistence/catalog |
| M4 | Multi-format stable | Format UX and overrides | Multi-format persistence/export |
| M5 | Smart resize beta | Preview/review UI | Mapping/rules/confidence |
| M6 | AI generation stable | Prompt/apply/history UX | Providers/safety/cost tracking |
| M7 | Agent alpha | Plan/approval/diff UX | Orchestration/actions/audit |

## Что backend может делать параллельно, пока frontend строит editor

Если frontend сильно загружен редактором, backend может параллельно вести отдельный продвинутый scope:

- заложить version history и diff model;
- поднять asset/media pipelines;
- собрать template catalog и metadata search;
- сделать export service и async jobs;
- подготовить AI provider gateway;
- проработать action registry для агента;
- исследовать resize heuristics и confidence model;
- подготовить audit trail, permissions и observability.

Это не “ожидание frontend”, а подготовка второго этажа продукта, который потом подключается в уже работающий editor.

## Recommended first delivery slice

Если нужен прагматичный первый delivery slice, я бы зафиксировал такой scope:

1. `E1` contracts.
2. `E2` editor shell and core interactions.
3. `E3` base tools, layers, properties.
4. `E4` persistence and assets.
5. `E5` frames and templates foundation.
6. `E6` basic multi-format and export.

После этого можно уверенно заходить в:

1. `E8` AI generation layer.
2. `E7` smart resize.
3. `E9` AI agent.

## Recommended advanced scope for future innovation

Если хочется заранее дать сильный, “не банальный” scope отдельным ребятам, я бы выделил такие направления:

### Track A. Smart Resize Intelligence

- Semantic slot classification.
- Layout transfer rules engine.
- Confidence scoring.
- Alternative resize proposals.
- Human feedback loop on resize decisions.

### Track B. Agentic Canvas Operations

- Scene graph abstraction.
- Plan-and-apply agent architecture.
- Approval and rollback model.
- Brand constraint enforcement.
- Explainable action trace.

### Track C. Design Infrastructure

- Rich template metadata and searchability.
- Export pipeline with reproducible artifacts.
- Version diff and document auditability.
- Analytics for editor behavior and AI adoption.

Эти треки дают реальный задел под будущее, а не просто “tech debt на потом”.
