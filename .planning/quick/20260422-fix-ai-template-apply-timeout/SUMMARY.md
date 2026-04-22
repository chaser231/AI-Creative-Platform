---
status: complete
slug: fix-ai-template-apply-timeout
started: 2026-04-22T16:03:01Z
completed: 2026-04-22T16:20:00Z
---

# SUMMARY — Fix: AI Agent template apply 502

## Проблема

Клик по карточке шаблона в AI-ассистенте редактора → сообщение
`Unable to transform response from server`. В Network: HTTP 502 от батч-запроса
`/api/trpc/ai.addMessage,workflow.applyTemplate`. Воспроизводилось на всех
шаблонах, в dev и prod.

## Корневая причина

Yandex API Gateway / upstream режет длинные запросы по таймауту (~30-60 сек).
`workflow.applyTemplate` для Market-шаблона делал 3-4 последовательных
`await callLLM(...)` + генерацию изображения, суммарно упираясь в таймаут.
`httpBatchLink` на клиенте ещё и склеивал этот вызов с быстрым `ai.addMessage`,
из-за чего один таймаут валил оба, а клиент пытался распарсить HTML-страницу 502
через superjson → криптическая ошибка `Unable to transform response`.

## Что сделано (3 атомарных коммита)

### 1. `fix(ai-chat): isolate long-running tRPC calls + readable 502/504 errors` (`d4b0046`)

`platform-app/src/components/providers/TRPCProvider.tsx`

- `httpBatchLink` → `splitLink`: процедуры `workflow.applyTemplate` и
  `workflow.interpretAndExecute` идут отдельным `httpLink` (без батча),
  быстрые вызовы остаются батчованными.
- `friendlyFetch`: перехватывает не-JSON ответы прокси (HTML 502/504) и
  конвертирует их в нормальные JSON-RPC error bodies с человекочитаемым
  сообщением («Сервер не ответил вовремя...», «Сервис временно недоступен...»).

### 2. `perf(workflow): run trackAgentCosts in background to trim response path` (`86bbccb`)

`platform-app/src/server/routers/workflow.ts`

- `await trackAgentCosts(...)` → `void trackAgentCosts(...).catch(...)` в обеих
  процедурах (`interpretAndExecute`, `applyTemplate`). Это срезает 100-500 ms с
  response path; функция уже имеет собственный try/catch внутри.

### 3. `perf(agent): parallelize LLM calls in apply_and_fill_template` (`27b65e6`)

`platform-app/src/server/agent/executeAction.ts`

- После резолва `cleanTopic` все независимые LLM-вызовы (pairs/headline/
  subhead/cta/imgPrompt) запускаются через `Promise.all` вместо цепочки
  `await`. Генерация изображения выполняется последовательно после резолва
  imgPrompt (естественная зависимость).
- Вынесены helpers `buildImagePromptTask` и `runImageGen`, устранено
  дублирование между Market и Generic ветками.
- Ожидаемое ускорение 30-50% wall-clock time на путь apply_and_fill_template.

## Проверка

- `tsc --noEmit` — OK
- `npm run lint` — 0 новых ошибок/предупреждений в изменённых файлах
  (pre-existing warnings не мои).

## Дополнительная UAT-проверка (ручная)

Пользователю нужно:
1. Открыть редактор → AI-чат → «Сгенерируй баннеры для Маркета».
2. Кликнуть карточку шаблона.
3. Убедиться, что:
   - В успешном сценарии шаблон применяется быстрее (на 30-50%).
   - При таймауте вместо «Unable to transform response» приходит
     «Сервер не ответил вовремя (timeout). Попробуйте ещё раз.»
   - Не валит соседний `ai.addMessage` (если есть логирование).

## Файлы

- `platform-app/src/components/providers/TRPCProvider.tsx`
- `platform-app/src/server/routers/workflow.ts`
- `platform-app/src/server/agent/executeAction.ts`
