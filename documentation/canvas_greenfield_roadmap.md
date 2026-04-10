# Canvas Greenfield Roadmap

## Цель документа

Этот документ описывает, как мог бы выглядеть roadmap разработки canvas-редактора AI Creative Platform почти с нуля. Фокус не только на последовательности этапов, но и на том, как синхронизировать frontend и backend, чтобы команда не ждала друг друга и параллельно закладывала базу под будущие “умные” функции.

## Базовые предпосылки

- Цель первой линии разработки: довести редактор до состояния production-ready canvas studio для создания и адаптации креативов.
- Приоритет продукта: быстро дойти до полезного editor MVP, но сразу строить доменную модель так, чтобы она не мешала multi-format, smart resize и AI orchestration.
- Архитектурный принцип: canvas state, layer schema, template schema, resize schema и AI action schema должны быть определены как shared contracts до глубокой реализации UI и backend-пайплайнов.
- Режим поставки: feature-flag driven, с изоляцией experimental-направлений (`smart resize`, `agent mode`, advanced export).

## Что считаем целевым продуктом

Canvas в greenfield-сценарии должен в итоге покрывать:

- базовый редактор с холстом, слоями, свойствами и asset workflow;
- template-driven composition с frame/slot model;
- multi-format adaptation и export;
- AI surfaces для генерации текста и изображений;
- продвинутый слой автоматизации: smart resize, semantic mapping, AI agent actions.

## Организация работ по потокам

Разработку лучше вести не “по экранам”, а по параллельным потокам.

### Stream A. Frontend Editor Core

Отвечает за:

- app shell редактора;
- canvas rendering engine;
- interaction model;
- layer panel, properties panel, toolbar, format panel;
- template/AI/external tool entrypoints;
- UX согласования AI и resize-операций.

### Stream B. Backend Platform

Отвечает за:

- auth/workspace/project domain;
- storage и persistence canvas state;
- asset upload/processing;
- template catalog и metadata;
- export jobs и long-running operations;
- AI provider abstraction, orchestration и observability.

### Stream C. Shared Contracts

Отвечает за:

- canvas JSON schema;
- layer type contracts;
- slot/semantic role taxonomy;
- version/diff schema;
- AI tool/action contracts;
- event/logging taxonomy.

### Stream D. Research and Innovation

Отвечает за:

- smart resize engine;
- scene understanding;
- AI agent planning/execution model;
- explainability and confidence mechanics;
- experimental ranking/heuristics/ML evaluation.

## Как синхронизировать frontend и backend

Да, синхронизировать разработку вполне возможно, даже если frontend делает большую часть editor-функций раньше backend.

Ключевой принцип: frontend не должен ждать “готовый backend”, а backend не должен ждать “готовый UI”. Вместо этого обе стороны сходятся на shared contracts и промежуточных стабилизированных интеграционных вехах.

### Практическая схема синхронизации

1. На старте фиксируются доменные схемы:
   - `CanvasDocument`
   - `Layer`
   - `Frame`
   - `AssetRef`
   - `Template`
   - `FormatInstance`
   - `ResizeMapping`
   - `AIAction`
2. Frontend строит editor against mock services и seeded fixtures.
3. Backend параллельно строит реальные API, storage, queues и processing.
4. На каждой milestone происходит переключение с mock adapters на реальные сервисы без переписывания UI-логики.
5. Все сложные функции идут через capability flags:
   - `templates`
   - `multiformat`
   - `smart_resize`
   - `ai_generate`
   - `ai_agent`

### Чем backend занимается, пока frontend делает редактор

Пока frontend делает canvas и interaction layer, backend не простаивает. В этот момент backend может независимо делать:

- доменную модель проекта, документа и слоя;
- API сохранения/загрузки канваса;
- версионирование и autosave;
- upload API и media processing pipeline;
- template catalog и поиск;
- экспортный сервис и фоновые очереди;
- AI provider gateway;
- cost tracking, moderation, audit logs;
- instrumentation, usage analytics и permissions.

Это как раз тот случай, где backend может подготовить фундамент для второй и третьей волны продукта, пока frontend доводит editor UX.

## Предлагаемый roadmap по фазам

## Phase 0. Product Definition and Technical Foundation

### Цель

Собрать минимально устойчивую техническую базу и заморозить shared contracts до начала глубокой UI-разработки.

### Frontend

- Поднять app shell редактора.
- Собрать layout: top bar, left toolbar, layer panel, properties panel, canvas area.
- Подготовить local editor store и mock canvas fixtures.
- Определить keyboard map и interaction state model.

### Backend

- Описать доменные сущности: workspace, project, document, asset, template, generation, version.
- Зафиксировать API-контракты и схемы сериализации.
- Выбрать storage model:
  - document state;
  - binary assets;
  - thumbnails/previews;
  - generation artifacts.
