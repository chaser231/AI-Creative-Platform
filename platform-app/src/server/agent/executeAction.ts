import type { ActionResult, ActionContext, CanvasInstruction } from "../actionRegistry";
import { callLLM } from "./llmProviders";
import { resolveRefTags } from "@/lib/ai-models";
import { SYSTEM_IMAGE_PRESETS } from "@/lib/stylePresets";

// ─── Logging helpers ─────────────────────────────────────

/**
 * Prompts can contain embedded base64 image blobs (especially when VLM output
 * or a user paste leaks through ref-tag resolution). Raw data URIs blow up
 * structured logs and risk persisting PII. Replace them with a short marker.
 */
function redactForLog(value: string, maxLen = 2000): string {
  if (!value) return value;
  const stripped = value.replace(
    /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{32,}/gi,
    "[base64-redacted]",
  );
  if (stripped.length <= maxLen) return stripped;
  return `${stripped.slice(0, maxLen)}…[+${stripped.length - maxLen} chars]`;
}

// ─── Action Executors ────────────────────────────────────

export async function executeAction(
  actionId: string,
  params: Record<string, unknown>,
  context: ActionContext
): Promise<ActionResult> {
  switch (actionId) {
    case "generate_headline": {
      const topic = params.topic as string;
      const tone = (params.tone as string) || "bold";

      const toneMap: Record<string, string> = {
        bold: "Коротко и мощно. Энергичный, призывный стиль.",
        playful: "Игривый, лёгкий тон. С юмором или каламбуром.",
        formal: "Деловой, солидный стиль.",
        urgent: "Срочность и дефицит. FOMO.",
      };

      const response = await callLLM([
        {
          role: "system",
          content: `Ты — копирайтер для рекламных баннеров. ${toneMap[tone] || toneMap.bold}

ПРАВИЛА:
- Придумай ОДИН заголовок
- Максимум 3-7 слов
- Без кавычек, без точки
- Только текст заголовка, ничего больше
- Пиши на русском`,
        },
        { role: "user", content: `Заголовок для: ${topic}` },
      ]);

      const headline = response.trim().replace(/^["«]|["»]$/g, "").replace(/\.$/, "");

      return {
        success: true,
        type: "text",
        content: headline,
        metadata: { role: "headline", tone },
      };
    }

    case "generate_subtitle": {
      const topic = params.topic as string;
      const headline = (params.headline as string) || "";

      const response = await callLLM([
        {
          role: "system",
          content: `Ты — копирайтер. Напиши подзаголовок для баннера.

ПРАВИЛА:
- Одно предложение, 10-20 слов
- Дополняет заголовок деталями или призывом к действию
- Без кавычек
- Только текст подзаголовка, ничего больше
- Пиши на русском`,
        },
        {
          role: "user",
          content: headline
            ? `Заголовок: "${headline}". Тема: ${topic}. Напиши подзаголовок.`
            : `Подзаголовок для: ${topic}`,
        },
      ]);

      const subtitle = response.trim().replace(/^["«]|["»]$/g, "");

      return {
        success: true,
        type: "text",
        content: subtitle,
        metadata: { role: "subtitle" },
      };
    }

    case "generate_image": {
      const subject = params.subject as string;
      const style = (params.style as string) || "photo";

      // Build an English prompt for the image model
      const hasReferenceDescriptions = subject.includes('ТОЧНЫЕ ОПИСАНИЯ ТОВАРОВ');
      const referenceImages = (params.referenceImages as string[] | undefined);
      const hasActualRefs = referenceImages && referenceImages.length > 0;

      let imagePrompt: string;

      if (hasActualRefs && hasReferenceDescriptions) {
        // Reference-based generation: use Google's recommended pattern
        // [Reference Images] + [Relationship Instruction] + [New Scenario]
        imagePrompt = await callLLM([
          {
            role: "system",
            content: `You write prompts for AI image generation that uses attached reference product photos.

CRITICAL RULES:
- Write in ENGLISH only
- The user has attached ${referenceImages.length} reference product photos
- The model CAN SEE the attached photos — you must tell it to USE them
- Start the prompt with: "Using the attached reference images as the exact products to include:"
- Then describe the COMPOSITION/SCENE: how to arrange these exact products together
- Do NOT describe individual products in detail (the model sees the photos)
- Focus on: arrangement, lighting, background, angles, mood
- Style: premium commercial ${style} photography, magazine-quality product hero shot
- Background: soft gradient (light gray to white) or elegant surface
- Lighting: professional studio lighting with soft shadows and subtle reflections
- ALWAYS end with: "no text, no letters, no words, no logos, no watermarks"
- Keep it under 80 words
- Return ONLY the prompt text, no quotes, no "Here is the prompt:" prefix`,
          },
          {
            role: "user",
            content: `Create a composition prompt for ${referenceImages.length} attached product photos. ${subject}`,
          },
        ]);
      } else {
        // Standard generation without reference photos
        imagePrompt = await callLLM([
          {
            role: "system",
            content: `You are an expert prompt engineer for AI image generation.
Convert the user's request into a detailed English prompt for image generation.

RULES:
- Write in ENGLISH only
- Include style keywords: ${style}, high quality, commercial
- For photo style: "professional product photography, studio lighting, clean white background"
- For illustration: "modern digital illustration, flat design"
- For 3d: "3D render, isometric, soft shadows"
- For gradient: "abstract gradient background, vibrant colors"
- ALWAYS include: "no text, no letters, no words, no logos, no watermarks"
- Keep it under 50 words
- Return ONLY the prompt text, no quotes, no "Here is the prompt:" prefix`,
          },
          { role: "user", content: `Generate prompt for: ${subject}, style: ${style}` },
        ]);
      }

      // Clean up common LLM wrapper artifacts
      let cleanPrompt = imagePrompt.trim();
      cleanPrompt = cleanPrompt.replace(/^["']|["']$/g, ''); // strip surrounding quotes
      cleanPrompt = cleanPrompt.replace(/^(Here is the prompt:?\s*)/i, ''); // strip wrapper
      cleanPrompt = cleanPrompt.replace(/^["']|["']$/g, ''); // strip quotes again after wrapper removal
      cleanPrompt = cleanPrompt.trim();

      // Call AI provider (use specified model or default to flux-schnell)
      const selectedModel = (params.model as string) || "flux-schnell";
      const { generateWithFallback } = await import("@/lib/ai-providers");

      console.log(`[Pipeline ▶5 executeAction] generate_image — model: ${selectedModel}, hasRefImages: ${hasActualRefs ? referenceImages.length : 0}`);
      console.log(`[Pipeline ▶5 executeAction] FULL PROMPT: "${redactForLog(cleanPrompt)}"`);

      try {
        const aiResult = await generateWithFallback({
          prompt: resolveRefTags(cleanPrompt, selectedModel),
          type: "image",
          model: selectedModel,
          referenceImages: hasActualRefs ? referenceImages : undefined,
        });

        return {
          success: true,
          type: "image",
          content: aiResult.content,
          metadata: { model: selectedModel, style, prompt: imagePrompt.trim() },
        };
      } catch (e) {
        return {
          success: false,
          type: "error",
          content: `Ошибка генерации: ${e instanceof Error ? e.message : "unknown"}`,
        };
      }
    }

    case "place_on_canvas": {
      const elementsStr = params.elements as string;
      let elements: Array<{ type: string; content: string; role: string }> = [];

      try {
        elements = JSON.parse(elementsStr);
      } catch {
        return { success: false, type: "error", content: "Невалидный JSON в параметре elements" };
      }

      const canvasActions: CanvasInstruction[] = [];
      for (const el of elements) {
        if (el.type === "text" && el.role === "headline") {
          canvasActions.push({
            action: "add_text",
            params: {
              text: el.content,
              fontSize: 64,
              fontWeight: "700",
              fill: "#FFFFFF",
              align: "center",
              x: 100,
              y: 200,
              width: 800,
              textTransform: "uppercase",
            },
          });
        } else if (el.type === "text" && el.role === "subtitle") {
          canvasActions.push({
            action: "add_text",
            params: {
              text: el.content,
              fontSize: 28,
              fontWeight: "400",
              fill: "#FFFFFF",
              align: "center",
              x: 150,
              y: 300,
              width: 700,
            },
          });
        } else if (el.type === "image") {
          canvasActions.push({
            action: "add_image",
            params: {
              src: el.content,
              width: 1024,
              height: 1024,
            },
          });
        }
      }

      return {
        success: true,
        type: "canvas_action",
        content: `Размещено ${canvasActions.length} элементов на холсте`,
        canvasActions,
      };
    }

    case "create_project": {
      const name = (params.name as string) || "Новый проект";
      const goal = (params.goal as string) || "banner";

      const project = await context.prisma.project.create({
        data: {
          name,
          goal,
          workspaceId: context.workspaceId,
          createdById: context.userId,
        },
      });

      return {
        success: true,
        type: "data",
        content: `Проект «${name}» создан`,
        metadata: { projectId: project.id },
      };
    }

    case "search_templates": {
      const service = (params.service as string).toLowerCase();

      // Map user-friendly names to DB search terms
      const serviceMap: Record<string, string[]> = {
        "market": ["yandex-market", "маркет", "market"],
        "маркет": ["yandex-market", "маркет", "market"],
        "food": ["yandex-food", "еда", "food"],
        "еда": ["yandex-food", "еда", "food"],
        "go": ["yandex-go", "go", "такси"],
        "lavka": ["yandex-lavka", "лавка", "lavka"],
        "лавка": ["yandex-lavka", "лавка", "lavka"],
      };

      const searchTerms = serviceMap[service] || [service];

      // Search by name, categories, or tags — include official templates from other workspaces
      // Build name search conditions for ALL service name variants
      const nameSearchConditions = searchTerms.map(term => ({
        name: { contains: term, mode: "insensitive" as const },
      }));

      const templates = await context.prisma.template.findMany({
        where: {
          AND: [
            // Visibility: own workspace + official (cross-workspace)
            { OR: [{ workspaceId: context.workspaceId }, { isOfficial: true }] },
            // Content filter: match ANY variant in name/description OR categories
            { OR: [
              ...nameSearchConditions,
              { description: { contains: service, mode: "insensitive" } },
              { categories: { hasSome: searchTerms } },
            ]},
          ],
        },
        select: {
          id: true,
          name: true,
          description: true,
          thumbnailUrl: true,
        },
        distinct: ["name"],
        orderBy: [{ isOfficial: "desc" }, { updatedAt: "desc" }],
        take: 8,
      });

      if (templates.length === 0) {
        return {
          success: true,
          type: "fallback_actions",
          content: `Шаблоны для «${service}» не найдены в библиотеке. Что хотите сделать?`,
          fallbackActions: [
            { id: "create_from_scratch", label: "Создать баннер с нуля", icon: "plus" },
            { id: "refine_query", label: "Уточнить запрос", icon: "search" },
          ],
        };
      }

      return {
        success: true,
        type: "template_choices",
        content: `Найдено ${templates.length} шаблонов. Выберите один:`,
        templateChoices: templates.map((t: { id: string; name: string; description: string | null; thumbnailUrl: string | null }) => ({
          id: t.id,
          name: t.name,
          description: t.description || "",
          thumbnailUrl: t.thumbnailUrl ?? undefined,
        })),
      };
    }

    case "apply_and_fill_template": {
      const templateId = params.templateId as string;
      const topic = params.topic as string;
      const imageModel = (params.imageModel as string) || "flux-schnell";
      const templateRefImages = params.referenceImages as string[] | undefined;
      const templateVisionCtx = params.visionContext as string | undefined;
      const templateStyleSuffix = params.stylePromptSuffix as string | undefined;
      const preGeneratedImageUrl = params.lastGeneratedImageUrl as string | undefined;
      const hasTemplateRefs = templateRefImages && templateRefImages.length > 0;

      console.log(`[Template Fill] lastGeneratedImageUrl: ${preGeneratedImageUrl ? preGeneratedImageUrl.slice(0, 60) + '...' : 'NONE'}`);
      console.log(`[Template Fill] referenceImages: ${hasTemplateRefs ? templateRefImages.length : 0}`);

      // Fetch the full template
      const template = await context.prisma.template.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        return { success: false, type: "error", content: "Шаблон не найден" };
      }

      const templateData = (template.data as Record<string, unknown>)?.data || template.data;

      // Scan template layers to find slots
      const slots: Array<{ id: string; type: string; slotId: string }> = [];

      interface TemplateNode {
        layer?: { id?: string; type?: string; slotId?: string };
        id?: string;
        type?: string;
        slotId?: string;
        children?: TemplateNode[];
      }

      function scanLayers(layers: TemplateNode[]) {
        for (const node of layers) {
          const layer = node.layer || node;
          if (layer.slotId && layer.slotId !== "none") {
            slots.push({
              id: layer.id || "",
              type: layer.type || "",
              slotId: layer.slotId,
            });
          }
          if (node.children) scanLayers(node.children);
        }
      }

      // Scan all three possible data formats: layerTree, masterComponents, and raw layers[]
      const td = templateData as Record<string, unknown>;
      if (td.layerTree) scanLayers(td.layerTree as TemplateNode[]);
      if (td.masterComponents) {
        for (const mc of td.masterComponents as any[]) {
          // Check both MC-level slotId and nested props.slotId
          const mcSlotId = mc.slotId || mc.props?.slotId;
          if (mcSlotId && mcSlotId !== "none") {
            slots.push({ id: mc.id || "", type: mc.type || "", slotId: mcSlotId });
          }
        }
      }
      // Raw canvas state format — layers[] at top level (new template editor format)
      if (td.layers && Array.isArray(td.layers)) {
        scanLayers(td.layers as TemplateNode[]);
      }

      const canvasActions: CanvasInstruction[] = [];

      // First: load the template
      canvasActions.push({
        action: "load_template",
        params: { templateData: template.data },
      });

      // ─── Detect if this is a Market BU template ───────
      const templateCategories = (template.categories as string[]) || [];
      const templateTags = (template.tags as unknown) || [];
      const allTags = [...templateCategories, ...(Array.isArray(templateTags) ? templateTags : [])].map(t => String(t).toLowerCase());
      const isMarketTemplate = allTags.some(t =>
        ["yandex-market", "маркет", "market"].includes(t)
      );

      // Check if template has both headline AND subhead slots
      const hasHeadline = slots.some(s => s.slotId === "headline" && s.type === "text");
      const hasSubhead = slots.some(s => s.slotId === "subhead" && s.type === "text");
      const hasPairedTextSlots = hasHeadline && hasSubhead;

      // ─── Clean topic: extract actual product/promo theme ───────
      // The raw `topic` is often the user's meta-request like "Сгенерируй баннеры для Маркета",
      // which leaks into generated headlines. We need to extract the ACTUAL theme.
      let cleanTopic = topic;
      if (templateVisionCtx) {
        // VLM described the products — use that as the copywriting brief
        cleanTopic = `Товары: ${templateVisionCtx}`;
        console.log(`[Template Fill] Using VLM context for text generation (${cleanTopic.slice(0, 80)}...)`);
      } else {
        // Strip meta-request patterns, leaving just the subject
        cleanTopic = await callLLM([
          { role: "system", content: `Ты извлекаешь тему из запроса пользователя.
Пользователь попросил создать баннер. Из его запроса извлеки ТОЛЬКО предмет/тему рекламы.
Убери все мета-инструкции (сгенерируй, сделай, создай, баннер, шаблон, маркет, лавка).
Если тема не ясна — придумай подходящую для ${isMarketTemplate ? "Яндекс Маркета" : "рекламного баннера"}.
Ответь 3-5 словами. Только тема, ничего больше.` },
          { role: "user", content: topic },
        ]);
        cleanTopic = cleanTopic.trim();
        console.log(`[Template Fill] Cleaned topic: "${topic}" → "${cleanTopic}"`);
      }

      // ─── Market paired title+subtitle generation ───────
      if (isMarketTemplate && hasPairedTextSlots) {
        // Use specialized Market copywriting prompt (versioned in prompts/market-title-subtitle-v1.md)
        const MARKET_SYSTEM_PROMPT = `Ты — бренд-копирайтер Яндекс Маркета. Пиши разговорно, коротко и честно.

ЗАДАЧА
Из одной входной «идеи» сгенерировать РОВНО 3 разные пары «title + subtitle».

ЖЁСТКИЕ ОГРАНИЧЕНИЯ (следи неукоснительно)
• TITLE: 8–30 символов, максимум 2 строки, без точки в конце, без кавычек, без «!». Допускается длинное тире «—».
• SUBTITLE: 18–60 символов, максимум 2 строки; без эмодзи; спокойная пунктуация.
• Считать ВСЕ видимые символы (включая пробелы). Если выходит за лимиты — переформулируй до соответствия.
• Числа — арабские; скидки только в форматах «до N%» или «−N%».
• Бренды пиши корректно (род/число не придумывай).
• Title всегда пиши с CAPS-LOCK, без эмодзи, без многоточий.
• Subtitle без CAPS-LOCK, без эмодзи, без многоточий злоупотребления.

ЕДИНЫЙ TOV (как мы звучим)
• Пиши короче, яснее, ближе к речи.
• Спокойный, утилитарный тон. Опирайся на факты.
• Пиши без двусмысленности и манипуляций (никакого FOMO/«успей, иначе…»).
• НИКАКОГО драматизма, лозунгов и давления на «боли» (не пиши «надоело?», «пора менять», «больше никакой...»).

ЧТО ДЕЛАТЬ В КАЖДОЙ ПАРЕ
• TITLE — суть оффера и рациональная выгода (прямое указание на скидки, низкие цены, большой выбор). Утвердительно и просто.
• SUBTITLE — добавляет конкретику (контекст/условие/бренды). КОРОЧЕ и ПРОЩЕ, чем title. Фокус на выгоде.

ФОРМАТ ОТВЕТА — строго JSON-массив, ничего кроме него:
[
  {"title": "...", "subtitle": "..."},
  {"title": "...", "subtitle": "..."},
  {"title": "...", "subtitle": "..."}
]`;

        const pairsResponse = await callLLM([
          { role: "system", content: MARKET_SYSTEM_PROMPT },
          { role: "user", content: cleanTopic },
        ]);

        // Parse JSON pairs from the response
        let pairs: Array<{ title: string; subtitle: string }> = [];
        try {
          const jsonMatch = pairsResponse.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            pairs = JSON.parse(jsonMatch[0]);
          }
        } catch {
          // Fallback: use the raw response as single pair
        }

        if (pairs.length > 0) {
          // Use the FIRST pair for immediate application
          const chosenPair = pairs[0];
          canvasActions.push({
            action: "update_layer",
            params: { slotId: "headline", updates: { text: chosenPair.title } },
          });
          canvasActions.push({
            action: "update_layer",
            params: { slotId: "subhead", updates: { text: chosenPair.subtitle } },
          });
        }

        // Still generate other slots (CTA, images) generically
        for (const slot of slots) {
          if (slot.slotId === "headline" || slot.slotId === "subhead") continue; // already handled

          if (slot.slotId === "cta" && slot.type === "text") {
            const cta = await callLLM([
              { role: "system", content: "Ты — копирайтер. Напиши текст для кнопки призыва к действию (CTA). 1-3 слова. Без кавычек. Только текст." },
              { role: "user", content: `CTA для: ${cleanTopic}` },
            ]);
            canvasActions.push({
              action: "update_layer",
              params: { slotId: "cta", updates: { text: cta.trim().replace(/^["«]|["»]$/g, "").replace(/\.$/, "") } },
            });
          } else if ((slot.slotId === "background" || slot.slotId === "image-primary") && slot.type === "image") {
            // Priority 1: Use pre-generated image from an earlier pipeline step
            if (preGeneratedImageUrl) {
              console.log(`[Template Fill] Using pre-generated image for slot "${slot.slotId}"`);
              canvasActions.push({
                action: "update_layer",
                params: { slotId: slot.slotId, updates: { src: preGeneratedImageUrl } },
              });
            } else {
              // Priority 2/3: Generate image (reference-aware or basic)
              let imgPrompt: string;
              if (hasTemplateRefs && templateVisionCtx) {
                imgPrompt = await callLLM([
                  { role: "system", content: `You write prompts for AI image generation that uses attached reference product photos.
CRITICAL RULES:
- Write in ENGLISH only
- The user has attached ${templateRefImages!.length} reference product photos
- The model CAN SEE the attached photos — tell it to USE them
- Start with: "Using the attached reference images as the exact products:"
- Describe COMPOSITION/SCENE: arrangement, lighting, background, angles
- Do NOT describe products in detail (the model sees the photos)
- Style: premium commercial photography, banner-quality hero shot
${templateStyleSuffix ? `- Additional style: ${templateStyleSuffix}` : ''}
- ALWAYS end with: "no text, no letters, no words, no logos, no watermarks"
- Keep under 80 words. Return ONLY the prompt text.` },
                  { role: "user", content: `Create a banner image prompt for a ${topic} banner. ${templateVisionCtx}` },
                ]);
              } else {
                imgPrompt = await callLLM([
                  { role: "system", content: `You are an expert prompt engineer. Convert the request into a detailed English prompt for AI image generation. Include: high quality, commercial, professional.${templateStyleSuffix ? ` Style: ${templateStyleSuffix}.` : ''} CRITICAL: always add 'no text, no letters, no words, no logos, no watermarks, no graphics, no UI elements' to the prompt. Max 40 words. Return ONLY the prompt.` },
                  { role: "user", content: `Image for banner about: ${topic}` },
                ]);
              }

              // Clean up LLM wrapper artifacts
              let cleanImgPrompt = imgPrompt.trim();
              cleanImgPrompt = cleanImgPrompt.replace(/^["']|["']$/g, '');
              cleanImgPrompt = cleanImgPrompt.replace(/^(Here is the prompt:?\s*)/i, '');
              cleanImgPrompt = cleanImgPrompt.trim();

              console.log(`[Template Fill] Image prompt for slot "${slot.slotId}": "${cleanImgPrompt.slice(0, 120)}..."`);
              console.log(`[Template Fill] hasRefImages: ${hasTemplateRefs ? templateRefImages!.length : 0}`);

              try {
                const { generateWithFallback } = await import("@/lib/ai-providers");
                const imgResult = await generateWithFallback({
                  prompt: cleanImgPrompt,
                  type: "image",
                  model: imageModel,
                  referenceImages: hasTemplateRefs ? templateRefImages : undefined,
                });
                canvasActions.push({
                  action: "update_layer",
                  params: { slotId: slot.slotId, updates: { src: imgResult.content } },
                });
              } catch {
                // skip failed image
              }
            }
          }
        }

        const filledSlots = canvasActions.length - 1;
        return {
          success: true,
          type: "canvas_action",
          content: pairs.length > 0
            ? `Шаблон «${template.name}» применён (Маркет). Сгенерировано ${pairs.length} вариантов текста, применён первый. Заполнено ${filledSlots} элементов.`
            : `Шаблон «${template.name}» применён. Заполнено ${filledSlots} элементов.`,
          canvasActions,
          metadata: {
            templateId,
            templateName: template.name,
            slotsFound: slots.length,
            isMarket: true,
            textVariants: pairs,
          },
        };
      }

      // ─── Generic slot filling (non-Market templates) ───────
      for (const slot of slots) {
        if (slot.slotId === "headline" && slot.type === "text") {
          const headline = await callLLM([
            { role: "system", content: "Ты — копирайтер. Напиши ОДИН заголовок для баннера. Максимум 5 слов. Без кавычек, без точки. Только текст." },
            { role: "user", content: `Заголовок для: ${cleanTopic}` },
          ]);
          canvasActions.push({
            action: "update_layer",
            params: { slotId: "headline", updates: { text: headline.trim().replace(/^["«]|["»]$/g, "").replace(/\.$/, "") } },
          });
        } else if (slot.slotId === "subhead" && slot.type === "text") {
          const subtitle = await callLLM([
            { role: "system", content: "Ты — копирайтер. Напиши подзаголовок для баннера. 8-15 слов. Без кавычек. Только текст." },
            { role: "user", content: `Подзаголовок для: ${cleanTopic}` },
          ]);
          canvasActions.push({
            action: "update_layer",
            params: { slotId: "subhead", updates: { text: subtitle.trim().replace(/^["«]|["»]$/g, "") } },
          });
        } else if (slot.slotId === "cta" && slot.type === "text") {
          const cta = await callLLM([
            { role: "system", content: "Ты — копирайтер. Напиши текст для кнопки призыва к действию (CTA). 1-3 слова. Без кавычек. Только текст." },
            { role: "user", content: `CTA для: ${cleanTopic}` },
          ]);
          canvasActions.push({
            action: "update_layer",
            params: { slotId: "cta", updates: { text: cta.trim().replace(/^["«]|["»]$/g, "") } },
          });
        } else if ((slot.slotId === "background" || slot.slotId === "image-primary") && (slot.type === "image")) {
          // Priority 1: Use pre-generated image from an earlier pipeline step
          if (preGeneratedImageUrl) {
            console.log(`[Template Fill Generic] Using pre-generated image for slot "${slot.slotId}"`);
            canvasActions.push({
              action: "update_layer",
              params: { slotId: slot.slotId, updates: { src: preGeneratedImageUrl } },
            });
          } else {
            // Priority 2/3: Generate image (reference-aware or basic)
            let imgPrompt: string;
            if (hasTemplateRefs && templateVisionCtx) {
              imgPrompt = await callLLM([
                { role: "system", content: `You write prompts for AI image generation that uses attached reference product photos.
CRITICAL RULES:
- Write in ENGLISH only
- The user has attached ${templateRefImages!.length} reference product photos
- The model CAN SEE the attached photos — tell it to USE them
- Start with: "Using the attached reference images as the exact products:"
- Describe COMPOSITION/SCENE: arrangement, lighting, background, angles
- Do NOT describe products in detail (the model sees the photos)
- Style: premium commercial photography, banner-quality hero shot
${templateStyleSuffix ? `- Additional style: ${templateStyleSuffix}` : ''}
- ALWAYS end with: "no text, no letters, no words, no logos, no watermarks"
- Keep under 80 words. Return ONLY the prompt text.` },
                { role: "user", content: `Create a banner image prompt for a ${topic} banner. ${templateVisionCtx}` },
              ]);
            } else {
              imgPrompt = await callLLM([
                { role: "system", content: `You are an expert prompt engineer. Convert the request into a detailed English prompt for AI image generation. Include: high quality, commercial, professional.${templateStyleSuffix ? ` Style: ${templateStyleSuffix}.` : ''} CRITICAL: always add 'no text, no letters, no words, no logos, no watermarks, no graphics, no UI elements' to the prompt. Max 40 words. Return ONLY the prompt.` },
                { role: "user", content: `Image for banner about: ${topic}` },
              ]);
            }

            // Clean up LLM wrapper artifacts
            let cleanImgPrompt = imgPrompt.trim();
            cleanImgPrompt = cleanImgPrompt.replace(/^["']|["']$/g, '');
            cleanImgPrompt = cleanImgPrompt.replace(/^(Here is the prompt:?\s*)/i, '');
            cleanImgPrompt = cleanImgPrompt.trim();

            console.log(`[Template Fill Generic] Image prompt for slot "${slot.slotId}": "${cleanImgPrompt.slice(0, 120)}..."`);
            console.log(`[Template Fill Generic] hasRefImages: ${hasTemplateRefs ? templateRefImages!.length : 0}`);

            try {
              const { generateWithFallback } = await import("@/lib/ai-providers");
              const imgResult = await generateWithFallback({
                prompt: cleanImgPrompt,
                type: "image",
                model: imageModel,
                referenceImages: hasTemplateRefs ? templateRefImages : undefined,
              });
              canvasActions.push({
                action: "update_layer",
                params: { slotId: slot.slotId, updates: { src: imgResult.content } },
              });
            } catch {
              // Image generation failed, skip this slot
            }
          }
        }
      }

      const filledSlots = canvasActions.length - 1; // minus load_template
      return {
        success: true,
        type: "canvas_action",
        content: slots.length > 0
          ? `Шаблон «${template.name}» применён. Заполнено ${filledSlots} элементов.`
          : `Шаблон «${template.name}» применён. Слоты не найдены — добавляю новые элементы.`,
        canvasActions,
        metadata: { templateId, templateName: template.name, slotsFound: slots.length },
      };
    }

    case "search_style_presets": {
      // Search for image style presets in the workspace's AIPreset table
      const presets = await context.prisma.aIPreset.findMany({
        where: {
          workspaceId: context.workspaceId,
          type: "image",
          isActive: true,
        },
        orderBy: { name: "asc" },
      });

      // Default presets if none exist in DB
      // Default presets from unified module (stylePresets.ts) — used when DB has none
      const defaultPresets = SYSTEM_IMAGE_PRESETS
        .filter(p => p.id !== "none")
        .map(p => ({
          id: `default-${p.id}`,
          name: p.label,
          description: p.description,
          promptSuffix: p.promptSuffix,
        }));

      interface PresetConfig {
        promptSuffix?: string;
        negativePrompt?: string;
        defaultModel?: string;
      }

      const choices = presets.length > 0
        ? presets.map((p: { id: string; name: string; description: string; config: unknown }) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            promptSuffix: (p.config as PresetConfig)?.promptSuffix || "",
          }))
        : defaultPresets;

      return {
        success: true,
        type: "preset_choices" as const,
        content: `Доступно ${choices.length} стилевых пресетов. Выберите стиль генерации:`,
        presetChoices: choices,
      };
    }

    default:
      return { success: false, type: "error", content: `Неизвестное действие: ${actionId}` };
  }
}
