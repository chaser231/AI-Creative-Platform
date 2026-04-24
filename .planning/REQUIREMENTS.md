# Requirements — v1.0 Workflow Automation: Product Reflection Scenario

> Требования выведены из `PROJECT.md` (scope v1.0) + `.planning/research/SUMMARY.md` (синтез STACK/FEATURES/ARCHITECTURE/PITFALLS). Каждое REQ — falsifiable: есть чёткий acceptance-критерий и способ проверки.

**Последнее обновление:** 2026-04-24.

**Легенда:**

- REQ-: уникальный stable ID для трассировки в phase plans и тестах.
- **Priority:** P0 = без этого milestone не считается выполненным, P1 = важно для качества UX, P2 = nice-to-have.
- **Phase:** фаза из `ROADMAP.md`, в которой это требование реализуется.

---

## Секция 1 — Data & Persistence

### REQ-01 · Graph storage schema (P0, Phase 1)

**Statement:** В таблице `AIWorkflow` существует nullable колонка `graph: Json?`, куда сохраняется node-based граф в формате, совместимом с React Flow (минимум: `{ nodes: [], edges: [], viewport: {x,y,zoom}, version: string }`). Legacy колонка `steps` остаётся нетронутой.

**Acceptance:**

- Prisma-миграция `add-workflow-graph` применена локально и не ломает существующие записи (`steps` читается как раньше).
- `npx prisma migrate reset --force && npx prisma migrate dev` проходит чисто.
- Откат миграции не разрушает данные (simple `DROP COLUMN`).

**Check:** `npx prisma db pull` показывает колонку `graph` типа `Json?`. SELECT работает без ошибок на записях с `graph IS NULL` и `graph IS NOT NULL`.

### REQ-02 · Workflow CRUD через tRPC (P0, Phase 2)

**Statement:** `workflowRouter` предоставляет: `saveGraph`, `loadGraph`, `list`, `getById`, `delete` с поддержкой поля `graph`. Все защищены `assertWorkspaceAccess` (минимум `USER` для list/read, `CREATOR` для write/delete).

**Acceptance:**

- `saveGraph` создаёт новый `AIWorkflow` с `graph !== null` если не передан `workflowId`, обновляет существующий иначе.
- `list` с default-фильтром `graph !== null` возвращает только графовые workflows (legacy чат-workflows скрыты).
- `list({ includeLegacy: true })` возвращает всё.
- Zod-schema параметров покрывает форматы `WorkflowGraph`.
- `delete` идемпотентен (повторный вызов на удалённый ID → ok или 404, без 500).

**Check:** интеграционные тесты на `workflow.test.ts` покрывают happy path + edge cases (нет доступа к чужому workspace → 403).

### REQ-03 · Preset seed (P0, Phase 5)

**Statement:** Workspace получает pre-seeded template workflow "Product Reflection" (`isTemplate: true`) с corrected графом из 4-х нод: ImageInput → RemoveBackground → AddReflection → AssetOutput.

**Acceptance:**

- Pre-seed выполняется через `seed` script или при создании нового workspace через post-create hook.
- Graph валиден (нет orphan edges, types связаны корректно).
- User видит preset на странице `/workflows` без отдельных action.

**Check:** smoke-тест — новый workspace → `/workflows` показывает карточку "Product Reflection".

---

## Секция 2 — Server Runtime (AI Actions)

### REQ-04 · Background removal action (P0, Phase 1)

**Statement:** Существует server-side action `remove_background`, вызываемый через `executeGraphNode`. Принимает `{ imageUrl: string }` (input), возвращает `{ imageUrl: string }` (PNG с alpha, URL в нашем Yandex S3). Использует каскад fallback: `bria/product-cutout` → `cjwbw/rembg` → `851-labs/background-remover`.

**Acceptance:**

- При успехе primary модели (Bria) — возвращается s3-URL нашего бакета (не Replicate URL).
- При ошибке primary — делается попытка следующей в каскаде; на клиенте это прозрачно.
- При отказе всех трёх — возвращается `TRPCError({ code: "INTERNAL_SERVER_ERROR" })` с понятным сообщением.
- Входной URL проходит `assertUrlIsSafe` (SSRF guard).
- Записывается `AIMessage` c `model` + `costUnits` для cost tracking.

