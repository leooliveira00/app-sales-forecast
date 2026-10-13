/**
 * Cálculos puros das ações em lote (prévia antes de salvar): aceitar IA, média,
 * distribuir total, valor fixo, percentual e reverter. Recebem produtos e devolvem
 * o mapa itemId → novo FCTS, sem efeitos colaterais.
 */
import type { AnnualProduct, AnnualMonthEntry } from '../../../hooks/useAnnualForecastData';
import type { DistributeCriterion } from '../../../hooks/useAnnualForecastData';
import type { BulkPreviewRow, BulkPreviewMonthRow } from '../BulkPreviewModal';
import { monthLabel } from './helpers';

// ── Preview compute helpers ───────────────────────────────────────────────────

export function buildPreviewRow(
  prod: AnnualProduct,
  newValuesByItemId: Record<string, number>,
  valueLabel: string,
  monthNames: string[],
  noData = false,
): BulkPreviewRow {
  const active = prod.months.filter(m => !m.gestorExcluido);
  const months: BulkPreviewMonthRow[] = active.map(m => ({
    itemId:   m.itemId,
    month:    m.month,
    label:    monthLabel(m.month, monthNames),
    newValue: newValuesByItemId[m.itemId] ?? 0,
    orc:      m.volumeORC ?? null,
    prevFcts: m.prevFCTS  ?? null,
    vendaAA:  m.vendaAA   ?? null,
    paisIso3: m.paisIso3  ?? null,
  }));
  const sumOrNull = (arr: (number | null)[]) => {
    const valid = arr.filter((v): v is number => v != null);
    return valid.length > 0 ? valid.reduce((s, v) => s + v, 0) : null;
  };
  return {
    produtoId:     prod.produtoId,
    codigo:        prod.codigo,
    descricao:     prod.descricao,
    classe:        prod.classe ?? undefined,
    newTotal:      months.reduce((s, m) => s + m.newValue, 0),
    valueLabel,
    monthsCount:   active.length,
    orcTotal:      sumOrNull(active.map(m => m.volumeORC ?? null)),
    prevFctsTotal: sumOrNull(active.map(m => m.prevFCTS  ?? null)),
    vendaAATotal:  sumOrNull(active.map(m => m.vendaAA   ?? null)),
    months,
    noData,
  };
}

export function computeAcceptIA(products: AnnualProduct[]): Record<string, number> {
  const u: Record<string, number> = {};
  for (const prod of products) {
    if (prod.gestorExcluido) continue;
    for (const m of prod.months) {
      if (m.gestorExcluido || m.volumeIA == null) continue;
      u[m.itemId] = m.volumeIA;
    }
  }
  return u;
}

export function computeFillAverage(
  products: AnnualProduct[],
  criterion: 'trim' | 'sem' | '12m' | 'aa',
): Record<string, number> {
  const u: Record<string, number> = {};
  for (const prod of products) {
    if (prod.gestorExcluido) continue;
    if (criterion === 'aa') {
      for (const m of prod.months) {
        if (m.gestorExcluido || m.vendaAA == null) continue;
        u[m.itemId] = Math.max(0, Math.round(m.vendaAA));
      }
    } else {
      const avg = criterion === 'trim' ? prod.avgTrim : criterion === 'sem' ? prod.avgSem : prod.avg12m;
      if (avg == null) continue;
      const value = Math.max(0, Math.round(avg));
      for (const m of prod.months) {
        if (m.gestorExcluido) continue;
        u[m.itemId] = value;
      }
    }
  }
  return u;
}

