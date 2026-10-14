import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, RotateCcw, Trash2, BarChart2, Sparkles, Copy } from 'lucide-react';
import { cn, InfoTooltip } from '../shared/Common';
import { fmt, CLASSE_BADGE_COLORS } from '../../types/forecast';
import type { AnnualProduct, AnnualMonthEntry } from '../../hooks/useAnnualForecastData';
import type { DistributeCriterion } from '../../hooks/useAnnualForecastData';
import { ProductSalesDetail } from './ProductSalesDetail';
import { FamilySalesDetail } from './FamilySalesDetail';
import { BulkPreviewModal } from './BulkPreviewModal';
import type { BulkPreviewRow } from './BulkPreviewModal';
import { ExcludeCountryModal } from './ExcludeCountryModal';
import type { AuditContext } from '../../types/audit';
import { generateUUID } from '../../utils/uuid';
import { COL_COUNT, SortCol, SortDir, CLASSE_SORT_ORDER, CRITERIA_LABELS_KEYS, adaptToItem } from './annual-family/helpers';
import { SortIcon } from './annual-family/SortIcon';
import { buildPreviewRow, computeAcceptIA, computeFillAverage, computeDistribute, computeSetValue, computeApplyPercent, computeRevertInitial } from './annual-family/previewCompute';
import { ActionsDropdown } from './annual-family/ActionsDropdown';
import { MonthSubRows } from './annual-family/MonthSubRows';

// ── Preview state type ────────────────────────────────────────────────────────

interface PreviewState {
  title:        string;
  subtitle?:    string;
  rows:         BulkPreviewRow[];
  allUpdates:   Record<string, number>;
  auditContext: AuditContext;
}

// ── Main component ────────────────────────────────────────────────────────────

export interface AnnualFamilyRowsProps {
  familia:                 string;
  products:                AnnualProduct[];
  collapsed:               boolean;
  onToggle:                () => void;
  fcts:                    Record<string, string>;
  setFcts:                 React.Dispatch<React.SetStateAction<Record<string, string>>>;
  isDirty:                 (itemId: string) => boolean;
  saveFCTS:                (itemId: string) => void;
  savingId:                string | null;
  isReadOnly:              boolean;
  isExport?:               boolean;
  consolidated?:           boolean;
  selectedCountry?:        string | null;
  selectedCountryNome?:    string | null;
  onSaveBulk:              (updates: Record<string, number>, auditContext?: AuditContext, options?: { silent?: boolean }) => Promise<boolean>;
  onProductAcceptIA:       (product: AnnualProduct) => Promise<void>;
  onExclude:               (product: AnnualProduct, scope?: 'country' | 'all') => void;
  onRestore:               (product: AnnualProduct) => void;
  onCopyForecast?:         (product: AnnualProduct) => void;
  onError:                 (msg: string) => void;
}