- Подготовить инфраструктуру очередей для export/AI/media jobs.

### Shared output

- `CanvasDocument` schema v1.
- `Layer` contracts v1.
- `Template` schema v1.
- `AIAction` schema draft.
- Feature flags matrix.

### Exit criteria

- FE и BE разрабатываются против одного набора схем.
- Есть mock dataset для frontend.
- Есть API spec и тестовые contract fixtures для backend.

## Phase 1. Editor Core MVP

### Цель

Получить рабочий single-format редактор, который умеет создавать, редактировать, сохранять и восстанавливать композицию.

### Frontend

- Canvas viewport с pan/zoom.
- Selection model: single select, multiselect, marquee.
- Move/resize/rotate для базовых слоёв.
- Базовые инструменты:
  - select;
  - text;
  - rectangle;
  - image place;
  - frame.
- Layer panel.
- Properties panel с базовыми полями.
- Inline text editing.

### Backend

- Project/document CRUD.
- Save/load canvas document.
- Autosave endpoint.
- Asset upload endpoint.
- Asset metadata extraction.
- Basic version snapshots.

### Exit criteria

- Пользователь может собрать креатив из текста, прямоугольников и изображений.
- Документ сохраняется и корректно открывается снова.
- Asset workflow работает end-to-end.

## Phase 2. Structured Composition and Templates

### Цель

Перейти от “свободного рисования” к управляемой композиции с frame/slot model и шаблонами.

### Frontend

- Вложенные frame-структуры.
- Контейнеры и clipping.
- Базовый auto-layout для frame.
- Slot role / group slot UX.
- Template apply UI.
- Save as template.
- Template preview chooser.

### Backend

- Template persistence.
- Template metadata schema.
- Template pack/catalog APIs.
- Template thumbnail generation.
- Template import/export.

### Exit criteria

- Пользователь может применить template к пустому документу.
- Документ можно сохранить как template.
- Template хранит структуру, роли и metadata.

## Phase 3. Multi-Format Foundation

### Цель

Ввести модель master format + instances и подготовить основу под resize и batch workflows.

### Frontend

- Formats panel.
- Создание форматов и переключение между ними.
- Linked/unlinked mode.
- Override markers на уровне свойств.
- Base resize tools и визуальные отличия master/instance.
- Batch export UI.

### Backend

- Сериализация multi-format document state.
- Версионирование с несколькими format instances.
- Export job model.
- Background rendering pipeline для форматов.

### Exit criteria

- Один документ поддерживает несколько форматов.
- Изменения master частично наследуются в instances.
- Batch export по форматам возможен.

## Phase 4. Smart Resize v1

### Цель

Сделать не просто resize, а управляемую адаптацию на базе семантики, слотов и layout rules.

### Frontend

- Resize preview UI.
- Mapping review interface.
- Conflict resolution UI.
- Confidence indicators.
- Side-by-side compare master vs resized instance.

### Backend

- Resize mapping engine.
- Rule evaluation layer.
- Semantic slot matching.
- Heuristic ranking для placement/layout transfer.
- Job execution и audit trail.

### Exit criteria

- Template-based resize работает лучше простого масштабирования.
- Пользователь видит, что изменилось и где система не уверена.
- Resize-операция воспроизводима и логируется.

## Phase 5. AI Generation Layer

### Цель

Добавить production-готовый AI workflow для генерации текста и изображений внутри editor experience.

### Frontend

- Prompt bar.
- AI history / generation tray.
- Apply-to-selection UX.
- Image edit modal.
- Reference images UX.
- Style/aspect/resolution controls.
- Loading, retries, error states.

### Backend

- Provider abstraction layer.
- Text generation service.
- Image generation service.
- Image edit / variation service.
- Prompt templating.
- Moderation / safety rules.
- Usage tracking and cost accounting.

### Exit criteria

- AI generation встроен в canvas UX, а не живёт отдельно.
- Результат генерации можно сразу применить к выделению или добавить на холст.
- Генерации отслеживаются и повторяемы на уровне истории.

## Phase 6. AI Agent and Assisted Editing

### Цель

Поднять AI с уровня “сгенерируй asset” до уровня “предложи и выполни последовательность действий в канвасе”.

### Frontend

- Agent chat panel.
- Plan/proposal UI.
- Preview before apply.
- Approval/reject/undo flows.
- Diff view для agent actions.
- Explainability surfaces: why this resize/change was proposed.

### Backend

- Action registry for canvas tools.
- Orchestration engine.
- Tool-calling pipeline.
- Policy and permissions layer.
- Step logs and recoverability.
- Agent memory scoped to document/project/session.

### Exit criteria

