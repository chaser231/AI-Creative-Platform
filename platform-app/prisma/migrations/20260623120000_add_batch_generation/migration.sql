-- Multi-generation ("Мульти-генерация") batch processing of product photos.
--
-- BatchGeneration is the durable source of truth for a batch run: prompt,
-- model, shared settings snapshot and aggregate progress counters. The
-- browser orchestrates per-item generation through the client-side image
-- queue (lib/imageGenerationQueue.ts) while the tab is open and writes each
-- item's status back through the `batch` tRPC router, so a partially
-- completed batch survives a refresh and can be resumed.
--
-- BatchGenerationItem holds one input image (uploaded file, ZIP entry or a
-- file resolved from a public Yandex.Disk link) and its generated results.

-- CreateTable
CREATE TABLE "BatchGeneration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sessionId" TEXT,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "mode" TEXT NOT NULL DEFAULT 'img2img',
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "settings" JSONB,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "completedItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "costUnits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchGenerationItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'upload',
    "sourceUrl" TEXT NOT NULL,
    "sourceName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultUrls" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "costUnits" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchGenerationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BatchGeneration_projectId_createdAt_idx" ON "BatchGeneration"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "BatchGeneration_userId_createdAt_idx" ON "BatchGeneration"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BatchGenerationItem_batchId_index_idx" ON "BatchGenerationItem"("batchId", "index");

-- AddForeignKey
ALTER TABLE "BatchGeneration" ADD CONSTRAINT "BatchGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchGeneration" ADD CONSTRAINT "BatchGeneration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchGeneration" ADD CONSTRAINT "BatchGeneration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchGenerationItem" ADD CONSTRAINT "BatchGenerationItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BatchGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
