# Соглашения о кодировании

**Дата анализа:** 2026-04-22

Документ описывает стандарты кода для основного приложения `platform-app/`
(Next.js 16 + React 19 + TypeScript + Tailwind 4 + tRPC 11 + Prisma 6 +
Zustand 5 + Vitest 4). Настройки продиктованы конфигами
`platform-app/eslint.config.mjs`, `platform-app/tsconfig.json`,
`platform-app/GIT_WORKFLOW.md`, `.cursor/rules/deploy-pipeline.mdc`,
`.cursor/rules/design-system-contrast.mdc`.

---

## Паттерны именования

**Файлы:**
- UI-компоненты и React-компоненты — `PascalCase.tsx`
  (например `platform-app/src/components/ui/Button.tsx`,
  `platform-app/src/components/ui/SegmentedControl.tsx`).
- Не-компонентные TypeScript-модули — `camelCase.ts`
  (например `platform-app/src/utils/layoutEngine.ts`,
  `platform-app/src/lib/cn.ts`, `platform-app/src/server/auth.ts`).
- React-хуки — `useXxx.ts` (`platform-app/src/hooks/useAssetUpload.ts`,
  `platform-app/src/hooks/useKeyboardShortcuts.ts`).
- tRPC-роутеры — `<domain>.ts` в `platform-app/src/server/routers/`
  (`asset.ts`, `project.ts`, `workflow.ts`).
- Zustand-хранилища — `<domain>Store.ts`
  (`platform-app/src/store/canvasStore.ts`, `aiStore.ts`, `photoStore.ts`),
  либо композиция слайсов в каталоге `store/<domain>/` с файлами
  `create<Domain>Slice.ts`.
- Тесты — `*.test.ts` / `*.test.tsx` внутри `__tests__/` рядом с
  тестируемым модулем.
- Next-роуты App Router — `page.tsx`, `layout.tsx`, `route.ts` в
  `platform-app/src/app/**`.

**Функции:**
- `camelCase` — для утилит, хендлеров, внутренних функций
  (`mapFigmaDocument`, `rgbaToHex`, `assertUrlIsSafe`, `parseFigmaUrl`).
- Guard-утилиты начинаются с `assert...` и бросают `Error` наследник, а не
  возвращают `boolean` (см. `platform-app/src/server/security/ssrfGuard.ts`,
  `platform-app/src/server/authz/guards.ts` — `assertAssetAccess`,
  `assertProjectAccess`, `assertWorkspaceAccess`).
- Boolean-проверки без сайд-эффектов — `isXxx` (`isBlockedIp`).

**Компоненты:**
- `PascalCase` для React-компонентов. `displayName` задаётся явно для
  компонентов, обёрнутых в `forwardRef`:
  `Button.displayName = "Button"` (см. `platform-app/src/components/ui/Button.tsx`).

**Переменные:**
- `camelCase` для локальных и модульных, `SCREAMING_SNAKE_CASE` для
  модульных констант-значений окружения (`BUCKET`, `REGISTRY_ID`).

**Типы и интерфейсы:**
- `PascalCase` (`ButtonProps`, `SyntheticFile`, `UploadProgress`,
  `SsrfBlockedError`). `interface` используется для публичных
  props/DTO, `type` — для union/alias.

---

## Стиль кода

**Форматирование:**
- Встроенный Prettier не сконфигурирован (нет `.prettierrc*` или
  `prettier` в `devDependencies`). Форматирование опирается на ESLint +
  редактор.
- Типичный отступ в новых модулях — **4 пробела** (все файлы в
  `platform-app/src/utils/__tests__/`, `platform-app/src/lib/figma/`,
  `platform-app/src/store/canvas/`). Часть старых/UI-файлов использует
  **2 пробела** (`platform-app/src/components/ui/Button.tsx`,
  `platform-app/src/app/layout.tsx`). При правках придерживайся отступа,
  уже принятого в файле.
