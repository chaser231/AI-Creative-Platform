# Canvas Greenfield Sprint Slices

## Цель документа

Этот документ переводит greenfield-roadmap и backlog в более операционный delivery format:

- milestone → sprint slices;
- frontend / backend ownership;
- точки интеграции;
- продвинутый scope, который можно вести параллельно как задел на будущее.

## Planning assumptions

- Горизонт плана: 16 спринтов.
- Длина спринта: 2 недели.
- Команда условно делится на:
  - `Frontend Core`
  - `Backend Platform`
  - `Shared / Tech Lead / Architect`
  - `Research / Innovation`
- План не означает, что все задачи обязаны идти строго линейно; это референсная delivery-сетка для синхронизации.

## Как пользоваться этим планом

- Если нужна быстрая delivery-версия, можно ограничиться спринтами `S1–S10`.
- Если нужен дифференцирующий продукт, нужно заранее оставить слот под `S11–S16`.
- `Research`-scope лучше вести не “после релиза”, а параллельно, чтобы smart resize и agent mode не оказались запоздалой надстройкой.

## Milestone Map

| Milestone | Sprint window | Outcome |
| --- | --- | --- |
| M1 | S1-S2 | Contracts frozen, editor shell on mocks |
| M2 | S3-S5 | Editor MVP with save/load and assets |
| M3 | S6-S8 | Structured editing with frames, slots, templates |
| M4 | S9-S10 | Multi-format foundation and export |
| M5 | S11-S12 | AI generation integrated into editor |
| M6 | S13-S14 | Smart resize beta |
| M7 | S15-S16 | AI agent alpha |

## S1. Contracts and Shell

### Objective

Запустить проектную основу и убрать архитектурную неопределённость.

### Frontend

- Собрать app shell редактора.
- Выделить canvas area, top bar, left toolbar, layer panel, properties panel.
- Поднять editor store и mock fixtures.

### Backend

- Описать `CanvasDocument`, `Layer`, `Template`, `AssetRef`, `FormatInstance`.
- Зафиксировать document CRUD contracts.
- Подготовить storage architecture draft.

### Shared

- Согласовать document schema v1.
- Согласовать feature flags matrix.
- Подготовить fixtures для contract-driven разработки.

### Sprint exit

- Команды разрабатываются против одной доменной модели.
- Editor shell есть и живёт на моках.

## S2. Interaction Skeleton and Platform Skeleton

### Objective

Собрать технический каркас editor interaction и backend platform.

### Frontend

- Реализовать viewport с pan/zoom.
- Подготовить selection state machine.
- Определить keyboard shortcuts foundation.

### Backend

- Подготовить document persistence skeleton.
- Описать asset upload flow.
- Выбрать queue/job strategy для export и AI.

### Shared

- Зафиксировать boundaries между document state и UI transient state.
- Подготовить API stubs для интеграции.

### Sprint exit

- Есть `M1`: contracts frozen, editor shell running on mocks.

## S3. Canvas Core and Document Lifecycle

### Objective

Сделать первый реальный end-to-end slice редактора.

### Frontend

- Single select / multi-select.
- Marquee selection.
- Перемещение объектов.
- Базовые toolbar modes.

### Backend

- Реализовать document CRUD API.
- Реализовать save/load.
- Поднять autosave draft strategy.

### Shared

- Договориться о payload сохранения и загрузки.
- Закрыть первые contract mismatches.

### Sprint exit

- Документ можно открыть и сохранить из editor.

## S4. Base Tools and Assets

### Objective

Поднять базовые editor tools и asset pipeline.

### Frontend

- Инструменты `text`, `rectangle`, `image place`, `frame`.
- Inline text editing.
- Transform handles foundation.

### Backend

- Asset upload API.
- Metadata extraction.
- Basic asset storage and retrieval.

### Shared

- Согласовать asset ref shape.
- Уточнить layer property contracts.

### Sprint exit

- На канвасе можно собрать простой креатив из текста, shape и изображения.

## S5. Panels, Autosave and Version Draft

### Objective

Сделать editor usable как продукт, а не как demo.

### Frontend

- Layer panel.
- Properties panel v1.
- Asset picker / replace UX.

### Backend

- Autosave endpoint.
- Basic version snapshots.
- Initial audit fields for document revisions.

### Shared

- Согласовать version snapshot format.
- Закрыть quality pass для `M2`.

### Sprint exit

- Есть `M2`: editor MVP, save/load, assets and autosave working.

## S6. Frames, Nesting and Clipping

### Objective

Перейти от плоского canvas к структурной композиции.

### Frontend

- Nested frames.
- Child hierarchy in layer panel.
- Internal selection inside frame.
- Clipping behavior.

### Backend

- Обновить persistence model под nested structure.
- Проверить serialization/deserialization сложных деревьев.

### Shared

- Согласовать frame behavior как часть schema.

### Sprint exit

- Frame воспринимается как полноценный контейнер.

## S7. Slots and Templates

### Objective

Собрать template-driven editing foundation.

### Frontend

- Slot editing UI.
- Save as template flow.
- Apply template flow.

### Backend

- Template persistence.
- Template catalog API.
- Template metadata schema.

### Shared

- Зафиксировать slot taxonomy.
- Описать template export/import shape.

### Sprint exit

- Пользователь может сохранить документ как template и применить template к новому документу.

## S8. Auto-Layout and Template Catalog Polish

### Objective

Сделать structured composition устойчивой и готовой к multi-format.

### Frontend