**Check:** curl → REST endpoint `/api/workflow/execute-node` с mock image URL (Asset Library) → получаем 200 + s3 URL результата в ответе. Вручную открываем URL → PNG с alpha.

### REQ-05 · Reflection generation action (P0, Phase 1)

**Statement:** Существует action `add_reflection`, принимает `{ imageUrl: string }` (RGBA PNG от bg-removal), параметры `{ style: "mirror"|"soft"|"floor", intensity?: number, model?: "bria-product-shadow"|"flux-kontext-pro" }`. Возвращает `{ imageUrl: string }` (PNG с alpha, s3-URL).

**Acceptance:**

- Primary `bria/product-shadow` вызывается с `preserve_alpha: true`.
- Fallback `flux-kontext-pro` с post-process через bg-removal (для восстановления alpha).
- Если оба провайдера упали — TRPCError с понятным сообщением.
- Вход проходит SSRF guard.
- Cost-tracking записывается.

**Check:** curl с URL продуктового PNG (без фона) → получаем PNG с реалистичным отражением/тенью на прозрачном фоне.

### REQ-06 · Replicate URL persistence (P0, Phase 1)

**Statement:** Результаты AI action никогда не сохраняются в Asset Library / graph-state напрямую как Replicate URL — они всегда копируются в наш Yandex Object Storage через helper `uploadFromExternalUrl`. В `Asset.s3Key` / output.imageUrl — только наш URL.

**Acceptance:**

- После `remove_background` action — если прилог на Replicate URL → через 5 минут URL продолжает работать (значит, мы его закопировали в S3).
- `Asset` записи, созданные через `assetOutput` ноду, указывают на `storage.yandexcloud.net/`*.

**Check:** regression test — создать workflow run, подождать 10 минут, открыть saved asset → file доступен.

### REQ-07 · Rate limiting (P0, Phase 4)

**Statement:** `executeGraphNode` применяет `checkRateLimit` per-user: не более 20 вызовов / час. При превышении — TRPCError `TOO_MANY_REQUESTS` с понятным сообщением.

**Acceptance:**

- 21-й вызов от одного user в течение часа отклоняется.
- Счётчик сбрасывается через час.
- В UI client показывает user-facing сообщение («Вы достигли лимита запусков. Попробуйте через X минут.») в вместо generic error.

**Check:** unit test на rateLimit middleware; e2e test в Playwright с моком 20 запусков.

### REQ-08 · Max duration tuning (P0, Phase 1)

**Statement:** Endpoint, исполняющий AI-ноды, имеет `maxDuration = 300` (как и существующий `/api/ai/generate`). tRPC `workflowRouter.executeGraphNode` либо сам дополняется `maxDuration` если архитектура позволяет, либо выделяется отдельный REST-роут `/api/workflow/execute-node`.

**Acceptance:**

- В коде есть `export const maxDuration = 300` в route file (см. существующий `src/app/api/ai/generate/route.ts`).
- При Replicate cold start ~60s — запрос не вываливается в timeout.

**Check:** manual test с искусственной задержкой 90s (e.g. `bria/product-cutout` на первом после простоя запуске) — ответ успешно приходит.

---

## Секция 3 — Node-Editor UI

### REQ-09 · Страница списка workflows (P0, Phase 2)

**Statement:** Страница `/workflows` отображает сетку карточек: пресетов (isTemplate: true) + user workflows. Каждая карточка: превью (thumbnail), имя, описание, даты. Кнопка «Создать новый».

**Acceptance:**

- SSR отдаёт базовый skeleton, CSR подгружает через tRPC (`workflow.list`).
- Карточки кликабельны → `/workflows/[id]`.
- Кнопка «Создать» → `/workflows/new`.
- На карточке preset'а кнопка «Открыть шаблон» → `/workflows/new?preset=product-reflection`.
- Ответ <1s при 50 workflow'ах (текущий стандарт).

**Check:** navigate в `/workflows` в devserver → рендерится список. Lighthouse ≥90 Performance.

### REQ-10 · Страница редактора (P0, Phase 2)

**Statement:** Страница `/workflows/[id]` показывает React Flow canvas, palette (слева), inspector (справа), top-bar (имя + Run + Save). Canvas поддерживает drag/drop из palette, соединение нод, zoom/pan, мини-карту.

