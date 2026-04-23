---
slug: fix-outpaint-upload-head-timeout
completed: 2026-04-22
status: complete
---

# Summary

Исправлена ошибка `"URL rejected: HEAD/Range провалился для всех 1 IP: aborted"`, возникавшая в консоли при расширении фона (outpaint) в AI-редакторе.

## Что сделано

### `platform-app/src/server/security/ssrfGuard.ts`

1. **Разделены таймеры HEAD и fallback GET Range.** Вынесено в хелпер `requestWithOwnTimer` — каждый HTTP-запрос получает собственный `AbortController` и `setTimeout`. Раньше они шарили один signal, и медленный HEAD «съедал» весь бюджет, оставляя GET Range без времени.
2. **Добавлен ровно один retry HEAD при transient-ошибках** (`aborted`, `ECONNRESET`, `ETIMEDOUT`, `socket hang up`, `EAI_AGAIN`). Через helper `isTransientNetworkError`. Поглощает типичный CDN-хикап на `fal.media` / `replicate.delivery` без фатального HEAD_FAILED для пользователя.
3. **Увеличен `DEFAULT_HEAD_TIMEOUT_MS` с 5s до 15s** и проставлен явно в `uploadImagePolicy()` и `agentAddImagePolicy()`. Реалистичный бюджет для cold-cache CDN.

### `platform-app/src/utils/imageUpload.ts`

- `uploadExternalUrlToS3`: `console.error` → `console.warn` с префиксом `[imageUpload]`. Путь graceful-fallback (функция возвращает `null`, caller падает обратно на исходный URL), но раньше в dev-консоли это выглядело как unhandled error.

### `platform-app/src/server/security/__tests__/ssrfGuard.test.ts`

- Добавлен regression-test: `uploadImagePolicy().headTimeoutMs` должен быть ≥ 10s.

## Проверка

- `npx vitest run src/server/security/__tests__/ssrfGuard.test.ts` → 33/33 passed (было 32, добавлен 1).
- Линтер: ошибок нет.

## Оставшиеся риски

- Верхний предел общего `safeFetch` таймаута теперь `15s * 6 = 90s` вместо `30s`. Это только для одной загрузки фонового изображения и по-прежнему ограничено `AbortSignal.timeout`. Приемлемо для сценария outpaint, где upstream-сервер реально может быть медленным.
- Если `fal.media` недоступен дольше 15s+retry, ошибка всё равно вернётся пользователю — но это уже реальная недоступность, не flakiness. Клиент корректно деградирует (возвращает исходный URL).