- Строки в двойных кавычках `"..."`, trailing-запятые в многострочных
  объектах и массивах.
- Точки с запятой в конце инструкций обязательны.

**Линтинг:**
- ESLint 9 flat config (`platform-app/eslint.config.mjs`), база —
  `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`.
- Команды: `npm run lint` (проверка `src/`), `npm run lint:fix`
  (автоисправление).
- Глобальные игноры: `.next/**`, `out/**`, `build/**`, `next-env.d.ts`.
- Активные правила с точным severity:
  - `@typescript-eslint/no-explicit-any` — **warn** (избегать `any`,
    но не блокировать CI).
  - `@typescript-eslint/no-unused-vars` — **warn**, с игнорированием
    имён с префиксом `_` (`argsIgnorePattern`, `varsIgnorePattern`,
    `caughtErrorsIgnorePattern`: `^_`).
  - `@typescript-eslint/no-require-imports` — **warn**.
  - `no-console` — **warn**, разрешён только `console.error`.
  - Override: в `src/server/**/*.ts` и `src/app/api/**/*.ts`
    `no-console` отключён полностью — серверные логи пишутся как есть.
  - `react/no-unescaped-entities` — **warn**.
  - `prefer-const` — **warn**, `no-var` — **error**.
  - `eqeqeq` — **warn** (`always`, с исключением `null` — `==
    null` допустимо).

**TypeScript строгость (`platform-app/tsconfig.json`):**
- `strict: true` (включает `strictNullChecks`, `noImplicitAny`,
  `strictFunctionTypes` и т.д.).
- `target: ES2017`, `module: esnext`, `moduleResolution: bundler`.
- `jsx: react-jsx`, `skipLibCheck: true`, `esModuleInterop: true`,
  `resolveJsonModule: true`, `isolatedModules: true`, `noEmit: true`.
- `allowJs: true` (миграция js-файлов допустима, но `src/` уже полностью
  TS).
- `exclude`: `node_modules`, `scripts`. Каталог `scripts/` намеренно вне
  проекта и не типизируется.
