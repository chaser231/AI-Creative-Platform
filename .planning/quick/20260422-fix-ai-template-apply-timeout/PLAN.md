---
slug: fix-ai-template-apply-timeout
status: in-progress
created: 2026-04-22T16:03:01Z
---

# Fix: AI Agent — Apply Template 502 / "Unable to transform response"

## Symptom

Клик по карточке шаблона в AI-чате → сообщение `Unable to transform response from server`.
В Network: `/api/trpc/ai.addMessage,workflow.applyTemplate?batch=1` → **HTTP 502**,
время ~20–60 сек до падения. Повторяется на всех шаблонах, в dev и prod.

## Root cause

1. Yandex Cloud API Gateway / upstream режет запросы по таймауту (502).
2. `workflow.applyTemplate` для Market-шаблона выполняет подряд 3-4 LLM-вызова
   + генерацию изображения (flux-schnell, 5-30 сек). Суммарно может превышать
   таймаут шлюза.
3. tRPC `httpBatchLink` склеивает `ai.addMessage` + `workflow.applyTemplate`
   в один HTTP. Один таймаут валит оба + мешает изолированной обработке ошибок.
4. Клиент интерпретирует HTML-страницу 502 как superjson-ответ → падает с
   `Unable to transform response from server`, пользователь не понимает суть.
5. `trackAgentCosts` после `applyTemplate` добавляет ещё БД-запросы, удлиняя
   response path.

## Plan (atomic commits)

**Commit 1 — client: split link + readable error**
- `TRPCProvider.tsx`: заменить `httpBatchLink` на `splitLink`:
  разбатчивать endpoints `workflow.applyTemplate`, `workflow.interpretAndExecute`
  (long-running) в `httpLink` (no batch); остальные — в `httpBatchLink`.
- Навесить custom `fetch` на оба link'а: если `!res.ok` или `content-type` не
  `application/json`, читаем текст и бросаем `TRPCClientError` с человекочитаемым
  сообщением («Сервер не ответил (502). Попробуйте ещё раз» и т.п.).
- Проверить: клик по шаблону → ошибка сети отображается читаемо.

**Commit 2 — server: background cost tracking**
- `workflow.ts`: убрать `await` перед `trackAgentCosts` в `applyTemplate`
  и `interpretAndExecute`. Использовать `void trackAgentCosts(...).catch(...)`
  с `console.error` — функция уже внутри try/catch.
- Это режет ~100-500 ms с response path, снижает шанс 502 на grace-периоде.

**Commit 3 — server: parallelize LLM calls in apply_and_fill_template**
- Сейчас для Market-шаблона: cleanTopic → pairsLLM → CTA LLM →
  imagePromptLLM → imageGen. Все `await` последовательны.
- Переписать: после `cleanTopic` запустить параллельно `pairsLLM` и
  `ctaLLM` и (если нужен) `imagePromptLLM` через `Promise.all`, затем `imageGen`.
- Для generic-ветки аналогично: headline + subtitle + cta + imagePrompt в
  параллель, затем imageGen.
- Ожидаемое ускорение: 30-50%, т.к. LLM latency доминирует.

## Risk & mitigation

- **Риск:** изменение порядка LLM-вызовов может поломать зависимости
  (headline → зависит от cleanTopic; imagePrompt → не зависит от текстов).
  **Mitigation:** внимательно сохранить зависимости. `cleanTopic` остаётся
  последовательным. Все остальные LLM — независимы.
- **Риск:** `splitLink` может не передать referrer/cookies одинаково.
  **Mitigation:** оба link'а идут на тот же `/api/trpc`, cookies сами идут.
- **Риск:** фоновый `trackAgentCosts` может потерять ошибки.
  **Mitigation:** `.catch(console.error)` — у функции уже есть внутренний try/catch.

## Verification

- `npm run lint` (platform-app)
- `npm run build` (platform-app) или `tsc --noEmit` если build тяжелый
- Ручная проверка UI — клик по шаблону, ожидание ответа, проверка что
  502 → понятное сообщение, а не «Unable to transform response».

## Files touched

- `platform-app/src/components/providers/TRPCProvider.tsx`
- `platform-app/src/server/routers/workflow.ts`
- `platform-app/src/server/agent/executeAction.ts`
