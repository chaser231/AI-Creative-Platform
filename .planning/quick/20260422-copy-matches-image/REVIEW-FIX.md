---
phase: quick-20260422-copy-matches-image
fixed_at: 2026-04-22T16:59:06Z
review_path: .planning/quick/20260422-copy-matches-image/REVIEW.md
fix_scope: selective-wr04-wr05
findings_in_scope: 2
fixed: 2
skipped: 5
iteration: 1
status: partial
commits:
  - b75ae94 fix(agent): guard preGeneratedImageUrl before it enters canvasState (WR-04)
  - dcf781c fix(ai-chat): friendlyFetch uses correct envelope per tRPC link (WR-05)
---

# Code Review Fix Report — PR #56

## Scope

Из 7 warning'ов в `REVIEW.md` пользователь выбрал закрыть **только WR-04
и WR-05** до merge — это два finding'а, которые напрямую затрагивают
код, меняемый этим же PR (SSRF guard на новом пути + envelope-mismatch
в новом `friendlyFetch`). Остальные warning'и (WR-01/02/03/06/07)
помечены как follow-up и остаются open; их предлагается закрыть
отдельным quick-таском.

Info-пункты (IN-01..IN-06) также пропущены в этой итерации.

## Fixed

### WR-04 — `lastGeneratedImageUrl` теперь проходит SSRF/scheme guard

**Commit:** `b75ae94`

**Changes:**

1. `platform-app/src/server/routers/workflow.ts::applyTemplate` — схема
   input'а ужесточена: `lastGeneratedImageUrl` теперь принимает только
   `http(s)://` URL или `data:image/...` blob. Любые другие схемы
   (`javascript:`, `file:`, `gopher:`, произвольные data: с text/html)
   отклоняются zod'ом до входа в mutation.

2. `platform-app/src/server/agent/executeAction.ts::apply_and_fill_template` —
   сразу после парсинга `preGeneratedImageUrl` добавлен guard по тому
   же паттерну, что уже применяется в `place_on_canvas::image`
   (строки 269-280 оригинала):

   ```typescript
   if (preGeneratedImageUrl && !/^data:image\//i.test(preGeneratedImageUrl)) {
     try {
       await assertUrlIsSafe(preGeneratedImageUrl, agentAddImagePolicy());
     } catch (e) {
       if (e instanceof SsrfBlockedError) {
         console.warn(`[Template Fill] preGeneratedImageUrl rejected (${e.code}): ${e.reason}`);
         preGeneratedImageUrl = undefined;
       } else {
         throw e;
       }
     }
   }
   ```

   При отклонении URL падает в `undefined` — копирайтинг и генерация
   картинки продолжаются без него. Лог не содержит полный URL (в
   соответствии с существующим правилом, т.к. temp-URL могут нести
   токены).

**Defensive layers (both fire):**

- **Layer 1 — zod:** блокирует всё, что не http(s) и не `data:image/`.
- **Layer 2 — assertUrlIsSafe:** блокирует http(s) URL'ы на приватные
  IP, loopback, link-local, запрещённые порты и т.п. (политика
  `agentAddImagePolicy()`).

### WR-05 — `friendlyFetch` теперь выбирает envelope по URL

**Commit:** `dcf781c`

**Changes:**

`platform-app/src/components/providers/TRPCProvider.tsx` — хэлпер
определяет режим по query-параметру `batch=`:

```typescript
const requestUrl =
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
const isBatched = /[?&]batch=/.test(requestUrl);
const body = isBatched ? JSON.stringify([envelope]) : JSON.stringify(envelope);
```

- `httpBatchLink` POST'ит на `...?batch=1` → отдаём `[{error:...}]`
  (массив — batched envelope).
- `httpLink` (для `workflow.applyTemplate` и
  `workflow.interpretAndExecute`) POST'ит без `batch=` → отдаём
  `{error:...}` (объект — non-batched envelope).

Документация в комментарии хелпера обновлена, чтобы будущие
поддерживающие видели это правило.

**Behavioural impact:** при реальном 502/504 на длинные ручки
пользователь теперь увидит аккуратное «Сервер не ответил вовремя,
попробуйте ещё раз», а не `Unable to transform response from server`.
Собственно, то, ради чего весь `friendlyFetch` и был добавлен.

## Skipped (follow-up)

| ID | File | Reason |
|---|---|---|
| WR-01 | `project.ts::saveState` | Stale `updatedAt` в CONFLICT.cause — косметика, лишний round-trip. Не блокер для merge. |
| WR-02 | `/api/canvas/save/route.ts` | Beacon endpoint: no userId в логе, две транзакции. Требует более аккуратного рефакторинга — отдельный quick-таск. |
| WR-03 | `project.saveState.test.ts` | Не покрыты unauthorized / VIEWER / missing project. Лучше добавить пачкой в отдельном todo. |
| WR-06 | `workflow.ts::trackAgentCosts` | Race `findFirst + create` → надо переходить на `upsert`. Требует миграции уникального индекса. Отдельный todo. |
| WR-07 | `importWorker.ts::cleanupFailedImport` | Unhandled rejection при transient DB. Узкий edge-case, обрамим `.catch()` — отдельный todo. |

Info-пункты IN-01..IN-06 — пропущены.

## Verification

- ✅ `tsc --noEmit` — clean
- ✅ `eslint` — 0 errors (2 pre-existing warnings на нетронутых строках 472, 244)
- ⬜ Ручная проверка `friendlyFetch` non-batched envelope — имеет смысл
  сделать в UAT (остановить serverless container и триггерить 502
  на `applyTemplate`, убедиться что клиент увидит аккуратное
  сообщение, а не parse error).
- ⬜ Ручная проверка SSRF guard — отправить невалидный `lastGeneratedImageUrl`
  (напр. `javascript:void(0)`) и убедиться, что mutation вернёт 400
  от zod, а не запишет это в canvasState.

## Next steps

- **Merge PR #56** — оба блокирующих warning'а закрыты.
- **Create follow-up todo** — собрать WR-01/02/03/06/07 и IN-\* в один
  quick-таск «stability polish after PR #56» и закрыть отдельно.