**Acceptance:**

- Страница рендерится через `next/dynamic({ ssr: false })` — нет hydration warning.
- При drag'е ноды из palette на canvas создаётся node instance с default params.
- Zoom ctrl+scroll работает, pan space+drag.
- State сохраняется в Zustand `useWorkflowStore`.
- Изменения debounced auto-save через 2s в `AIWorkflow.graph`.
- Кнопка «Save» force-saves.
- `beforeunload` handler force-saves при попытке закрыть вкладку с unsaved changes.

**Check:** в dev-server — drag ноды, соедини с другой, перезагрузи страницу → граф на месте.

### REQ-11 · Типизированные соединения (P0, Phase 3)

**Statement:** Попытка соединить несовместимые порты (e.g. text-out → image-in) блокируется `isValidConnection` с visual feedback.

**Acceptance:**

- При drag edge от output → над target handle: зелёная подсветка для совместимых, красная для несовместимых.
- Drop на несовместимый target — не создаёт edge (no-op).
- `PortType === "any"` матчит всё.

**Check:** manual test — попытаться соединить output imageInput с несуществующим input или несовместимым типом → edge не создаётся.

### REQ-12 · Inspector автогенерация формы (P0, Phase 3)

**Statement:** Inspector panel (правая колонка) отрисовывает форму параметров для selected node на основе Zod-schema из `NODE_REGISTRY`.

**Acceptance:**

- `text` поле → input text.
- `number` с min/max → slider или number input.
- `enum` → select dropdown.
- `boolean` → checkbox.
- Изменения немедленно вызывают `updateNodeParams` и триггерят debounced save.
- При невалидном вводе (e.g. число вне диапазона) — visual error + не сохраняется.

**Check:** выбрать `RemoveBackground` ноду → inspector показывает dropdown `model` с 3-мя опциями. Переключение → auto-save.

### REQ-13 · Node palette (P0, Phase 2 + 3)

**Statement:** Left sidebar отображает все ноды из `NODE_REGISTRY`, сгруппированные по `category` (input / ai / output), с иконкой и описанием. Поддерживается drag-drop на canvas.

**Acceptance:**

- Не менее 4 нод в v1.0: ImageInput, RemoveBackground, AddReflection, AssetOutput.
- Каждая ноду можно схватить и перетащить в canvas.
- При drop в canvas — `addNode(type, position)` с default params.

**Check:** вручную перетащить каждую ноду из palette → создаётся на canvas.

### REQ-14 · Per-node params UX русификация (P1, Phase 3)

**Statement:** Все user-facing тексты (node display names, descriptions, parameter labels, error messages) — на русском языке.

**Acceptance:**

- Display names: «Изображение», «Удалить фон», «Добавить отражение», «Сохранить в Assets».
- Error messages: «Нода требует заполнить параметр X», «Превышен лимит запусков», «Не удалось удалить фон» и т.п.
- Tooltip hover на ноду palette'е показывает описание.

**Check:** код-ревью всех текстов в `NODE_REGISTRY` + error-handler'ах.

---

## Секция 4 — Runtime / Execution

### REQ-15 · Run button + progress UI (P0, Phase 4)

**Statement:** Top-bar имеет prominent кнопку «Запустить» (Run). При нажатии — executor проходит граф от inputs к outputs. Каждая нода во время исполнения визуально показывает состояние: idle (серый) / running (spinner + синяя рамка) / done (зелёная галочка + thumbnail) / error (красный + tooltip) / blocked (серый зачёркнутый).

**Acceptance:**

- Run кнопка доступна только если `runState` не содержит `running`.
- При старте — все ноды → `idle`.
- По мере прохождения executor'а — статусы обновляются в real-time.
- После финиша — terminal ноды показывают thumbnail результата.
- При ошибке upstream'а — downstream ноды помечаются `blocked`.

**Check:** вручную запустить preset «Product Reflection» с тестовым PNG → через ~15-20 секунд все 4 ноды зелёные, AssetOutput показывает preview.

### REQ-16 · Topological execution + cycle detection (P0, Phase 4)

**Statement:** Executor строит DirectedGraph через `graphology`, проверяет `hasCycle()` и выполняет `topologicalGenerations()`. Внутри поколения — `Promise.all` (параллельно). Между поколениями — последовательно.

