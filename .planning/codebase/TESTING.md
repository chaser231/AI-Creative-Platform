# Паттерны тестирования

**Дата анализа:** 2026-04-22

Документ описывает, как устроены тесты в `platform-app/`: фреймворк,
структура, моки, фикстуры и интеграция с деплой-пайплайном. Тестовая
культура сейчас точечная — покрыты критичные чистые модули (безопасность,
парсеры, layout-движок), а не весь код.

---

## Тестовый фреймворк

**Раннер:**
- Vitest `^4.1.4` (`platform-app/package.json`).
- Конфиг: `platform-app/vitest.config.ts`.
- Настройки:
  - `environment: "node"` — все тесты идут в Node-окружении. DOM-
    окружение (`jsdom`, `happy-dom`) не настроено; тесты UI-компонентов
    с DOM ещё не пишем.
  - `include: ["src/**/*.test.ts", "src/**/*.test.tsx"]` — подхватываются
    только `*.test.*`-файлы внутри `src/`.
  - `passWithNoTests: false` — пустой прогон считается ошибкой,
    защищает от регрессий «тесты нечаянно отключили».
  - `resolve.alias["@"] = path.resolve(__dirname, "src")` — тот же
    алиас, что в `tsconfig.json`, чтобы импорты вида
    `@/utils/layoutEngine` работали в тестах.

**Библиотека ассертов:** встроенная в Vitest (`expect(...).to...`).
Покрытие — `@vitest/coverage-v8 ^4.1.4` (устанавливается, отдельного
npm-скрипта пока нет).

**Покрытие DOM/React:** отсутствует — нет
`@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
Реакт-рендеринг не тестируется, только чистая логика.

**E2E / интеграционные тесты:** не сконфигурированы (нет Playwright,
Cypress, Puppeteer).

**Команды запуска (`platform-app/package.json`):**

```bash
npm run test         # vitest run — одноразовый прогон, как в CI
npm run test:watch   # vitest — watch-режим
```

Из корня репозитория — `cd platform-app && npm run test`. Альтернативно
прямой вызов: `cd platform-app && npx vitest run`.

---

## Организация тестовых файлов

**Расположение:** тесты лежат рядом с тестируемым кодом в каталоге
`__tests__/`. Никаких отдельных `test/`, `tests/`, `__tests__` на корне.

**Текущий набор (на 2026-04-22):**

- `platform-app/src/utils/__tests__/layoutEngineConstraints.test.ts`
- `platform-app/src/utils/__tests__/layoutEngineVisibility.test.ts`
- `platform-app/src/lib/figma/__tests__/mapper.test.ts`
- `platform-app/src/lib/figma/__tests__/parseUrl.test.ts`
- `platform-app/src/lib/figma/__tests__/fixtures.ts`
  (не `.test.ts` — это набор синтетических фикстур для `mapper.test.ts`)
- `platform-app/src/server/security/__tests__/ssrfGuard.test.ts`
- `platform-app/src/store/canvas/__tests__/computeConstrainedPosition.test.ts`

**Именование:**
- Файл теста — `<moduleName>.test.ts` / `<moduleName>.test.tsx`.
- Файлы фикстур без суффикса `.test.` (не попадают в include glob).

**Структура каталога:**

```
src/
└── <feature>/
    ├── <module>.ts
    └── __tests__/
        ├── <module>.test.ts
        └── fixtures.ts   (опционально — только если данные переиспользуются)
```

Тесты идут вместе с продовым кодом (не исключаются из `tsconfig.json`
`include`), поэтому проходят общий `npx tsc --noEmit`.

---

## Структура теста

**Организация в describe/it:**

```typescript
import { describe, it, expect } from "vitest";
import { functionUnderTest } from "../module";

describe("functionUnderTest — поведенческий срез", () => {
    it("описание ожидаемого поведения глаголом", () => {
        expect(functionUnderTest(input)).toBe(expected);
    });
});
```

Пример реального файла — `platform-app/src/lib/figma/__tests__/mapper.test.ts`:
- Один файл содержит **несколько** `describe`-блоков, каждый
  сфокусирован на одном сценарии (`"mapFigmaDocument — simple banner"`,
  `"mapFigmaDocument — auto-layout"`, `"mapFigmaDocument — image fills"`,
  `"mapFigmaDocument — components & instances"`,
  `"mapFigmaDocument — vector fallback"`,
  `"mapFigmaDocument — report stats"`).
- Имена `describe` — `"<function/unit> — <сценарий>"`.
- Имена `it` — утвердительное описание инварианта
  (`"emits lowercase 6-digit hex for opaque colors"`,
  `"rejects forbidden schemes"`,
  `"PR-4: absolute child inside an AL frame respects {right, bottom}..."`).

**Setup/teardown:**
- `beforeEach` / `afterEach` вызываются только там, где нужно ресетнуть
  мок (`lookupMock.mockReset()` в
  `platform-app/src/server/security/__tests__/ssrfGuard.test.ts`).
- Общих хуков уровня файла или глобальных `setupFiles` сейчас нет —
  каждый тест изолирован, данные строятся на месте или берутся из
  локальных фикстур.

**Паттерны ассерта:**
- Прямое равенство — `expect(x).toBe(y)` для примитивов,
  `expect(x).toEqual(y)` для структур,
  `expect(x).toBeCloseTo(y, 3)` для float'ов.
- Отрицательные проверки — `expect(fn).toThrow(SsrfBlockedError)` или
  `try/catch + expect.fail(...)` при необходимости проверить поле
  `.code` пойманной ошибки.
- Промисы — `await expect(promise).rejects.toMatchObject({ code: "IP_BLOCKED" })`.
- Наличие элемента — `expect(layers.find(l => l.type === "text")).toBeTruthy()`.

---

## Моки

**Фреймворк:** встроенный `vi` из Vitest.

**Паттерн мока модуля (DNS, безопасность):**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns", async () => {
  const actual = await vi.importActual<typeof import("node:dns")>("node:dns");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      lookup: vi.fn(),
    },
  };
});

import { promises as dnsPromises } from "node:dns";
const lookupMock = dnsPromises.lookup as unknown as ReturnType<typeof vi.fn>;
```

