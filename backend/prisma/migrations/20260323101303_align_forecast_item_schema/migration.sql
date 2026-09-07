-- Adicionar coluna paisIso3 em ForecastItem
ALTER TABLE "ForecastItem" ADD COLUMN "paisIso3" TEXT;

-- Remover coluna volumeReal (não existe mais no schema)
ALTER TABLE "ForecastItem" DROP COLUMN IF EXISTS "volumeReal";

-- Substituir unique index antigo (sem paisIso3) pelo novo (com paisIso3)
DROP INDEX IF EXISTS "ForecastItem_runId_produtoId_unidadeVendaId_month_key";
CREATE UNIQUE INDEX "ForecastItem_runId_produtoId_unidadeVendaId_month_paisIso3_key"
  ON "ForecastItem"("runId", "produtoId", "unidadeVendaId", month, "paisIso3");

-- Adicionar index para queries por país + mês
CREATE INDEX "ForecastItem_paisIso3_month_idx" ON "ForecastItem"("paisIso3", month);

-- Adicionar FK de ForecastItem para Pais
ALTER TABLE "ForecastItem"
  ADD CONSTRAINT "ForecastItem_paisIso3_fkey"
  FOREIGN KEY ("paisIso3") REFERENCES "Pais"("iso3")
  ON UPDATE CASCADE ON DELETE SET NULL;
