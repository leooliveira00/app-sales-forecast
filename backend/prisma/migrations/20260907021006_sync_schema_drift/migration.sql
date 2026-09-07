-- CreateEnum
CREATE TYPE "ProtheusExportStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "ProtheusExportItemStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CycleGate" ADD VALUE 'REPROCESSING';
ALTER TYPE "CycleGate" ADD VALUE 'CLOSED';

-- AlterEnum
ALTER TYPE "RunStatus" ADD VALUE 'PROCESSING';

-- DropIndex
DROP INDEX "DivisionSubmission_refMonth_status_idx";

-- DropIndex
DROP INDEX "OrcamentoItem_month_idx";

-- DropIndex
DROP INDEX "OrcamentoItem_orcamentoAno_idx";

-- AlterTable
ALTER TABLE "CycleReadinessLog" ADD COLUMN     "gestorNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DivisionSubmission" ADD COLUMN     "autoSubmitted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ForecastOverrideHistory" ADD COLUMN     "action" TEXT NOT NULL DEFAULT 'UPDATE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProtheusExportLog" (
    "id" TEXT NOT NULL,
    "refMonth" TIMESTAMP(3) NOT NULL,
    "triggeredById" TEXT NOT NULL,
    "parentLogId" TEXT,
    "status" "ProtheusExportStatus" NOT NULL DEFAULT 'RUNNING',
    "totalUnidades" INTEGER NOT NULL DEFAULT 0,
    "unidadesOk" INTEGER NOT NULL DEFAULT 0,
    "unidadesFailed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "airflowRunId" TEXT,
    "details" JSONB,
    "csvFallbackPath" TEXT,

    CONSTRAINT "ProtheusExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtheusExportItem" (
    "id" TEXT NOT NULL,
    "logId" TEXT NOT NULL,
    "unidadeVendaId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "produtoId" TEXT NOT NULL,
    "codigoFamilia" TEXT,
    "volumeFCTS" INTEGER NOT NULL,
    "forecastItemId" TEXT,
    "overrideId" TEXT,
    "status" "ProtheusExportItemStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "ProtheusExportItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "userNome" TEXT,
    "userPerfil" TEXT,
    "source" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "refMonth" TEXT,
    "unidadeId" TEXT,
    "produtoId" TEXT,
    "paisIso3" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsolidadoMesSnapshot" (
    "orcamentoAno" INTEGER NOT NULL,
    "unidadeVendaId" TEXT NOT NULL,
    "refMonth" TIMESTAMP(3) NOT NULL,
    "orc" INTEGER NOT NULL,
    "fcts" INTEGER NOT NULL,
    "vendas" INTEGER NOT NULL,
    "submissaoStatus" TEXT,
    "latestRunFcts" INTEGER NOT NULL,
    "prevRunFcts" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsolidadoMesSnapshot_pkey" PRIMARY KEY ("orcamentoAno","unidadeVendaId","refMonth")
);

-- CreateTable
CREATE TABLE "ConsolidadoProdutoMesSnapshot" (
    "orcamentoAno" INTEGER NOT NULL,
    "unidadeVendaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "refMonth" TIMESTAMP(3) NOT NULL,
    "produtoCodigo" TEXT NOT NULL,
    "produtoDescricao" TEXT NOT NULL,
    "familia" TEXT,
    "classe" TEXT,
    "orc" INTEGER NOT NULL,
    "fcts" INTEGER NOT NULL,
    "vendas" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsolidadoProdutoMesSnapshot_pkey" PRIMARY KEY ("orcamentoAno","unidadeVendaId","produtoId","refMonth")
);

-- CreateTable
CREATE TABLE "AcuraciaSnapshot" (
    "unidadeVendaId" TEXT NOT NULL,
    "anchorMonth" TIMESTAMP(3) NOT NULL,
    "meses" INTEGER NOT NULL DEFAULT 3,
    "acuracia" DECIMAL(6,2) NOT NULL,
    "bias" DECIMAL(8,2) NOT NULL,
    "ciclosValidos" INTEGER NOT NULL,
    "totalVendas" DECIMAL(18,0),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcuraciaSnapshot_pkey" PRIMARY KEY ("unidadeVendaId","anchorMonth","meses")
);

-- CreateIndex
CREATE INDEX "ProtheusExportLog_refMonth_idx" ON "ProtheusExportLog"("refMonth");

-- CreateIndex
CREATE INDEX "ProtheusExportLog_status_idx" ON "ProtheusExportLog"("status");

-- CreateIndex
CREATE INDEX "ProtheusExportLog_startedAt_idx" ON "ProtheusExportLog"("startedAt");

-- CreateIndex
CREATE INDEX "ProtheusExportItem_logId_idx" ON "ProtheusExportItem"("logId");

-- CreateIndex
CREATE INDEX "ProtheusExportItem_unidadeVendaId_month_idx" ON "ProtheusExportItem"("unidadeVendaId", "month");

-- CreateIndex
CREATE INDEX "ProtheusExportItem_produtoId_idx" ON "ProtheusExportItem"("produtoId");

-- CreateIndex
CREATE INDEX "ProtheusExportItem_forecastItemId_idx" ON "ProtheusExportItem"("forecastItemId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_refMonth_idx" ON "AuditLog"("refMonth");

-- CreateIndex
CREATE INDEX "AuditLog_unidadeId_idx" ON "AuditLog"("unidadeId");

-- CreateIndex
CREATE INDEX "AuditLog_produtoId_idx" ON "AuditLog"("produtoId");

-- CreateIndex
CREATE INDEX "AuditLog_paisIso3_idx" ON "AuditLog"("paisIso3");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "ConsolidadoMesSnapshot_orcamentoAno_refMonth_idx" ON "ConsolidadoMesSnapshot"("orcamentoAno", "refMonth");

-- CreateIndex
CREATE INDEX "ConsolidadoMesSnapshot_unidadeVendaId_refMonth_idx" ON "ConsolidadoMesSnapshot"("unidadeVendaId", "refMonth");

-- CreateIndex
CREATE INDEX "ConsolidadoProdutoMesSnapshot_orcamentoAno_unidadeVendaId_idx" ON "ConsolidadoProdutoMesSnapshot"("orcamentoAno", "unidadeVendaId");

-- CreateIndex
CREATE INDEX "ConsolidadoProdutoMesSnapshot_unidadeVendaId_refMonth_idx" ON "ConsolidadoProdutoMesSnapshot"("unidadeVendaId", "refMonth");

-- CreateIndex
CREATE INDEX "ConsolidadoProdutoMesSnapshot_produtoId_unidadeVendaId_idx" ON "ConsolidadoProdutoMesSnapshot"("produtoId", "unidadeVendaId");

-- CreateIndex
CREATE INDEX "AcuraciaSnapshot_anchorMonth_meses_idx" ON "AcuraciaSnapshot"("anchorMonth", "meses");

-- CreateIndex
CREATE INDEX "OrcamentoItem_orcamentoAno_produtoId_unidadeVendaId_month_idx" ON "OrcamentoItem"("orcamentoAno", "produtoId", "unidadeVendaId", "month");

-- CreateIndex
CREATE INDEX "VendaMensal_produtoId_unidadeVendaId_month_canal_idx" ON "VendaMensal"("produtoId", "unidadeVendaId", "month", "canal");

-- AddForeignKey
ALTER TABLE "ProtheusExportLog" ADD CONSTRAINT "ProtheusExportLog_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtheusExportItem" ADD CONSTRAINT "ProtheusExportItem_logId_fkey" FOREIGN KEY ("logId") REFERENCES "ProtheusExportLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
