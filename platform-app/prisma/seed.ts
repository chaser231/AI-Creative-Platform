/**
 * Database Seed Script
 *
 * Creates initial data:
 * - Default workspace (Yandex Market)
 * - System prompts for each BU
 * - Default AI presets
 *
 * Run: npx prisma db seed
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...\n");

  // ─── Default Workspace: Yandex Market ────────────────────

  const workspace = await prisma.workspace.upsert({
    where: { slug: "yandex-market" },
    update: { name: "Яндекс Маркет" },
    create: {
      name: "Яндекс Маркет",
      slug: "yandex-market",
      businessUnit: "yandex-market",
      colors: [
        { id: "c1", name: "Primary", hex: "#111827", usage: "Headlines, CTAs" },
        { id: "c2", name: "Accent", hex: "#6366F1", usage: "Links, highlights" },
        { id: "c3", name: "Background", hex: "#FFFFFF", usage: "Backgrounds" },
        { id: "c4", name: "Surface", hex: "#F9FAFB", usage: "Cards, panels" },
        { id: "c5", name: "Muted", hex: "#6B7280", usage: "Secondary text" },
        { id: "c6", name: "Success", hex: "#22C55E", usage: "Positive states" },
        { id: "c7", name: "Warning", hex: "#F59E0B", usage: "Alerts" },
        { id: "c8", name: "Error", hex: "#EF4444", usage: "Errors, destructive" },
      ],
      fonts: [
        { id: "f1", name: "Inter", weights: ["400", "500", "600", "700"], usage: "All text" },
      ],
      toneOfVoice:
        "Ты профессиональный копирайтер Яндекс Маркета. " +
        "Пиши кратко, динамично и продающе. " +
        "Используй призыв к покупке. " +
        "Тон: дружелюбный и выгодный.",
    },
  });

  console.log(`✅ Workspace: ${workspace.name} (${workspace.slug})`);

  // ─── Additional Workspaces ───────────────────────────────

  const wsFood = await prisma.workspace.upsert({
    where: { slug: "yandex-food" },
    update: { name: "Яндекс Еда" },
    create: {
      name: "Яндекс Еда",
      slug: "yandex-food",
      businessUnit: "yandex-food",
      colors: [
        { id: "c1", name: "Primary", hex: "#111827", usage: "Headlines" },
        { id: "c2", name: "Accent", hex: "#FF5722", usage: "CTA, highlights" },
        { id: "c3", name: "Background", hex: "#FFFDE7", usage: "Warm backgrounds" },
      ],
      fonts: [
        { id: "f1", name: "Inter", weights: ["400", "500", "600", "700"], usage: "All text" },
      ],
      toneOfVoice:
        "Ты копирайтер Яндекс Еды. " +
        "Твои тексты вызывают аппетит и желание заказать прямо сейчас. " +
        "Пиши вкусно, с заботой, но очень емко.",
    },
  });

  console.log(`✅ Workspace: ${wsFood.name} (${wsFood.slug})`);

  const wsGo = await prisma.workspace.upsert({
    where: { slug: "yandex-go" },
    update: { name: "Яндекс Go" },
    create: {
      name: "Яндекс Go",
      slug: "yandex-go",
      businessUnit: "yandex-go",
      colors: [
        { id: "c1", name: "Primary", hex: "#111827", usage: "Headlines" },
        { id: "c2", name: "Accent", hex: "#FFD600", usage: "CTA, highlights" },
        { id: "c3", name: "Background", hex: "#FFFFFF", usage: "Backgrounds" },
      ],
      fonts: [
        { id: "f1", name: "Inter", weights: ["400", "500", "600", "700"], usage: "All text" },
      ],
      toneOfVoice:
        "Ты копирайтер Яндекс Такси / Go. " +
        "Пиши про удобство и скорость. " +
        "Тон: уверенный и динамичный.",
    },
  });

  console.log(`✅ Workspace: ${wsGo.name} (${wsGo.slug})`);

  // ─── Yandex Lavka ──────────────────────────────────────

  const wsLavka = await prisma.workspace.upsert({
    where: { slug: "yandex-lavka" },
    update: { name: "Яндекс Лавка" },
    create: {
      name: "Яндекс Лавка",
      slug: "yandex-lavka",
      businessUnit: "yandex-lavka",
      colors: [
        { id: "c1", name: "Primary", hex: "#111827", usage: "Headlines" },
        { id: "c2", name: "Accent", hex: "#00C853", usage: "CTA, highlights" },
        { id: "c3", name: "Background", hex: "#FFFFFF", usage: "Backgrounds" },
      ],
      fonts: [
        { id: "f1", name: "Inter", weights: ["400", "500", "600", "700"], usage: "All text" },
      ],
      toneOfVoice:
        "Ты копирайтер Яндекс Лавки. " +
        "Пиши про свежие продукты, быструю доставку и удобство. " +
        "Тон: заботливый и практичный.",
    },
  });

  console.log(`✅ Workspace: ${wsLavka.name} (${wsLavka.slug})`);

  // ─── System Prompts ──────────────────────────────────────

  const systemPrompts = [
    {
      workspaceId: workspace.id,
      name: "default-text",
      type: "text",
      content:
        "Ты профессиональный копирайтер Яндекс Маркета. Пиши кратко, динамично и продающе. Используй призыв к покупке. Тон: дружелюбный и выгодный.",
    },
    {
      workspaceId: workspace.id,
      name: "default-image",
      type: "image",
      content:
        "Продуктовая фотография студийного качества, яркий сплошной фон (желтый или контрастный), товар по центру, реалистично, высокое разрешение, 4k, студийный свет.",
    },
    {
      workspaceId: wsFood.id,
      name: "default-text",
      type: "text",
      content:
        "Ты копирайтер Яндекс Еды / Лавки. Твои тексты вызывают аппетит и желание заказать прямо сейчас. Пиши вкусно, с заботой, но очень емко.",
    },
    {
      workspaceId: wsFood.id,
      name: "default-image",
      type: "image",
      content:
        "Вкусная еда крупным планом, теплый свет, аппетитно, профессиональная фуд-фотография, боке, глубина резкости, 8k, photorealistic.",
    },
  ];

  for (const sp of systemPrompts) {
    await prisma.systemPrompt.upsert({
      where: {
        workspaceId_name_type: {
          workspaceId: sp.workspaceId,
          name: sp.name,
          type: sp.type,
        },
      },
      update: { content: sp.content },
      create: sp,
    });
  }

  console.log(`✅ System prompts: ${systemPrompts.length} created`);

  // ─── Default AI Presets ──────────────────────────────────

  const presets = [
    {
      workspaceId: workspace.id,
      name: "Продающий текст",
      description: "Продающий рекламный текст с призывом к действию",
      type: "text",
      config: { style: "selling", model: "deepseek" },
    },
    {
      workspaceId: workspace.id,
      name: "Информационный текст",
      description: "Нейтральный информативный текст",
      type: "text",
      config: { style: "informational", model: "deepseek" },
    },
    {
      workspaceId: workspace.id,
      name: "Фото продукта",
      description: "Студийная фотография товара",
      type: "image",
      config: { model: "nano-banana-2", style: "product-photo" },
    },
  ];

  for (const preset of presets) {
    const existing = await prisma.aIPreset.findFirst({
      where: { workspaceId: preset.workspaceId, name: preset.name, type: preset.type },
    });
    if (!existing) {
      await prisma.aIPreset.create({ data: preset });
    }
  }

  console.log(`✅ AI presets: ${presets.length} created`);

  console.log("\n🎉 Seed complete!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Seed failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
