---
slug: fix-outpaint-upload-head-timeout
created: 2026-04-22
status: complete
---

# Fix: "URL rejected: HEAD/Range провалился для всех 1 IP: aborted" при outpaint

## Симптом
При ai-редактировании "Expand Background" (outpaint) в `AIPromptBar` в консоли появляется:

```
URL rejected: HEAD/Range провалился для всех 1 IP: aborted
  at uploadExternalUrlToS3
  at persistImageToS3
  at AIPromptBar.callImageEdit
```

Сервер `/api/upload` возвращает 400 с `code: HEAD_FAILED`.

## Корневая причина

1. **SSRF-guard `headCheck()` имеет жёсткий таймаут 5 секунд на весь цикл HEAD → fallback GET Range**
   (`platform-app/src/server/security/ssrfGuard.ts:582-614`).
   На каждый IP создаётся один `AbortController` с `setTimeout(ac.abort(), 5000)`,
   но **один и тот же `ac.signal` используется и для HEAD, и для fallback GET Range**.
   Если HEAD занимает 4.5с (медленный CDN), на GET Range остаётся 500мс → он падает с `"aborted"`.

2. **`fal.media` (CDN для результатов bria-expand) медленно отвечает на HEAD/GET на больших изображениях**
   — это уже отмечено в комментариях `AIPromptBar.tsx:445-448`: "fal.ai media hosts occasionally stall the request or omit CORS headers". У outpaint-результата итоговый файл часто 5–15MB, и первый запрос к конкретной граничной ноде CDN может занять 8–12с (cold cache).

3. **Нет retry при сетевых срывах**: если HEAD упал один раз из-за случайного RST/aborted, guard возвращает фатальную ошибку.

## Решение

### 1. Разделить таймеры HEAD и fallback GET Range

В `headCheck()` создать **отдельный** `AbortController` + `setTimeout` для HEAD и для GET Range. Так у каждого запроса будет полный бюджет таймаута.

### 2. Увеличить `headTimeoutMs` для `uploadImagePolicy` до 15 секунд

Это bounded — мы всё равно прокидываем таймаут дальше в `safeFetch` (там `timeoutMs * 6`), так что полный верхний предел остаётся разумным (90с вместо 30с, но это только в пределах одной загрузки). fal.media реально бывает ≥10с на холодной ноде.

### 3. Добавить ровно один retry HEAD при transient `aborted`/network error

Если первая попытка HEAD для IP упала с `"aborted"` или `ECONNRESET`/`ETIMEDOUT`, сделать ещё одну попытку с новым AbortController. Одного retry достаточно — типичный CDN-хикап решается за второй запрос.

### 4. Скрыть stacktrace-алерт в `uploadExternalUrlToS3`

`console.error("uploadExternalUrlToS3 failed:", err)` → оставить как warn и не бросать исключение в неведомые UI-обработчики. Сейчас оно и так попадает через `return null`, но Next.js dev в консоли светит эту ошибку как unhandled. Уменьшить шум.

## Файлы
- `platform-app/src/server/security/ssrfGuard.ts` — основное исправление (headCheck, retries, увеличенный timeout в uploadImagePolicy)
- `platform-app/src/utils/imageUpload.ts` — понизить уровень логирования до warn
- `platform-app/src/server/security/__tests__/ssrfGuard.test.ts` — добавить тест, что HEAD и GET Range не шарят один и тот же таймер

## Ожидаемое поведение после фикса
- При нормальной работе fal.media outpaint проходит без ошибок.
- При временном hiccup один retry чинит проблему без перехода в fallback.
- Если CDN реально недоступен 15с+ — ошибка остаётся, но сообщение такое же (код не сломан).