**Acceptance:**

- Если граф имеет цикл — Run сразу возвращает error «Граф содержит цикл», не делает запросов.
- Если есть 2 независимые ветки — они исполняются параллельно (замер time < сумма по отдельности).
- Generator-порядок стабилен между запусками (same graph → same order).

**Check:** unit-test: двух-веточный граф с двумя AI-нодами запускается за max(t1,t2), а не t1+t2.

### REQ-17 · Pre-run validation (P1, Phase 4)

**Statement:** Перед стартом executor'а — validate каждую ноду: `required` inputs соединены, `required` params заполнены. При fail — подсветить проблемные ноды, showError с описанием, Run не стартует.

**Acceptance:**

- Required порт без edge → нода красная, tooltip «Не соединён вход: Image».
- Required param пустой → нода красная, tooltip «Не выбрано изображение».
- Если всё ок → Run стартует.

**Check:** вручную открыть пустую ImageInput ноду, нажать Run → showError.

### REQ-18 · Error recovery (P1, Phase 4)

**Statement:** Если одна нода упала в Run'е — workflow halts. Промежуточные результаты успешных нод сохраняются в state (видны thumbnails). Не-исполненные downstream ноды помечаются `blocked` (не `error`).

**Acceptance:**

- Failed нода: status "error", красная рамка, tooltip с error message.
- Downstream от неё: status "blocked", серый зачёркнутый, tooltip «Upstream node failed».
- Upstream / boundary результаты — остаются `done` с thumbnails.
- Повторный Run начинает с нуля (или в v1.1 — с failed ноды).

**Check:** вручную замокать fail в `add_reflection` (invalid params) → вижу UI как описано.

### REQ-19 · Cost tracking per-node (P1, Phase 4)

**Statement:** При каждом успешном server-node execute — пишется `AIMessage` с `workspaceId`, `userId`, `model`, `costUnits`. При fail/retry/fallback — соответствующие записи создаются на каждую попытку.

**Acceptance:**

- После 1 run'а preset'а — 2 `AIMessage` (bg-removal + reflection).
- `costUnits` суммарно — в пределах ~$0.08 (primary models cost).
- Если был fallback — видно две записи для одной ноды.

**Check:** выполнить Run → SQL SELECT на `AIMessage` где `createdAt >= NOW() - INTERVAL '5 min'` → 2 записи с корректными моделями.

---

## Секция 5 — Preset "Product Reflection"

### REQ-20 · 1-click experience (P0, Phase 5)

**Statement:** Новый пользователь может за ≤ 30 секунд от входа на `/workflows` получить первый результат: клик «Открыть Product Reflection» → canvas открыт с pre-filled графом → клик на ImageInput → выбор asset из Library → клик Run → через ~15-20с видит thumbnail отражённого продукта в AssetOutput.

**Acceptance:**

- Preset карточка — визуально выделяющаяся (не обычная user workflow).
- Клик «Открыть» → `/workflows/new?preset=product-reflection` → граф pre-populated.
- Первый ImageInput без selected asset — видно visual prompt «Выберите изображение».
- Run работает на первой попытке (при корректном image input).

**Check:** пользовательский тест/сценарий: «от нажатия кнопки preset → до первого результата < 30s» (с готовым asset в library).

### REQ-21 · PNG with alpha output (P0, Phase 5)

**Statement:** Результат Run'а preset'а — PNG с прозрачным фоном, подходящий для overlay на произвольный графичный фон банера. Файл сохраняется в Asset Library workspace'а.

**Acceptance:**

- Полученный asset открыт в preview → видны transparent checkerboard пикселы по краям продукта.
- File size < 5MB для типичного продуктового фото (1000-2000px).
- Format: PNG, color space RGBA.

**Check:** manual test — скачать resulting asset, открыть в Figma / Photoshop / browser dev-tools → alpha channel присутствует.

### REQ-22 · Save user workflow (P1, Phase 5)

**Statement:** После запуска preset'а user может сохранить текущий граф как собственный workflow через клик Save → диалог с name / description.

**Acceptance:**

- Save диалог показывает default name («Product Reflection (копия)»).
- После сохранения → `/workflows` показывает новую user-workflow карточку.
- При следующем открытии user-workflow — граф идентичен сохранённому.

