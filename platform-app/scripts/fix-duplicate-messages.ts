import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Clean up duplicate AIMessage entries and fix legacy data.
 * 
 * Problem: useAISessionSync created a second AIMessage for every generation
 * with model = slug (e.g. "google/nano-banana-pro") and costUnits = 0.
 * The API route already created the primary entry with model = id and correct cost.
 * 
 * Fix: Remove model from duplicate entries so analytics won't count them.
 */
async function main() {
    // Find all assistant messages with slug-style models (containing "/")
    const slugMessages = await prisma.aIMessage.findMany({
        where: {
            role: "assistant",
            model: { contains: "/" },
        },
        select: { id: true, model: true, costUnits: true, createdAt: true, content: true },
        orderBy: { createdAt: "desc" },
    });

    console.log(`Found ${slugMessages.length} messages with slug-style model names`);

    for (const msg of slugMessages) {
        console.log(`  [${msg.createdAt.toISOString()}] model="${msg.model}" cost=$${(msg.costUnits ?? 0).toFixed(4)} → clearing model`);
    }

    if (slugMessages.length === 0) {
        console.log("No duplicates to fix!");
        return;
    }

    // Clear model field on these duplicates (keeps data, removes from analytics)
    const result = await prisma.aIMessage.updateMany({
        where: {
            id: { in: slugMessages.map(m => m.id) },
        },
        data: {
            model: null,
            costUnits: null,
        },
    });

    console.log(`\nUpdated ${result.count} records: model and costUnits set to null`);
    console.log("These messages will no longer appear in cost analytics but chat history is preserved.");
}

main()
    .then(() => prisma.$disconnect())
    .catch((e) => { console.error(e); prisma.$disconnect(); });