Реальный пример — `platform-app/src/server/security/__tests__/ssrfGuard.test.ts`.
Ключевые моменты:
- `vi.mock(...)` объявляется **до** импортов из замоканного модуля
  (hoisting в Vitest как в Jest).
- Сохраняем реальные реализации через `importActual`, переопределяем
  только нужную функцию (`lookup`).
- Для управления возвратами — `mockResolvedValueOnce`, `mockRejectedValueOnce`.
- Ресет мока — в `beforeEach`/`afterEach` через `mockReset()`.

**Что моcкаем:**
- Сетевые примитивы (`node:dns`) при тестировании SSRF-логики.
- Переменные окружения — **не мокаем глобально**, а сохраняем и
  восстанавливаем в `try/finally`:

  ```typescript
  const saved = process.env.AGENT_IMAGE_URL_ALLOWLIST;
  process.env.AGENT_IMAGE_URL_ALLOWLIST = "replicate.delivery";
  try {
    // assert
  } finally {
    if (saved === undefined) delete process.env.AGENT_IMAGE_URL_ALLOWLIST;
    else process.env.AGENT_IMAGE_URL_ALLOWLIST = saved;
  }
  ```

**Что не мокаем:**
- Чистую доменную логику (layout-движок, Figma-маппер,
  constraint-хелперы) — тестируем на реальных входах.
- Типы из `@figma/rest-api-spec` — используем синтетические JSON-объекты
  (см. `platform-app/src/lib/figma/__tests__/fixtures.ts`), а не мокаем
  модуль целиком.
- Prisma / tRPC / Next.js — сейчас не покрыты тестами, поэтому и моков
  нет. При добавлении таких тестов предпочтительный подход — выносить
  чистую бизнес-логику в утилиты и тестировать их, а не мокать Prisma.

---

## Фикстуры и фабрики

**Синтетические фикстуры:**
- `platform-app/src/lib/figma/__tests__/fixtures.ts` — набор
  `SyntheticFile`-объектов (`simpleBannerFixture`, `autoLayoutFixture`,
  `imageFillFixture`, `componentInstanceFixture`,
  `instanceBeforeMasterFixture`, `vectorFallbackFixture`).
  Построены вручную по типам `@figma/rest-api-spec`, потому что
  лицензия на реальные Figma-ответы неясна (см. JSDoc в начале файла).

**Фабричные функции в тестах:**
- Прямо внутри файла теста, когда нужно построить много однотипных
  объектов с небольшими отличиями. Пример —
  `platform-app/src/utils/__tests__/layoutEngineConstraints.test.ts`:

  ```typescript
  function makeRect(id: string, overrides: Partial<RectangleLayer> = {}): RectangleLayer { ... }
  function makeFrame(id: string, overrides: Partial<FrameLayer>): FrameLayer { ... }
  function getLayer<T extends Layer>(layers: Layer[], id: string): T { ... }
  ```

- Паттерн — дефолт + `overrides: Partial<T>` через spread. Фабрика
  возвращает строго типизированный объект и каст к нужному подтипу.

**Расположение фикстур:**
- Рядом с тестом, в том же `__tests__/`. Имя — `fixtures.ts` (без
  `.test.`), чтобы Vitest не пытался его запускать как тест, но
  TypeScript-проверка на него всё равно распространялась.

---

## Покрытие

**Требования:** явных порогов покрытия нет
(`@vitest/coverage-v8` установлен, но не включён в CI).

**Просмотр локально:**

```bash
cd platform-app
npx vitest run --coverage
```

**Текущее фактическое покрытие (best-effort):**
- `platform-app/src/utils/layoutEngine.ts` — 2 файла тестов
  (constraints + visibility), покрывают регрессионные сценарии
  auto-layout (PR-4, PR-10 и т.д.).
- `platform-app/src/lib/figma/mapper.ts` — полноценный набор
  описывающий каждый тип узла Figma (TEXT, RECTANGLE, INSTANCE,
  COMPONENT, VECTOR, IMAGE fill) и отчёт `report.stats`.
