import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown, ChevronRight, RotateCcw, Trash2, BarChart2, Zap, Sparkles,
  ArrowUp, ArrowDown, ArrowUpDown, Copy,
} from 'lucide-react';
import { cn, InfoTooltip } from '../shared/Common';
import { fmt, CLASSE_BADGE_COLORS } from '../../types/forecast';
import type { ForecastItem } from '../../types/forecast';
import type { AnnualProduct, AnnualMonthEntry } from '../../hooks/useAnnualForecastData';
import type { DistributeCriterion } from '../../hooks/useAnnualForecastData';
import { ProductSalesDetail } from './ProductSalesDetail';
import { FamilySalesDetail } from './FamilySalesDetail';
import { BulkPreviewModal } from './BulkPreviewModal';
import type { BulkPreviewRow, BulkPreviewMonthRow } from './BulkPreviewModal';
import { ExcludeCountryModal } from './ExcludeCountryModal';
import type { AuditContext } from '../../types/audit';
import { generateUUID } from '../../utils/uuid';

// ── Constants ─────────────────────────────────────────────────────────────────

const COL_COUNT = 8;

type SortCol = 'codigo' | 'descricao' | 'classe' | 'orc' | 'fcts' | 'desvio' | null;
type SortDir = 'asc' | 'desc';
const CLASSE_SORT_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };

const SortIcon: React.FC<{ col: NonNullable<SortCol>; active: SortCol; dir: SortDir }> = ({ col, active, dir }) => {
  if (active !== col) return <ArrowUpDown className="w-3 h-3 shrink-0" />;
  return dir === 'asc' ? <ArrowUp className="w-3 h-3 shrink-0" /> : <ArrowDown className="w-3 h-3 shrink-0" />;
};
function monthLabel(iso: string, months: string[]): string {
  const [y, m] = iso.split('-').map(Number);
  return `${months[m - 1]}/${String(y).slice(2)}`;
}