- Обязательная проверка типов перед push'ем: `cd platform-app && npx tsc
  --noEmit` (требование `.cursor/rules/deploy-pipeline.mdc` — иначе
  Docker-сборка в CI упадёт на `next build`).

---

## Организация импортов

**Порядок (наблюдаемая конвенция):**
1. Внешние пакеты (`react`, `next`, `zod`, `@trpc/*`, `@radix-ui/*`,
   `vitest`, `@aws-sdk/*`).
2. Сайд-эффектные импорты стилей (`import "./globals.css"`).
3. Внутренние модули через алиас `@/` (`@/components/...`,
   `@/server/...`, `@/lib/...`, `@/types`).
4. Относительные импорты (`../mapper`, `./fixtures`, `./helpers`).
5. Типовые импорты отделяются через `import type { ... }`.

**Алиасы путей:**
- `@/*` → `./src/*` (задано в `platform-app/tsconfig.json` и продублировано
  в `platform-app/vitest.config.ts` через `resolve.alias`).
- Абсолютные импорты через `@/` — предпочтительный способ ссылаться на
  модули из другой папки. Относительные пути разрешены только между
  соседями в одной директории или внутри локальной подсистемы
  (`../mapper`, `./createLayerSlice`).

**Барелы:**
- `platform-app/src/store/canvasStore.ts` — явный barrel-композитор
  Zustand-слайсов. Единственная точка импорта `useCanvasStore` и
  связанных типов.
- `platform-app/src/types/` используется как точка ре-экспорта
  типов домена (`import type { FrameLayer, Layer } from "@/types"`).
- Бессмысленных `index.ts` ре-экспортов в UI-папках не создавать — импорт
  идёт напрямую из файла компонента (`@/components/ui/Button`).

---

## Обработка ошибок

**Клиент (React/хуки):**
- Состояние ошибок хранится в локальном `useState` типа
  `{ status: "idle" | "error" | ...; error?: string }`
  (см. `platform-app/src/hooks/useAssetUpload.ts`,
  интерфейс `UploadProgress`).
- Ошибки tRPC всплывают через `@tanstack/react-query` и обрабатываются
  в месте вызова мутации/запроса.

**Сервер (tRPC):**
- Бросаем `TRPCError` с явным `code`
  (`"UNAUTHORIZED"`, `"FORBIDDEN"`, `"NOT_FOUND"`, `"BAD_REQUEST"`,
  `"INTERNAL_SERVER_ERROR"`). См.
  `platform-app/src/server/routers/asset.ts`.
- Входные данные tRPC-процедур обязательно валидируются `zod`-схемой
  через `.input(z.object({...}))`.
- Авторизацию делаем через централизованные guards в
  `platform-app/src/server/authz/guards.ts`
  (`assertWorkspaceAccess`, `assertProjectAccess`, `assertAssetAccess`,
  `assertTemplateAccess`, `getWorkspaceRole`). Новый роут, который
  трогает ресурс workspace/project, **обязан** вызвать соответствующий
  guard до бизнес-логики.

**Безопасность (SSRF):**
- Кастомные ошибки — наследники `Error` с полем `code`
  (`SsrfBlockedError` в `platform-app/src/server/security/ssrfGuard.ts`).
  Код ошибки — литеральный union (`"SCHEME_NOT_ALLOWED"`,
  `"IP_BLOCKED"`, `"HOST_NOT_ALLOWED"`, `"PORT_NOT_ALLOWED"`,
  `"USERINFO_NOT_ALLOWED"`, `"DNS_FAILED"`).
- Внешние URL, попадающие в fetch/преобразование — всегда прогоняются
  через `assertUrlIsSafe` или готовые пресеты (`uploadImagePolicy`,
  `agentAddImagePolicy`).

**Никаких проглатываний:**
- Пустых `catch {}` избегаем. Если ловим — либо ре-throw с контекстом,
  либо логируем через `console.error` (только в серверном коде).

---

## Логирование

**Фреймворк:** встроенный `console` (специализированный logger не
используется). Разрешение регулируется ESLint:
- В UI/клиентском коде (`src/components/**`, `src/app/*` не-API,
  `src/hooks/**`, `src/store/**`, `src/utils/**`) — разрешён только
  `console.error`. Любой `console.log` / `console.warn` даёт warning и
  шумит в CI.
- В серверном коде (`src/server/**/*.ts`, `src/app/api/**/*.ts`) —
  любое использование `console` разрешено (override в `eslint.config.mjs`).

**Когда логировать:**
- Сериверные хендлеры и долгоживущие процессы (агент, upload,
  миграции) — `console.error` + `console.info` для инцидентов и
  ключевых переходов состояния.
- На клиенте — только для непредвиденных исключений; обычные валидации
  показываются пользователю через UI.

---

## Комментарии

**Когда комментировать:**
- Блочный JSDoc в начале модуля с кратким описанием
  (`platform-app/src/server/routers/asset.ts` —
  `/** Asset Router — File upload/... */`,
  `platform-app/src/hooks/useAssetUpload.ts` — аналогично,
  `platform-app/src/store/canvasStore.ts` — описание слайсов).
- Inline-комментарий объясняет **почему**, а не что (типичный пример —
  комментарии к регрессионным тестам в
  `platform-app/src/store/canvas/__tests__/computeConstrainedPosition.test.ts`).
- Разделители вида `// ─── Section ──────────` используются для
  визуальной группировки секций в больших файлах (`asset.ts`,
  `canvasStore.ts`).
- Ссылки на тикет/PR/регрессию — допустимы в теле тестов (`PR-4`,
  `PR-10`, `C2 regression`).
- Русский язык в комментариях допускается (см.
  `.cursor/rules/deploy-pipeline.mdc`), но новые технические комментарии
  в продовом коде обычно пишутся на английском; правила и project docs —
  на русском.

