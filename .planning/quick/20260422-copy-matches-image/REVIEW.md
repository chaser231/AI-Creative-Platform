---
phase: quick-20260422-copy-matches-image
reviewed: 2026-04-22T12:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - platform-app/package.json
  - platform-app/prisma/schema.prisma
  - platform-app/src/app/api/canvas/save/route.ts
  - platform-app/src/app/editor/[id]/page.tsx
  - platform-app/src/components/providers/TRPCProvider.tsx
  - platform-app/src/hooks/useProjectSync.ts
  - platform-app/src/lib/figma/importWorker.ts
  - platform-app/src/server/agent/executeAction.ts
  - platform-app/src/server/agent/visionAnalyzer.ts
  - platform-app/src/server/routers/__tests__/project.saveState.test.ts
  - platform-app/src/server/routers/asset.ts
  - platform-app/src/server/routers/project.ts
  - platform-app/src/server/routers/workflow.ts
findings:
  critical: 0
  warning: 7
  info: 6
  total: 13
status: issues_found
---

# PR #56: Code Review Report

**Reviewed:** 2026-04-22T12:00:00Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

PR объединяет три логически независимых изменения на ветке `chore/stability-mf6-canvas-state-consistency` (14 коммитов): (1) MF-3 data-layer — optimistic locking на `Project.canvasState`; (2) client-side hardening tRPC (splitLink + friendlyFetch) + fire-and-forget cost tracking; (3) фикс "copy matches image" — VLM на `lastGeneratedImageUrl` + anti-hallucination copywriting.

В целом архитектура здравая: optimistic locking корректно работает в основной ветке (P2025 → CONFLICT), splitLink разумно отделяет долгоиграющие ручки от батча, `friendlyFetch` превращает 502/504 в понятные ошибки, parallel-fan-out копирайтинга ликвидирует Gateway 502-е таймауты.

Серьёзных багов или дыр в авторизации не нашёл, но есть несколько настораживающих мест:

- **WR-01 / WR-02:** тонкости optimistic locking — race в `updatedAt` при CONFLICT и soft-merge в beacon-эндпоинте не бампает `updatedAt` предсказуемо.
- **WR-03 / WR-04:** тесты покрывают только success/conflict/no-expectedVersion, не покрывают (а) unauthorized/wrong-workspace, (б) `loadState` NOT_FOUND, (в) friendlyFetch envelope (одна-mutation vs batched).
- **WR-05:** `lastGeneratedImageUrl` — нет z.string().url() + нет валидации перед записью `update_layer.src` в canvasState (stored payload через шаринг canvas/publish).
- **WR-06:** `friendlyFetch` возвращает JSON-массив `[{error:...}]` для 502/504 — корректно для batch, но проксируется и в `httpLink` (non-batched), который ожидает объект, а не массив.
- **WR-07:** fire-and-forget `trackAgentCosts` теряет failure path в observability, и кроме того `.catch(…).catch(…)` — двойной guard, но ошибка `session.create` в racey-условиях может дублировать AISession (нет upsert).

---

## Warnings

### WR-01: `saveState` CONFLICT — возвращаемый `updatedAt` может быть stale

**File:** `platform-app/src/server/routers/project.ts:304-316`
**Issue:**
При P2025 делается второй `findUnique` для получения `currentVersion`/`updatedAt`, чтобы положить их в `cause`. Между ударом P2025 и этим findUnique может пройти ещё один успешный `update` от другой вкладки — клиент получит `currentVersion = N` и `updatedAt = T`, но на момент следующего `loadState` сервер может быть уже на `N+1`. Это не корректность optimistic locking (версия всё равно будет актуальной из загрузки), а observability — клиент логирует заведомо уже протухший `updatedAt`. Плюс лишний round-trip на конфликтный путь при каждом rejection. Мелкое, но стабильно "висит в логах навсегда".

**Fix:**

```typescript
} catch (err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    // Rather than re-read, rely on the next loadState to return the
    // canonical state — we only need to tell the client "it's stale".
    throw new TRPCError({
      code: "CONFLICT",
      message: "version mismatch",
      cause: { expectedVersion: input.expectedVersion },
    });
  }
  throw err;
}
```