/** Adapts AnnualProduct to ForecastItem for ProductSalesDetail (chart/KPI row). */
function adaptToItem(prod: AnnualProduct): ForecastItem {
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

// ── Preview compute helpers ───────────────────────────────────────────────────

function buildPreviewRow(
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

function computeAcceptIA(products: AnnualProduct[]): Record<string, number> {
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

function computeFillAverage(
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

function computeDistribute(
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

function computeSetValue(products: AnnualProduct[], value: number): Record<string, number> {
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

function computeApplyPercent(
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
function computeRevertInitial(products: AnnualProduct[]): Record<string, number> {
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

// ── Actions dropdown ──────────────────────────────────────────────────────────

type InlineMode = 'value' | 'distribute' | 'percent' | null;

const CRITERIA_LABELS_KEYS: Record<DistributeCriterion, string> = {
  trim: 'columns.trim',
  sem:  'columns.sem',
  '12m':'columns.avg12m',
  orc:  'columns.orc',
  aa:   'columns.yoy',
};

interface ActionsDropdownProps {
  hasIA:                  boolean;
  isExportAllCountries:   boolean;
  onPreviewAcceptIA:   () => void;
  onPreviewFillAvg:    (c: 'trim' | 'sem' | '12m' | 'aa') => void;
  onPreviewSetValue:   (v: number) => void;
  onPreviewDistribute: (total: number, c: DistributeCriterion) => void;
  onPreviewApplyPct:   (pct: number, basis: 'IA' | 'ORC') => void;
  onPreviewRevert:     () => void;
}

const ActionsDropdown: React.FC<ActionsDropdownProps> = ({
  hasIA, isExportAllCountries,
  onPreviewAcceptIA, onPreviewFillAvg, onPreviewSetValue,
  onPreviewDistribute, onPreviewApplyPct, onPreviewRevert,
}) => {
  const { t } = useTranslation('forecast');
  const [open,        setOpen]        = useState(false);
  const [inlineMode,  setInlineMode]  = useState<InlineMode>(null);
  const [valueInput,  setValueInput]  = useState('');
  const [pctInput,    setPctInput]    = useState('');
  const [pctBasis,    setPctBasis]    = useState<'IA' | 'ORC'>('IA');
  const [distTotal,   setDistTotal]   = useState('');
  const [distCrit,    setDistCrit]    = useState<DistributeCriterion>('aa');
  const [dropPos,     setDropPos]     = useState<{ top?: number; bottom?: number; right: number } | null>(null);

  const triggerRef  = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setOpen(false);
        setInlineMode(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const right = window.innerWidth - rect.right;
      const APPROX_HEIGHT = 420;
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow >= APPROX_HEIGHT || spaceBelow >= rect.top) {
        setDropPos({ top: rect.bottom + 4, right });
      } else {
        setDropPos({ bottom: window.innerHeight - rect.top + 4, right });
      }
    }
    setOpen(v => !v);
    setInlineMode(null);
  };

  const close = () => { setOpen(false); setInlineMode(null); };

  const menuItem = (
    label: React.ReactNode,
    onClick: () => void,
    disabled = false,
    tooltip?: string,
  ) => (
    <button
      disabled={disabled}
      title={tooltip}
      onClick={() => { if (!disabled) { onClick(); } }}
      className={cn(
        'w-full text-left px-4 py-1.5 text-xs hover:bg-slate-50 transition-colors',
        disabled ? 'opacity-40 cursor-not-allowed' : 'text-slate-700 cursor-pointer',
      )}
    >
      {label}
    </button>
  );

  const section = (label: string) => (
    <div className="px-4 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-t border-slate-100 mt-1 pt-2">
      {label}
    </div>
  );

  return (
    <div onClick={e => e.stopPropagation()}>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className={cn(
          'flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors',
          open
            ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
            : 'bg-white text-emerald-600 border-emerald-200 hover:bg-emerald-50',
        )}
      >
        <Zap className="w-3 h-3" />
        {t('contextMenu.actions')}
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && dropPos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', ...dropPos }}
          className="w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-[200] py-1.5"
          onClick={e => e.stopPropagation()}
        >

          {/* Aceitar sugestão IA */}
          {menuItem(
            <span className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              {t('contextMenu.acceptIA')}
              {!hasIA && <span className="ml-auto text-[9px] text-slate-300">{t('contextMenu.noIAData')}</span>}
            </span>,
            () => { onPreviewAcceptIA(); close(); },
            !hasIA,
            t('contextMenu.acceptIAHint'),
          )}

          {section(t('contextMenu.fillWith'))}

          {menuItem(t('contextMenu.fillAvg3'), () => { onPreviewFillAvg('trim'); close(); }, isExportAllCountries,
            isExportAllCountries ? t('contextMenu.requiresCountryFilter') : t('contextMenu.fillAvg3Hint'))}
          {menuItem(t('contextMenu.fillAvg6'), () => { onPreviewFillAvg('sem');  close(); }, isExportAllCountries,
            isExportAllCountries ? t('contextMenu.requiresCountryFilter') : t('contextMenu.fillAvg6Hint'))}
          {menuItem(t('contextMenu.fillAvg12'), () => { onPreviewFillAvg('12m'); close(); }, isExportAllCountries,
            isExportAllCountries ? t('contextMenu.requiresCountryFilter') : t('contextMenu.fillAvg12Hint'))}
          {menuItem(t('contextMenu.fillYoY'), () => { onPreviewFillAvg('aa'); close(); }, isExportAllCountries,
            isExportAllCountries ? t('contextMenu.requiresCountryFilter') : t('contextMenu.fillYoYHint'))}

          {/* Valor fixo inline */}
          <div className="px-4 py-1">
            {inlineMode === 'value' ? (
              <div className="space-y-1.5 mt-0.5 mb-1">
                <input
                  autoFocus
                  type="number" min="0"
                  className="w-full text-xs px-2 py-1 border border-sky-300 rounded-lg outline-none focus:ring-1 focus:ring-sky-400"
                  value={valueInput}
                  placeholder={t('contextMenu.fixedValuePlaceholder')}
                  onChange={e => setValueInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const v = parseInt(valueInput, 10);
                      if (!isNaN(v) && v >= 0) { onPreviewSetValue(v); setValueInput(''); close(); }
                    }
                    if (e.key === 'Escape') setInlineMode(null);
                  }}
                />
                <button
                  onClick={() => {
                    const v = parseInt(valueInput, 10);
                    if (!isNaN(v) && v >= 0) { onPreviewSetValue(v); setValueInput(''); close(); }
                  }}
                  className="w-full text-[10px] font-bold text-emerald-600 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors"
                >
                  {t('contextMenu.viewPreview')}
                </button>
              </div>
            ) : (
              <button
                title={t('contextMenu.fixedValueHint')}
                onClick={() => setInlineMode('value')}
                className="w-full text-left text-xs text-slate-700 hover:text-emerald-600 py-0.5 transition-colors"
              >
                {t('contextMenu.fixedValueBtn')}
              </button>
            )}
          </div>

          {section(t('contextMenu.distribution'))}

          {/* Distribuir total inline */}
          <div className="px-4 py-1">
            {inlineMode === 'distribute' ? (
              <div className="space-y-1.5 mb-1">
                <input
                  autoFocus
                  type="number" min="0"
                  className="w-full text-xs px-2 py-1 border border-violet-300 rounded-lg outline-none focus:ring-1 focus:ring-violet-400"
                  value={distTotal}
                  placeholder={t('contextMenu.distributePlaceholder')}
                  onChange={e => setDistTotal(e.target.value)}
                />
                <select
                  value={isExportAllCountries && distCrit === 'aa' ? 'orc' : distCrit}
                  onChange={e => setDistCrit(e.target.value as DistributeCriterion)}
                  className="w-full text-xs px-2 py-1 border border-violet-300 rounded-lg outline-none bg-white focus:ring-1 focus:ring-violet-400 cursor-pointer"
                >
                  {(Object.entries(CRITERIA_LABELS_KEYS) as [DistributeCriterion, string][])
                    .filter(([k]) => !(isExportAllCountries && k === 'aa'))
                    .map(([k, v]) => (
                      <option key={k} value={k}>{t(v)}</option>
                    ))}
                </select>
                {isExportAllCountries && (
                  <p className="text-[10px] text-amber-600">{t('contextMenu.distributeAaRequiresCountry')}</p>
                )}
                <button
                  onClick={() => {
                    const total = parseInt(distTotal, 10);
                    if (!isNaN(total) && total > 0) { onPreviewDistribute(total, distCrit); setDistTotal(''); close(); }
                  }}
                  className="w-full text-[10px] font-bold text-emerald-600 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors"
                >
                  {t('contextMenu.viewPreview')}
                </button>
              </div>
            ) : (
              <button
                title={t('contextMenu.distributeTotalHint')}
                onClick={() => setInlineMode('distribute')}
                className="w-full text-left text-xs text-slate-700 hover:text-emerald-600 py-0.5 transition-colors"
              >
                {t('contextMenu.distributeTotalBtn')}
              </button>
            )}
          </div>

          {/* Ajustar % inline */}
          <div className="px-4 py-1">
            {inlineMode === 'percent' ? (
              <div className="space-y-1.5 mb-1">
                {/* Seletor de base */}
                <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setPctBasis('IA')}
                    disabled={!hasIA}
                    title={hasIA ? t('contextMenu.applyPctOver') : t('contextMenu.noIAData')}
                    className={cn(
                      'flex-1 px-2 py-1 transition-colors',
                      pctBasis === 'IA' && hasIA
                        ? 'bg-violet-600 text-white'
                        : !hasIA
                          ? 'bg-slate-50 text-slate-300 cursor-not-allowed'
                          : 'bg-white text-slate-500 hover:bg-slate-50',
                    )}
                  >
                    {t('contextMenu.basisIA')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPctBasis('ORC')}
                    title={`${t('contextMenu.applyPctOver')} ${t('columns.orc')}`}
                    className={cn(
                      'flex-1 px-2 py-1 border-l border-slate-200 transition-colors',
                      pctBasis === 'ORC'
                        ? 'bg-sky-600 text-white'
                        : 'bg-white text-slate-500 hover:bg-slate-50',
                    )}
                  >
                    {t('contextMenu.basisORC')}
                  </button>
                </div>
                <input
                  autoFocus
                  type="number"
                  className="w-full text-xs px-2 py-1 border border-emerald-300 rounded-lg outline-none focus:ring-1 focus:ring-emerald-400"
                  value={pctInput}
                  placeholder={t('contextMenu.pctPlaceholder')}
                  onChange={e => setPctInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const p = parseFloat(pctInput);
                      if (!isNaN(p)) { onPreviewApplyPct(p, pctBasis); setPctInput(''); close(); }
                    }
                    if (e.key === 'Escape') setInlineMode(null);
                  }}
                />
                <button
                  onClick={() => {
                    const p = parseFloat(pctInput);
                    if (!isNaN(p)) { onPreviewApplyPct(p, pctBasis); setPctInput(''); close(); }
                  }}
                  className="w-full text-[10px] font-bold text-emerald-600 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors"
                >
                  {t('contextMenu.viewPreview')}
                </button>
              </div>
            ) : (
              <button
                title={t('contextMenu.applyPctHint')}
                onClick={() => {
                  if (!hasIA) setPctBasis('ORC');
                  setInlineMode('percent');
                }}
                className="w-full text-left text-xs text-slate-700 hover:text-emerald-600 py-0.5 transition-colors"
              >
                {t('contextMenu.applyPctBtn')}
              </button>
            )}
          </div>

          {section(t('contextMenu.other'))}

          {menuItem(
            <span className="flex items-center gap-2 text-amber-700">
              <RotateCcw className="w-3.5 h-3.5 shrink-0" />
              {t('contextMenu.revertChanges')}
            </span>,
            () => { onPreviewRevert(); close(); },
            false,
            t('contextMenu.revertChangesHint'),
          )}
        </div>,
        document.body,
      )}
    </div>
  );
};

