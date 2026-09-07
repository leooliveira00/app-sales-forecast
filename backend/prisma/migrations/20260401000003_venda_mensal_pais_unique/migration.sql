-- Remove a restrição de unicidade simples que não contempla paisIso3
DROP INDEX IF EXISTS "VendaMensal_produtoId_unidadeVendaId_month_canal_key";

-- Nacional: único por (produto, unidade, mês, canal) onde paisIso3 IS NULL
CREATE UNIQUE INDEX "venda_mensal_nacional_unique"
  ON "VendaMensal" ("produtoId", "unidadeVendaId", "month", "canal")
  WHERE "paisIso3" IS NULL;

-- Export: único por (produto, unidade, mês, canal, país)
CREATE UNIQUE INDEX "venda_mensal_export_unique"
  ON "VendaMensal" ("produtoId", "unidadeVendaId", "month", "canal", "paisIso3")
  WHERE "paisIso3" IS NOT NULL;