**JSDoc/TSDoc:**
- Используется спорадически для публичных хуков, роутеров и утилит.
  Обязательных `@param`/`@returns` тегов нет — достаточно одного
  описательного абзаца.

---

## Дизайн функций

**Размер:** функции короткие и разложены по модулям. Композиция — через
Zustand-слайсы (`createViewportSlice`, `createHistorySlice` и т.д.,
`platform-app/src/store/canvas/`), утилиты собираются точечно
(`applyAllAutoLayouts`, `mapFigmaDocument`, `computeConstrainedPosition`).

**Параметры:** одиночные параметры — позиционные; начиная с 2-3 — всегда
объектом с именованными полями (см. `computeConstrainedPosition({ ... })`,
`assertUrlShape(url, { allowedSchemes, allowedPorts, allowedHosts })`).

**Возвращаемые значения:**
- Guard-функции без возврата, но кидают типизированную ошибку
  (`assertUrlShape`, `assertAssetAccess`).
- Парсеры возвращают `T | null` (`parseFigmaUrl` → `{ fileKey, nodeId? } | null`).
- Доменные функции возвращают структурный объект со статистикой/репортом
  (`mapFigmaDocument` → `{ pages, report }`).

---

## Дизайн модулей и компонентов

**Экспорт:**
- Именованные экспорты по умолчанию (`export { Button, buttonVariants }`,
  `export type { ButtonProps }`). `default export` — только там, где
  требует фреймворк (`page.tsx`, `layout.tsx`, `route.ts` в App Router,
  `middleware.ts`).
- Тип props экспортируется отдельно (`export type { ButtonProps }`),
  чтобы потребители могли расширять.

**UI-компоненты (`platform-app/src/components/ui/`):**
- Все — `"use client"` в первой строке.
- Оборачиваются в `forwardRef` когда требуется передать ref
  (`Button`, `Input`, `Textarea`).
- Варианты — `cva` из `class-variance-authority` с типами через
  `VariantProps<typeof xxxVariants>`.
- Классы объединяются утилитой `cn` из `@/lib/cn` (tailwind-merge +
  clsx).
- Интеграция с `Radix UI` через именованные namespace-импорты
  (`import * as SelectPrimitive from "@radix-ui/react-select"`).
- Паттерн `asChild` через `@radix-ui/react-slot` (`Slot` как `Comp`).

**Дизайн-токены и Tailwind:**
- Используются CSS-переменные
  (`platform-app/src/app/globals.css`), экспонируемые как Tailwind-классы:
  `bg-accent-primary`, `text-text-primary`, `border-border-primary`,
  `rounded-[var(--radius-full)]`, `shadow-[var(--shadow-sm)]`.
- **Правило контраста** (`.cursor/rules/design-system-contrast.mdc`):
  на тема-независимых поверхностях (`bg-accent-lime`, `bg-white`)
  использовать только фиксированные токены текста
  (`text-accent-lime-text`, `text-on-light`); не смешивать с
  тема-зависимыми токенами (`text-text-primary`, `text-accent-primary`,
  `text-text-inverse`), иначе в dark mode получится «light-on-light».

**Server Components vs Client Components:**
- `layout.tsx` и `page.tsx` — server-by-default.
- Любой файл, использующий state/effect/browser API/Zustand-store/хуки
  React, начинается с `"use client"`. Это же относится ко всем
  UI-компонентам в `src/components/ui/` и к hook-модулям.

**Провайдеры:**
- Композиция в `platform-app/src/app/layout.tsx`:
  `SessionProvider` → `TRPCProvider` → `WaitlistGuard` →
  `WorkspaceProvider` → `ThemeProvider`. Новые провайдеры добавляются
  сюда, корневая иерархия — единственная точка правды.

**Zustand-паттерн:**
- Store разбит на слайсы (`platform-app/src/store/canvas/`), каждый
  слайс — фабрика `create<Domain>Slice(set, get, api)`.