- Агент умеет выполнять ограниченный набор надёжных canvas-действий.
- Любое действие прозрачно, подтверждаемо и откатываемо.
- Есть журнал действий и трассировка решений.

## Phase 7. Hardening, Performance and Scale

### Цель

Довести систему до масштабируемого production-состояния.

### Frontend

- Perf optimization для больших документов.
- Keyboard-first editing.
- Bulk editing.
- Improved snapping and alignment systems.
- Better loading states and failure recovery.
- Accessibility and QA pass.

### Backend

- Observability dashboards.
- Rate limits and quotas.
- Permission model.
- Async job resilience.
- CDN and asset caching strategy.
- Export throughput optimization.

### Exit criteria

- Документы среднего и большого размера работают стабильно.
- Экспорт, AI и resize не ломают UX под нагрузкой.
- Система мониторится и поддерживается операционно.

## Продвинутый scope с заделом на будущее

Именно этот блок имеет смысл закладывать рано, даже если часть задач пойдёт в discovery, а не в первую доставку.

## Smart Resize v2

### Что можно заложить заранее

- Semantic slot taxonomy вместо purely geometric mapping.
- Constraint/rule engine с человекочитаемыми правилами.
- Alternate layout proposals, а не один resize-result.
- Confidence scoring по каждому слою и по всей композиции.
- Human-in-the-loop review surface.
- Learning loop по принятым/отклонённым изменениям.

### Почему это важно

Если не заложить семантику слоёв и slot model рано, потом smart resize превратится в набор хрупких эвристик и будет плохо масштабироваться на шаблоны и агентные сценарии.

## AI Agent v2

### Что можно заложить заранее

- Scene graph / canvas AST как абстракцию над визуальными слоями.
- Action vocabulary: add, replace, restyle, align, resize, group, adapt, export.
- Tool preconditions и postconditions.
- Approval policy engine.
- Prompt-to-plan-to-action pipeline.
- Session memory и brand constraints.

### Почему это важно

Если agent layer строить поверх “случайных UI-экшенов”, он будет хрупким. Если строить поверх canvas action model и scene graph, то появляется основа для:

- autonomous adaptation;
- intelligent layout repair;
- batch creative generation;
- brand-safe editing assistants;
- explainable AI tooling.

## Как реально развести frontend и backend по времени

Ниже практическая схема, чтобы обе команды двигались одновременно.

## Wave 1. Пока editor ещё локальный

### Frontend делает

- canvas engine;
- selection/transform;
- tool system;
- panels and layout;
- local persistence;
- fixture-driven AI/template entrypoints.

### Backend делает

- contracts;
- save/load APIs;
- asset APIs;
- versioning model;
- queues/jobs foundation;
- template storage;
- AI gateway skeleton.

## Wave 2. Пока frontend шлифует UX

### Frontend делает

- multi-format UX;
- template flows;
- property refinements;
- error handling;
- keyboard and interaction polish.

### Backend делает

- export pipeline;
- media processing;
- autosave/version history;
- template catalog;
- AI generation APIs;
- monitoring and quotas.

## Wave 3. Пока frontend строит advanced editor experience

### Frontend делает

- smart resize review UI;
- agent plan UI;
- generation history;
- approval workflows.

### Backend делает

- resize engine;
- mapping heuristics;
- orchestration;
- audit logs;
- policy engine;
- experiment infrastructure.

## Integration milestones

- Milestone 1: schemas frozen, editor работает на mocks.
- Milestone 2: single-format save/load и assets работают end-to-end.
- Milestone 3: templates и slot roles стабилизированы.
- Milestone 4: multi-format document model замкнут.
- Milestone 5: smart resize запускается как контролируемая операция.
- Milestone 6: AI generation встроен в редактор.
- Milestone 7: AI agent умеет выполнять безопасный ограниченный набор действий.

## Риски, если делать без такого roadmap

- Frontend соберёт editor, который тяжело подключать к реальному persistence model.
- Backend построит API, не совпадающие с реальной interaction-моделью editor.
- Smart resize начнут делать слишком поздно, и окажется, что в данных нет семантики.
- AI agent будут пытаться строить поверх UI-хака вместо action model.
- Export, versions, templates и AI history окажутся несогласованными сущностями.

## Рекомендованный порядок приоритизации

Если нужна прагматичная последовательность, я бы рекомендовал:

1. Foundation and contracts.
2. Editor Core MVP.
3. Structured composition and templates.
4. Multi-format foundation.
5. AI generation layer.
6. Smart resize v1.
7. AI agent assisted editing.
8. Hardening and scale.

Причина такого порядка в том, что `smart resize` и `AI agent` сильнее зависят от зрелой layer/schema/template model, чем наоборот. Но их архитектурный фундамент нужно продумывать уже в первых фазах.