// ── Month sub-rows ─────────────────────────────────────────────────────────────

interface MonthSubRowsProps {
  months:     AnnualMonthEntry[];
  fcts:       Record<string, string>;
  setFcts:    React.Dispatch<React.SetStateAction<Record<string, string>>>;
  isDirty:    (itemId: string) => boolean;
  saveFCTS:   (itemId: string) => void;
  savingId:   string | null;
  isReadOnly: boolean;
  aggregated?: boolean;
}

const MonthSubRows: React.FC<MonthSubRowsProps> = ({
  months, fcts, setFcts, isDirty, saveFCTS, savingId, isReadOnly, aggregated = false,
}) => {
  const { t } = useTranslation('forecast');
  const MESES_SHORT = t('months', { ns: 'common', returnObjects: true }) as string[];
  return (
  <tr>
    <td colSpan={COL_COUNT} className="p-0 border-b border-sky-100">
      <table className="w-full text-left">
        <thead>
          <tr className="bg-sky-50/70 text-slate-400 text-[10px] font-bold uppercase tracking-wider border-b border-sky-100">
            <th className="px-6 py-2 w-20">{t('columns.month')}</th>
            <th className="px-4 py-2 text-right">
              <span className="inline-flex items-center gap-1 justify-end">
                {t('columns.orc')}
                <InfoTooltip text={t('columns.orcHint')} position="bottom" textSize="text-[10px]" />
              </span>
            </th>
            <th className="px-4 py-2 text-right">
              <span className="inline-flex items-center gap-1 justify-end">
                {t('columns.ia')}
                <InfoTooltip text={t('columns.iaHint')} position="bottom" textSize="text-[10px]" />
              </span>
            </th>
            <th className="px-4 py-2 text-right">
              <span className="inline-flex items-center gap-1 justify-end">
                {t('columns.yoy')}
                <InfoTooltip text={t('columns.yoyHint')} position="bottom" width="w-56" textSize="text-[10px]" />
              </span>
            </th>
            <th className="px-4 py-2 text-right w-44">
              <span className="inline-flex items-center gap-1 justify-end">
                {t('columns.fcts')}
                <InfoTooltip text={t('columns.fctsHint')} position="bottom" textSize="text-[10px]" />
              </span>
            </th>
            <th className="px-4 py-2 text-right">
              <span className="inline-flex items-center gap-1 justify-end">
                {t('columns.deviation')}
                <InfoTooltip text={t('columns.desvioMonthHint')} position="bottom" textSize="text-[10px]" />
              </span>
            </th>
            <th className="w-8 px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-sky-50">
          {aggregated && (
            <tr className="bg-indigo-50/40 border-b border-indigo-100">
              <td colSpan={7} className="px-6 py-2 text-[11px] text-indigo-600 font-medium">
                {t('consolidatedView.editHint')}
              </td>
            </tr>
          )}
          {months.map((m, idx) => {
            // Consolidado: valor efetivo já somado em override (read-only).
            // Edição por país: valor vem do estado editável `fcts`.
            const fctsVal   = aggregated ? (m.override?.volumeFCTS ?? 0) : Number(fcts[m.itemId] ?? '');
            const hasFcts   = aggregated ? (m.override != null) : !!fcts[m.itemId];
            const cellDirty = !aggregated && isDirty(m.itemId);

            const vendaAA = m.vendaAA;
            const desvio =
              vendaAA != null && vendaAA > 0 && !isNaN(fctsVal) && hasFcts
                ? ((fctsVal / vendaAA - 1) * 100) : null;
            const deltaVendaAA = desvio;

            return (
              <tr
                key={m.itemId}
                className={cn(
                  "transition-colors text-sm",
                  cellDirty
                    ? "bg-amber-50/60"
                    : idx % 2 === 0 ? "bg-white" : "bg-sky-50/20"
                )}
              >
                {/* Mês */}
                <td className="px-6 py-1.5 font-mono text-xs font-semibold text-slate-500 w-20">
                  {monthLabel(m.month, MESES_SHORT)}
                  {m.paisIso3 && (
                    <span className="ml-1 text-[9px] font-bold text-indigo-400 bg-indigo-50 px-1 py-0.5 rounded">
                      {m.paisIso3}
                    </span>
                  )}
                </td>

                {/* ORC */}
                <td className="px-4 py-1.5 text-right text-slate-600 tabular-nums">
                  {fmt(m.volumeORC)}
                </td>

                {/* Sugestão IA */}
                <td className="px-4 py-1.5 text-right text-slate-500 tabular-nums">
                  {fmt(m.volumeIA)}
                </td>

                {/* Venda A.A. */}
                <td className="px-4 py-1.5 text-right tabular-nums">
                  {vendaAA != null ? (
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-slate-600">{fmt(vendaAA)}</span>
                      {deltaVendaAA != null && (
                        <span className={cn("text-[10px] font-bold",
                          deltaVendaAA > 0 ? "text-amber-600" :
                          deltaVendaAA < 0 ? "text-rose-500" : "text-slate-400"
                        )}>
                          {deltaVendaAA > 0 ? '▲ +' : '▼ '}{Math.abs(deltaVendaAA).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  ) : <span className="text-slate-300 text-xs">—</span>}
                </td>

                {/* FCTS input */}
                <td className="px-4 py-1.5 text-right">
                  {isReadOnly ? (
                    <span className="text-sm font-bold text-slate-900">
                      {fmt(m.override?.volumeFCTS ?? null)}
                    </span>
                  ) : (
                    <input
                      data-fcts-input
                      type="text"
                      inputMode="numeric"
                      className={cn(
                        "w-32 text-right px-3 py-1 border rounded-lg text-sm outline-none focus:ring-2 bg-white transition-colors",
                        cellDirty
                          ? "border-amber-300 focus:ring-amber-400"
                          : "border-slate-200 focus:ring-sky-500"
                      )}
                      value={fcts[m.itemId] ?? ''}
                      onChange={(e) => setFcts(prev => ({
                        ...prev,
                        [m.itemId]: e.target.value.replace(/[^\d]/g, ''),
                      }))}
                      onBlur={() => saveFCTS(m.itemId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          saveFCTS(m.itemId);
                          const all = Array.from(
                            document.querySelectorAll<HTMLInputElement>('[data-fcts-input]')
                          );
                          const i = all.indexOf(e.currentTarget);
                          all[i + 1]?.focus();
                        }
                      }}
                      onFocus={(e) => e.target.select()}
                      placeholder="0"
                    />
                  )}
                </td>

                {/* Desvio */}
                <td className="px-4 py-1.5 text-right">
                  {desvio !== null ? (
                    <span className={cn(
                      "text-xs font-bold",
                      Math.abs(desvio) <= 5  ? "text-emerald-600" :
                      Math.abs(desvio) <= 15 ? "text-amber-600"   : "text-red-600"
                    )}>
                      {desvio > 0 ? '+' : ''}{desvio.toFixed(1)}%
                    </span>
                  ) : <span className="text-xs text-slate-300">—</span>}
                </td>

                {/* Saving indicator */}
                <td className="px-4 py-1.5 text-center w-8">
                  {savingId === m.itemId && (
                    <span className="text-[10px] text-sky-500 animate-pulse">...</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </td>
  </tr>
  );
};

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
