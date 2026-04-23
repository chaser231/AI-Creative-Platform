# AI Creative Platform — Project Charter

> **Bootstrap note:** Этот `PROJECT.md` создан в ходе `/gsd-new-milestone` в момент, когда проект уже существовал как код, но ещё не был формально инициализирован в GSD. Секции "Context" и "Validated Requirements" заполнены по факту того, что есть в кодовой базе на **2026-04-24**, и будут уточняться по мере продвижения.

---

## What This Is

AI Creative Platform — SaaS-редактор креативов (баннеры, шаблоны, мультиформатные дизайны) с LLM-агентом для ассистивной генерации и канвасом на Konva для интерактивного редактирования. Основной пользователь — маркетинг/дизайн-команды внутри workspace'а; работа через браузер, персональные workspace'ы с RBAC, интеграции (Figma import, AI-генерация, Asset library на S3).

## Core Value

Ускорить производство визуальных креативов в B2B-контексте: **от идеи/референса → к готовому к публикации мультиформатному дизайну**, используя связку «мастер-компонент → биндинг в форматах» (Figma-подобно) и AI-генерацию как аксессор для типовых задач (заголовок, фон, субтитр, адаптация под формат).

## Context

**Project stage:** MVP+ (кодбаза на ~100k+ LOC, в продакшене на Yandex Cloud).
**Users:** команды внутри приглашённых workspace'ов (invite-only), RBAC (VIEWER/USER/CREATOR/ADMIN).
**Domain:** рекламные креативы, маркетинг-банners, мультиформатная адаптация (resize + bindings).

**Existing capabilities (что работает сегодня):**

- Canvas-редактор на Konva + 8 Zustand-слайсов (`src/store/canvas/`*) с master/instance биндингами и синхронизацией форматов.
- LLM-агент с tool-calling (9 действий: generate_headline / generate_subtitle / generate_image / place_on_canvas / create_project / search_templates / apply_and_fill_template / search_style_presets).
- AI-провайдеры с fallback chain: Yandex GPT / OpenAI / Replicate / Gemini.
- `AIWorkflow` модель в БД (Prisma) — заготовка под сценарии автоматизации, но без визуального редактора и графового runtime.
- Template library + resize panel + brand kit + palette + style presets.
- Figma import через OAuth.
- AI sessions с cost tracking (AIMessage / AISession).
- S3 (Yandex Object Storage) + presign для ассетов.
- NextAuth v5 + Yandex OAuth + admin panel.

## Validated Requirements

Снимок того, что уже реализовано в кодовой базе. Детальную карту смотри в `.planning/codebase/` (ARCHITECTURE.md, STACK.md, STRUCTURE.md, CONVENTIONS.md, INTEGRATIONS.md, TESTING.md, CONCERNS.md).

### Canvas editor (Konva-based)

- Многослойный canvas (text / image / rectangle / badge / frame).
- Master-component → instance cascade (форматные биндинги).
- Resize с умным layout (AutoLayout, SmartResize).
- История undo/redo (`createHistorySlice`, MF-6 in-progress — см. `.planning/mf6/DESIGN.md`).

### AI

- Чат-агент с LLM tool-calling.
- Генерация заголовков / субтитров / изображений / шаблонов.
- VLM-анализ референсов (Gemini/OpenAI vision).

### Project & Storage

- Проекты + версии + избранное.
- Asset library + S3 upload с presign.
- Template catalog.

### Auth & RBAC

- Yandex OAuth + NextAuth v5.
- Workspace-scoped RBAC (VIEWER < USER < CREATOR < ADMIN).
- Waitlist / approved / suspended статусы.

### Integrations

- Figma import (OAuth + mapper).

## Current Milestone: v1.0 Workflow Automation — Product Reflection Scenario

**Goal:** Дать пользователю визуальный редактор сценариев автоматизации (нодовый граф а-ля ComfyUI / FloraFauna / Figma Weave) и первый встроенный сценарий — генерацию изображения продукта с реалистичным отражением на прозрачном фоне.

**Target features:**

- Визуальный node-editor на холсте (ноды + рёбра, drag/drop, zoom/pan, inspector).
- Типизированные порты и валидация соединений.
- Workflow runtime — топ-sort + исполнение узлов; lazy кэш; progress UI.
- ~5-7 базовых нод для сценария (ImageInput, BackgroundRemove, AddReflectionAI, AssetOutput, служебные).
- Страница `/workflows` — список пресетов и пользовательских сценариев; `/workflows/[id]` — редактор графа.
- Расширение `AIWorkflow` модели под графовый формат (`nodes`, `edges`, `viewport`, `version`) с миграцией.
- Пресет "Product Reflection" как стартовая точка.

