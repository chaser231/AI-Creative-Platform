/**
 * Seed Default Style Presets
 *
 * Creates 6 default image style presets in a workspace's AIPreset table.
 * Usage: npx ts-node prisma/seed-presets.ts <workspaceId>
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_PRESETS = [
  {
    name: "📸 Лайфстайл",
    description: "Реалистичная фотография в современном интерьере с тёплым естественным освещением",
    type: "image",
    config: {
      promptSuffix: "realistic lifestyle photography, modern interior setting, natural warm lighting, depth of field, 4K resolution",
      negativePrompt: "cartoon, illustration, flat, low quality, blurry",
      defaultModel: "nano-banana",
    },
  },
  {
    name: "🏢 Студийная съёмка",
    description: "Профессиональная студийная съёмка на чистом фоне с мягким светом",
    type: "image",
    config: {
      promptSuffix: "professional studio photography, clean white/gray background, product hero shot, soft studio lighting, commercial quality",
      negativePrompt: "messy background, outdoor, illustration",
      defaultModel: "nano-banana",
    },
  },
  {
    name: "🎯 Минимализм",
    description: "Минималистичная композиция с простым геометрическим фоном и приглушёнными тонами",
    type: "image",
    config: {
      promptSuffix: "minimalist composition, simple geometric backdrop, muted pastel tones, clean negative space, elegant simplicity",
      negativePrompt: "cluttered, busy background, heavy textures",
      defaultModel: "nano-banana",
    },
  },
  {
    name: "🎭 3D Рендер",
    description: "3D-сцена с мягкими тенями и изометрической перспективой",
    type: "image",
    config: {
      promptSuffix: "3D rendered scene, soft ambient occlusion, isometric perspective, clean shadows, modern 3D design",
      negativePrompt: "flat, 2D, hand-drawn, sketch",
      defaultModel: "nano-banana",
    },
  },
  {
    name: "🌈 Градиент",
    description: "Абстрактный градиентный фон с яркими современными цветами",
    type: "image",
    config: {
      promptSuffix: "abstract gradient background, vibrant modern colors, soft color transitions, premium feel",
      negativePrompt: "photo, realistic, objects, people",
      defaultModel: "flux-schnell",
    },
  },
  {
    name: "✏️ Иллюстрация",
    description: "Современная цифровая иллюстрация с яркими плоскими цветами",
    type: "image",
    config: {
      promptSuffix: "modern digital illustration, bold flat colors, clean vector style, contemporary design",
      negativePrompt: "photo, realistic, 3D render",
      defaultModel: "flux-schnell",
    },
  },
];

async function main() {
  const workspaceId = process.argv[2];
  if (!workspaceId) {
    // If no workspace ID provided, seed all workspaces
    const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true } });
    console.log(`Seeding presets for ${workspaces.length} workspace(s)...`);
    for (const ws of workspaces) {
      await seedWorkspace(ws.id, ws.name);
    }
  } else {
    await seedWorkspace(workspaceId, workspaceId);
  }
  console.log("Done!");
}

async function seedWorkspace(workspaceId: string, name: string) {
  // Check if presets already exist
  const existing = await prisma.aIPreset.count({
    where: { workspaceId, type: "image" },
  });

  if (existing > 0) {
    console.log(`  [${name}] Already has ${existing} image presets, skipping.`);
    return;
  }

  for (const preset of DEFAULT_PRESETS) {
    await prisma.aIPreset.create({
      data: {
        ...preset,
        workspaceId,
      },
    });
  }
  console.log(`  [${name}] Created ${DEFAULT_PRESETS.length} image style presets.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
