import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // All nano-banana-pro messages
    const msgs = await prisma.aIMessage.findMany({
        where: {
            role: "assistant",
            model: { not: null },
        },
        select: {
            id: true,
            model: true,
            costUnits: true,
            content: true,
            type: true,
            createdAt: true,
        },
        orderBy: { createdAt: "desc" },
    });

    console.log(`\n=== Total messages: ${msgs.length} ===\n`);

    // Group by model
    const byModel = new Map<string, { count: number; entries: typeof msgs }>();
    for (const m of msgs) {
        const key = m.model || "unknown";
        if (!byModel.has(key)) byModel.set(key, { count: 0, entries: [] });
        const entry = byModel.get(key)!;
        entry.count++;
        entry.entries.push(m);
    }

    for (const [model, { count, entries }] of byModel) {
        console.log(`\n--- ${model} (${count} entries) ---`);
        for (const e of entries.slice(0, 15)) {
            const contentShort = (e.content || "").slice(0, 60).replace(/\n/g, " ");
            console.log(`  [${e.createdAt.toISOString()}] cost=$${(e.costUnits ?? 0).toFixed(4)} type=${e.type} "${contentShort}"`);
        }
    }

    // Today's nano-banana-pro specifically
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMsgs = msgs.filter(m => 
        (m.model === "nano-banana-pro" || m.model === "google/nano-banana-pro") && 
        m.createdAt >= today
    );
    console.log(`\n=== nano-banana-pro TODAY (${todayMsgs.length}) ===`);
    for (const e of todayMsgs) {
        const contentShort = (e.content || "").slice(0, 80).replace(/\n/g, " ");
        console.log(`  [${e.createdAt.toISOString()}] cost=$${(e.costUnits ?? 0).toFixed(4)} type=${e.type} "${contentShort}"`);
    }
}

main().then(() => prisma.$disconnect());
