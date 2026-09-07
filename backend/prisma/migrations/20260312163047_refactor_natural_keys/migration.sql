-- CreateEnum
CREATE TYPE "Perfil" AS ENUM ('gestor', 'controladoria', 'admin');

-- CreateEnum
CREATE TYPE "UserUnidadeRole" AS ENUM ('GESTOR', 'GERENTE');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OrcamentoStatus" AS ENUM ('APROVADO', 'ARQUIVADO');

-- CreateEnum
CREATE TYPE "UnidadeTipo" AS ENUM ('NACIONAL', 'EXPORT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "perfil" "Perfil" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnidadeVenda" (
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "tipo" "UnidadeTipo" NOT NULL DEFAULT 'NACIONAL',
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnidadeVenda_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "Pais" (
    "iso3" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "unidadeVendaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pais_pkey" PRIMARY KEY ("iso3")
);

-- CreateTable
CREATE TABLE "UserUnidadeVenda" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unidadeVendaId" TEXT NOT NULL,
    "role" "UserUnidadeRole" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserUnidadeVenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produto" (
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "classe" TEXT,
    "ncm" TEXT,
    "erpUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "ProdutoUnidadeVenda" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "unidadeVendaId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "familia" TEXT,
    "divisao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProdutoUnidadeVenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastRun" (
    "id" TEXT NOT NULL,
    "refMonth" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RunStatus" NOT NULL,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "leadTimeMonths" INTEGER NOT NULL DEFAULT 2,
    "availableFrom" TIMESTAMP(3),
    "sourceKey" TEXT,
    "artifactPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "unidadeVendaId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "volumeIA" INTEGER,
    "estoque" INTEGER,
    "volumeReal" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'AIRFLOW',
    "gestorExcluido" BOOLEAN NOT NULL DEFAULT false,
    "excluidoAt" TIMESTAMP(3),
    "excluidoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastOverride" (
    "id" TEXT NOT NULL,
    "forecastItemId" TEXT NOT NULL,
    "gestorId" TEXT NOT NULL,
    "volumeFCTS" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastItemPais" (
    "id" TEXT NOT NULL,
    "forecastItemId" TEXT NOT NULL,
    "paisIso3" TEXT NOT NULL,
    "volumeIA" INTEGER,
    "volumeFCTS" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastItemPais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DivisionSubmission" (
    "id" TEXT NOT NULL,
    "refMonth" TIMESTAMP(3) NOT NULL,
    "unidadeVendaId" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "autorId" TEXT NOT NULL,
    "revisorId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DivisionSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendaMensal" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "unidadeVendaId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "receita" DECIMAL(18,2),
    "canal" TEXT NOT NULL DEFAULT 'VENDA DIRETA',
    "paisIso3" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendaMensal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrcamentoRun" (
    "ano" INTEGER NOT NULL,
    "aprovadoEm" TIMESTAMP(3),
    "status" "OrcamentoStatus" NOT NULL DEFAULT 'APROVADO',
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrcamentoRun_pkey" PRIMARY KEY ("ano")
);

-- CreateTable
CREATE TABLE "OrcamentoItem" (
    "id" TEXT NOT NULL,
    "orcamentoAno" INTEGER NOT NULL,
    "produtoId" TEXT NOT NULL,
    "unidadeVendaId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "volumeORC" INTEGER NOT NULL,
    "paisIso3" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrcamentoItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_perfil_idx" ON "User"("perfil");

-- CreateIndex
CREATE INDEX "UnidadeVenda_ativo_idx" ON "UnidadeVenda"("ativo");

-- CreateIndex
CREATE INDEX "UnidadeVenda_tipo_idx" ON "UnidadeVenda"("tipo");

-- CreateIndex
CREATE INDEX "Pais_unidadeVendaId_ativo_idx" ON "Pais"("unidadeVendaId", "ativo");

-- CreateIndex
CREATE INDEX "UserUnidadeVenda_unidadeVendaId_role_idx" ON "UserUnidadeVenda"("unidadeVendaId", "role");

-- CreateIndex
CREATE INDEX "UserUnidadeVenda_userId_role_idx" ON "UserUnidadeVenda"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "UserUnidadeVenda_userId_unidadeVendaId_role_key" ON "UserUnidadeVenda"("userId", "unidadeVendaId", "role");

-- CreateIndex
CREATE INDEX "Produto_ativo_idx" ON "Produto"("ativo");

-- CreateIndex
CREATE INDEX "ProdutoUnidadeVenda_unidadeVendaId_ativo_idx" ON "ProdutoUnidadeVenda"("unidadeVendaId", "ativo");

-- CreateIndex
CREATE INDEX "ProdutoUnidadeVenda_produtoId_ativo_idx" ON "ProdutoUnidadeVenda"("produtoId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "ProdutoUnidadeVenda_produtoId_unidadeVendaId_key" ON "ProdutoUnidadeVenda"("produtoId", "unidadeVendaId");

-- CreateIndex
CREATE INDEX "ForecastRun_refMonth_idx" ON "ForecastRun"("refMonth");

-- CreateIndex
CREATE INDEX "ForecastItem_unidadeVendaId_month_idx" ON "ForecastItem"("unidadeVendaId", "month");

-- CreateIndex
CREATE INDEX "ForecastItem_produtoId_month_idx" ON "ForecastItem"("produtoId", "month");

-- CreateIndex
CREATE INDEX "ForecastItem_runId_unidadeVendaId_idx" ON "ForecastItem"("runId", "unidadeVendaId");

-- CreateIndex
CREATE INDEX "ForecastItem_gestorExcluido_idx" ON "ForecastItem"("gestorExcluido");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastItem_runId_produtoId_unidadeVendaId_month_key" ON "ForecastItem"("runId", "produtoId", "unidadeVendaId", "month");

-- CreateIndex
CREATE INDEX "ForecastOverride_gestorId_idx" ON "ForecastOverride"("gestorId");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastOverride_forecastItemId_gestorId_key" ON "ForecastOverride"("forecastItemId", "gestorId");

-- CreateIndex
CREATE INDEX "ForecastItemPais_paisIso3_idx" ON "ForecastItemPais"("paisIso3");

-- CreateIndex
CREATE INDEX "ForecastItemPais_forecastItemId_idx" ON "ForecastItemPais"("forecastItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastItemPais_forecastItemId_paisIso3_key" ON "ForecastItemPais"("forecastItemId", "paisIso3");

-- CreateIndex
CREATE INDEX "DivisionSubmission_status_refMonth_idx" ON "DivisionSubmission"("status", "refMonth");

-- CreateIndex
CREATE INDEX "DivisionSubmission_unidadeVendaId_refMonth_idx" ON "DivisionSubmission"("unidadeVendaId", "refMonth");

-- CreateIndex
CREATE UNIQUE INDEX "DivisionSubmission_refMonth_unidadeVendaId_key" ON "DivisionSubmission"("refMonth", "unidadeVendaId");

-- CreateIndex
CREATE INDEX "VendaMensal_unidadeVendaId_month_idx" ON "VendaMensal"("unidadeVendaId", "month");

-- CreateIndex
CREATE INDEX "VendaMensal_produtoId_month_idx" ON "VendaMensal"("produtoId", "month");

-- CreateIndex
CREATE INDEX "VendaMensal_paisIso3_month_idx" ON "VendaMensal"("paisIso3", "month");

-- CreateIndex
CREATE INDEX "VendaMensal_month_idx" ON "VendaMensal"("month");

-- CreateIndex
CREATE UNIQUE INDEX "VendaMensal_produtoId_unidadeVendaId_month_canal_key" ON "VendaMensal"("produtoId", "unidadeVendaId", "month", "canal");

-- CreateIndex
CREATE UNIQUE INDEX "SystemConfig_key_key" ON "SystemConfig"("key");

-- CreateIndex
CREATE INDEX "OrcamentoRun_status_idx" ON "OrcamentoRun"("status");

-- CreateIndex
CREATE INDEX "OrcamentoItem_unidadeVendaId_month_idx" ON "OrcamentoItem"("unidadeVendaId", "month");

-- CreateIndex
CREATE INDEX "OrcamentoItem_paisIso3_month_idx" ON "OrcamentoItem"("paisIso3", "month");

-- CreateIndex
CREATE INDEX "OrcamentoItem_produtoId_month_idx" ON "OrcamentoItem"("produtoId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "OrcamentoItem_orcamentoAno_produtoId_unidadeVendaId_month_key" ON "OrcamentoItem"("orcamentoAno", "produtoId", "unidadeVendaId", "month");

-- AddForeignKey
ALTER TABLE "Pais" ADD CONSTRAINT "Pais_unidadeVendaId_fkey" FOREIGN KEY ("unidadeVendaId") REFERENCES "UnidadeVenda"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserUnidadeVenda" ADD CONSTRAINT "UserUnidadeVenda_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserUnidadeVenda" ADD CONSTRAINT "UserUnidadeVenda_unidadeVendaId_fkey" FOREIGN KEY ("unidadeVendaId") REFERENCES "UnidadeVenda"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoUnidadeVenda" ADD CONSTRAINT "ProdutoUnidadeVenda_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoUnidadeVenda" ADD CONSTRAINT "ProdutoUnidadeVenda_unidadeVendaId_fkey" FOREIGN KEY ("unidadeVendaId") REFERENCES "UnidadeVenda"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastItem" ADD CONSTRAINT "ForecastItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ForecastRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastItem" ADD CONSTRAINT "ForecastItem_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastItem" ADD CONSTRAINT "ForecastItem_unidadeVendaId_fkey" FOREIGN KEY ("unidadeVendaId") REFERENCES "UnidadeVenda"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastItem" ADD CONSTRAINT "ForecastItem_excluidoPorId_fkey" FOREIGN KEY ("excluidoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastOverride" ADD CONSTRAINT "ForecastOverride_forecastItemId_fkey" FOREIGN KEY ("forecastItemId") REFERENCES "ForecastItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastOverride" ADD CONSTRAINT "ForecastOverride_gestorId_fkey" FOREIGN KEY ("gestorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastItemPais" ADD CONSTRAINT "ForecastItemPais_forecastItemId_fkey" FOREIGN KEY ("forecastItemId") REFERENCES "ForecastItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastItemPais" ADD CONSTRAINT "ForecastItemPais_paisIso3_fkey" FOREIGN KEY ("paisIso3") REFERENCES "Pais"("iso3") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivisionSubmission" ADD CONSTRAINT "DivisionSubmission_unidadeVendaId_fkey" FOREIGN KEY ("unidadeVendaId") REFERENCES "UnidadeVenda"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivisionSubmission" ADD CONSTRAINT "DivisionSubmission_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivisionSubmission" ADD CONSTRAINT "DivisionSubmission_revisorId_fkey" FOREIGN KEY ("revisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaMensal" ADD CONSTRAINT "VendaMensal_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaMensal" ADD CONSTRAINT "VendaMensal_unidadeVendaId_fkey" FOREIGN KEY ("unidadeVendaId") REFERENCES "UnidadeVenda"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaMensal" ADD CONSTRAINT "VendaMensal_paisIso3_fkey" FOREIGN KEY ("paisIso3") REFERENCES "Pais"("iso3") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrcamentoItem" ADD CONSTRAINT "OrcamentoItem_orcamentoAno_fkey" FOREIGN KEY ("orcamentoAno") REFERENCES "OrcamentoRun"("ano") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrcamentoItem" ADD CONSTRAINT "OrcamentoItem_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrcamentoItem" ADD CONSTRAINT "OrcamentoItem_unidadeVendaId_fkey" FOREIGN KEY ("unidadeVendaId") REFERENCES "UnidadeVenda"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrcamentoItem" ADD CONSTRAINT "OrcamentoItem_paisIso3_fkey" FOREIGN KEY ("paisIso3") REFERENCES "Pais"("iso3") ON DELETE SET NULL ON UPDATE CASCADE;
