---
status: complete
slug: fix-ai-template-apply-timeout
source: SUMMARY.md
started: 2026-04-22T16:22:00Z
updated: 2026-04-22T16:40:00Z
completed: 2026-04-22T16:40:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Перезапустить dev-сервер с нуля → редактор открывается, AI-чат открывается без ошибок в консоли.
result: pass

### 2. Apply Market Template — happy path
expected: В AI-чате запросить «Сгенерируй баннеры для Маркета» → кликнуть карточку шаблона → шаблон применяется на холст (загружаются слои, подставляются текст и изображение), без ошибок.
result: pass
note: |
  Шаблон применяется, основной путь работает. Пользователь заметил отдельную
  проблему: сгенерированные тексты (title/subtitle) не связаны с товарами на
  картинке. На скриншоте фон — стиралка + смартфон, тексты про «стилевые
  пресеты», «пресеты для фото», «цены от 199 руб» — это leak меты-запроса
  «пресеты», а не реальных товаров из кадра. Зафиксировано как отдельная
  issue ниже; не блокирует текущий фикс таймаутов.

### 3. Apply template — speed improvement
expected: Применение Market-шаблона ощутимо быстрее, чем до фикса (субъективно — на 30-50%).
result: pass

### 4. Readable gateway error on timeout
expected: Если шлюз отдаёт 502/504 (например, долгий LLM-провайдер), в чате появляется сообщение «Сервер не ответил вовремя (timeout). Попробуйте ещё раз.» вместо «Unable to transform response from server».
result: skipped
reason: |
  Естественный таймаут не воспроизвёлся в текущей сессии (предыдущие фиксы
  убрали узкое место). Полагаемся на гарантию кода: friendlyFetch явно
  конвертирует любой non-JSON ответ (Content-Type ≠ application/json) в
  читаемое сообщение, код прозрачен и покрывает 502/503/504 и пр.
  При появлении реального таймаута проверить сообщение визуально.

### 5. Batch isolation — fast calls не страдают
expected: Пока идёт долгий applyTemplate, другие быстрые tRPC-вызовы (навигация по проектам, обновление UI) работают без задержки и не падают.
result: pass

## Summary

total: 5
passed: 4
issues: 0
pending: 0
skipped: 1

## Out-of-scope issues (captured for follow-up)

- truth: "Generated title/subtitle must reflect products visible in the generated/reference image, not the meta-request"
  status: observed
  reason: |
    На скриншоте фон — стиральная машина + смартфон, а сгенерированные
    варианты текстов — про «стилевые пресеты», «пресеты для фото»,
    «цены от 199 руб». Это leak исходного meta-запроса пользователя
    («пресеты...») в копирайтинг, несмотря на то что изображение
    содержит совсем другие товары. Корневая причина, вероятно, в том,
    что cleanTopic строится из сырого `topic` без учёта VLM-описания
    картинки, когда VLM-контекст отсутствует / не передан; а при
    наличии VLM — не синхронизирован с тем, что реально пошло в
    генерацию изображения.
  severity: major
  scope: out-of-scope-for-this-fix
  action: follow-up quick task

## Gaps

[none yet]
