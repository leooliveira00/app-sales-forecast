-- CreateEnum
CREATE TYPE "ProtheusSyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "ProtheusSyncLog" (
    "id" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "status" "ProtheusSyncStatus" NOT NULL,
    "cTipo" TEXT NOT NULL DEFAULT 'PA',
    "totalRecebidos" INTEGER NOT NULL DEFAULT 0,
    "produtosCreated" INTEGER NOT NULL DEFAULT 0,
    "produtosUpdated" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ProtheusSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProtheusSyncLog_status_idx" ON "ProtheusSyncLog"("status");

-- CreateIndex
CREATE INDEX "ProtheusSyncLog_startedAt_idx" ON "ProtheusSyncLog"("startedAt");
