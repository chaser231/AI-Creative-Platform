---
slug: copy-matches-image
status: done
completed: 2026-04-22T16:30:00Z
commits:
  - 8e5466f fix(agent): applyTemplate роутер пробрасывает VLM visionContext из refs
  - b8429a8 fix(agent): copywriting "видит" pre-generated image через VLM
  - 3321a69 fix(agent): копирайтеры не придумывают несуществующие товары
---

# Summary: AI copywriting теперь соответствует изображению

## Проблема

На баннере, сгенерированном AI-агентом, фон показывал стиральную
машину и смартфон, а title/subtitle рассказывали про «стилевые пресеты»
и «цены от 199 рублей». Тексты и картинка — два несвязанных мира.

## Корневые причины

### RC-1: applyTemplate-роутер терял VLM-контекст

Прямой путь «клик по карточке шаблона» в `workflow.applyTemplate`
получал `referenceImages`, но **не вызывал VLM** — в отличие от
ветки через `interpretAndExecute` → `orchestrator.ts`, где
`analyzeReferenceImages` уже давно работает. Копирайтер видел только
сырой topic пользователя.

### RC-2: copywriting игнорировал `lastGeneratedImageUrl`

Даже когда в `executeAction.apply_and_fill_template` приходил
`preGeneratedImageUrl` (картинка от предыдущего шага — именно этот
сценарий на скриншоте), она использовалась ТОЛЬКО для фонового
слоя. Для текстов — нет, копирайтер писал из `topic`.

## Коммиты

### 1. `8e5466f` — роутер применяет VLM к referenceImages

`workflow.ts::applyTemplate` теперь дублирует паттерн orchestrator'а:
перед `executeAction` вызывает `analyzeReferenceImages(refs, topic)`
и прокидывает `visionContext` в параметры.

Покрывает сценарий «пользователь загрузил свои фото товаров
и кликнул шаблон».

### 2. `b8429a8` — executeAction лениво анализирует pre-generated image

В `executeAction.ts::apply_and_fill_template`: если `visionContext`
НЕ передан, но есть `preGeneratedImageUrl` — вызываем VLM на этой
картинке перед копирайтингом. Результат попадает в `cleanTopic`
и далее во все три копирайтинг-вызова (Market pairs / generic
headline-subtitle / CTA).

Попутно исправлен баг в `visionAnalyzer.ts`: оба VLM-провайдера
(GPT-4o и Gemini через Replicate) теперь пропускают `http(s)://...`
URL'ы как есть. Раньше превращали их в битый data URI
`data:image/jpeg;base64,https://...`.

Покрывает ровно тот сценарий со скриншота.

### 3. `3321a69` — anti-hallucination в промптах

Защита от регрессий, если VLM всё-таки недоступен (нет API-ключа,
сетевая ошибка, невалидный ответ):

- Market system-prompt: добавлено правило в ЖЁСТКИЕ ОГРАНИЧЕНИЯ —
  НЕ придумывать товары/бренды/категории, которых нет во входных
  данных.
- Generic slots: вынесено в `NO_HALLUCINATION_RULE` и добавлено
  в system-prompt каждого из headline/subtitle/CTA вызовов.

## Итоговый поток (happy path)

```
user → "Сгенерируй баннеры для Маркета"
     → interpretAndExecute
        → generate_image (flux/другой) → картинка с реальными товарами
        → lastGeneratedImageUrl сохранён на клиенте
user → клик по карточке шаблона
     → workflow.applyTemplate
        ↓ если refs есть:
        → analyzeReferenceImages(refs) → visionContext
        ↓
        → executeAction(apply_and_fill_template, {visionContext, lastGeneratedImageUrl})
           ↓ если visionContext пуст + lastGeneratedImageUrl есть:
           → analyzeReferenceImages([url]) → hydrate visionContext
           ↓
           → cleanTopic = "Товары: <VLM-описание того, что ДЕЙСТВИТЕЛЬНО на картинке>"
           → Promise.all([market pairs, CTA, imgPrompt]) или Generic analog
```

Тексты теперь либо основаны на реальных товарах (VLM отработал),
либо нейтрально-общие (VLM не смог / недоступен) — но уже никогда
не расходятся с картинкой.

## Verification

- ✅ `tsc --noEmit` — clean
- ✅ `eslint src/server/routers/workflow.ts src/server/agent/executeAction.ts
     src/server/agent/visionAnalyzer.ts` — 0 errors, 2 pre-existing warnings
     (not touched lines).

## Files touched

- `platform-app/src/server/routers/workflow.ts` (+26 lines)
- `platform-app/src/server/agent/executeAction.ts` (+42, −5 lines)
- `platform-app/src/server/agent/visionAnalyzer.ts` (+10, −4 lines)

## Non-goals / follow-ups

- Не меняли сам VLM-анализатор существенно (только URL-passthrough).
- Extra latency: +1 VLM-вызов на `applyTemplate` когда есть refs или
  preGeneratedImageUrl. На GPT-4o Vision это ~1.5-3 сек, что входит в
  прошлый budget улучшения после параллелизации LLM-вызовов. Если
  станет узким местом — можно кешировать по хешу URL или запускать
  VLM одновременно с `cleanTopic`-чисткой.