Клиент в `useProjectSync.ts:297-303` всё равно делает `refetchCanvas()` при CONFLICT — так что `currentVersion` в причине даже не используется.

---

### WR-02: beacon endpoint обновляет `canvasState` + `version` последним-пишут при конфликте, но не логирует `userId`

**File:** `platform-app/src/app/api/canvas/save/route.ts:65-91`
**Issue:**
Beacon при конфликте делает `last-wins` без какой-либо информации о том, какой пользователь в каком воркспейсе перезаписал. При инциденте ("моя работа пропала") из `console.warn` можно восстановить только `projectId`/`expectedVersion`/`currentVersion`. Плюс `conflict` вычисляется через findUnique + update — это **две** транзакции, а не одна, поэтому возможна третья запись между ними, и флаг `conflict: true` может вернуться там, где сам beacon на самом деле был в рассинхроне, но уже legacy-ным путём.

Плюс в ответе возвращается `{ ok: true, version, conflict }` — клиент это читает? Судя по `useProjectSync.ts::saveNowSync` (стр. 346-358) — нет, ответ игнорируется, значит `conflict: true` уходит в пустоту.

**Fix:** добавить `userId` в warn-лог и сделать conflict-детекцию атомарной (одной update-with-version-predicate):

```typescript
console.warn(
  `[canvas/save] beacon version conflict: projectId=${projectId}, ` +
  `userId=${session.user.id}, client=${expectedVersion}, server=${current.version}`
);

// Or: do the update WITH version predicate; if P2025, do a bare update AND
// log the conflict. Single round-trip for happy path.
```

---

### WR-03: Тесты `saveState` не покрывают unauthorized и отсутствующий проект

**File:** `platform-app/src/server/routers/__tests__/project.saveState.test.ts:160-261`
**Issue:**
Из четырёх ветвей (success / conflict / legacy / unauthorized) тесты покрывают только первые три. Сценарий unauthorized (`assertProjectAccess` throws FORBIDDEN) неявно обойдён mock-ом `workspaceMember.findUnique` (всегда возвращает USER membership). `guards.ts::assertProjectAccess` может провалиться по трём разным причинам (нет проекта, нет членства, недостаточно роли), и ни одна из них не тестируется. Это оставляет риск регрессии, если кто-то рефакторит гард, но забывает изменить тест.

Плюс нет теста: `saveState` после успешного update возвращает `{ version }` такой же формы, что ожидает клиент. Сейчас это проверяется runtime, но не unit-test.

**Fix:** добавить 3 кейса:

```typescript
it("throws FORBIDDEN when user has no membership", async () => { /* workspaceMember.findUnique → null */ });
it("throws FORBIDDEN when user has VIEWER role (minRole=USER)", async () => { /* role: "VIEWER" */ });
it("throws NOT_FOUND when project does not exist", async () => { /* project.findUnique → null inside guard */ });
```

---

### WR-04: `lastGeneratedImageUrl` не валидируется как URL

**File:** `platform-app/src/server/routers/workflow.ts:278`
**Issue:**

```typescript
lastGeneratedImageUrl: z.string().optional(),
```

Поле затем проваливается в `executeAction.ts::apply_and_fill_template` где:
1. Отдаётся в `analyzeReferenceImages([preGeneratedImageUrl], topic)` → VLM (OpenAI/Replicate fetch).
2. Записывается в `canvasActions` как `update_layer.params.src = preGeneratedImageUrl` (строка 708, 829) — то есть напрямую идёт в `canvasState.layers[].src` через reducer клиента.

Проблема **не** в server-side SSRF (OpenAI/Replicate сами делают fetch), а в:
- сохранении невалидных/опасных схем (`javascript:`, `data:text/html`, произвольные http URL с токенами) в persisted canvasState;
- последующем ре-рендере этого src в share/publish-режимах.

