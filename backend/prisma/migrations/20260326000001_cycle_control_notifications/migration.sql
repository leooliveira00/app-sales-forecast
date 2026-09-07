-- CreateEnum
CREATE TYPE "CycleGate" AS ENUM ('PENDING', 'PARTIAL', 'READY', 'BLOCKED', 'FAILED');

-- AlterTable: add needsReview to DivisionSubmission
ALTER TABLE "DivisionSubmission" ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: CycleRequiredDag
CREATE TABLE "CycleRequiredDag" (
    "id" TEXT NOT NULL,
    "dagId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CycleRequiredDag_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CycleReadinessLog
CREATE TABLE "CycleReadinessLog" (
    "id" TEXT NOT NULL,
    "refMonth" TIMESTAMP(3) NOT NULL,
    "stepsCompleted" JSONB NOT NULL DEFAULT '{}',
    "expectedDagRunIds" JSONB NOT NULL DEFAULT '{}',
    "gate" "CycleGate" NOT NULL DEFAULT 'PENDING',
    "blockedAt" TIMESTAMP(3),
    "blockedById" TEXT,
    "blockedReason" TEXT,
    "unblockedAt" TIMESTAMP(3),
    "unblockedById" TEXT,
    "rerunReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "triggeredBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CycleReadinessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Notification
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "refMonth" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CycleRequiredDag_dagId_key" ON "CycleRequiredDag"("dagId");

-- CreateIndex
CREATE UNIQUE INDEX "CycleReadinessLog_refMonth_key" ON "CycleReadinessLog"("refMonth");

-- CreateIndex
CREATE INDEX "CycleReadinessLog_gate_idx" ON "CycleReadinessLog"("gate");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "CycleReadinessLog" ADD CONSTRAINT "CycleReadinessLog_blockedById_fkey"
    FOREIGN KEY ("blockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CycleReadinessLog" ADD CONSTRAINT "CycleReadinessLog_unblockedById_fkey"
    FOREIGN KEY ("unblockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: DAGs obrigatórias iniciais
INSERT INTO "CycleRequiredDag" ("id", "dagId", "label", "enabled", "order", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::text, 'protheus_produtos_sync', 'Sincronização de Produtos (Protheus)', true,  1, NOW(), NOW()),
  (gen_random_uuid()::text, 'sync_vendas',            'Atualização de Histórico de Vendas',   false, 2, NOW(), NOW()),
  (gen_random_uuid()::text, 'forecast_model',         'Execução dos Modelos Estatísticos',    false, 3, NOW(), NOW());