**Check:** вручную — create workflow, change name, save, refresh, open → всё на месте.

---

## Секция 6 — Безопасность и стабильность

### REQ-23 · SSRF защита (P0, Phase 1)

**Statement:** Все server-side actions, принимающие `imageUrl`, проходят `assertUrlIsSafe` перед внешним вызовом. Отклоняются: private IPs (10.x, 172.16-31.x, 192.168.x, 127.x), link-local, localhost, любые не-HTTPS схемы, кроме data:.

**Acceptance:**

- POST на `executeGraphNode` с `imageUrl="http://192.168.1.1/secret"` → 400 Bad Request.
- С валидным Asset Library URL (Yandex S3) → success.
- Data-URL → success (для drag-drop base64).

**Check:** security tests в `ssrfGuard.test.ts` покрывают все кейсы.

### REQ-24 · Cross-workspace защита (P0, Phase 1-2)

**Statement:** User не может читать/писать workflows или assets из чужого workspace'а через manual API-вызовы или manipulations с params.

**Acceptance:**

- `workflow.getById({ id: otherWorkspaceWorkflowId })` → 404 (скрываем существование).
- `saveGraph` игнорирует `workspaceId` из params — использует `ctx.workspaceId`.
- `assetOutput` server-side проверяет, что `workspaceId` совпадает с `ctx.workspaceId`.

**Check:** security regression тесты.

### REQ-25 · Legacy workflows isolated (P0, Phase 2)

**Statement:** Страница `/workflows` не показывает legacy чат-agent workflows (где `graph IS NULL`). Легаси-функциональность (если есть UI) продолжает работать через отдельные pathway.

**Acceptance:**

- `workflow.list` без fильтра → default фильтрует по `graph !== null`.
- Существующий AI chat UI (если использует workflows) — продолжает работать.
- В `/workflows` — только новые графовые, legacy невидим.

**Check:** manual test + UI-inspection существующих чат-страниц.

---

## Секция 7 — Tests & QA

### REQ-26 · Unit tests на executor (P1, Phase 4)

**Statement:** `executor.ts` покрыт unit-тестами на: cycle detection, topological order корректность, parallel execution внутри поколения, error propagation, pre-run validation.

**Acceptance:**

- ≥ 5 тестов в `executor.test.ts`.
- Coverage ключевых веток (cycle, single-gen, multi-gen, error halt).

**Check:** `npm test executor`.

### REQ-27 · E2E smoke test: preset run (P0, Phase 5)

**Statement:** Playwright e2e: открыть `/workflows`, кликнуть preset, запустить на тестовом image, дождаться success, проверить что asset сохранён.

**Acceptance:**

- Тест проходит стабильно в CI.
- Использует мок Replicate (чтобы не платить за каждый CI run).
- Время выполнения < 30s.

**Check:** `npm run test:e2e workflows-preset`.

### REQ-28 · Визуальная проверка дизайн-контракта (P1, Phase 5)

**Statement:** UI соответствует design system проекта (Tailwind 4 + Radix), использует существующие Button / Card / Input компоненты. Контрастность WCAG AA (см. `.cursor/rules/design-system-contrast.mdc`).

**Acceptance:**

- Code-review подтверждает использование existing primitives.
- Цвета inspector текста и фона — AA contrast.
- Кнопка Run выделена visually (primary color).

**Check:** manual review + контрастометр.

---

## Требования, намеренно отложенные на v1.1/v2

Следующее **не** входит в v1.0, но упомянуто для трассировки:

- Undo/redo в редакторе → v1.1.
- Показ предварительной стоимости run'а на Run кнопке → v1.1.
- `WorkflowRun` таблица + история запусков → v1.1.
- Cancel running workflow (через Replicate abort) → v2.
- Client-side композитные ноды (Blur, GradientMask, ...) → v2.
- LLM-generate graph from prompt → v2.
- Sharing public workflow link → v2+.
- Batch / scheduled runs → v2.
- Realtime collaboration → v3+.

## Трассировка

Каждое требование должно всплыть в `ROADMAP.md` как элемент в соответствующей фазе. Фазовые `PLAN.md` должны ссылаться на REQ-ID из этого файла при описании изменений.

---

*Last updated: 2026-04-24 (initial bootstrap at milestone start).*