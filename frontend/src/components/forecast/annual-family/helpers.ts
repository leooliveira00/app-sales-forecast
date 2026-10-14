/**
 * Constantes, tipos de ordenação e auxiliares de apresentação das linhas anuais por família.
 */
import type { ForecastItem } from '../../../types/forecast';
import type { AnnualProduct, DistributeCriterion } from '../../../hooks/useAnnualForecastData';

// ── Constants ─────────────────────────────────────────────────────────────────

export const COL_COUNT = 8;

export type SortCol = 'codigo' | 'descricao' | 'classe' | 'orc' | 'fcts' | 'desvio' | null;

export type SortDir = 'asc' | 'desc';

export const CLASSE_SORT_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };

export function monthLabel(iso: string, months: string[]): string {
  const [y, m] = iso.split('-').map(Number);
  return `${months[m - 1]}/${String(y).slice(2)}`;
}

/** Adapts AnnualProduct to ForecastItem for ProductSalesDetail (chart/KPI row). */
export function adaptToItem(prod: AnnualProduct): ForecastItem {
  return {
    id:          prod.produtoId,
    runId:       '',
    month:       prod.months[0]?.month ?? '',
    volumeORC:   prod.months.reduce((s, m) => s + (m.volumeORC ?? 0), 0),
    volumeIA:    null,
    prevFCTS:    null,
    avgTrim:     prod.avgTrim,
    avgSem:      prod.avgSem,
    avg12m:      prod.avg12m,
    salesHistory: prod.salesHistory,
    orcHistory:  prod.orcHistory,
    source:      prod.source,
    isDefaultPortfolio: false,
    gestorExcluido: prod.gestorExcluido,
    produto: {
      codigo:   prod.codigo,
      descricao: prod.descricao,
      classe:   prod.classe,
      unidades: [],
    },
    overrides: [],
  } as unknown as ForecastItem;
}

/** Chaves i18n dos critérios de distribuição/média das ações em lote. */
export const CRITERIA_LABELS_KEYS: Record<DistributeCriterion, string> = {
  trim: 'columns.trim',
  sem:  'columns.sem',
  '12m':'columns.avg12m',
  orc:  'columns.orc',
  aa:   'columns.yoy',
};