- Auto-layout foundation for frame.
- Улучшение template chooser UX.
- Улучшение frame property editing.

### Backend

- Template thumbnails.
- Catalog search/filter basis.

### Shared

- Проверить template compatibility matrix.
- Закрыть `M3`.

### Sprint exit

- Есть `M3`: frames, slots и templates стабилизированы.

## S9. Multi-Format Model

### Objective

Ввести master/instance model форматов.

### Frontend

- Formats panel.
- Create / rename / remove format.
- Switching between instances.

### Backend

- Multi-format persistence.
- Inheritance/override serialization.

### Shared

- Зафиксировать rules для master/instance поведения.

### Sprint exit

- Документ поддерживает несколько format instances.

## S10. Export and Overrides

### Objective

Довести multi-format до production-useful состояния.

### Frontend

- Override indicators.
- Batch export UX.
- Visual markers for linked/unlinked changes.

### Backend

- Export jobs.
- Rendering pipeline.
- Export artifact storage draft.

### Shared

- Закрыть `M4`.
- Согласовать export result payload.

### Sprint exit

- Есть `M4`: multi-format and export working.

## S11. AI Generation Entry Layer

### Objective

Поднять production-friendly AI entrypoint внутри editor.

### Frontend

- Prompt bar.
- Generation panel / tray.
- Apply-to-selection UX.

### Backend

- Provider abstraction layer.
- Text generation API.
- Image generation API.

### Shared

- Согласовать generation artifact schema.
- Определить safety boundaries.

### Sprint exit

- Пользователь может запустить AI generation прямо из редактора.

## S12. AI History, Safety and Image Edit

### Objective

Сделать AI слоем продукта, а не демо-интеграцией.

### Frontend

- Reference image UI.
- Style/aspect controls.
- Generation history and retry.

### Backend

- Moderation / safety policy.
- Cost tracking.
- Image edit / variation pipeline.

### Shared

- Закрыть `M5`.
- Подготовить metrics по AI adoption.

### Sprint exit

- Есть `M5`: AI generation integrated into editor UX.

## S13. Smart Resize Engine and Preview

### Objective

Запустить первую “умную” адаптацию форматов.

### Frontend

- Resize preview UI.
- Compare view.

### Backend

- `ResizeMapping` engine v1.
- Slot-aware heuristics.

### Research

- Quality metrics for resize evaluation.
- Набор тестовых кейсов на resize quality.

### Sprint exit

- Resize работает как previewable operation, а не как blind scale.

## S14. Mapping Review and Confidence

### Objective

Сделать smart resize контролируемым и explainable.

### Frontend

- Mapping review UI.
- Conflict resolution flow.
- Confidence indicators.

### Backend

- Confidence scoring.
- Resize audit trail.
- Logging accepted/rejected decisions.

### Research

- Эксперименты с alternative layout proposals.

### Sprint exit

- Есть `M6`: smart resize beta.

## S15. Agent Architecture and Plan UX

### Objective

Подготовить agent layer на устойчивой action model.

### Frontend

- Agent panel.
- Plan preview UI.
- Approval / reject controls.

### Backend

- Canvas action vocabulary runtime.
- Action registry.
- Orchestration skeleton.

### Shared

- Зафиксировать scene graph / canvas AST abstraction.

### Sprint exit

- Агент умеет предлагать план действий над документом.

## S16. Agent Apply, Diff and Audit

### Objective

Довести agent до controlled alpha.

### Frontend

- Diff view.
- Undo / rollback UX.
- Explainability surfaces.

### Backend

- Step execution logging.
- Audit trail.
- Policy layer and recoverability.

### Research

- Brand constraints.
- Agent-assisted smart resize experiments.

### Sprint exit

- Есть `M7`: AI agent alpha.

## Что можно отдать backend как продвинутый параллельный scope

Если frontend перегружен editor UX, backend может почти без блокеров вести:

- version diff model;
- export orchestration;
- asset/media normalization pipeline;
- template catalog and indexing;
- AI provider gateway;
- moderation, quotas, cost accounting;
- action registry и audit trail;
- smart resize confidence engine;
- orchestration primitives для AI agent.

Это создаёт реальный прогресс без ожидания готового UI.

## Что можно отдать frontend как продвинутый параллельный scope

Пока backend делает платформу, frontend может готовить:

- keyboard-first editor;
- resize review surfaces;
- explainable diff UI;
- AI generation tray;
- agent approval model;
- performance model для больших документов;
- multi-select bulk editing;
- richer template and slot editing UX.

## Recommended first release boundary

Если нужно быстро дойти до первого релиза, разумная граница выглядит так:

### Release 1

- `S1–S10`
- Это даёт:
  - editor core;
  - save/load/assets;
  - templates;
  - frames;
  - multi-format;
  - export.

### Release 2

- `S11–S14`
- Это даёт:
  - AI generation;
  - smart resize beta.

### Release 3

- `S15–S16`
- Это даёт:
  - AI agent alpha.

## Если хочется усилить инновационный трек

Я бы прямо выделил 2 постоянных под-потока:

### Track A. Resize Intelligence Lab

- semantic slots;
- ranking heuristics;
- confidence scoring;
- alternative layouts;
- quality benchmark dataset.

### Track B. Agentic Editing Lab

- scene graph;
- action semantics;
- approval policies;
- brand-safe automation;
- explainable canvas diffs.

Такой формат позволяет не откладывать “умные” функции до момента, когда архитектура уже не подходит для них.
