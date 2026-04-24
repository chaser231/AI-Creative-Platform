# Research: Подводные камни Workflow Automation (v1.0)

> Цель: перечислить риски и предупредить типичные проблемы при добавлении node-based editor + runtime в существующий Next.js 16 + Yandex Cloud Serverless проект. Приоритет: P0 (блокер запуска / риск потери данных / безопасность) → P1 (ухудшение UX или перфоманс) → P2 (nice-to-fix, edge cases).

## Summary: Топ-5 рисков

1. **[P0] Replicate cold start > 60s рискует упасть на обычном tRPC endpoint с ~60s timeout.** В Yandex Cloud Serverless Containers только AI-роуты имеют `maxDuration: 300s`; обычный `workflowRouter` — default (гораздо короче). **Mitigation:** добавить в `executeGraphNode` флаг `export const maxDuration = 300` на API route, а лучше выделить отдельный REST-endpoint `POST /api/workflow/execute-node` по паттерну `/api/ai/generate`. Phase 1.
2. **[P0] SSR/hydration для xyflow на Next.js 16 + React 19.** xyflow требует window и React-18-паттерны хуков; forced `"use client"` + `next/dynamic({ ssr: false })` обязательны. Без этого — mismatch при первом рендере и мерцание. Phase 2.
3. **[P0] Replicate URL для результата истекает ~через 1 час — обязательно копировать в наш S3 сразу.** Иначе — сохранённый asset через неделю превратится в мёртвую ссылку. **Mitigation:** `uploadFromExternalUrl(replicateUrl)` → наш Yandex Object Storage → сохранять **только** S3 URL в assets. Phase 1.
4. **[P0] AIWorkflow.steps vs AIWorkflow.graph совместимость.** Existing `interpretAndExecute` читает `steps`, новый executor читает `graph`. Если в UI смешаются — бардак. **Mitigation:** в `workflowRouter.list` возвращать discriminator `mode: "legacy" | "graph"` (по `graph !== null`), UI показывает только графовые на `/workflows` странице. Legacy чат-workflows — скрыты или в отдельной вкладке. Phase 2.
5. **[P1] Cost blow-up — без per-workspace rate-limit один пользователь может сжечь бюджет.** Каждый Run = $0.04-0.08 Replicate calls × N runs. **Mitigation:** применить `checkRateLimit` из `lib/rateLimit.ts` к `executeGraphNode` (e.g. 20 runs/hour на user). Hard cap в v1.0 — per-workspace daily quota вводится в v1.1 через `WorkflowRun` таблицу. Phase 1 / Phase 4.

Остальные риски — в секциях ниже, сгруппированы по источнику.

---

## 1. Node Editor Integration (xyflow/reactflow + Next.js 16)

### [P0] SSR / hydration mismatch

**Где:** `/workflows/[id]` страница при первом рендере.
**Как проявляется:** blank canvas на первый tick, потом flash с нодами; в консоли warning `Hydration failed because the initial UI does not match what was rendered on the server`.
**Причина:** xyflow использует `window.getComputedStyle`, `ResizeObserver`, drag-handlers — всё client-only. При SSR компонент пытается измерить DOM, получает `undefined`.
**Предотвращение:**
```tsx
// src/app/workflows/[id]/page.tsx
"use client"; // тоже нужен для Zustand store
import dynamic from "next/dynamic";
const WorkflowEditor = dynamic(() => import("@/components/workflows/WorkflowEditor"), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});
```
**Фаза:** Phase 2.

### [P1] CSS-конфликты с Tailwind CSS 4

**Где:** React Flow shipает свой CSS (`@xyflow/react/dist/style.css`), некоторые классы (`.react-flow__node`, `.react-flow__edge`) могут переопределяться proectными default-стилями Tailwind preflight.
**Mitigation:** импортировать xyflow CSS **после** Tailwind, локально в WorkflowEditor компоненте. Проверить что `body { overflow: hidden }` не ломает scroll внутри canvas (xyflow sets own `touch-action: none`).
**Фаза:** Phase 2.

