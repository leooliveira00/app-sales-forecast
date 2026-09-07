-- Índice standalone em OrcamentoItem.month para queries de range mensal
-- sem filtro de orcamentoAno (ex: relatórios ad-hoc, outras APIs).
CREATE INDEX IF NOT EXISTS "OrcamentoItem_month_idx"
  ON "OrcamentoItem"("month");
