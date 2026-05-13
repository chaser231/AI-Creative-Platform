-- Add LoraPreset: workspace-scoped catalogue of user/community LoRA weights
-- consumed by the new LoRA-aware fal.ai endpoints (flux-lora, flux-2-lora,
-- qwen-image-lora, qwen-image-edit-lora). System-curated LoRAs ship in code
-- (lib/lora-catalog.ts); this table only stores custom URLs added in-app.
--
-- The `path` column points at a publicly-reachable .safetensors URL. Hosts
-- are validated against an SSRF allowlist (huggingface.co, civitai.com,
-- *.fal.media, *.replicate.delivery) at write time — there's no DB-level
-- check; the server-side API is the only safe entry point.
--
-- Family is one of "flux-1" | "flux-2" | "qwen" and MUST match the
-- ModelEntry.loraSpec.family of any model the preset is applied to.

-- CreateTable
CREATE TABLE "LoraPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "path" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "defaultScale" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "previewUrl" TEXT,
    "triggerWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visibility" TEXT NOT NULL DEFAULT 'personal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "LoraPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoraPreset_workspaceId_family_visibility_idx" ON "LoraPreset"("workspaceId", "family", "visibility");

-- CreateIndex
CREATE INDEX "LoraPreset_createdById_idx" ON "LoraPreset"("createdById");

-- AddForeignKey
ALTER TABLE "LoraPreset" ADD CONSTRAINT "LoraPreset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoraPreset" ADD CONSTRAINT "LoraPreset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