`place_on_canvas` с LLM-генерированными URL-ами уже проходит через `assertUrlIsSafe(…, agentAddImagePolicy())` (executeAction.ts:269-280), а `apply_and_fill_template` — нет. Это нарушает принцип "любой URL из LLM/клиента должен пройти ту же проверку перед записью в canvasState".

**Fix:** в воркфлоу — `z.string().url().optional()` (минимум). В executeAction, перед записью `update_layer.src = preGeneratedImageUrl` — пропустить через ту же guard-логику, что в `place_on_canvas::image`:

```typescript
if (!/^data:image\//i.test(preGeneratedImageUrl)) {
  try {
    await assertUrlIsSafe(preGeneratedImageUrl, agentAddImagePolicy());
  } catch (e) {
    if (e instanceof SsrfBlockedError) {
      console.warn(`[Template Fill] preGeneratedImageUrl rejected (${e.code}): ${e.reason}`);
      // fall through: don't set imageSlot; copywriting continues with VLM context
      preGeneratedImageUrl = undefined;
    } else throw e;
  }
}
```

Замечу, что в `stability_research.md` уже висит A11 с пометкой "low sev, open" — этот PR расширяет поверхность атаки, поэтому приоритет A11 стоит пересмотреть.

---

### WR-05: `friendlyFetch` возвращает JSON-массив для `httpLink` (non-batched) путь

**File:** `platform-app/src/components/providers/TRPCProvider.tsx:50-80,106-120`
**Issue:**
`friendlyFetch` формирует

```json
[{ "error": { "json": { ... } } }]
```

— это форма tRPC **batched** envelope (массив ответов на массив запросов). Но тот же `friendlyFetch` подключён и к `httpLink` (non-batched, для `workflow.applyTemplate` / `workflow.interpretAndExecute`), который ожидает **объект**:

```json
{ "error": { "json": { ... } } }
```

Когда пользователь вызывает `applyTemplate` и Yandex API Gateway вернёт 502 с HTML, `friendlyFetch` отдаст массив на путь, где тRPC-client ждёт объект → parsing error ровно тот, который этот patch должен был исправить.

**Fix:** различать batched/non-batched по URL или по request-body:

```typescript
async function friendlyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.ok) return res;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res;

  const statusText = /* ... */;
  const envelope = {
    error: { json: { message: statusText, code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: res.status } } }
  };

  // batched endpoint has `?batch=1` in query; undici POSTs body.
  const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
  const isBatched = url.includes("batch=");
  const body = isBatched ? JSON.stringify([envelope]) : JSON.stringify(envelope);

  return new Response(body, { status: res.status, headers: { "content-type": "application/json" } });
}
```

Желательно прогнать реальный сценарий: остановить процесс / вернуть 502 и проверить обе ручки.

---

### WR-06: Fire-and-forget `trackAgentCosts` — race на AISession.findFirst + create

**File:** `platform-app/src/server/routers/workflow.ts:28-39`
**Issue:**

```typescript
let session = await prisma.aISession.findFirst({ where: { projectId, userId }, orderBy: { updatedAt: "desc" } });
if (!session) session = await prisma.aISession.create({ data: { projectId, userId } });
```

При параллельных вызовах (две interpretAndExecute одного юзера на одном проекте — редко, но бывает при нескольких табах) оба увидят `null` в findFirst и создадут **две** AISession. В результате AIMessage будут раскиданы по двум разным сессиям, и UI `useAISessionSync` (который берёт одну по `orderBy: updatedAt desc`) покажет только последнюю. Тестом не покрыто.

Это не критично (cost-tracking всё равно best-effort), но добавляет лишние строки и делает отладку "где мои сообщения?" сложнее.

**Fix:** upsert по уникальному ключу `(projectId, userId)`:

```typescript
const session = await prisma.aISession.upsert({
  where: { projectId_userId: { projectId, userId } },
  create: { projectId, userId },
  update: {},
  select: { id: true },
});
```

Потребуется `@@unique([projectId, userId])` в `schema.prisma` на модели `AISession` — сейчас там только `@@index([projectId])`. Миграция тривиальная.

---