### [P1] Bundle size (~60 KB gzipped)

**Где:** client bundle `/workflows/*`.
**Mitigation:** route-level code-split — xyflow попадает только в `/workflows/*` bundle благодаря `next/dynamic`. Главная страница и `/editor` не затрагиваются. **Фаза:** Phase 2.

### [P2] React Compiler compatibility

Next.js 16 включает React Compiler по умолчанию. `@xyflow/react` использует классические useEffect-паттерны — не должно ломаться, но добавить smoke test с включённым Compiler-ом.

---

## 2. Replicate API

### [P0] Cold start 30-60s + server timeout

**Где:** первый вызов модели после простоя.
**Как проявляется:** tRPC endpoint истекает раньше, чем Replicate отдаёт результат; user видит 504/timeout error.
**Предотвращение:**
- Выделить `executeGraphNode` в отдельный **REST**-роут (`/api/workflow/execute-node/route.ts`) с `export const maxDuration = 300`. tRPC-route не даёт per-endpoint control над maxDuration (весь `[trpc].route.ts` разделяет один maxDuration).
- На клиенте показывать «Запускаем модель... это может занять до 1 минуты» с spinner.
- Retry с exponential backoff при 503/timeout от Replicate.
**Фаза:** Phase 1 / Phase 4.

### [P0] Rate limits 429

**Где:** Replicate плоский лимит ~600 запросов/минуту на аккаунт.
**Как проявляется:** 429 Too Many Requests.
**Предотвращение:** retry with exponential backoff (1s, 2s, 4s, 8s), max 3 попытки. При финальном fail → fallback на следующую модель в каскаде (bria → rembg → 851-labs).
**Фаза:** Phase 1.

### [P0] Output URLs expire

**Где:** любой Replicate response — url action.
**Как проявляется:** workflow run вчера сохранил в БД Replicate URL — сегодня в asset library 404 на preview.
**Предотвращение:** немедленный download Replicate URL и upload в Yandex S3 **до** завершения tRPC-запроса. Сохранять в `Asset.s3Key` только наш URL. Helper `uploadFromExternalUrl` в `src/server/workflow/helpers.ts`.
**Фаза:** Phase 1 (обязательно реализовать в первой же версии `remove_background` action).

### [P1] Biling per-run vs per-second

**Где:** `bria/product-cutout` — per-image pricing (~$0.04/img). FLUX Kontext и некоторые — per-second GPU time.
**Mitigation:** в `ai-models.ts.costPerRun` хранить наш best estimate. Перед v1.0 — сделать 5-10 test запусков каждой модели и замерить реальную latency/cost.

### [P2] Replicate webhook vs polling

Сейчас `ai-providers.ts` использует polling (`REPLICATE_MAX_POLLS = 120`). Для длинных моделей webhook был бы лучше, но Yandex Serverless требует inbound HTTPS endpoint + verification signature — усложнение без justification для v1.0. Остаёмся на polling.

---

## 3. Gemini 2.5 Flash Image (Nano Banana) — вспомогательно

### [P1] Нет alpha channel

**Зафиксировано в STACK.md:** Gemini 2.5 Flash Image не возвращает PNG с прозрачностью. **Исключён из v1.0 BG-removal / reflection путей.** Остаётся в model registry для **других** будущих нод (style transfer, text-to-image без требования alpha).

### [P1] Ограниченная control над выходом

**Mitigation:** при первом появлении Gemini-ноды в v2+ — заранее учесть что output — RGB. Не обещать alpha где её нет.

---

## 4. Graph Runtime

### [P0] Циклы в графе

**Где:** user соединяет output → upstream input, создавая цикл.
**Как проявляется:** бесконечный loop или зависание.
**Предотвращение:** 
1. Клиент: `isValidConnection` проверяет через BFS что не создаётся back-edge.
2. Сервер + executor: `graphology-dag.hasCycle()` перед топ-sort → throw `ValidationError("Граф содержит цикл")`. Абсорт выполнения.
**Фаза:** Phase 3 (клиент) + Phase 4 (executor).

