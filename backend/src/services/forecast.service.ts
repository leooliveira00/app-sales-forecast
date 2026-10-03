/**
 * API pública do domínio de forecast — reexporta os módulos por responsabilidade.
 * Consumidores (forecast.controller, forecast-airflow.service) importam daqui; código novo
 * pode importar direto do módulo específico.
 *
 *   forecast-shared     utilitários (autoria para auditoria, cache analítico, mapa de runs)
 *   forecast-runs       ciclo de vida do ForecastRun e inserção de itens (Airflow/backfill)
 *   forecast-items      leitura de itens para as telas do gestor
 *   forecast-portfolio  excluir / restaurar / adicionar produto no ciclo
 *   forecast-overrides  FCTS do gestor (upsert, lote, exclusão) com histórico
 *   forecast-dashboard  tendência, desvios, resumo e pendências
 *   forecast-accuracy   acurácia/bias, produtos crônicos e detalhe mensal
 */
export { invalidateAnalyticsCache, getSuccessRunMap } from "./forecast-shared.service.js";
export * from "./forecast-runs.service.js";
export * from "./forecast-items.service.js";
export * from "./forecast-portfolio.service.js";
export * from "./forecast-overrides.service.js";
export * from "./forecast-dashboard.service.js";
export * from "./forecast-accuracy.service.js";

