-- Performance: índices para queries do Consolidado (getConsolidado)
-- Cobrem os padrões WHERE month BETWEEN x AND y (VendaMensal),
-- WHERE orcamentoAno = N (OrcamentoItem) e WHERE refMonth + status (DivisionSubmission).
-- IF NOT EXISTS = idempotente.

CREATE INDEX IF NOT EXISTS "VendaMensal_month_idx"
  ON "VendaMensal"("month");

CREATE INDEX IF NOT EXISTS "OrcamentoItem_orcamentoAno_idx"
  ON "OrcamentoItem"("orcamentoAno");

CREATE INDEX IF NOT EXISTS "DivisionSubmission_refMonth_status_idx"
  ON "DivisionSubmission"("refMonth", "status");