export const AnnualFamilyRows: React.FC<AnnualFamilyRowsProps> = ({
  familia, products, collapsed, onToggle, fcts, setFcts, isDirty, saveFCTS,
  savingId, isReadOnly, isExport = false, consolidated = false,
  selectedCountry = null, selectedCountryNome = null,
  onSaveBulk, onProductAcceptIA,
  onExclude, onRestore, onCopyForecast, onError,
}) => {
  const { t } = useTranslation('forecast');
  const MESES_SHORT = t('months', { ns: 'common', returnObjects: true }) as string[];

  // Na visão consolidada ("Todos os países"), os meses já vêm somados por país e o
  // FCTS efetivo está em m.override.volumeFCTS (read-only). Caso contrário, o valor
  // editável vem do estado `fcts` por itemId. Os accessors abaixo unificam a leitura
  // para que totais, desvios e progresso funcionem em ambos os modos.
  const fctsValOf = useCallback((m: AnnualMonthEntry): number => {
    if (consolidated) return m.override?.volumeFCTS ?? 0;
    const v = Number(fcts[m.itemId] ?? '');
    return isNaN(v) ? 0 : v;
  }, [consolidated, fcts]);
  const fctsFilledOf = useCallback((m: AnnualMonthEntry): boolean =>
    consolidated ? m.override != null : (fcts[m.itemId] !== undefined && fcts[m.itemId] !== ''),
  [consolidated, fcts]);

  const [expandedMonths,  setExpandedMonths]  = useState<Set<string>>(new Set());
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());
  const [showFamilyDetail, setShowFamilyDetail] = useState(false);
  const [previewState, setPreviewState]        = useState<PreviewState | null>(null);
  const [excludeTarget, setExcludeTarget]      = useState<AnnualProduct | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      if (sortDir === 'asc') { setSortDir('desc'); }
      else { setSortCol(null); setSortDir('asc'); }
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  // fcts is intentionally excluded from deps — sort is a static snapshot taken at click time
  const sortedProducts = useMemo(() => {
    if (!sortCol) return products;
    return [...products].sort((a, b) => {
      let va: number | string;
      let vb: number | string;
      switch (sortCol) {
        case 'codigo':   va = a.codigo;   vb = b.codigo;   break;
        case 'descricao': va = a.descricao; vb = b.descricao; break;
        case 'classe':
          va = CLASSE_SORT_ORDER[a.classe ?? ''] ?? 99;
          vb = CLASSE_SORT_ORDER[b.classe ?? ''] ?? 99;
          break;
        case 'orc':
          va = a.months.reduce((s, m) => s + (m.volumeORC ?? 0), 0);
          vb = b.months.reduce((s, m) => s + (m.volumeORC ?? 0), 0);
          break;
        case 'fcts': {
          const sum = (p: AnnualProduct) => p.months.reduce((s, m) => s + fctsValOf(m), 0);
          va = sum(a); vb = sum(b); break;
        }
        case 'desvio': {
          const calc = (p: AnnualProduct) => {
            const monthsAA = p.months.filter(m => m.vendaAA != null && m.vendaAA > 0);
            const aa = monthsAA.reduce((s, m) => s + (m.vendaAA ?? 0), 0);
            const fctsV = monthsAA.reduce((s, m) => s + fctsValOf(m), 0);
            return aa > 0 && fctsV > 0 ? (fctsV / aa - 1) * 100 : -Infinity;
          };
          va = calc(a); vb = calc(b); break;
        }
        default: return 0;
      }
      if (typeof va === 'string' && typeof vb === 'string')
        return sortDir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR');
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, sortCol, sortDir]);

  // ── Family aggregates ───────────────────────────────────────────────────────

  const familyAggregated = useMemo(() => {
    const salesMap = new Map<string, number>();
    const orcMap   = new Map<string, number>();
    for (const prod of products) {
      prod.salesHistory.forEach(h => salesMap.set(h.month, (salesMap.get(h.month) ?? 0) + h.qty));
      prod.orcHistory.forEach(o => orcMap.set(o.month, (orcMap.get(o.month) ?? 0) + o.volumeORC));
    }
    const salesHistory = [...salesMap.entries()].sort().map(([month, qty]) => ({ month, qty }));
    const orcHistory   = [...orcMap.entries()].sort().map(([month, volumeORC]) => ({ month, volumeORC }));
    const last3 = salesHistory.slice(-3);
    const last6 = salesHistory.slice(-6);
    const avg = (arr: { qty: number }[]) =>
      arr.length ? Math.round(arr.reduce((s, h) => s + h.qty, 0) / arr.length) : null;
    return { salesHistory, orcHistory, avgTrim: avg(last3), avgSem: avg(last6), avg12m: avg(salesHistory) };
  }, [products]);

  const familyFctsHistory = useMemo(() => {
    const monthMap = new Map<string, number>();
    for (const prod of products) {
      if (prod.gestorExcluido) continue;
      for (const { month, fcts: f } of prod.fctsHistory) {
        monthMap.set(month, (monthMap.get(month) ?? 0) + f);
      }
    }
    return [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, fcts]) => ({ month, fcts }));
  }, [products]);

  // ── Aggregates ──────────────────────────────────────────────────────────────

  const groupORC = products.reduce(
    (s, p) => s + p.months.reduce((ms, m) => ms + (m.volumeORC ?? 0), 0), 0
  );
  const groupFCTS = products.reduce(
    (s, p) => s + p.months.reduce((ms, m) => ms + fctsValOf(m), 0), 0
  );
  // Desvio agregado simétrico: considera apenas meses-produto com A.A. > 0.
  // Meses sem venda no ano anterior são ignorados em ambos os lados para
  // não inflar o número (sazonalidade extrema / produtos novos).
  let groupVendaAA = 0;
  let groupFCTSForDesvio = 0;
  for (const p of products) {
    for (const m of p.months) {
      if (m.vendaAA != null && m.vendaAA > 0) {
        groupVendaAA += m.vendaAA;
        groupFCTSForDesvio += fctsValOf(m);
      }
    }
  }
  const desvioGrupo = groupVendaAA > 0 && groupFCTSForDesvio > 0
    ? ((groupFCTSForDesvio / groupVendaAA - 1) * 100) : null;
  const hasIA       = products.some(p => !p.gestorExcluido && p.months.some(m => m.volumeIA != null));

  // ── Progress badge ──────────────────────────────────────────────────────────

  const { filledCount, totalCount } = useMemo(() => {
    let filled = 0, total = 0;
    for (const prod of products) {
      if (prod.gestorExcluido) continue;
      total++;
      const allFilled = prod.months
        .filter(m => !m.gestorExcluido)
        .every(m => fctsFilledOf(m));
      if (allFilled) filled++;
    }
    return { filledCount: filled, totalCount: total };
  }, [products, fctsFilledOf]);

  // ── Preview handlers ────────────────────────────────────────────────────────

  const openPreview = useCallback((
    title: string,
    updates: Record<string, number>,
    makeLabel: (prod: AnnualProduct, updates: Record<string, number>) => string,
    auditContext: AuditContext,
    subtitle?: string,
  ) => {
    if (Object.keys(updates).length === 0) {
      onError(t('preview.noDataError'));
      return;
    }
    const rows = products
      .filter(p => !p.gestorExcluido)
      .map(prod => {
        const activeMonths = prod.months.filter(m => !m.gestorExcluido);
        const hasData = activeMonths.some(m => updates[m.itemId] != null);
        return buildPreviewRow(prod, updates, makeLabel(prod, updates), MESES_SHORT, !hasData);
      });
    setPreviewState({ title, subtitle, rows, allUpdates: updates, auditContext });
  }, [products, onError, t]);

  const handlePreviewAcceptIA = useCallback(() => {
    const updates = computeAcceptIA(products);
    const correlationId = generateUUID();
    openPreview(
      t('contextMenu.acceptIA'),
      updates,
      (prod) => `${fmt(prod.months.filter(m => !m.gestorExcluido).reduce((s, m) => s + (updates[m.itemId] ?? 0), 0))} ${t('preview.totalSuffix')}`,
      { operation: 'ACCEPT_IA_SUGGESTION', basis: 'AI_MODEL', correlationId },
    );
  }, [products, openPreview, t]);

  const handlePreviewFillAvg = useCallback((criterion: 'trim' | 'sem' | '12m' | 'aa') => {
    const updates = computeFillAverage(products, criterion);
    const criterionLabelKey = `preview.labels.${criterion}`;
    const operationMap: Record<string, string> = {
      trim: 'FILL_AVERAGE_TRIM',
      sem:  'FILL_AVERAGE_SEM',
      '12m':'FILL_AVERAGE_12M',
      aa:   'FILL_YEAR_OVER_YEAR',
    };
    const basisMap: Record<string, string> = {
      trim: 'HISTORICAL_SALES',
      sem:  'HISTORICAL_SALES',
      '12m':'HISTORICAL_SALES',
      aa:   'YEAR_OVER_YEAR',
    };
    const correlationId = generateUUID();
    openPreview(
      t('preview.fillTitle', { label: t(criterionLabelKey) }),
      updates,
      (prod) => {
        if (criterion === 'aa') {
          const total = prod.months.filter(m => !m.gestorExcluido).reduce((s, m) => s + (updates[m.itemId] ?? 0), 0);
          return `${fmt(total)} ${t('preview.totalSuffix')} (A.A.)`;
        }
        const avg = criterion === 'trim' ? prod.avgTrim : criterion === 'sem' ? prod.avgSem : prod.avg12m;
        return avg != null ? `${fmt(Math.round(avg))} ${t('preview.perMonth')}` : '—';
      },
      { operation: operationMap[criterion], basis: basisMap[criterion], correlationId },
    );
  }, [products, openPreview, t]);

  const handlePreviewSetValue = useCallback((value: number) => {
    const updates = computeSetValue(products, value);
    const correlationId = generateUUID();
    openPreview(
      t('contextMenu.fixedValue'),
      updates,
      () => `${fmt(value)} ${t('preview.perMonth')}`,
      { operation: 'SET_VALUE', fixedValue: value, correlationId },
    );
  }, [products, openPreview, t]);

  const handlePreviewDistribute = useCallback((total: number, criterion: DistributeCriterion) => {
    const updates = computeDistribute(products, total, criterion);
    if (!updates) {
      onError(t('preview.distributionError'));
      return;
    }
    const opMap: Record<DistributeCriterion, string> = {
      orc:  'DISTRIBUTE_TOTAL_ORC',
      trim: 'DISTRIBUTE_TOTAL_TRIM',
      sem:  'DISTRIBUTE_TOTAL_SEM',
      '12m':'DISTRIBUTE_TOTAL_12M',
      aa:   'DISTRIBUTE_TOTAL_AA',
    };
    const basisMap: Record<DistributeCriterion, string> = {
      orc:  'BUDGET',
      trim: 'PROPORTIONAL',
      sem:  'PROPORTIONAL',
      '12m':'PROPORTIONAL',
      aa:   'PROPORTIONAL_SEASONAL',
    };
    const correlationId = generateUUID();
    openPreview(
      t('preview.distributeTotalTitle', { label: t(CRITERIA_LABELS_KEYS[criterion]) }),
      updates,
      (prod) => {
        const prodTotal = prod.months.filter(m => !m.gestorExcluido)
          .reduce((s, m) => s + (updates[m.itemId] ?? 0), 0);
        return `${fmt(prodTotal)} ${t('preview.totalSuffix')}`;
      },
      { operation: opMap[criterion], basis: basisMap[criterion], totalVolume: total, correlationId },
      t('preview.distributeTotalSubtitle', { total: fmt(total) }),
    );
  }, [products, openPreview, onError, t]);

  const handlePreviewApplyPct = useCallback((pct: number, basis: 'IA' | 'ORC') => {
    const updates = computeApplyPercent(products, pct, basis);
    const correlationId = generateUUID();
    const basisLabel    = basis === 'IA' ? t('preview.basisIA') : t('preview.basisORC');
    const auditBasis    = basis === 'IA' ? 'AI_MODEL'    : 'BUDGET';
    openPreview(
      t('preview.applyPctTitle', { pct: `${pct > 0 ? '+' : ''}${pct}`, basis: basisLabel }),
      updates,
      (prod) => {
        const total = prod.months.filter(m => !m.gestorExcluido).reduce((s, m) => s + (updates[m.itemId] ?? 0), 0);
        return `${fmt(total)} ${t('preview.totalSuffix')}`;
      },
      { operation: 'APPLY_PERCENT', basis: auditBasis, percentageApplied: pct, correlationId },
      t('preview.applyPctSubtitle', { basis: basisLabel }),
    );
  }, [products, openPreview, t]);

  const handlePreviewRevert = useCallback(() => {
    const updates = computeRevertInitial(products);
    const correlationId = generateUUID();
    openPreview(
      t('contextMenu.revertChanges'),
      updates,
      (prod) => `${fmt(prod.months.filter(m => !m.gestorExcluido).reduce((s, m) => s + (updates[m.itemId] ?? 0), 0))} ${t('preview.totalSuffix')}`,
      { operation: 'REVERT_CHANGES', basis: 'INITIAL_OPEN_STATE', correlationId },
      t('preview.revertSubtitle'),
    );
  }, [products, openPreview, t]);

  const handlePreviewConfirm = useCallback(async (
    selectedIds: Set<string>,
    adjustedUpdates: Record<string, number>,
    wasRefined: boolean,
  ) => {
    if (!previewState) return;
    const selectedItemIds = new Set<string>(
      products
        .filter(p => selectedIds.has(p.produtoId))
        .flatMap(p => p.months.map(m => m.itemId)),
    );
    const filtered: Record<string, number> = {};
    for (const [id, v] of Object.entries(adjustedUpdates)) {
      if (selectedItemIds.has(id)) filtered[id] = v;
    }
    const ctx = wasRefined
      ? { ...previewState.auditContext, operation: 'PREVIEW_REFINEMENT' }
      : previewState.auditContext;
    setPreviewState(null);
    if (Object.keys(filtered).length > 0) await onSaveBulk(filtered, { ...ctx, affectedCount: Object.keys(filtered).length });
  }, [previewState, products, onSaveBulk]);

  // ── Toggle helpers ──────────────────────────────────────────────────────────

  const toggleMonths = (produtoId: string) =>
    setExpandedMonths(prev => {
      const next = new Set(prev);
      next.has(produtoId) ? next.delete(produtoId) : next.add(produtoId);
      return next;
    });

  const toggleHistory = (produtoId: string) =>
    setExpandedHistory(prev => {
      const next = new Set(prev);
      next.has(produtoId) ? next.delete(produtoId) : next.add(produtoId);
      return next;
    });

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {excludeTarget && (
        <ExcludeCountryModal
          produto={excludeTarget}
          paisNome={selectedCountryNome ?? selectedCountry ?? ''}
          onConfirm={(scope) => {
            onExclude(excludeTarget, scope);
            setExcludeTarget(null);
          }}
          onClose={() => setExcludeTarget(null)}
        />
      )}
      {previewState && (
        <BulkPreviewModal
          isOpen
          title={previewState.title}
          subtitle={previewState.subtitle}
          rows={previewState.rows}
          onConfirm={handlePreviewConfirm}
          onClose={() => setPreviewState(null)}
        />
      )}

      <div className="border border-slate-200 rounded-xl mb-2">

        {/* ── Family header ─────────────────────────────────────────────────── */}
        <div
          className="flex items-center gap-3 px-4 py-3 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors select-none rounded-t-xl"
          onClick={onToggle}
        >
          <div className="shrink-0 text-slate-400">
            {collapsed
              ? <ChevronRight className="w-4 h-4" />
              : <ChevronDown  className="w-4 h-4" />}
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="font-bold text-slate-800 text-sm truncate">{familia}</span>
            <span className="text-[10px] font-bold text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded-full shrink-0">
              {products.length} SKU{products.length !== 1 ? 's' : ''}
            </span>
            {/* Progress badge */}
            {totalCount > 0 && !consolidated && (
              <span className={cn(
                "text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0",
                filledCount === totalCount
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-200 text-slate-500",
              )}>
                {filledCount}/{totalCount}
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setShowFamilyDetail(v => !v); }}
              title={t('family.analyticsHint')}
              className={cn(
                "p-1 rounded transition-colors shrink-0",
                showFamilyDetail ? "text-sky-500 bg-sky-100" : "text-slate-400 hover:text-sky-500"
              )}
            >
              <BarChart2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-4 text-xs text-slate-500 shrink-0">
            <span>{t('columns.orc')} <span className="font-bold text-slate-700">{fmt(groupORC)}</span></span>
            <span>{t('columns.fcts')} <span className={cn(
              "font-bold",
              groupFCTS > 0 ? "text-slate-900" : "text-slate-400"
            )}>
              {groupFCTS > 0 ? fmt(groupFCTS) : '—'}
            </span></span>
            {desvioGrupo !== null && groupFCTSForDesvio > 0 && (
              <span
                title={t('columns.desvioFamilyHint')}
                className={cn(
                  "font-bold px-1.5 py-0.5 rounded text-[10px] cursor-help",
                  Math.abs(desvioGrupo) <= 5  ? "bg-emerald-100 text-emerald-700" :
                  Math.abs(desvioGrupo) <= 15 ? "bg-amber-100 text-amber-700"    :
                                                 "bg-red-100 text-red-700"
                )}
              >
                {desvioGrupo > 0 ? '+' : ''}{desvioGrupo.toFixed(1)}%
              </span>
            )}
          </div>

          {!isReadOnly && !consolidated && (
            <div className="shrink-0" onClick={e => e.stopPropagation()}>
              <ActionsDropdown
                hasIA={hasIA}
                isExportAllCountries={isExport && !selectedCountry}
                onPreviewAcceptIA={handlePreviewAcceptIA}
                onPreviewFillAvg={handlePreviewFillAvg}
                onPreviewSetValue={handlePreviewSetValue}
                onPreviewDistribute={handlePreviewDistribute}
                onPreviewApplyPct={handlePreviewApplyPct}
                onPreviewRevert={handlePreviewRevert}
              />
            </div>
          )}
        </div>

        {/* ── Painel analítico da família ──────────────────────────────────── */}
        {showFamilyDetail && (
          <FamilySalesDetail
            label={`${familia} — ${products.length} SKU${products.length !== 1 ? 's' : ''}`}
            avgTrim={familyAggregated.avgTrim}
            avgSem={familyAggregated.avgSem}
            avg12m={familyAggregated.avg12m}
            salesHistory={familyAggregated.salesHistory}
            orcHistory={familyAggregated.orcHistory}
            fctsHistory={familyFctsHistory}
          />
        )}

        {/* ── Products table ───────────────────────────────────────────────── */}
        {!collapsed && (
          <div className="overflow-x-auto rounded-b-xl">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-white text-slate-400 text-[10px] font-bold uppercase tracking-wider border-b border-slate-100">
                  <th className="w-8  px-3 py-3" />
                  <th className="px-4 py-3">
                    <button onClick={() => handleSort('codigo')} className={cn('inline-flex items-center gap-1 hover:text-slate-600 transition-colors', sortCol === 'codigo' && 'text-slate-600')}>
                      {t('columns.code')}<SortIcon col="codigo" active={sortCol} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button onClick={() => handleSort('descricao')} className={cn('inline-flex items-center gap-1 hover:text-slate-600 transition-colors', sortCol === 'descricao' && 'text-slate-600')}>
                      {t('columns.product')}<SortIcon col="descricao" active={sortCol} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-center">
                    <button onClick={() => handleSort('classe')} className={cn('inline-flex items-center justify-center gap-1 w-full hover:text-slate-600 transition-colors', sortCol === 'classe' && 'text-slate-600')}>
                      {t('columns.class')}<SortIcon col="classe" active={sortCol} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <button onClick={() => handleSort('orc')} className={cn('inline-flex items-center gap-1 hover:text-slate-600 transition-colors', sortCol === 'orc' && 'text-slate-600')}>
                        <SortIcon col="orc" active={sortCol} dir={sortDir} />{t('columns.orcTotal')}
                      </button>
                      <InfoTooltip text={t('columns.orcTotalHint')} position="bottom" textSize="text-[10px]" />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <button onClick={() => handleSort('fcts')} className={cn('inline-flex items-center gap-1 hover:text-slate-600 transition-colors', sortCol === 'fcts' && 'text-slate-600')}>
                        <SortIcon col="fcts" active={sortCol} dir={sortDir} />{t('columns.fctsTotal')}
                      </button>
                      <InfoTooltip text={t('columns.fctsTotalHint')} position="bottom" textSize="text-[10px]" />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <button onClick={() => handleSort('desvio')} className={cn('inline-flex items-center gap-1 hover:text-slate-600 transition-colors', sortCol === 'desvio' && 'text-slate-600')}>
                        <SortIcon col="desvio" active={sortCol} dir={sortDir} />{t('columns.deviation')}
                      </button>
                      <InfoTooltip text={t('columns.desvioHint')} position="bottom" textSize="text-[10px]" />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-center w-20" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sortedProducts.map((prod) => {
                  const prodORC  = prod.months.reduce((s, m) => s + (m.volumeORC ?? 0), 0);
                  const prodFCTSNum = prod.months.reduce((s, m) => s + fctsValOf(m), 0);
                  // Desvio simétrico: soma apenas meses com A.A. > 0 em ambos os lados.
                  // Meses sem venda no ano anterior são ignorados também no FCTS — evita
                  // inflar o desvio quando há sazonalidade extrema ou produto novo.
                  const monthsWithAA = prod.months.filter(m => m.vendaAA != null && m.vendaAA > 0);
                  const prodVendaAA = monthsWithAA.reduce((s, m) => s + (m.vendaAA ?? 0), 0);
                  const prodFCTSForDesvio = monthsWithAA.reduce((s, m) => s + fctsValOf(m), 0);
                  const prodDesvio = prodVendaAA > 0 && prodFCTSForDesvio > 0
                    ? ((prodFCTSForDesvio / prodVendaAA - 1) * 100) : null;
                  const desvioCoverage = monthsWithAA.length;
                  const desvioCoverageTotal = prod.months.length;
                  const excluded     = prod.gestorExcluido;
                  const monthsOpen   = expandedMonths.has(prod.produtoId);
                  const historyOpen  = expandedHistory.has(prod.produtoId);
                  const prodDirty    = !excluded && prod.months.some(m => isDirty(m.itemId));
                  const prodHasIA    = !excluded && prod.months.some(m => m.volumeIA != null);

                  return (
                    <React.Fragment key={prod.produtoId}>

                      {/* ── Product summary row ── */}
                      <tr className={cn(
                        "transition-colors",
                        excluded
                          ? "opacity-40 bg-red-50/30"
                          : prod.source === 'MANUAL'
                            ? "border-l-4 border-violet-400 bg-violet-50/30"
                            : prodDirty
                              ? "border-l-4 border-amber-300 bg-amber-50/40"
                              : monthsOpen
                                ? "bg-slate-50"
                                : "hover:bg-slate-50/60"
                      )}>

                        {/* Expand months toggle */}
                        <td className="w-8 px-3 py-2.5">
                          <button
                            onClick={() => !excluded && toggleMonths(prod.produtoId)}
                            disabled={excluded}
                            className={cn(
                              "p-0.5 rounded transition-colors",
                              excluded
                                ? "text-slate-200 cursor-not-allowed"
                                : monthsOpen
                                  ? "text-sky-500"
                                  : "text-slate-300 hover:text-sky-500"
                            )}
                            title={monthsOpen ? t('product.collapseMonths') : t('product.expandMonths')}
                          >
                            {monthsOpen
                              ? <ChevronDown  className="w-3.5 h-3.5" />
                              : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                        </td>

                        {/* Código */}
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className={cn(
                              "font-mono text-xs font-bold",
                              excluded ? "line-through text-slate-300" : "text-slate-400"
                            )}>
                              {prod.codigo}
                            </span>
                            {prod.source === 'MANUAL' && (
                              <span className="text-[9px] font-bold bg-violet-100 text-violet-600 px-1 py-0.5 rounded">
                                Manual
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Produto + history toggle */}
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => toggleHistory(prod.produtoId)}
                              className={cn(
                                "p-0.5 rounded transition-colors shrink-0",
                                historyOpen ? "text-sky-500" : "text-slate-300 hover:text-sky-500"
                              )}
                              title={historyOpen ? t('product.collapseSalesHistory') : t('product.viewSalesHistory')}
                            >
                              <BarChart2 className="w-3.5 h-3.5" />
                            </button>
                            <span className={cn(
                              "text-sm",
                              excluded ? "line-through text-slate-400" : "text-slate-800"
                            )}>
                              {prod.descricao}
                            </span>
                          </div>
                        </td>

                        {/* Classe */}
                        <td className="px-4 py-2.5 text-center">
                          {prod.classe ? (
                            <span className={cn(
                              "inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold border",
                              CLASSE_BADGE_COLORS[prod.classe] ?? 'bg-slate-100 text-slate-500 border-slate-200'
                            )}>
                              {prod.classe}
                            </span>
                          ) : <span className="text-slate-200">—</span>}
                        </td>

                        {/* ORC total */}
                        <td className="px-4 py-2.5 text-right text-sm text-slate-600 tabular-nums">
                          {excluded ? '—' : fmt(prodORC)}
                        </td>

                        {/* FCTS total */}
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {excluded ? '—' : (
                            <span className={cn(
                              "text-sm font-bold",
                              prodFCTSNum > 0 ? "text-slate-900" : "text-slate-300"
                            )}>
                              {prodFCTSNum > 0 ? fmt(prodFCTSNum) : '—'}
                            </span>
                          )}
                        </td>

                        {/* Desvio */}
                        <td className="px-4 py-2.5 text-right">
                          {!excluded && prodDesvio !== null ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className={cn(
                                "text-xs font-bold",
                                Math.abs(prodDesvio) <= 5  ? "text-emerald-600" :
                                Math.abs(prodDesvio) <= 15 ? "text-amber-600"   : "text-red-600"
                              )}>
                                {prodDesvio > 0 ? '+' : ''}{prodDesvio.toFixed(1)}%
                              </span>
                              {desvioCoverage < desvioCoverageTotal && (
                                <span
                                  title={t('columns.desvioCoverageHint', { covered: desvioCoverage, total: desvioCoverageTotal })}
                                  className="text-[10px] text-slate-400 cursor-help tabular-nums"
                                >
                                  {desvioCoverage}/{desvioCoverageTotal}
                                </span>
                              )}
                            </div>
                          ) : <span className="text-xs text-slate-300">—</span>}
                        </td>

                        {/* Actions */}
                        <td className="px-3 py-2.5 text-center w-20">
                          <div className="flex items-center justify-center gap-1">
                            {/* IA accept button per product */}
                            {!isReadOnly && !consolidated && !excluded && prodHasIA && (
                              <button
                                onClick={() => onProductAcceptIA(prod)}
                                className="p-1 rounded text-violet-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
                                title={t('product.acceptIAHint')}
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {!isReadOnly && !consolidated && !excluded && onCopyForecast && (
                              <button
                                onClick={() => onCopyForecast(prod)}
                                className="p-1 rounded text-slate-300 hover:text-sky-500 hover:bg-sky-50 transition-colors"
                                title={t('product.copyHint')}
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {!isReadOnly && !consolidated && (
                              excluded ? (
                                <button
                                  onClick={() => onRestore(prod)}
                                  className="p-1 rounded text-emerald-500 hover:bg-emerald-50 transition-colors"
                                  title={t('product.restoreHint')}
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    if (isExport && selectedCountry) {
                                      setExcludeTarget(prod);
                                    } else {
                                      onExclude(prod, 'all');
                                    }
                                  }}
                                  className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                  title={t('product.excludeHint')}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* ── Sales history chart ── */}
                      {historyOpen && !excluded && (
                        <ProductSalesDetail
                          item={adaptToItem(prod)}
                          colSpan={COL_COUNT}
                          fctsHistory={prod.fctsHistory}
                        />
                      )}

                      {/* ── Monthly FCTS sub-rows ── */}
                      {monthsOpen && !excluded && (
                        <MonthSubRows
                          months={prod.months}
                          fcts={fcts}
                          setFcts={setFcts}
                          isDirty={isDirty}
                          saveFCTS={saveFCTS}
                          savingId={savingId}
                          isReadOnly={isReadOnly || consolidated}
                          aggregated={consolidated}
                        />
                      )}

                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};
