-- Performance: índices compostos para queries globais de analytics do dashboard admin/PCP
-- Cobrem o padrão WHERE month BETWEEN x AND y AND (paisIso3 IS NULL | runId IN (...))
-- IF NOT EXISTS = idempotente (índices podem ter sido criados manualmente)

CREATE INDEX IF NOT EXISTS "ForecastItem_month_paisIso3_idx"
  ON "ForecastItem"("month", "paisIso3");

CREATE INDEX IF NOT EXISTS "ForecastItem_month_runId_idx"
  ON "ForecastItem"("month", "runId");