export function computeDistribute(
  products: AnnualProduct[],
  total: number,
  criterion: DistributeCriterion,
): Record<string, number> | null {
  const active = products.filter(p => !p.gestorExcluido);
  const u: Record<string, number> = {};

  if (criterion === 'aa') {
    const totalVendaAA = active.reduce((s, p) =>
      s + p.months.filter(m => !m.gestorExcluido).reduce((ms, m) => ms + (m.vendaAA ?? 0), 0), 0,
    );
    if (totalVendaAA === 0) return null;
    for (const prod of active) {
      for (const m of prod.months.filter(m => !m.gestorExcluido)) {
        u[m.itemId] = Math.max(0, Math.round(((m.vendaAA ?? 0) / totalVendaAA) * total));
      }
    }
  } else {
    const getW = (prod: AnnualProduct): number => {
      if (criterion === 'orc')
        return prod.months.filter(m => !m.gestorExcluido).reduce((s, m) => s + (m.volumeORC ?? 0), 0);
      return (criterion === 'trim' ? prod.avgTrim : criterion === 'sem' ? prod.avgSem : prod.avg12m) ?? 0;
    };
    const sumW = active.reduce((s, p) => s + getW(p), 0);
    if (sumW === 0) return null;
    for (const prod of active) {
      const share  = (getW(prod) / sumW) * total;
      const months = prod.months.filter(m => !m.gestorExcluido);
      if (!months.length) continue;
      const pm = Math.max(0, Math.round(share / months.length));
      for (const m of months) u[m.itemId] = pm;
    }
  }
  return u;
}

export function computeSetValue(products: AnnualProduct[], value: number): Record<string, number> {
  const u: Record<string, number> = {};
  for (const prod of products) {
    if (prod.gestorExcluido) continue;
    for (const m of prod.months) {
      if (m.gestorExcluido) continue;
      u[m.itemId] = value;
    }
  }
  return u;
}

export function computeApplyPercent(
  products: AnnualProduct[],
  pct: number,
  basis: 'IA' | 'ORC',
): Record<string, number> {
  const u: Record<string, number> = {};
  for (const prod of products) {
    if (prod.gestorExcluido) continue;
    for (const m of prod.months) {
      if (m.gestorExcluido) continue;
      const base = basis === 'IA' ? m.volumeIA : m.volumeORC;
      if (base == null) continue;
      u[m.itemId] = Math.max(0, Math.round(base * (1 + pct / 100)));
    }
  }
  return u;
}

// Reverte os valores ao estado inicial de abertura do ciclo, reproduzindo a
// semeadura do backend (cycle-readiness/finalizeRun):
//   Passada 1 — FCTS herdado do ciclo anterior (prevFCTS > 0);
//   Passada 2 — meses sem correspondência herdam do mês imediatamente anterior
//               da mesma série (produto + país), efeito "esteira";
//   demais meses voltam a 0 (campo zerado, como nasceu o ciclo).
// Cobre TODOS os meses ativos — inclusive zerando o que o gestor digitou em
// meses que não tinham valor na abertura.
export function computeRevertInitial(products: AnnualProduct[]): Record<string, number> {
  const u: Record<string, number> = {};
  for (const prod of products) {
    if (prod.gestorExcluido) continue;
    const active = prod.months.filter(m => !m.gestorExcluido);
    // Agrupa por país para que o carry da Passada 2 respeite a série de cada país
    const byCountry = new Map<string, AnnualMonthEntry[]>();
    for (const m of active) {
      const k = m.paisIso3 ?? '';
      if (!byCountry.has(k)) byCountry.set(k, []);
      byCountry.get(k)!.push(m);
    }
    for (const series of byCountry.values()) {
      const ordered = [...series].sort((a, b) => a.month.localeCompare(b.month));
      // Passada 1: valor herdado do ciclo anterior (apenas > 0, como no backend)
      const pass1 = ordered.map(m => (m.prevFCTS != null && m.prevFCTS > 0 ? m.prevFCTS : null));
      for (let i = 0; i < ordered.length; i++) {
        let val = pass1[i];
        if (val == null) {
          // Passada 2: herda do mês anterior da Passada 1 (single-hop, como no backend)
          const carry = i > 0 ? pass1[i - 1] : null;
          val = carry != null && carry > 0 ? carry : 0;
        }
        u[ordered[i].itemId] = val;
      }
    }
  }
  return u;
}
