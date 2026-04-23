---
slug: copy-matches-image
status: in-progress
created: 2026-04-22T16:24:39Z
related:
  - .planning/quick/20260422-fix-ai-template-apply-timeout/UAT.md (see Out-of-scope issues)
---

# Fix: AI copywriting must reflect the image, not the meta-request

## Symptom

На сгенерированном баннере фон — стиральная машина + смартфон, а
title/subtitle — про «стилевые пресеты», «пресеты для фото», «цены от 199 руб».
Тексты сгенерированы из сырого пользовательского запроса («пресеты...»)
без связи с тем, что реально на изображении.

## Root causes

### RC-1: applyTemplate роутер теряет visionContext

`platform-app/src/server/routers/workflow.ts::applyTemplate` получает
`referenceImages`, но **никогда не вызывает VLM** и не передаёт
`visionContext` в `executeAction("apply_and_fill_template", ...)`.
Сравните с `interpretAndExecute` → `orchestrator.ts`, где VLM запускается
перед планированием и `visionContext` инжектится в step.parameters.

### RC-2: copywriting не смотрит на lastGeneratedImageUrl

В `executeAction.ts::apply_and_fill_template` при наличии
`preGeneratedImageUrl` (картинка от предыдущего шага пайплайна) код
использует её **только для `update_layer` фона**, но для текстов —
всё равно пишет из `topic`. В случае со скриншота это именно корень:
refs не загружены, но картинка уже есть, и никто не смотрит, что там.

## Plan (atomic commits)

**Commit 1 — server: applyTemplate роутер пробрасывает visionContext
через VLM на referenceImages**

- В `workflow.ts::applyTemplate` перед `executeAction`: если переданы
  `referenceImages`, вызвать `analyzeReferenceImages(...)` и передать
  `visionContext` в параметры экшена. (Паттерн уже есть в orchestrator.ts.)
- Это починит сценарий «пользователь загрузил свои фото и кликнул шаблон».

**Commit 2 — server: executeAction авто-VLM на preGeneratedImageUrl,
когда других сигналов нет**

- В `executeAction.ts::apply_and_fill_template`: если `visionContext`
  НЕ передан, но есть `preGeneratedImageUrl` — вызвать VLM на этой
  одной картинке (URL, не base64 — visionAnalyzer уже умеет `data:`
  и внешние URL в GPT-4o Vision; для Replicate потребуется проверка).
- Результат использовать как `templateVisionCtx` → `cleanTopic` будет
  построен из описания реальных товаров на картинке.
- Fire-and-forget НЕ подходит — результат нужен до копирайтинга.
  Но его можно запустить **параллельно** с `cleanTopic`-извлечением.

**Commit 3 — server: safety — системный prompt копирайтера усилить**

- Для Market и Generic prompt'ов добавить: «Если контекст о конкретных
  товарах не содержит конкретики — пиши только общие формулировки
  (скидки/выбор/доставка), НЕ придумывай названия товаров».
- Это защита от регрессий, когда VLM молчит и cleanTopic = meta-запрос.

## Non-goals

- Не трогаем сам VLM-анализатор.
- Не меняем сигнатуры публичных типов без необходимости.
- Не увеличиваем latency: VLM-вызов на preGeneratedImageUrl запускаем
  в параллель с cleanTopic LLM-вызовом; в Market-ветке — с pairs/cta/imgPrompt.

## Verification

- `tsc --noEmit`, `npm run lint`
- Ручная проверка: сгенерировать картинку, кликнуть шаблон, убедиться что
  тексты теперь про реальные товары с картинки (или хотя бы general-без-лжи,
  если VLM не разобрал).

## Files touched

- `platform-app/src/server/routers/workflow.ts`
- `platform-app/src/server/agent/executeAction.ts`
