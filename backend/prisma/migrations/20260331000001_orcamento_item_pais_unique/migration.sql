-- Substitui a unique constraint simples de OrcamentoItem por dois índices parciais
-- que tratam corretamente registros nacionais (paisIso3 IS NULL) e de exportação
-- (paisIso3 IS NOT NULL) de forma independente.

-- Remove a constraint gerada pelo Prisma
DROP INDEX IF EXISTS "OrcamentoItem_orcamentoAno_produtoId_unidadeVendaId_month_key";

-- Nacionais: unicidade em (ano, produto, unidade, mês) somente quando paisIso3 é nulo
CREATE UNIQUE INDEX IF NOT EXISTS "orcamento_item_nacional_unique"
  ON "OrcamentoItem" ("orcamentoAno", "produtoId", "unidadeVendaId", "month")
  WHERE "paisIso3" IS NULL;

-- Exportações: unicidade em (ano, produto, unidade, mês, país) somente quando paisIso3 é não-nulo
CREATE UNIQUE INDEX IF NOT EXISTS "orcamento_item_export_unique"
  ON "OrcamentoItem" ("orcamentoAno", "produtoId", "unidadeVendaId", "month", "paisIso3")
  WHERE "paisIso3" IS NOT NULL;