### WR-07: `importWorker.ts` — unhandled rejections при update после throw внутри runImport

**File:** `platform-app/src/lib/figma/importWorker.ts:50-61,121-238`
**Issue:**
`startFigmaImport` делает `runImport(...).catch(async (err) => { cleanupFailedImport(...) })`. Внутри `cleanupFailedImport` есть `prisma.figmaImport.update` без try/catch — если DB временно недоступна (transient), promise.reject улетит вверх, но снаружи уже нет `.catch`. Получим UnhandledPromiseRejection, который на Yandex Serverless может повалить контейнер или просто невидимо съестся.

Плюс: `cleanupFailedImport` делает `prisma.project.delete` без предварительной проверки "прокинутый importId всё ещё FAILED/не закомплеченный" — если между getByImportId и delete кто-то руками переключил статус (редко, но возможно в админке), удалим живой проект.

**Fix:**

```typescript
runImport(args, prisma).catch(async (err) => {
  console.error("[figma/import] unhandled:", err);
  try {
    await cleanupFailedImport(prisma, args.importId, asError(err));
  } catch (cleanupErr) {
    console.error("[figma/import] cleanup also failed:", cleanupErr);
  }
});
```

(уже частично сделано — в ловушке `/* ignore */`, но лог сейчас молчит). И обернуть внутренний `prisma.figmaImport.update` в try/catch с логом.

---

## Info

### IN-01: `executeAction.ts` — magic number 200 000 (thumbnail cutoff) не соответствует комментарию

**File:** `platform-app/src/server/routers/project.ts:279`
**Issue:**
Комментарий говорит про "3.5 MB Serverless Container request limit", но cutoff — 200 000 байт (~195 KB) для base64. Для JPG это примерно 150 KB PNG — разумно, но несоответствие между магическим числом и объяснением в комменте сбивает с толку.

**Fix:** вынести константу с осмысленным именем:

```typescript
const MAX_INLINE_THUMBNAIL_BYTES = 200_000; // ~150 KB — мы предпочитаем S3-загрузку, inline base64 только как safety net
```

---

### IN-02: `visionAnalyzer.ts` — regex `^https?:\/\//i` пропускает http:// (не только https://)

**File:** `platform-app/src/server/agent/visionAnalyzer.ts:69,139`
**Issue:**

```typescript
img.startsWith("data:") || /^https?:\/\//i.test(img)
```

Это корректно в смысле "не ломайте legacy HTTP URLs", но противоречит политике `agentAddImagePolicy` (только https). Если `lastGeneratedImageUrl` — http-URL, VLM отдаст его OpenAI/Replicate, и те его достанут. Это не server-side SSRF в нашем периметре, но:
- В проде `lastGeneratedImageUrl` должен всегда быть S3-URL (→ https). http-путь должен быть мёртвой веткой.

**Fix:** сузить до https или хотя бы предупреждать:

```typescript
if (/^http:\/\//i.test(img)) {
  console.warn("[VisionAnalyzer] http:// URL passed to VLM — upgrade to https or reject");
}
```

Дополнительно связано с WR-04.

---

### IN-03: `executeAction.ts:173` — дублирующийся strip quotes

**File:** `platform-app/src/server/agent/executeAction.ts:170-174`
**Issue:**

```typescript
cleanPrompt = cleanPrompt.replace(/^["']|["']$/g, ''); // strip surrounding quotes
cleanPrompt = cleanPrompt.replace(/^(Here is the prompt:?\s*)/i, ''); // strip wrapper
cleanPrompt = cleanPrompt.replace(/^["']|["']$/g, ''); // strip quotes again after wrapper removal
cleanPrompt = cleanPrompt.trim();
```

Та же regex выполняется дважды. Можно сделать циклом до фикс-поинта или объединить в одну функцию. Не баг, но code smell.

**Fix:**

```typescript
const stripWrappers = (s: string) => {
  let prev;
  do {
    prev = s;
    s = s.replace(/^["']|["']$/g, '').replace(/^(Here is the prompt:?\s*)/i, '').trim();
  } while (s !== prev);
  return s;
};
cleanPrompt = stripWrappers(imagePrompt.trim());
```