### [P1] Авто-run при изменении параметра

**Где:** если бы параметры вызывали re-execution автоматически.
**Как проявляется:** каждый slider-drag триггерит 10 tRPC-запросов.
**Предотвращение:** **НЕ делаем** auto-run в v1.0. Run — только по явной кнопке. В inspector при изменении params — просто пометка `runState[nodeId].status = "idle"` (invalidates previous result), но не запуск.

### [P1] Кэш результатов — корректность

**Где:** `nodeResults` Map между поколениями.
**Как проявляется:** при partial re-run (v2) — может вернуть stale result, если mutated params ноды.
**Предотвращение:** в v1.0 — always full re-execution (кэш только в рамках одного runAll). В v2 — хешировать `(nodeId, params, upstream-hashes)` для пропуска нод.

### [P1] Memory leak больших image buffers

**Где:** Map<nodeId, result> с URL (не в blob); но если в будущем запомним base64 — expensive.
**Mitigation:** в v1.0 все промежуточные результаты = S3 URLs (не data-urls, не blob). Легковесно (строка < 200 байт).

### [P2] Race condition при изменении графа во время Run

**Где:** user жмёт Run → дёргает ноду → delete edge, пока ещё исполняется.
**Предотвращение:** блокировать edit-interactions во время `running = true`. UX: edges frozen, nodes не draggable, inspector read-only. Кнопка Run превращается в Cancel (TBD в v2).

---

## 5. AI Reflection Generation — особенности

### [P1] Неконсистентность результата (seed control)

**Где:** `flux-kontext-pro` даёт разные отражения при разных запусках.
**Как проявляется:** user unhappy that "second run gave different shadow".
**Mitigation:** для FLUX Kontext — фиксировать `seed` в `data.params` (random на первом запуске, cached). Для Bria product-shadow — их модель детерминистична по built-in фиксированным hyperparameters.

### [P1] Alpha preservation в flux-kontext-pro

**Где:** fallback путь.
**Как проявляется:** FLUX Kontext возвращает RGB. Приходится делать extra bg-remove post-process.
**Mitigation:** **сознательное решение** — fallback путь чуть дороже и медленнее primary. Документировано в STACK.md. Primary `bria/product-shadow` не требует этого.

### [P2] Watermarks в некоторых моделях

**Mitigation:** все выбранные модели (Bria, FLUX Kontext через BFL commercial) — **без watermark**. DALL-E / Imagen были бы с watermark, но не в нашем каскаде.

### [P1] GDPR / consent при user-загрузке фото с людьми

**Где:** theoretically user может загрузить фото человека в `ImageInput` → мы скормим в Bria/FLUX.
**Mitigation:** ToS workspace-а уже запрещает non-own content. Bria имеет `content_moderation: true` флаг — использовать. Документировать в onboarding: «загружайте только продуктовые изображения».

---

## 6. Existing AIWorkflow Compatibility

### [P0] Разделение legacy steps vs новый graph

**Где:** одна таблица `AIWorkflow` с двумя семантиками.
**Как проявляется:** UI `/workflows` показывает все записи, включая legacy LLM-agent workflows, user кликает — ломается (редактор ожидает `graph`, а там null).
**Предотвращение:**
- В `workflowRouter.list` добавить фильтр по умолчанию `where: { graph: { not: null } }` — на новой странице `/workflows` показываются **только** графовые.
- Legacy workflows (используемые в чат-UI) остаются доступны через прежние queries (`list` без фильтра) — для существующего AI-chat UI.
- Возможно, завести отдельный `select: { mode: "graph" | "legacy" }` virtual field через computed. Проще — просто фильтр в list-query.
**Фаза:** Phase 2.

### [P1] Migration data loss fear

**Где:** если кто-то начнёт делать migration скрипт «конвертировать steps в graph».
**Mitigation:** **не делаем** конверсию. steps-workflows остаются как есть. Новые — пишутся как graph. Параллельное сосуществование.

---

