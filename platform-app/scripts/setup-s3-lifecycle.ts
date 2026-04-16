/**
 * One-time script to configure S3 lifecycle rules on the acp-assets bucket.
 *
 * Rules:
 *   1. ai-tmp/*           → delete after 3 days (temporary AI operation files)
 *   2. Incomplete uploads  → abort after 1 day
 *   3. canvas-images/*     → move to COLD after 90 days (rarely accessed old projects)
 *
 * Usage:
 *   npx tsx scripts/setup-s3-lifecycle.ts          # apply rules
 *   npx tsx scripts/setup-s3-lifecycle.ts --dry-run # preview without applying
 *
 * Requires env vars: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 * Optional: S3_ENDPOINT, S3_BUCKET
 */

import {
  S3Client,
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
  type LifecycleRule,
} from "@aws-sdk/client-s3";

const BUCKET = process.env.S3_BUCKET || "acp-assets";
const ENDPOINT = process.env.S3_ENDPOINT || "https://storage.yandexcloud.net";

const s3 = new S3Client({
  region: "ru-central1",
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

const rules: LifecycleRule[] = [
  {
    ID: "cleanup-ai-tmp",
    Status: "Enabled",
    Filter: { Prefix: "ai-tmp/" },
    Expiration: { Days: 3 },
  },
  {
    ID: "abort-incomplete-uploads",
    Status: "Enabled",
    Filter: { Prefix: "" },
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
  },
  {
    ID: "cold-old-canvas-images",
    Status: "Enabled",
    Filter: { Prefix: "canvas-images/" },
    Transitions: [
      {
        Days: 90,
        StorageClass: "COLD" as unknown as import("@aws-sdk/client-s3").TransitionStorageClass,
      },
    ],
  },
];

async function showCurrentRules() {
  try {
    const res = await s3.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: BUCKET }),
    );
    if (res.Rules && res.Rules.length > 0) {
      console.log("\n📋 Текущие lifecycle rules:");
      for (const r of res.Rules) {
        console.log(`  • ${r.ID} [${r.Status}]`);
        if (r.Expiration?.Days) console.log(`    Expiration: ${r.Expiration.Days} days`);
        if (r.Transitions?.length) {
          for (const t of r.Transitions) {
            console.log(`    Transition → ${t.StorageClass} after ${t.Days} days`);
          }
        }
        if (r.AbortIncompleteMultipartUpload?.DaysAfterInitiation) {
          console.log(`    Abort incomplete: ${r.AbortIncompleteMultipartUpload.DaysAfterInitiation} day(s)`);
        }
      }
    } else {
      console.log("\n📋 Lifecycle rules не настроены.");
    }
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === "NoSuchLifecycleConfiguration") {
      console.log("\n📋 Lifecycle rules не настроены.");
    } else {
      throw err;
    }
  }
}

async function applyRules() {
  console.log(`\n🚀 Применяю lifecycle rules к бакету "${BUCKET}"...`);

  await s3.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: BUCKET,
      LifecycleConfiguration: { Rules: rules },
    }),
  );

  console.log("✅ Lifecycle rules успешно применены!\n");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("═══════════════════════════════════════════");
  console.log("  S3 Lifecycle Policy Setup");
  console.log(`  Bucket: ${BUCKET}`);
  console.log(`  Endpoint: ${ENDPOINT}`);
  console.log("═══════════════════════════════════════════");

  await showCurrentRules();

  console.log("\n📝 Новые rules:");
  for (const r of rules) {
    console.log(`  • ${r.ID} [${r.Status}]`);
    if (r.Filter?.Prefix !== undefined) console.log(`    Filter prefix: "${r.Filter.Prefix}" ${r.Filter.Prefix === "" ? "(весь бакет)" : ""}`);
    if (r.Expiration?.Days) console.log(`    ❌ Удаление через ${r.Expiration.Days} дн.`);
    if (r.Transitions?.length) {
      for (const t of r.Transitions) {
        console.log(`    🔄 Перенос в ${t.StorageClass} через ${t.Days} дн.`);
      }
    }
    if (r.AbortIncompleteMultipartUpload?.DaysAfterInitiation) {
      console.log(`    🧹 Прерывание незавершённых загрузок через ${r.AbortIncompleteMultipartUpload.DaysAfterInitiation} дн.`);
    }
  }

  if (dryRun) {
    console.log("\n⚠️  --dry-run: правила НЕ применены. Убери флаг, чтобы применить.");
    return;
  }

  await applyRules();
  await showCurrentRules();
}

main().catch((err) => {
  console.error("❌ Ошибка:", err);
  process.exit(1);
});
