# Research: Фичи Workflow Automation

**Milestone:** v1.0 — Workflow Automation: Product Reflection Scenario
**Дата:** 2026-04-24
**Автор:** researcher subagent
**Область:** визуальный нодовый редактор AI-сценариев, первый production-сценарий — «продукт с реалистичным отражением на прозрачном фоне».

---

## Summary

**Goal one-liner.** Спроектировать каталог фич и контракт UX для визуального нодового редактора автоматизации AI-воркфлоу. В v1 доставить сценарий «product reflection» как end-to-end-флоу (upload → background remove → reflection → export) и задать основы, расширяемые до полноценного Comfy-/Weave-уровня в v2+.

**Что говорит рынок.**

- **ComfyUI** — технический эталон. Front-to-back topological sort с dependency-aware caching по `CacheKeySetInputSignature` (hash по input signature + node class), lazy evaluation, строгая типизация портов (IMAGE / MASK / LATENT / CONDITIONING / MODEL / VAE / CLIP / INT / FLOAT / STRING), Subgraphs (официально с августа 2025, заменяют deprecated Group Nodes). Аудитория — инженеры.
- **Flora / FloraFauna.ai** — «Photoshop слоёв как граф» для креативных профи. 3 базовые модальности (Text / Image / Video), 50–80+ AI-моделей в одном canvas, Style DNA для brand consistency, AI-агент FAUNA (Assist/Auto/Plan режимы) — это *Cursor для canvas*. Collab — comment+share, **но без real-time co-edit**.
- **Figma Weave (ex-Weavy)** — таргетирует дизайнеров. Weavy acquired Figma 30.10.2025, relaunched 09.04.2026 с 20+ workflow-темплейтами в Figma Community. Ключевой differentiator — **App Mode**: из любого workflow автогенерится упрощённый UI для нетехнических пользователей. Философия: «Artistic Intelligence», «process over shortcuts».
- **Product reflection** в индустрии существует в двух парадигмах:
  - **Классика Photoshop**: flip-vertical + linear gradient mask + Gaussian blur + opacity 10–30 %. Детерминистично, быстро, работает на 80 % кейсов.
  - **AI (diffusion + ControlNet)**: DEROBA dataset + SD-1.5 + placement encoder (arxiv `2604.02168`); MirrorFusion / SynMirror для зеркал (arxiv `2409.14677`). Нужен для сложных сцен (зеркало, вода, спец-материалы).
  - **SaaS-сервисы (Photoroom, Canva)** — wrap вокруг AI-моделей с batch-процессингом и preset-контролями (soft/hard/floating/colored shadows; reflection intensity/blur/length/color/position).

**Что берём в v1 и что НЕ берём.** См. Anti-features секцию — MVP строго на один end-to-end сценарий product reflection + расширяемая архитектура.

**Ссылки на наш кодбейс как базу.**

- `platform-app/prisma/schema.prisma:410-426` — `AIWorkflow { steps: Json, isTemplate: Boolean, workspaceId, createdById }`. Модель уже есть — расширяем до `graph: Json`, backward-compat см. Open Questions.
- `platform-app/src/server/routers/workflow.ts` — CRUD (`list`, `getById`, `create`, `update`, `delete`) + агентные (`interpretAndExecute`, `applyTemplate`). Используем как основу для node-executor API.
- `platform-app/src/server/actionRegistry.ts:77-159` — 8 существующих actions (`generate_headline`, `generate_subtitle`, `generate_image`, `place_on_canvas`, `search_templates`, `apply_and_fill_template`, `create_project`, `search_style_presets`). Это и есть стартовый каталог типов нод — их нужно переосмыслить в парадигме ports.
- `platform-app/src/lib/ai-providers.ts` (`generateWithFallback`) + `ai-models.ts` — мультипровайдерная абстракция (Yandex GPT / OpenAI / Replicate / Gemini), уже готова к вызову из node executors.
- `platform-app/src/server/security/ssrfGuard.ts` — защита для external URLs, критично для image-input нод с referenceImages.
- `@aws-sdk/client-s3` + Yandex Object Storage (`storage.yandexcloud.net/acp-assets/**`) — готовый artifact storage для node-output кэша.
- Canvas = Konva (редактор креативов). Workflow-canvas — **отдельная поверхность** (react-flow / `@xyflow/react` кандидат), не мешаем с editor canvas.

---

## Конкуренты

### ComfyUI