## 7. Async / Progress / Yandex Cloud Limits

### [P0] tRPC subscriptions (WebSocket) не поддерживаются

**Где:** Yandex Cloud Serverless Containers / API Gateway.
**Как проявляется:** если бы попытались сделать live progress через tRPC subscription — не заработало бы.
**Предотвращение:** в v1.0 **per-node полный запрос-ответ** — каждая нода = синхронный tRPC call с waitum до 300s. Client видит progress на уровне "какая нода сейчас running". Real-time 0-100% progress внутри ноды — не поддерживается.
**Фаза:** Phase 4.

### [P1] SSE streaming ненадёжен в Yandex Gateway

**Где:** если бы использовали SSE для progress.
**Mitigation:** не используем. Видели в `/api/ai/generate` — там стриминг LLM-tokens работает, но бывают проблемы с буферизацией Yandex API Gateway (замечено в codebase).

### [P2] Concurrent executions per user

**Where:** user открывает 3 вкладки, жмёт Run в каждой одновременно.
**Mitigation:** ok для MVP (Replicate лимит сам ограничит). Для prod — v1.1 per-user concurrency limit через Redis / in-memory semaphore.

### [P1] Закрыл вкладку во время выполнения

**Где:** user navigate away → tRPC request aborted клиентом, но сервер продолжает.
**Как проявляется:** Replicate всё равно биллит полный прогон; результат потерян (нет места сохранить). Платим deньги впустую.
**Mitigation v1.0:** accept. В v2 — `WorkflowRun` таблица + polling; при abort — сохранить results в DB для повторного запроса при возврате.

---

## 8. Security (SSRF, CSP, Auth)

### [P0] SSRF через `ImageInput.sourceUrl`

**Где:** если дать user paste произвольный URL.
**Mitigation:** в v1.0 **`ImageInput` принимает только assetId** (ссылки в нашу Asset library) + data-url (base64 из drag-drop). Никаких произвольных https URL. Плюс `assertUrlIsSafe` на сервере перед внешними вызовами Replicate с image_url.
**Фаза:** Phase 3 (клиент ограничивает), Phase 1 (server-guard).

### [P1] CSP для Replicate delivery URLs

**Где:** если показываем Replicate thumbnails до их сохранения в S3.
**Mitigation:** **не показываем** temporary Replicate URLs в UI. Всегда копируем в наш S3 → URL из `storage.yandexcloud.net/acp-assets/` → уже разрешён в `next.config.ts` `images.remotePatterns`.

### [P1] Cross-workspace asset leak

**Где:** user пишет в `assetOutput.params` workspaceId другого workspace-а (через devtools или ручной POST).
**Mitigation:** server-side — `assertWorkspaceAccess(ctx, ctx.workspaceId, "CREATOR")` в `saveGraph` и `executeGraphNode`. workspaceId берётся **из ctx**, не из params.

---

## 9. Cost Tracking & Rate Limits

### [P0] Per-workspace budget overrun

**Где:** один зловредный user × 1000 runs × $0.08 = $80/час.
**Mitigation v1.0:** `checkRateLimit` в `lib/rateLimit.ts` — in-memory token bucket, 20 runs/hour per user. Per-workspace — v1.1 (требует Redis или DB counter).
**Фаза:** Phase 4.

### [P1] Cost attribution per workflow

**Где:** в `trackAgentCosts` сейчас агрегируется по session. Для workflow — нужно understand какой workflow сколько стоит.
**Mitigation:** в `AIMessage` добавить nullable `workflowId` поле через миграцию (v1.1) либо писать в `content` JSON с workflowId для aggregation. v1.0 — не обязательно, но учесть.

---

## 10. UX & Error Handling

### [P1] User не понимает почему ребро не соединяется

**Где:** `isValidConnection` блокирует некорректное соединение, но без visual feedback кажется «сломано».
**Mitigation:** при drag edge — подсветить валидные target handles (зелёным) и невалидные (красным). xyflow поддерживает через `isValidConnection + onConnectStart/onConnectEnd`.
**Фаза:** Phase 3.