**Scope decisions (зафиксированы через discuss-milestone и research):**

- Runtime **гибридный**: клиент оркестрирует, AI/S3 — на сервере.
- Background removal: **Replicate bria/product-cutout primary + cjwbw/rembg + 851-labs/background-remover fallback-каскад**. Gemini 2.5 Flash Image ИСКЛЮЧЁН из BG-пути (не поддерживает alpha channel — выяснено в research STACK.md).
- Отражение: **AI-генерация** (Bria product-shadow primary + FLUX Kontext Pro fallback), не клиентский композит.
- Точка входа: новая страница `/workflows` (не интеграция в `/photo`).
- Research first — перед requirements.

## Future Requirements (Out of Scope для v1, планируется дальше)

- v2: Клиентский композит-движок (WebGL/canvas) с узлами Blur, GradientMask, BlendMode, LayerStack, Flip, Resize, Crop — для локальных трансформаций без AI-расхода.
- v2: LLM-оркестрация графа ("построй сценарий по промпту" поверх user-graph).
- v2: Галерея пользовательских пресетов (shared workflows внутри workspace).
- v3: Realtime collaboration на графе (CRDT или OT).
- v3: Subgraphs / nested workflows.
- Backlog: Custom code nodes (safe sandbox), plugin marketplace, batch/scheduled runs.

## Out of Scope (явные исключения v1)

- Реалтайм-коллаборация на графе — слишком широкий скоуп, v3+.
- Custom code / script nodes — security risk в SaaS, backlog.
- Subgraphs / nested workflows — adds UX complexity, v3+.
- Marketplace плагинов — требует платформы и review процесса, backlog.
- Локальный WebGL-композит-движок — сознательный выбор: v1 делает reflection через AI, локальные композит-ноды в v2.

## Key Decisions Log


| Дата       | Решение                                                                                            | Контекст                                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-24 | Запуск GSD-бутстрапа с майлстоуном v1.0 Workflow Automation                                        | Проект перешёл в формальный GSD-процесс; `.planning/` до этого содержал только `codebase/` карту и точечные quick/mf6 артефакты.                                      |
| 2026-04-24 | Runtime гибридный (client orchestrates, server executes AI/S3 nodes)                               | Yandex Cloud Serverless Containers 300s maxDuration; ключи провайдеров только на сервере.                                                                             |
| 2026-04-24 | Background removal: Replicate bria/product-cutout primary + rembg + 851-labs fallback              | Research (STACK.md): Gemini Nano Banana не возвращает alpha — исключён из BG-пути. Bria обучен на лицензированном датасете → commercial-safe.                         |
| 2026-04-24 | Reflection: AI-подход (Bria product-shadow primary + FLUX Kontext fallback), не локальный композит | Scope control: v1 фокус на граф-framework, локальные трансформации — в v2. Bria product-shadow сохраняет alpha нативно.                                               |
| 2026-04-24 | Node-editor: @xyflow/react v12 (React Flow)                                                        | Research (STACK.md): MIT, React 19 совместим, активно поддерживается, типизированные порты из коробки. Отклонены tldraw (некоммерческая лицензия) и rete.js (застой). |
| 2026-04-24 | DAG runtime: graphology + graphology-dag                                                           | Research (STACK.md): лёгкий, `topologicalGenerations()` даёт параллелизм внутри поколения. Отказались от тяжёлых orchestration frameworks.                            |
| 2026-04-24 | Storage: новая колонка AIWorkflow.graph: Json? (nullable, additive)                                | Research (ARCHITECTURE.md): legacy `steps` не трогаем; миграция rollback-safe.                                                                                        |


## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):

1. Requirements invalidated? → Move to Out of Scope with reason.
2. Requirements validated? → Move to Validated with phase reference.
3. New requirements emerged? → Add to Active.
4. Decisions to log? → Add to Key Decisions.
5. "What This Is" still accurate? → Update if drifted.

**After each milestone** (via `/gsd-complete-milestone`):

1. Full review of all sections.
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state.

---

*Last updated: 2026-04-24 (bootstrap + milestone v1.0 start).*