---

### IN-04: `useProjectSync.ts` — module-level `projectVersionRefs` Map теряется при SSR hot-reload

**File:** `platform-app/src/hooks/useProjectSync.ts:100-109`
**Issue:**
Module-level `Map` — разумный трюк, чтобы `useLoadCanvasState` и `useCanvasAutoSave` делили версию без провайдера. Но:
- Map никогда не очищается — при долгой сессии и переходе между многими проектами Map растёт. На 1000 проектов — ~1 KB, не крит. Но это утечка.
- При Next.js Fast Refresh модуль может перезагрузиться, и Map обнулится — первый save после HMR пойдёт без expectedVersion → legacy-путь и last-wins.

**Fix:** очищать запись на unmount `useLoadCanvasState` (для ручного контроля) или принять как "трейд-офф документировано":

```typescript
useEffect(() => {
  return () => {
    projectVersionRefs.delete(projectId);
  };
}, [projectId]);
```

Не обязательно — текущее поведение приемлемо. Но стоит добавить комментарий.

---

### IN-05: `applyTemplate` игнорирует `projectId` для cost tracking

**File:** `platform-app/src/server/routers/workflow.ts:342`
**Issue:**

```typescript
void trackAgentCosts(
  ctx.prisma,
  ctx.user.id,
  undefined, // applyTemplate doesn't have projectId directly; use workspace-level
  [templateStep]
).catch(...);
```

`trackAgentCosts` первым делом делает `if (!projectId || steps.length === 0) return;` → для applyTemplate ничего не записывается в cost-ledger. Комментарий "use workspace-level" подразумевает, что есть workspace-level учёт — его нет. Это значит, что самый дорогой action платформы (applyTemplate — LLM + VLM + Replicate image gen) вообще не учитывается.

**Fix:** либо расширить `trackAgentCosts` на workspace-level (AISession.projectId сейчас NOT NULL, нужна миграция), либо принять `workspaceId` как fallback-контекст. В минимуме — убрать misleading комментарий и признать, что applyTemplate не трекается.

---

### IN-06: `asset.ts::deleteMany` — N+1 guards на заранее известном id-списке

**File:** `platform-app/src/server/routers/asset.ts:513-519`
**Issue:**

```typescript
for (const __id of input.ids) {
  const __a = await assertAssetAccess(ctx, __id, "write");
  const __r = await getWorkspaceRole(ctx.prisma, ctx.user.id, __a.workspaceId);
  ...
}
```

Для массового удаления 50 assets — 100 sequential round-trip'ов (50 assertAssetAccess + 50 getWorkspaceRole). `getWorkspaceRole` по `ctx.user.id` — один и тот же workspaceId почти всегда; можно сделать `Promise.all` либо закешировать role per workspace внутри процедуры. Пока не узкое место (deleteMany не horner), но масштабируется плохо.

**Fix (опционально, не-блокер):**

```typescript
const assets = await ctx.prisma.asset.findMany({ where: { id: { in: input.ids } } });
if (assets.length !== input.ids.length) throw new TRPCError({ code: "NOT_FOUND" });

const workspaces = new Set(assets.map(a => a.workspaceId));
const roles = new Map<string, string>();
for (const ws of workspaces) {
  roles.set(ws, await getWorkspaceRole(ctx.prisma, ctx.user.id, ws));
}
for (const a of assets) {
  if (a.uploadedById !== ctx.user.id && roles.get(a.workspaceId) !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", ... });
  }
}
```

---

## Приоритеты

**Блокеры релиза:** нет.

**Должно быть закрыто до merge (но не блокирует):** WR-04 (`z.string().url()` для `lastGeneratedImageUrl` — одна строка, копеечный фикс), WR-05 (friendlyFetch envelope — требует проверки обоих путей в devtools).

**Можно после merge:** WR-01, WR-02, WR-03, WR-06, WR-07, все IN-*.

---

_Reviewed: 2026-04-22T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