### [P1] Required param не заполнен

**Где:** user жмёт Run на графе с пустым `ImageInput.assetId`.
**Mitigation:** pre-run валидация в `runAll()` — обходим ноды, Zod-validate `params`. При fail — подсветить проблемные ноды, showError "Нода 'Изображение' требует выбрать картинку".

### [P1] Error recovery

**Где:** нода `BackgroundRemove` упала (Replicate 503).
**Mitigation v1.0:** halt workflow, промежуточные результаты остаются видны (preview thumbnail у `ImageInput`). Error message в failed ноде. Нажать Run — попытка с нуля (fallback каскад уже должен был сработать).

### [P2] Показать tooltip «что делает эта нода»

В inspector — короткий описательный текст из `NODE_REGISTRY[type].description`. Nice-to-have, Phase 3.

---

## Phase Allocation

| Pitfall | ID | Phase |
|---|---|---|
| maxDuration / REST vs tRPC | 2.[P0] cold start | Phase 1 |
| SSRF guard | 8.[P0] | Phase 1 |
| Replicate URL expiration | 2.[P0] | Phase 1 |
| AIWorkflow.steps vs graph | 6.[P0] | Phase 2 |
| SSR hydration xyflow | 1.[P0] | Phase 2 |
| CSS конфликты Tailwind 4 | 1.[P1] | Phase 2 |
| isValidConnection UX | 10.[P1] | Phase 3 |
| Node params Zod validation | 10.[P1] | Phase 3 |
| Cycle detection | 4.[P0] | Phase 4 |
| Pre-run validation | 10.[P1] | Phase 4 |
| Rate limit | 9.[P0] | Phase 4 |
| Auto-run дисциплина | 4.[P1] | Phase 4 |
| Cost attribution | 9.[P1] | Phase 4 / 5 |
| seed control для FLUX | 5.[P1] | Phase 4 |
| Concurrent per-user | 7.[P2] | v1.1 backlog |
| Bundle code-split | 1.[P1] | Phase 2 verification |

---

## Open Questions

1. **Per-user rate-limit на executeGraphNode.** Какое число runs/hour — 10? 20? 50? Рекомендация для MVP: 20/hour на пользователя (достаточно для pet-test, блокирует abuse).

2. **Какой REST endpoint для executeGraphNode.** Рекомендация: новый `POST /api/workflow/execute-node/route.ts` с `maxDuration = 300` по паттерну `/api/ai/generate`. Использовать `requireSessionAnd*` wrapper для auth. Процедура в `workflowRouter` остаётся как deprecated alias для dev/testing.

3. **Где включить xyflow CSS.** Решение: локально в `WorkflowEditor.tsx` — `import "@xyflow/react/dist/style.css"`. Это inline CSS попадёт в chunk routes-specific, не влияет на остальные страницы.

4. **Fallback ordering для BG-removal.** Bria → rembg → 851-labs или Bria → 851-labs → rembg? Рекомендация: user-facing caskad по (quality, cost):
    - Primary: `bria-product-cutout` (best quality + commercial safe).
    - Fallback 1: `cjwbw/rembg` (already integrated, $0.002).
    - Fallback 2: `851-labs/background-remover` (cheapest $0.00043).

5. **Зашифрованные ID workflow's в URL.** `/workflows/[id]` использует cuid — нельзя ли сделать враг shared link с short-id? Рекомендация: оставить cuid, если появится запрос на sharing — добавить отдельное поле `shareSlug` в Phase post-v1.0.

6. **Drag image прямо в canvas (без попадания на конкретную ноду).** Nice-to-have UX. xyflow поддерживает drop targets — можно создать ImageInput ноду автоматически в месте drop. Рекомендация: Phase 5 (polish), если время позволит.

7. **Showing cost pre-run.** Из `NODE_REGISTRY` + текущих моделей вычислим total cost estimate. Показывать в кнопке Run как «Запустить ($0.08)». Рекомендация: v1.1, не блокер MVP.