**Источники:**
- [Core Nodes | ComfyUI Manual](https://comfyuidoc.com/Core%20Nodes/)
- [LoadImage | ComfyUI Docs](https://docs.comfy.org/built-in-nodes/LoadImage)
- [KSampler | ComfyUI Docs](https://docs.comfy.org/built-in-nodes/sampling/ksampler)
- [Graph Execution System | DeepWiki](https://deepwiki.com/Comfy-Org/ComfyUI/2.2-node-system)
- [Execution Model Inversion Guide](https://docs.comfy.org/development/comfyui-server/execution_model_inversion_guide)
- [ComfyUI Subgraph (2025-08-07 release)](https://comfyui-wiki.com/en/news/2025-08-07-subgraph-official-release)
- [Images, Latents, and Masks | ComfyUI Docs](https://docs.comfy.org/custom-nodes/backend/images_and_masks)

**Модель исполнения:**

- **Front-to-back topological sort** (с PR #2666 инвертировали из back-to-front recursive). `ExecutionList` расширяет `TopologicalSort` паттерном *topological dissolve*: ноды стейджатся, могут быть unstaged если зависимости изменились (например лениво подгрузился новый input), удаляются только при успехе.
- **Three-state execution**: `SUCCESS` / `FAILURE` / `PENDING` (для async + lazy).
- **Lazy evaluation**: инпут помечается `"lazy": True` в schema → weak link (не блокирует выполнение). Нода реализует `check_lazy_status(inputs_so_far)` и возвращает список имён реально нужных ей инпутов → тогда ComfyUI делает `make_input_strong_link()` (конвертит в strong dep).
- **Dependency-aware caching**: `CacheKeySetInputSignature` хэширует input signature + node class + `fingerprint_inputs()`. Ноды пере-исполняются, только если их inputs или upstream dependencies реально изменились. Стратегии кэша: `classic` (ASAP dump), `LRU`, `RAM_PRESSURE` (адаптивное выселение по `_ram_gb`), `null` (с `--cache-none`).
- **Subgraph expansion**: нода может во время выполнения вернуть `{"expand": {...}}` → развернётся в подграф. Так реализуются loops через tail-recursion.

**Ключевые ноды (v1 ComfyUI core):**

| Нода | Inputs (типы) | Outputs | Назначение |
|------|---------------|---------|-----------|
| `LoadImage` | path (COMBO[STRING]) | `IMAGE`, `MASK` | Загрузка файла + auto-extract alpha как маску |
| `CLIP Text Encode` | text (STRING), clip (CLIP) | `CONDITIONING` | Embedding промпта (positive / negative) |
| `Empty Latent Image` | width, height, batch_size (INT) | `LATENT` | Стартовый шум |
| `KSampler` | model (MODEL), positive/negative (CONDITIONING), latent_image (LATENT), seed/steps/cfg (INT/FLOAT), sampler_name/scheduler (Enum), denoise (FLOAT) | `LATENT` | Основной цикл diffusion |
| `VAE Decode` | samples (LATENT), vae (VAE) | `IMAGE` | Latent → pixels |
| `VAE Encode` | pixels (IMAGE), vae (VAE) | `LATENT` | Pixels → latent (для img2img) |
| `Save Image` / `Preview Image` | images (IMAGE), filename_prefix | side-effect + превью на ноде | Вывод |

**Типизация портов (критично для UX):**

- Типы: `IMAGE` (torch.Tensor `[B,H,W,C]`, C=3), `MASK` (`[B,H,W]`, 0..1 float), `LATENT` (dict, `samples` shape `[B,C,H,W]`, C=4, channel-first), `CONDITIONING`, `MODEL`, `VAE`, `CLIP`, `INT`, `FLOAT`, `STRING`, + Enum (COMBO).
- **Слоты цветокодированы** (CONDITIONING — оранжевый, LATENT — розовый, IMAGE — синий, MASK — серый и т.д.). Несовместимые типы физически не соединяются.
- `LoadImage` всегда эмитит маску (если нет alpha — дефолтная `[1, 64, 64]`). Это учебный момент: UX эмитит «что-то» всегда, чтобы не плодить null-handling.

**UX-паттерны:**

- **Queue-based run**: кнопка «Queue Prompt» → workflow попадает в очередь, фронт слушает websocket (`progress`, `executing`, `executed` events). В очереди может стоять сразу много ран с разными seed-ами.
- **Node state visualization**: выполняющаяся нода подсвечивается рамкой, completed — зелёным, error — красным с inline-сообщением, cached — не исполняется (visual hint).
- **Preview on node**: `Save Image`/`Preview Image` показывают thumbnail результата прямо на ноде. Flaky UX: известные баги со stale preview и state-sync при browser reload ([issue #8136](https://github.com/Comfy-Org/ComfyUI_frontend/issues/8136), [#12439](https://github.com/Comfy-Org/ComfyUI/issues/12439)) — websocket execution state держится только в памяти клиента.
- **Node params редактируются прямо на ноде** (в отличие от Weave/Flora, где чаще inspector panel). Экономит клики, но плохо масштабируется на ноды с 10+ параметрами.
- **Node search / add via right-click** или double-click на canvas → fuzzy search (тысячи нод от custom authors).

**Subgraphs / groups:**

- Релиз август 2025 (frontend ≥ 1.24.3), заменяют deprecated Group Nodes. Packages node-combination как reusable node с inputs/outputs. Auto-detect port mapping при создании.
- Поддерживают nesting (вложенные subgraphs). Статус: **нестабилен** в 0.17.x — в GH open issues о битых connections, duplicated inputs, corrupted saves ([#13007](https://github.com/Comfy-Org/ComfyUI/issues/13007)). Вывод: даже эталон не решил subgraphs без багов — в v1 **не делаем**.

**Что берём (для нашей платформы):**

1. **Front-to-back topological sort + dependency-aware caching по input-hash.** Это база execution engine. Кэш артефактов — S3 (у нас уже есть) по ключу `sha256(nodeType + params + upstream_output_hashes)`.
2. **Строгая типизация портов**: `image` / `mask` / `text` / `number` / `boolean` / `asset-ref` (наш domain-тип — ссылка на `Asset`). Совместимость проверяется на уровне UI (не даём соединить несовместимые) + сервер (второй guard при execute).
3. **Queue + websocket execution updates**. Но подчиняемся нашей инфре: можно просто server-sent events / tRPC subscriptions. `executing_node_id`, `progress`, `error`, `done` events.
4. **Preview на нодах** для image/text output — thumbnail на каждой ноде (lazy load из S3 по node-cache-key).
5. **Lazy evaluation как семантика, но НЕ как API в v1**. Слишком сложно для пользователя. В v2+.

**Что НЕ берём:**

- Латенты/CLIP/VAE — наш слой абстракции выше, пользователь не должен знать про latent space. Генерация = одна нода с `prompt`+`model`+`params` → output IMAGE.
- Параметры «на ноде» в стиле Comfy — плохо читается при 10+ полях. Используем inspector panel (как Weave/Flora).
- Subgraphs — слишком рано + эталон нестабилен (см. выше).

---

### FloraFauna.ai (Flora AI)

**Источники:**
- [Node Overview | FLORA Docs](https://docs.florafauna.ai/nodes/editor)
- [FAUNA | FLORA Docs](https://docs.flora.ai/editor/fauna)
- [Flora AI Review 2026 | memorable-studio.com](https://memorable-studio.com/reviews-flora-ai/)
- [FloraFauna AI Review 2026 | AI Biz Builder Pro](https://aibizbuilderpro.com/florafauna-ai-review-2026-features-pricing-and-honest-verdict/)

**Модель:**

Node-based creative canvas с **тремя базовыми модальностями** (Text Node / Image Node / Video Node) и 50–80+ AI-моделей, доступных из одной подписки. Infinite canvas, node toolbar появляется по hover. Каждая нода — сразу и input, и generate, и output. Типа Flux → Seedream → Upscaler → Video-модель — всё в одной цепочке. Видимая траба: при 50 SKU catalog pipeline экономит часы (`one pipeline, N inputs`).

**Ключевые ноды:**

- **Text Node** — LLM / prompt / text op.
- **Image Node** — generate / edit / upscale / variation. Модели: Flux 2 Pro, Seedream 4.5, Nano Banana Pro, Ideogram 3.0 и пр.
- **Video Node** — t2v / i2v / motion. Модели: Kling, Veo 3.1, Luma, Hailuo, Sora.
- **Character Swap / Background Swap** — специализированные нодовые утилиты.
- **Style DNA** — первый-класс «brand consistency» примитив (референсный стиль распространяется вниз по пайплайну).

**Chain-templates / пресеты:**

Да — есть workflow-шаблоны (иначе FAUNA не умел бы «Create a starter workflow»). Но отдельного «template marketplace» UX-уровня Figma Community у Flora нет — шаблоны спрятаны глубже (через онбординг, FAUNA starter).

**Collab:**

- Commenting, shared workflows, workflow versioning.
- **НЕТ real-time co-edit** (это явный gap vs Figma, который обозревает [memorable-studio](https://memorable-studio.com/reviews-flora-ai/) как минус для teams 4+).

**Differentiator: FAUNA (AI-агент):**

FAUNA = «Cursor для creative canvas». Лично самый интересный UX-паттерн:

- **3 режима**: Assist (default, approval перед run) / Auto (run immediately) / Plan (ideate only, no credits).
- Читает выбранные ноды как контекст, `@` — mention ноды по имени.
- Может: добавлять ноды, модифицировать settings/prompts/models, reconnect/restructure, remove, create variations, group into containers, arrange/organize, run up to 50 нод одновременно.
- Streaming + «thinking timeline» (expandable log of tool-calls).
- Pricing: $18/mo Starter (20k credits), credit rollover.

**Что берём:**

1. **Три базовых класса нод для нашего v1** — Text / Image / Video (в v1 видео пока НЕ). Каждая нода многорежимная: для Image — generate / edit / upscale это не отдельные ноды, а разные *modes* одной ноды (уменьшает визуальный шум). Альтернатива: отдельные ноды — Comfy-style (не оптимально для нас).
2. **Style DNA как концепция** (не в v1): brand-consistency референс, распространяемый по пайплайну. Это отлично ложится на наш существующий `brandKitStore.ts`.
3. **Workflow templates как first-class feature** — fork-from-preset (`AIWorkflow.isTemplate = true` уже заложено в схеме, `platform-app/prisma/schema.prisma:415`).
4. **«Canvas selection as context»** — если у нас будет чат-агент поверх нодового редактора, он должен читать selection (это уже делаем в `AIChatPanel`).
5. **FAUNA-like agent — отложить в v2+**, но архитектурно заложить: наши existing 8 actions → «canvas tools» для agent (уже частично так в `src/server/agent/`).

**Что НЕ берём:**

- 50+ моделей сразу — для v1 хватит наших текущих 4 провайдеров + их моделей. Расширение постепенно.
- Real-time co-edit — у Flora его тоже нет, не проигрываем. Explicit anti-feature (см. ниже).

---

### Figma Weave

**Источники:**
- [Introducing Figma Weave | Figma Blog (Oct 30, 2025)](https://www.figma.com/blog/welcome-weavy-to-figma/)
- [Turning prompts into five scalable workflows | Figma Blog (Apr 9, 2026)](https://www.figma.com/blog/five-figma-weave-workflows/)
- [Figma Weave | weave.figma.com](https://weave.figma.com/)
- [Figma Weave product page | EveryDev.ai](https://www.everydev.ai/tools/figma-weave)
- [How to use Figma Weave | sergeichyrkov.com](https://sergeichyrkov.com/blog/how-to-use-figma-weave-to-add-ai-generated-videos-to-your-website-designs)

**Что известно:**

- **История**: Figma купила Weavy (Tel Aviv, 2024-founded, SOC 2 Type II) 30.10.2025. Rebrand в «Figma Weave» + relaunch 09.04.2026 с 20+ workflow-templates в Figma Community. Интеграция с Figma main canvas — **в работе** (объявлено на 2026, без конкретной даты).
- **Философия**: «Artistic Intelligence», «process over shortcuts», «first prompt is the starting point, not the destination». Таргет — профессиональные дизайнеры, не инженеры.
- **Model zoo**: Google (Imagen, Veo), OpenAI (Sora), Bytedance (Seedance/Seedream), Kling, Black Forest Labs (Flux), Runway, Luma, Lightricks, Wan, Grok, Recraft, Bria, Ideogram, Higgsfield.

**Ноды Figma Weave (подтверждённые по блогу и обзорам):**

Generative:
- **Prompt** — текстовый ввод.
- **Image Generation** — выбор модели (Imagen 4, Ideogram v3, Flux, Nano Banana, Seedream).
- **Video Generation** — Seedance, Kling, Sora, Higgsfield.
- **Any LLM** — выбор любой text-модели + instruction.
- **Image Describer** — анализ референс-картинки, возвращает текстовое описание визуальных атрибутов (texture, color, lighting, composition). **Ключевой паттерн**: генерация описания → feed в prompt вниз по цепочке. Даёт «style extraction» без LoRA.

Editing (professional-grade):
- **Compositor** — многослойный композит Photoshop-style (layers, blend modes, masks). Это не «layer stack as node» — это нода, в которой внутри целый мини-Photoshop.
- **Crop** — кроп к aspect ratio.
- **Inpaint / Outpaint**.
- **Mask Extractor** — вытаскивает маску из изображения (аналог background remove, но general-purpose).
- **Upscale**.
- **Z Depth Extractor** — depth map (для 3D-пайплайнов и depth-based effects).
- **Channels** — работа с R/G/B/A каналами.
- **Painter** — ручное рисование поверх.
- **Relight** — изменение освещения сцены (один из самых «магических» узлов, двухчастный: `Relight 2.0 human`, `Relight — Product`).
- **Invert**.
- **ControlNet — Structure Reference** — structure-conditioning нода.
- **Camera Angle Control**.
- **3D node** (Rodin 3D V2 для t2-3D, + view-generation front/back/left/right).
- **Kling Element** — motion reference для видео-генерации.
- **Wan LoRa** — LoRA-based transformation.
- **Export**.

**UX-отличия от ComfyUI:**

| Ось | ComfyUI | Figma Weave |
|-----|---------|-------------|
| Аудитория | Инженеры / ML-энтузиасты | Креативные дизайнеры, агентства, VFX |
| Низкоуровневые концепты | Виден latent, CLIP, VAE, sampler, CFG scale | Скрыты — только prompt + model + обычные media-концепты |
| Параметры | На ноде (компактно, но перегружено) | В боковой панели + ключевые превью на ноде |
| Workflow share | JSON-файл, PNG с embedded metadata, custom node deps | First-class `Figma Community` ресурс типа |
| Collab | — | В работе (Figma main canvas integration) |
| «App Mode» | — | **Differentiator**: автогенерит упрощённый UI для нетехничных пользователей |
| Многомодельность | Любая модель руками | 12+ провайдеров в стандарте |

**5 публичных workflow-сценариев (из Apr 2026 блога):**

1. Style extraction (2 референса → Image Describer → объединённое описание → сравнение на разных моделях).
2. Master style description (LLM merger) → apply to new subject (flower-rock style → begonia plant).
3. 3D asset pipeline (flat image → Rodin 3D V2 → multi-view → model).
4. Compositing для homepage layout.
5. Motion на static composition (Kling Element control).

**Что берём:**

1. **Image Describer как нода первого класса** — `VLM Describe` уже есть в нашей кодбазе (`src/server/agent/visionAnalyzer.ts`). Обернуть в ноду с output `text`. Мощный паттерн для style-extract сценариев.
2. **«App Mode» — долгосрочный killer feature** для нас (не в v1, но в mind). Workflow → упрощённый UI для operator-пользователей (маркетологов, категорийных менеджеров). Это именно то, что наш bus enterprise юзер ждёт.
3. **Template workflows как публикуемый артефакт** (like Figma Community). В v1 — просто `isTemplate=true` с кнопкой «Fork». В v2 — marketplace.
4. **Параметры в inspector panel, не на ноде.** Выбранная нода → правый dock с формой параметров. У нас этот паттерн уже есть в editor (`PropertiesPanel`).
5. **Mini-preview на каждой output-ноде** (image/video/text) — именно визуальный артефакт, не только статус.
6. **Editing tools как отдельные ноды** (не mode одной ноды) — когда функция специализирована (Relight, Outpaint), отдельная нода читается понятнее.

**Что НЕ берём (пока):**

- Все 15+ editing tools сразу. В v1 нам нужны буквально 4: Background Remove, Add Reflection (product reflection сценарий), Crop/Resize, Compositor. Остальные — в бэклог с чётким приоритетом (см. категории нод ниже).
- 3D pipeline — не наш scope.
- Видео — не в v1 (требует интеграции видеомоделей, медленная генерация, сложный preview).

---

## Product Reflection — индустрия

### Классический алгоритм (Photoshop-style, детерминистичный)

Консенсус между источниками — [Pixelz](https://www.pixelz.com/blog/shadows-product-images-photoshop/), [Retouching Labs](https://retouchinglabs.com/add-shadows-to-product-images-photoshop/), [Creatively Squared](https://www.creativelysquared.com/article/create-a-realistic-product-reflection-in-photoshop), LinkedIn guide. Пайплайн стабилизировался:

```
1. Isolate object (background removal / alpha-channel)
2. Duplicate product layer → Flip Vertical
3. Align flipped copy bottom-to-bottom with original
4. Add layer mask + linear gradient
     (top of flipped = opaque, bottom of flipped = transparent)
5. Gaussian Blur (radius 2–3 px)
6. Opacity 10–30 % (Retouching Labs) / 30–50 % (LinkedIn guide)
7. Optional: брашом убрать боковые хвосты, чтобы reflection начинался ровно от контакта
```

Для нашей платформы это **идеально** как v1 реализация нода `AddReflection`: детерминистично, быстро (client-side Canvas2D или server-side sharp/ImageMagick), не жжёт AI-кредиты, работает на 80 % product-shots. Единственная сложность — правильно определить «линию контакта» (ground line), для чего нужен bbox объекта после background removal.

Параметры ноды (минимум):
- `opacity` (0..1, default 0.25)
- `blur` (px, default 2.0)
- `fade_start` (0..1, default 0.0 — где gradient начинает fade)
- `fade_end` (0..1, default 1.0)
- `vertical_offset` (px, default 0 — зазор между объектом и отражением)

Это **достаточно для 80 % кейсов**. В v1 — только детерминистический nodel; AI-режим — отдельной нодой в v1.5+.

### Современные AI-подходы

**1. Photoroom (production SaaS).** ([Shadows](https://photoroom.com/tools/instant-shadows), [Reflections batch](https://www.photoroom.com/batch/add-reflections), [Bulk shadows](https://www.photoroom.com/batch/ai-shadows))

- Разводят shadows и reflections как **две разные фичи**. *«Shadows show where a product sits. Reflections show what a product is sitting on.»*
- AI-shadow generator: анализ light direction + product shape → генерирует shadow (soft / hard / floating / colored). Пользовательские параметры: intensity, blur, length, color, position.
- Batch mode: сохранённый preset применяется к всему каталогу (единый lighting footprint across SKUs).
- Открытый API для интеграции в e-commerce пайплайны.
- Shopify-plugin — заметный distribution-канал.

**2. Canva.** ([Photoroom vs Canva](https://creati.ai/ai-tools/photoroom/alternatives/photoroom-vs-canva-comprehensive-comparison-photo-editing-design-tools/))

- Shadow/reflection через Magic Edit — one-shot, без batch.
- Target — social media creators, не e-commerce.

**3. AI-diffusion подходы (research):**

- **DEROBA + ControlNet SD-1.5** ([arxiv 2604.02168v1](https://arxiv.org/html/2604.02168v1)): первый large-scale reflection dataset. Архитектура: composite image + foreground mask → ControlNet encoder → auxiliary encoder предсказывает (a) reflection bounding box через регрессию, (b) reflection type — `vertical` (зеркало/вода) или `others` (глянцевые surfaces) → diffusion генерирует physically-coherent reflection. Объединяется с classical prior-ом (где отражение *должно* быть по bbox объекта).
- **MirrorFusion / SynMirror** ([arxiv 2409.14677](https://arxiv.org/abs/2409.14677)): depth-conditioned inpainting для зеркал. SynMirror — 198k samples, 66k объектов перед зеркалами + depth maps + normal maps + segmentation. Вывод: зеркальные отражения — это inpainting problem, который выигрывает от geometric priors.
- **ControlNet Reflection LoRA** — community-trained модули (есть в ComfyUI / Civitai экосистеме).

**4. Hybrid-подход (рекомендация):**

| Кейс | Подход | Почему |
|------|--------|--------|
| Product on reflective surface (glossy table, glass shelf) | **Classical flip+mask+blur** | Детерминистично, бесплатно, <100 мс, работает на 80 % |
| Product в зеркале / с водным отражением | **AI (diffusion inpainting с depth-prior)** | Classical не справится с геометрией; зеркало требует geometric awareness |
| Complex highlights (jewelry, metal) | **AI-relight + classical reflection** | Relight модель правит highlights, дальше classical |

### Что берём в v1

- **Node `AddReflection` — classical** (deterministic, server-side sharp или canvas-based). 5 параметров, ~150 LOC на implementation.
- **Node `GenerateImage`** — уже есть в `actionRegistry.ts:99`, wrap в нодовый контракт с typed ports.
- **AI-based reflection (`AIReflection` нода)** — v2+. Интеграция через Replicate / кастомную модель.

---

## Категории нод

Чёткая классификация даёт UX-навигацию (группы в Node Palette) и архитектурную ясность (разные категории — разные execution-контракты).

### Input

Ноды без upstream-входов, только выходы. Они — точки входа данных в workflow.

- **Table stakes (v1):**
  - `ImageInput` — загрузка файла через file-picker или drop в canvas. Output: `image`. Резолвится через наш existing S3-presign flow (`src/app/api/upload/presign/route.ts`).
  - `AssetLibraryPicker` — выбор из Asset Library воркспейса. Output: `image` (c `assetId` в metadata для отслеживания). Наш differentiator (интеграция с существующим `asset` router).
  - `PromptText` — свободный текст. Output: `text`. Параметр — multiline с variable-slots (`{topic}`, `{brand_name}`) для шаблонизации.

- **Differentiators (v2+):**
  - `BatchInput` — CSV / JSON-массив → N одинаковых runs для catalog-сценариев.
  - `BrandKitValue` — читает значение из `brandKitStore` (primary color, logo, brand prompt suffix). Naturally connects to нашему existing Brand Kit.
  - `FigmaImport` — тянет node из Figma-файла (`figmaRouter` уже есть).

- **Anti-features:**
  - `CameraInput` — live camera feed. Не e-commerce use-case.
  - `UrlFetch` — произвольный URL. SSRF-риск, нам уже пришлось писать `ssrfGuard.ts`. Только через whitelisted providers.

### Transform

Детерминистичные (не-AI) image transformations. Быстрые, без кредитов.

- **Table stakes (v1):**
  - `BackgroundRemove` — альфа-канал. Через Replicate `rembg` или аналог (уже есть в `ai-providers.ts` инфра для Replicate). **Критично для product reflection сценария.**
  - `AddReflection` — classical flip+mask+blur+opacity (см. Product Reflection секцию выше). **Критично.**
  - `Resize` — фиксированная ширина / высота / fit-mode (`cover` / `contain`).
  - `Crop` — aspect ratio / manual bbox.

- **Differentiators (v2+):**
  - `Flip` (H / V) — редкий самостоятельно, но атомарный строительный блок.
  - `Rotate`.
  - `AddShadow` (classical) — как у Photoroom, но локально.
  - `PadToAspect` — для Instagram / VK / TG format-fitting.
  - `ColorAdjust` — brightness / contrast / saturation.

- **Anti-features:**
  - `CustomFilter` (произвольная SVG-filter или WebGL-шейдер) — слишком опасно для SaaS.
  - `CustomScript` — см. Anti-features секцию ниже.

### AI

Обращения к AI-провайдерам. Платные, медленные, могут failить. Требуют ретраи / fallback.

- **Table stakes (v1):**
  - `GenerateImage` — text-to-image. Параметры: `prompt`, `model` (селектор из `ai-models.ts`), `aspectRatio`, `referenceImages?`. Output: `image`. У нас уже есть через `/api/ai/generate` — просто обернуть в ноду.
  - `GenerateText` (LLM) — bridge на `generate_headline` / `generate_subtitle`, обобщённый через `template` + `variables`. Output: `text`.
  - `VLMDescribe` — референс-картинка → текстовое описание. Уже есть в `src/server/agent/visionAnalyzer.ts`. Ключ к style-extract паттернам.

- **Differentiators (v2+):**
  - `Inpaint` — image + mask + prompt → image. Критично для product photography edits.
  - `Outpaint` — extend canvas. У нас есть `outpaint upload` баг (см. `.planning/quick/20260422-fix-outpaint-upload-head-timeout/`), значит инфра начала формироваться.
  - `Upscale` — via Replicate real-esrgan / аналог.
  - `Relight` — via Comfy/Replicate relight-модель.
  - `AIReflection` — diffusion-based (см. DEROBA/MirrorFusion выше).
  - `ImageEdit` — prompt-based edit (Nano Banana, GPT-image).

- **Anti-features:**
  - `CustomModel` — arbitrary HuggingFace / user-uploaded checkpoint. Безопасность + биллинг.
  - `VideoGenerate` — не scope v1 (long-running, expensive, нужна своя UX для превью).

### Composite

Слоёная работа с изображениями. Много-input ноды.

- **Table stakes (v1):**
  - `PlaceOnCanvas` — output-нода: отправляет image / text на наш Konva canvas (editor). Уже есть в `actionRegistry.ts:110` как action. Это наш differentiator vs Comfy/Weave — мы пишем результат не в файл, а в реальный дизайн-редактор.

- **Differentiators (v2+):**
  - `LayerStack` — композит нескольких IMAGE через blend modes (normal / multiply / screen / overlay / add). Ближайший аналог — Figma Weave Compositor.
  - `MaskCompose` — image + mask + background → композит с прозрачностью.
  - `GradientFill` — генерит gradient layer для backgrounds.
  - `TextToLayer` — рендерит text (font + size + color) в image-layer, можно композитить.

- **Anti-features:**
  - `FullPhotoshopCompositor` — Weave-style мини-Photoshop внутри одной ноды — слишком ambitious для v1.

### Output

Терминальные ноды (без downstream). Записывают результат куда-то наружу от workflow.

- **Table stakes (v1):**
  - `SaveToAssetLibrary` — загружает output image в наш Asset Library (таблица `Asset`, S3). Автоматически tag-ит `workflowId`, `nodeId`, `runId`. Наш differentiator.
  - `ExportPNG` — download-кнопка на ноде (file-saver, у нас уже есть `file-saver ^2.0.5`).
  - `PlaceOnCanvas` — см. Composite (это гибрид composite + output).

- **Differentiators (v2+):**
  - `ExportBatch` — ZIP через существующий `jszip` — полезно для catalog-сценариев.
  - `PushToFigma` — обратно в Figma-файл через existing OAuth.
  - `SaveTemplate` — сохранение в `Template` table (наш editor template).

- **Anti-features:**
  - `SendEmail` / `SendSlack` / `PostWebhook` — это уже территория Make/Zapier, не наш scope.
  - `WriteToDatabase` — никаких arbitrary DB-операций из workflow.

---

## UX Table stakes (v1)

Ниже — минимум, без которого v1 не летит.

1. **Two-pane layout**: левая — Node Palette (категории как табы), центр — Canvas с графом, правая — Inspector (параметры выбранной ноды) + Asset Library drawer.
2. **Drag-n-drop из палитры**: таскаем ноду из палитры на canvas; drop creates instance с дефолтными параметрами. Дубль кликом по категории — добавляется в центре viewport.
3. **Typed port connections**: каждый порт имеет type (`image` / `text` / `mask` / `number` / `boolean` / `asset-ref`). Несовместимые типы визуально не соединяются (drop не регистрируется, tooltip показывает почему). Слоты цветокодированы.
4. **Inspector-driven params**: выбранная нода → правая панель с formом по schema параметров. На самой ноде — только название + 1 preview output.
5. **Preview на ноде**: для output-порта типа `image` — мини-thumbnail (96×96) прямо на ноде, lazy-load из S3 по node-cache-key. Для `text` — первые 60 символов. Click на preview → expand в modal.
6. **Run workflow**: кнопка Run на toolbar, keyboard shortcut (⌘⏎). Выполняет граф в порядке топосорта. Dirty-marking: если upstream нода изменилась, downstream помечается dirty; при re-run только dirty ноды исполняются (через input-hash cache, как в ComfyUI).
7. **Progress indicator**: прогресс на уровне workflow (N of M nodes done) + per-node state (`idle` / `queued` / `running` / `done` / `error` / `cached`). Активная нода подсвечена anim-border.
8. **Error states**: ошибка на ноде → красная рамка + inline-сообщение (expand для stacktrace). Downstream ноды помечаются `skipped` с tooltip «Upstream node `{name}` failed».
9. **Save / Load workflow**: persisted в `AIWorkflow` (уже есть). Auto-save с debounce (аналогично `useProjectSync`).
10. **Fork template**: кнопка «Duplicate as my workflow» на template-ноде. Создаёт копию с `isTemplate=false, createdById=me`.
11. **Undo/Redo на графе**: добавление/удаление ноды, соединение/разъединение, перемещение, правка параметра — все undoable. Реализация через Zundo-pattern или commit-event log (не через Zustand middleware, т.к. граф — большой объект).

---

## Differentiators (v1)

Что делает нас *особыми* vs Comfy / Flora / Weave в контексте Yandex-ориентированного SMB-рынка и нашего existing editor.

1. **Интеграция с existing Konva-редактором** (`src/app/editor/[id]/page.tsx`). `PlaceOnCanvas` нода drop-ит результат прямо на artboard с правильным позиционированием (centered, fit-to-canvas). Ни Comfy, ни Flora, ни Weave этого не имеют — у них workflow и design-canvas разделены.
2. **Asset Library как first-class data source**. `AssetLibraryPicker` и `SaveToAssetLibrary` ноды — закрытый loop для production-пайплайнов: ассет из библиотеки → workflow → обратно в библиотеку. Вся метаинформация (`workflowId`, `nodeId`, `runId`) трекается — audit trail.
3. **Multi-format / resize first-class**. Наш editor уже имеет концепцию Master/Instance (см. `createComponentSlice.ts`). Workflow может запустить один run, сгенерить один master-output и автоматически каскадить в N размерных instances. Это killer для e-commerce (1 продукт → 15 размеров под Маркет/Ozon/WB).
4. **Русскоязычный LLM-провайдер (Yandex GPT) как first-class citizen**. Уже интегрирован в `ai-providers.ts`. Text-ноды работают на русском из коробки, без «перевода промпта на английский» проблемы.
5. **Template-marketplace с workspace-scoped** (и в перспективе — федеративный по воркспейсам). `AIWorkflow.isTemplate` уже есть в схеме. Отраслевые пресеты: «Карточка товара для Маркета», «Рекламный баннер для Лавки» — выстрелят.
6. **AI-агент (перспектива v1.5)**: уже имеем `interpretAndExecute` в `workflowRouter`. Эволюция до FAUNA-уровня через расширение `actionRegistry` инструментами манипуляции графом (`add_node`, `connect_nodes`, `run_subgraph`, `modify_param`).

---

## Anti-features (явно НЕ делаем в v1)

| Anti-feature | Почему не сейчас | Когда пересматриваем |
|--------------|------------------|----------------------|
| **Real-time collaboration** | CRDT/OT — отдельный проект на квартал. Flora обходится без этого, Figma Weave тоже. | v2+, когда у нас будет 10+ user-session per workspace. |
| **Custom code nodes** (JS / Python) | Sandbox-escape, биллинг-абьюз, отладка, versioning. `executeAction.ts` как single-source-of-truth безопаснее. | Никогда без Vercel Sandbox / аналога на нашей инфре. |
| **Subgraphs / nested workflows** | Даже ComfyUI имеет баги ([#13007](https://github.com/Comfy-Org/ComfyUI/issues/13007), [#6391](https://github.com/Comfy-Org/ComfyUI_frontend/issues/6391)). Усложняет execution engine, кэш-ключи, UI-навигацию. | v2, когда граф >20 нод регулярно. |
| **Plugin marketplace** | Third-party security, revenue-share, governance. Слишком рано. | v3+. |
| **Video nodes** | Долгая генерация (минуты), дорого, отдельный preview UX. | v2, после milestone 1.0. |
| **Arbitrary HTTP / webhook nodes** | SSRF-риск (у нас уже есть `ssrfGuard.ts` не просто так), scope-creep в сторону Make/Zapier. | Никогда, кроме whitelisted integrations (Figma, наша собственная API). |
| **Latent-space ноды** | Утечка абстракции к пользователю. Мы на слое выше Stable Diffusion internals. | Никогда для end-users; возможно internal debug-режим. |
| **3D-pipeline** | Не наш product market fit. | v3+ или never. |

---

## Flow «Product Reflection» — упрощённая версия v1

### Высокоуровневый граф (target UX)

```
[ImageInput / AssetLibraryPicker]
         │ image
         ▼
[BackgroundRemove]
         │ image (RGBA с alpha)
         ▼
[AddReflection]   ◀── params: opacity=0.25, blur=2.0, fade=0..1
         │ image
         ▼
[SaveToAssetLibrary]  ──also──▶  [PlaceOnCanvas]  (optional)
```

**Минимум нод**: 4 (input + 2 transform + 1 output). С optional `PlaceOnCanvas` — 5. Это попадает в target «~5 нод» из задания.

### Расширенный граф (с AI-фоном под товар)

```
[ImageInput]          [PromptText: "minimal cream beige background"]
     │                          │
     ▼                          ▼
[BackgroundRemove]       [GenerateImage (Yandex Art / Flux)]
     │ image + alpha             │ image
     │                           ▼
     │                     [Resize: match product size]
     │                           │
     └─► [LayerStack] ◀──────────┘  (product поверх background через alpha)
             │
             ▼
        [AddReflection]
             │
             ▼
        [SaveToAssetLibrary] ──▶ [PlaceOnCanvas]
```

Это v1.5 target — добавляем `GenerateImage` + `LayerStack`. Пока `LayerStack` в v2, ограничиваемся базовым графом выше.

### Execution path через существующую инфру

1. **`ImageInput`** — клиент загружает файл → presigned URL (`src/app/api/upload/presign/route.ts`) → S3 key. Output: `{ assetId, s3Key, width, height }`.
2. **`BackgroundRemove`** — server-side вызов `generateWithFallback` с Replicate rembg-модель, передаёт s3Url. Output: новый s3Key (PNG с alpha). Кэш: `sha256(nodeType + s3Key_input)` → если хэш был — сразу возвращаем out.
3. **`AddReflection`** — server-side через `sharp` (нужно добавить в deps, либо через нашу existing image-pipeline). Операции: flip, композит с gradient mask, blur, opacity. Output: новый s3Key.
4. **`SaveToAssetLibrary`** — INSERT в `Asset` table с `workspaceId` / `createdById`, tag с `workflowId/nodeId/runId`.

### Что уже имеем vs что дописать

| Компонент | Статус | Что надо |
|-----------|--------|----------|
| `AIWorkflow` Prisma-модель | ✅ есть (`steps: Json`) | Мигрировать `steps` → `graph: { nodes, edges, version }` |
| Workflow CRUD tRPC | ✅ есть (`workflowRouter`) | Добавить `execute`, `subscribe` (progress events) |
| AI-провайдеры | ✅ есть (`generateWithFallback`) | Wrap в node-executor контракт |
| Asset upload (presign) | ✅ есть | — |
| SSRF guard | ✅ есть | Проверять URL на image-input нодах |
| Image transform (sharp) | ❌ нет | Добавить `sharp` зависимость для `AddReflection`, `Resize`, `Crop` |
| Graph execution engine | ❌ нет | Написать: topsort + input-hash cache + progress events |
| Graph editor UI | ❌ нет | `@xyflow/react` — типизированные ports, node rendering, DnD |
| Preview on node | ❌ нет | S3 presigned-URL с short TTL + thumbnail cache |
| Template library UI | ❌ нет | Расширение `workflowRouter.list` + UI для fork |

---

## Mapping существующих actions → новый node-каталог

Для backward-compat и минимизации блокирующего миграционного риска.

| Existing action (в `actionRegistry.ts`) | v1 Node | Примечание |
|-----------------------------------------|---------|-----------|
| `generate_headline` | `GenerateText` (mode=headline) | Объединяем 2 actions в 1 ноду с `mode` param |
| `generate_subtitle` | `GenerateText` (mode=subtitle) | ^^ |
| `generate_image` | `GenerateImage` | 1-в-1 |
| `place_on_canvas` | `PlaceOnCanvas` (output) | 1-в-1 |
| `search_templates` | Не нода — UI-команда | Template search не граф-узел |
| `apply_and_fill_template` | `ApplyTemplate` (composite-ish) | Specialized, остаётся как есть |
| `create_project` | Не нода — out-of-band | Граф не может создавать проекты |
| `search_style_presets` | Не нода — UI-команда | Style-preset picker live в `PromptText` параметре |

**Вывод**: 4 из 8 actions становятся нодами, 4 — остаются UI/agent-инструментами. Миграционный риск низкий — actions в `actionRegistry.ts` продолжают работать для legacy (агент через `interpretAndExecute`).

---

## Open Questions

1. **Graph editor library: `@xyflow/react` vs custom Konva-based?** `@xyflow/react` (ex-react-flow) — индустриальный стандарт для node-editors (Retool, LangGraph, n8n). Наш Konva уже тяжёлый; добавить ещё одну canvas-библиотеку — приемлемо (разные страницы). Custom на Konva — лишние 2 месяца. **Рекомендация: `@xyflow/react`**. Уточнить у тима.

2. **Миграция `AIWorkflow.steps: Json` → `graph`.** Варианты:
   - a) Новая колонка `graph: Json`, `steps` остаётся для legacy-linear flows. Два кода-пути.
   - b) Одна колонка `steps: Json` с дискриминантом `{ version: "1-linear" | "2-graph", ... }`. Всё в одном JSON.
   - **Рекомендация: (b)** — проще DB-миграции, ключевой код-путь один. Прочитать дискриминант → роутить на legacy-runner или graph-runner.

3. **Выполнение на сервере vs клиенте.** ComfyUI — server-heavy (модели нельзя в браузере). Наши нодe:
   - AI-ноды — **server** (уже так, через `/api/ai/generate`).
   - Deterministic transforms (flip, mask, blur) — можно client-side через `sharp`-in-browser (wasm) или через Canvas2D. **Client-side предпочтительнее для latency**, но есть лимит браузерной памяти.
   - **Рекомендация**: v1 — всё server-side (проще, консистентно), client-side оптимизация в v1.5+.

4. **Progress events transport.** tRPC subscriptions (через WebSocket) vs SSE vs поллинг. Наша инфра:
   - tRPC v11 поддерживает subscriptions, но требует persistent WS (Yandex Serverless Container не любит long-lived connections).
   - SSE через отдельный REST-endpoint — проще для serverless.
   - **Рекомендация**: SSE на `/api/workflow/:runId/events` + fallback на polling `/api/workflow/:runId/status`.

5. **Кэш артефактов: TTL и eviction.**
   - S3-хранить per-node outputs по `node-cache-key` (`sha256(nodeType + params + upstream_hashes)`).
   - TTL? 7 дней подходит для iterative edit-цикла. Workspace-level storage quota — через existing S3-cleanup (`src/server/utils/s3-cleanup.ts`).
   - **Открытый вопрос**: нужно ли per-user quota на node-cache (возможен абьюз через hash-bombing)?

6. **«Dirty propagation» модель.** Когда пользователь меняет параметр ноды:
   - (a) Только эта нода dirty, downstream получает новый hash и перезапускает только их.
   - (b) Сама нода и downstream — сразу dirty (visual hint).
   - ComfyUI делает (a), но visualizes (b) через hash-comparison перед run. **Рекомендация: (a) + визуальный hint dirty при hash-miss**.

7. **Workflow-templates: наследование vs копия.**
   - Figma Community — чистый fork (duplicate-as-new).
   - «Subscribed template» с обновлениями от автора — привлекательно для brand-сценариев (обновил мастер → обновились все мои копии), но это entanglement + versioning-сложность.
   - **Рекомендация v1**: только fork (duplicate). Subscribed-templates — v2+.

8. **«Pure function» vs side-effecting ноды.** `SaveToAssetLibrary` пишет в DB при каждом run — это side-effect. Что если пользователь запустил случайно 10 раз? Library забита дубликатами.
   - **Рекомендация**: `SaveToAssetLibrary` идемпотентна по `(workflowId, nodeId, runId)` — второй run с тем же input-hash НЕ создаёт новый Asset, а возвращает существующий.

9. **Как обрабатывать failed AI-провайдера (e.g. Yandex GPT timeout)?** У нас `generateWithFallback`. Но на уровне ноды:
   - Retry с backoff (2 попытки, exponential)?
   - Fallback на другую модель (если пользователь не закрепил конкретную)?
   - **Рекомендация**: retry внутри executor, fallback только если пользователь выбрал «Auto» модель, иначе — error на ноде с кнопкой Retry.

10. **«Run on upload» / автосабмит**: когда пользователь только добавил `ImageInput` и ещё не нажал Run — выполнять ли автоматически? Comfy — нет (явный Queue). Flora — да (на каждом change пересчитывает). **Рекомендация v1: manual Run** (предсказуемо по кредитам). «Auto-run» — toggle в settings в v1.5+.

---

## Quality-gates verification

- ✅ **Категории нод чёткие**: Input / Transform / AI / Composite / Output — по 5 категорий с явным execution-контрактом каждой.
- ✅ **Для каждой фичи есть table-stake / differentiator / anti-feature**: см. секции по каждой категории выше + финальные секции «UX Table stakes», «Differentiators», «Anti-features».
- ✅ **Ссылки на продукты-источники**: ComfyUI docs (execution, nodes, subgraphs, images-and-masks), FLORA docs + reviews, Figma Blog (2025-10-30 acquisition + 2026-04-09 relaunch), Photoroom feature pages, arxiv DEROBA + SynMirror papers, Photoshop reflection tutorials (Pixelz, Retouching Labs, Creatively Squared, LinkedIn).
- ✅ **Product-reflection flow с минимумом нод**: 4 ноды (input + BackgroundRemove + AddReflection + SaveToAssetLibrary), 5 с PlaceOnCanvas.
- ✅ **Связь с существующим кодом**: цитированы `AIWorkflow` Prisma-модель (`schema.prisma:410-426`), `workflowRouter`, `actionRegistry.ts:77-159` (8 actions → маппинг на новые ноды), `ai-providers.ts`, `ssrfGuard.ts`, `visionAnalyzer.ts`, Asset Library infra.

---

*Research completed: 2026-04-24.*