- Итоговый store собирается через `create<CanvasStore>((...args) => ({
  ...createViewportSlice(...args), ... }))`
  в `platform-app/src/store/canvasStore.ts`.
- Хелперы и чистые функции выносятся в `store/canvas/helpers.ts`,
  чтобы их можно было покрыть unit-тестами без монтирования store'а.

**tRPC-паттерн:**
- Роутеры живут в `platform-app/src/server/routers/<domain>.ts`,
  собираются в `_app.ts`.
- Процедуры: `publicProcedure` | `protectedProcedure` (с проверкой
  `ctx.session`). Дополнительные проверки доступа — через `authz/guards`.
- Каждая процедура описывает `input` через `z.object(...)`, избегаем
  «свободных» параметров.

---

## Git-воркфлоу и коммиты

**Бренчинг (`platform-app/GIT_WORKFLOW.md`,
`.cursor/rules/deploy-pipeline.mdc`):**
1. Локальные атомарные коммиты агента.
2. Push **всегда** в feature-ветку (`feat/...`, `fix/...`,
   `chore/...`). Прямой push в `main` = мгновенный прод-деплой через
   `.github/workflows/deploy.yml`.
3. PR в `main` создаёт и мёржит человек через GitHub UI (чтобы
   merge-коммит был от him, иначе Vercel Hobby блокирует деплой).
4. Мерж после явного подтверждения пользователя.

**Conventional Commits:**
- Префиксы: `feat`, `fix`, `chore`, `build`, `docs`, `perf`, `refactor`,
  `wip` (см. `git log --oneline` — все соответствуют).
- Опциональный scope в скобках: `feat(security): ...`,
  `fix(canvas): ...`, `perf(canvas): ...`, `docs(stability): ...`.
- Тело отделяется пустой строкой, объясняет **почему**, не **что**.
- Коммитить через heredoc, а не `-m "..."` — длинные сообщения не
  ломаются на экранировании.

**Предкоммитные проверки:**
- `cd platform-app && npx tsc --noEmit` — обязательный зелёный тайп-чек.
- `npx vitest run` — если затронут код, покрытый тестами.
- `package.json` и `package-lock.json` коммитятся вместе. Рассинхрон
  уронит `npm ci` в Docker-сборке. Lockfile регенерировать через
  `rm -rf node_modules package-lock.json && npm install` (npm 10+,
  `lockfileVersion: 3`).

**Запрещено коммитить:**
- `.env*`, `*.pem`, `*-sa-key.json`, `/tmp/`-дампы, любые SA-ключи и
  токены. Если такой файл появился в `git status` — остановиться и
  предупредить пользователя.

---

## Куда добавлять код (быстрый справочник)

- Новый UI-компонент — `platform-app/src/components/<domain>/<Component>.tsx`
  (существующие домены: `auth`, `dashboard`, `editor`, `layout`, `photo`,
  `providers`, `ui`, `wizard`, `workspace`).
- Примитив дизайн-системы — `platform-app/src/components/ui/<Name>.tsx`.
- Новая страница/роут — в `platform-app/src/app/<path>/page.tsx` (App Router).
- Новый API-эндпоинт — предпочтительно через tRPC-процедуру в
  `platform-app/src/server/routers/<domain>.ts`; чистые HTTP-роуты — в
  `platform-app/src/app/api/<path>/route.ts`.
- Новое доменное хранилище — `platform-app/src/store/<domain>Store.ts`
  или слайс в `platform-app/src/store/<domain>/createXxxSlice.ts`.
- Новая утилита — `platform-app/src/utils/<name>.ts`
  (если связана с layout/image/file) или `platform-app/src/lib/<name>.ts`
  (если это адаптер/клиент/интеграция, напр. `lib/figma/`, `lib/trpc.ts`).
- Новый хук — `platform-app/src/hooks/use<Name>.ts`.
- Новая проверка авторизации — расширять
  `platform-app/src/server/authz/guards.ts`, не писать ad-hoc проверки
  по месту.

---

*Convention analysis: 2026-04-22*