- `platform-app/src/lib/figma/parseUrl.ts` — покрытие всех
  URL-вариантов (file, design, proto, node-id colon/dash, bare key,
  reject).
- `platform-app/src/server/security/ssrfGuard.ts` — расширенное
  покрытие: IPv4/IPv6, loopback, RFC1918, CGNAT, link-local,
  IPv4-mapped IPv6, cloud metadata, DNS rebind, ENV allowlist,
  пресеты.
- `platform-app/src/store/canvas/helpers.ts` — регрессионные сценарии
  `computeConstrainedPosition` на вырожденных bounds (NaN/Infinity).

**Непокрытые области:**
- React-компоненты (`src/components/**`) и хуки (`src/hooks/**`).
- tRPC-роутеры (`src/server/routers/**`).
- Prisma-слой и интеграции с S3 / OpenAI / Replicate / Fal.
- Zustand-слайсы за пределами чистых хелперов.

---

## Типы тестов

**Unit-тесты:**
- Все существующие тесты — unit. Границы: один модуль, без сети, без БД,
  без браузера.
- Фокус — детерминированные чистые функции и guard-логика.

**Интеграционные тесты:**
- Пока нет. При появлении — нужна отдельная конфигурация
  `environment: "jsdom"` (для React) или прогон tRPC-роутеров с
  тестовой БД (Prisma + SQLite/контейнер Postgres).

**E2E-тесты:**
- Не используются.

**Snapshot-тесты:**
- Не используются.

---

## Типичные паттерны

**Тестирование async-кода:**

```typescript
it("rejects when ANY resolved address is in a blocked range", async () => {
  mockLookup([
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  await expect(assertUrlIsSafe("https://example.com/")).rejects.toMatchObject({
    code: "IP_BLOCKED",
  });
});
```

**Тестирование выброса конкретной типизированной ошибки:**

```typescript
try {
  assertUrlShape("https://alice:secret@example.com/");
  expect.fail();
} catch (e) {
  expect(e).toBeInstanceOf(SsrfBlockedError);
  expect((e as SsrfBlockedError).code).toBe("USERINFO_NOT_ALLOWED");
}
```

Используется, когда нужно проверить и класс ошибки, и дополнительное
поле (`code`). Для простого «throws» достаточно
`expect(() => fn()).toThrow(SsrfBlockedError)`.

**Параметризация через цикл по массиву входов:**

```typescript
for (const raw of ["http://example.com/", "file:///etc/passwd", ...]) {
  try {
    assertUrlShape(raw);
    expect.fail(`should have rejected ${raw}`);
  } catch (e) {
    expect((e as SsrfBlockedError).code).toBe("SCHEME_NOT_ALLOWED");
  }
}
```

Используется вместо `it.each`, когда сценарий один, а входов много.

**Регрессионные комментарии:**
Тесты под конкретный баг/PR подписываются комментарием с идентификатором
(`PR-4`, `PR-10`, `C2 regression`), который ссылается на историю
изменений движка. Это защищает ключевой инвариант и объясняет, почему
тест выглядит именно так.

---

## Интеграция с CI

**Где запускается:**
- Отдельного шага `vitest` в `.github/workflows/deploy.yml` **нет**.
  Workflow собирает Docker-образ и деплоит в Yandex Cloud, ни `npm run
  test`, ни `npm run lint` в пайплайне не гоняются.
- Гарант качества — сам `next build` в Docker-сборке (падает на тайп-
  ошибках) + дисциплина правил `.cursor/rules/deploy-pipeline.mdc`,
  которые требуют **локально** прогнать `npx tsc --noEmit` и
  `npx vitest run` перед push'ем.

**Правила перед merge (`.cursor/rules/deploy-pipeline.mdc`):**

```bash
cd platform-app
npx tsc --noEmit       # обязательный зелёный тайп-чек
npx vitest run         # если код был покрыт тестами
```

**Рекомендация при добавлении новых тестов:** включить отдельный job в
`.github/workflows/deploy.yml` (или в отдельный `ci.yml` на PR), чтобы
Vitest гонялся до сборки контейнера, а не полагаться только на
`next build` и ручную дисциплину.

---

## Как добавить новый тест

1. Создай `__tests__/<moduleName>.test.ts` рядом с исходным модулем.
2. Импортируй тестируемый код через алиас `@/...` или относительный
   путь (`../moduleName`).
3. Для переиспользуемых данных — заведи `__tests__/fixtures.ts`
   (не `.test.ts`!).
4. Один `describe` на функциональный срез, одно `it` на инвариант;
   имя `it` — утверждение, а не «should ...».
5. Если нужен мок внешнего модуля — `vi.mock("module", ...)` **до**
   импортов из него; ресеть через `mockReset()` в `beforeEach`.
6. Если трогаешь `process.env` — сохраняй/восстанавливай в
   `try/finally`, глобальных моков env не заводим.
7. Прогон: `cd platform-app && npm run test` (одноразово) или `npm run
   test:watch` (во время работы).
8. Перед push'ем — `npx tsc --noEmit` + `npx vitest run`, иначе
   Docker-сборка в Yandex Cloud CI упадёт на `next build`.

---

*Testing analysis: 2026-04-22*
