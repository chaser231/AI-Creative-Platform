-- Video generation (Higgsfield-style mode + AI Workflows video nodes).
--
-- VideoJob tracks async fal.ai queue requests: the submit endpoint stores the
-- fal request id / status / response URLs, the client polls our jobs route
-- until the queue finishes, at which point the video is persisted to S3 and
-- the row flips to COMPLETED. Daily per-user quota for premium models is
-- computed as count of non-FAILED jobs per (userId, modelId) since UTC
-- midnight — no separate counters to keep in sync.
--
-- VideoModelQuota stores per-model daily limits editable from the admin
-- panel. Rows are lazily seeded from lib/video-quotas.ts defaults.

-- CreateTable
CREATE TABLE "VideoJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "sessionId" TEXT,
    "modelId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "falRequestId" TEXT NOT NULL,
    "falStatusUrl" TEXT NOT NULL,
    "falResponseUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "resultUrl" TEXT,
    "error" TEXT,
    "costUnits" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoModelQuota" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "dailyLimit" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoModelQuota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoJob_userId_modelId_createdAt_idx" ON "VideoJob"("userId", "modelId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoJob_projectId_createdAt_idx" ON "VideoJob"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoModelQuota_modelId_key" ON "VideoModelQuota"("modelId");
