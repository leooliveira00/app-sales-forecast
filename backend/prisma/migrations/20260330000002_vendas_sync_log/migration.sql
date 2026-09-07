-- CreateTable
CREATE TABLE "VendasSyncLog" (
    "id" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "status" "ProtheusSyncStatus" NOT NULL,
    "refMonth" TIMESTAMP(3) NOT NULL,
    "cDataDe" TEXT NOT NULL,
    "cDataAte" TEXT NOT NULL,
    "totalRecebidos" INTEGER NOT NULL DEFAULT 0,
    "totalAgrupados" INTEGER NOT NULL DEFAULT 0,
    "totalUpsertedVendas" INTEGER NOT NULL DEFAULT 0,
    "totalUpsertedVinculos" INTEGER NOT NULL DEFAULT 0,
    "totalSkipped" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "VendasSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendasSyncLog_status_idx" ON "VendasSyncLog"("status");

-- CreateIndex
CREATE INDEX "VendasSyncLog_refMonth_idx" ON "VendasSyncLog"("refMonth");

-- CreateIndex
CREATE INDEX "VendasSyncLog_startedAt_idx" ON "VendasSyncLog"("startedAt");
