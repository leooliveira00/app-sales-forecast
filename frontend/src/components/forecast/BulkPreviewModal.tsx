import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight, ChevronDown, X, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn, InfoTooltip } from '../shared/Common';
import { DeltaBadge } from '../shared/Common';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface BulkPreviewMonthRow {
  itemId:    string;
  month:     string;        // "YYYY-MM"
  label:     string;        // "Jan/26"
  newValue:  number;
  orc:       number | null;
  prevFcts:  number | null;
  vendaAA:   number | null;
  paisIso3?: string | null; // preenchido para unidades EXPORT
}

export interface BulkPreviewRow {
  produtoId:      string;
  codigo:         string;
  descricao:      string;
  classe?:        string;
  newTotal:       number;
  valueLabel:     string;
  monthsCount:    number;
  orcTotal:       number | null;
  prevFctsTotal:  number | null;
  vendaAATotal:   number | null;
  months:         BulkPreviewMonthRow[];
  noData?:        boolean;
}

interface BulkPreviewModalProps {
  isOpen:            boolean;
  title:             string;
  subtitle?:         string;
  rows:              BulkPreviewRow[];
  confirmLabel?:     string;
  valueColumnLabel?: string;
  onConfirm:         (selectedIds: Set<string>, adjustedUpdates: Record<string, number>, wasRefined: boolean) => void;
  onClose:           () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (v: number | null): string =>
  v == null ? '—' : v.toLocaleString('pt-BR');

const deltaPct = (newVal: number, ref: number | null): number | null => {
  if (ref == null || ref === 0) return null;
  return ((newVal / ref) - 1) * 100;
};

const ColHeader: React.FC<{ label: string; tooltip: string; right?: boolean }> = ({ label, tooltip, right }) => (
  <span className={cn('inline-flex items-center gap-1', right && 'justify-end')}>
    {label}
    <InfoTooltip text={tooltip} position="bottom" textSize="text-[10px]" width="w-56" />
  </span>
);

// ── Popover de refinamento ────────────────────────────────────────────────────

interface RefinePopoverProps {
  selectedCount: number;
  adjustDirty:   boolean;
  onApplyPct:    (pct: number) => void;
  onReset:       () => void;
}

const PRESETS = [-10, -5, +5, +10] as const;

const RefinePopover: React.FC<RefinePopoverProps> = ({ selectedCount, adjustDirty, onApplyPct, onReset }) => {
  const { t } = useTranslation('forecast');
  const [open,      setOpen]      = useState(false);
  const [customPct, setCustomPct] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const applyCustom = () => {
    const n = parseFloat(customPct);
    if (!isNaN(n)) { onApplyPct(n); setCustomPct(''); setOpen(false); }
  };

  const applyPreset = (pct: number) => { onApplyPct(pct); setOpen(false); };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors',
          open
            ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
            : adjustDirty
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
        )}
        title={t('modal.refine.buttonHint')}
      >
        <SlidersHorizontal size={13} />
        {t('modal.refine.button')}
        {adjustDirty && (
          <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-[60] overflow-hidden">

          {/* Cabeçalho do popover */}
          <div className="px-4 pt-3 pb-2 border-b border-slate-100">
            <p className="text-xs font-bold text-slate-800">{t('modal.refine.title')}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {t('modal.refine.subtitle', { count: selectedCount })}
            </p>
          </div>

          {/* Presets */}
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{t('modal.refine.shortcuts')}</p>
            <div className="grid grid-cols-4 gap-1.5">
              {PRESETS.map(pct => (
                <button
                  key={pct}
                  onClick={() => applyPreset(pct)}
                  disabled={selectedCount === 0}
                  className="py-1.5 text-[11px] font-bold rounded-lg bg-slate-50 border border-slate-200 text-slate-700 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {pct > 0 ? '+' : ''}{pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Campo personalizado */}
          <div className="px-4 py-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{t('modal.refine.custom')}</p>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  autoFocus
                  type="number"
                  value={customPct}
                  onChange={e => setCustomPct(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && applyCustom()}
                  placeholder={t('modal.refine.customPlaceholder')}
                  className="w-full text-xs px-2 py-1.5 pr-6 border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-emerald-400 focus:border-emerald-300"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">%</span>
              </div>
              <button
                onClick={applyCustom}
                disabled={customPct === '' || selectedCount === 0}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {t('modal.refine.apply')}
              </button>
            </div>
          </div>

          {/* Reverter — só aparece quando dirty */}
          {adjustDirty && (
            <div className="px-4 pb-3">
              <button
                onClick={() => { onReset(); setOpen(false); }}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <RotateCcw size={11} />
                {t('modal.refine.revert')}
              </button>
            </div>
          )}

        </div>
      )}
    </div>
  );
};

// ── Modal principal ───────────────────────────────────────────────────────────

export const BulkPreviewModal: React.FC<BulkPreviewModalProps> = ({
  isOpen, title, subtitle, rows,
  confirmLabel,
  valueColumnLabel,
  onConfirm, onClose,
}) => {
  const { t } = useTranslation('forecast');
  const resolvedConfirmLabel     = confirmLabel     ?? t('modal.apply');
  const resolvedValueColumnLabel = valueColumnLabel ?? t('modal.valueApplied');
  const [selected,     setSelected]    = useState<Set<string>>(new Set());
  const [expanded,     setExpanded]    = useState<Set<string>>(new Set());
  const [localUpdates, setLocalUpdates]= useState<Record<string, number>>({});
  const origUpdates = useRef<Record<string, number>>({});
  const [adjustDirty,  setAdjustDirty] = useState(false);
  // Buffer de digitação por célula: só comita em localUpdates no blur
  const [editBuffer,   setEditBuffer]  = useState<Record<string, string>>({});

  useEffect(() => {
    const init: Record<string, number> = {};
    for (const row of rows) {
      for (const m of row.months) init[m.itemId] = m.newValue;
    }
    origUpdates.current = init;
    setLocalUpdates(init);
    setSelected(new Set(rows.filter(r => !r.noData).map(r => r.produtoId)));
    setExpanded(new Set());
    setAdjustDirty(false);
    setEditBuffer({});
  }, [rows]);

  const handleMonthEdit = useCallback((itemId: string, raw: string) => {
    setEditBuffer(prev => ({ ...prev, [itemId]: raw.replace(/[^\d]/g, '') }));
  }, []);

  const commitMonthEdit = useCallback((itemId: string) => {
    setEditBuffer(prev => {
      const raw = prev[itemId];
      if (raw !== undefined) {
        const v = parseInt(raw, 10);
        if (!isNaN(v) && v >= 0) {
          setLocalUpdates(u => ({ ...u, [itemId]: v }));
          setAdjustDirty(true);
        }
        const next = { ...prev };
        delete next[itemId];
        return next;
      }
      return prev;
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectAll  = useCallback(() => setSelected(new Set(rows.filter(r => !r.noData).map(r => r.produtoId))), [rows]);
  const selectNone = useCallback(() => setSelected(new Set()), []);

  const applyPct = useCallback((pct: number) => {
    if (isNaN(pct)) return;
    setLocalUpdates(prev => {
      const next = { ...prev };
      for (const row of rows) {
        if (!selected.has(row.produtoId)) continue;
        for (const m of row.months) {
          next[m.itemId] = Math.max(0, Math.round((prev[m.itemId] ?? 0) * (1 + pct / 100)));
        }
      }
      return next;
    });
    setAdjustDirty(true);
  }, [rows, selected]);

  const resetToOriginal = useCallback(() => {
    setLocalUpdates(origUpdates.current);
    setAdjustDirty(false);
  }, []);

  const hasORC      = rows.some(r => r.orcTotal      != null);
  const hasPrevFcts = rows.some(r => r.prevFctsTotal != null);
  const hasVendaAA  = rows.some(r => r.vendaAATotal  != null);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-5xl w-full max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between px-6 pt-5 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
            {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X size={18} />
          </button>
        </div>

        {/* ── Sub-header: seleção + refinamento ───────────────────────────── */}
        <div className="flex items-center gap-3 px-6 py-2 bg-slate-50 border-b border-slate-100 text-xs text-slate-500">
          <button onClick={selectAll}  className="underline hover:text-slate-700">{t('modal.selectAll')}</button>
          <button onClick={selectNone} className="underline hover:text-slate-700">{t('modal.selectNone')}</button>

          <span className="ml-auto">
            {t('modal.selectedCount', { count: selected.size, total: rows.filter(r => !r.noData).length })}
            {adjustDirty && (
              <span className="ml-2 text-emerald-600 font-semibold">{t('modal.adjusted')}</span>
            )}
          </span>

          <RefinePopover
            selectedCount={selected.size}
            adjustDirty={adjustDirty}
            onApplyPct={applyPct}
            onReset={resetToOriginal}
          />
        </div>

        {/* ── Tabela ──────────────────────────────────────────────────────── */}
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <th className="w-8 px-2 py-2" />
                <th className="w-8 px-2 py-2" />
                <th className="text-left px-3 py-2 font-medium">{t('columns.code')}</th>
                <th className="text-left px-3 py-2 font-medium">{t('columns.product')}</th>
                <th className="text-right px-3 py-2 font-medium">
                  <ColHeader right label={t('modal.columns.months')} tooltip={t('modal.columns.monthsHint')} />
                </th>
                <th className="text-right px-3 py-2 font-medium text-sky-700">
                  <ColHeader right label={resolvedValueColumnLabel} tooltip={t('modal.columns.valueHint')} />
                </th>
                {hasORC && (
                  <th className="text-right px-3 py-2 font-medium">
                    <ColHeader right label={t('columns.orc')} tooltip={t('modal.columns.orcHint')} />
                  </th>
                )}
                {hasORC && (
                  <th className="text-right px-3 py-2 font-medium">
                    <ColHeader right label={t('modal.columns.deltaOrc')} tooltip={t('modal.columns.deltaOrcHint')} />
                  </th>
                )}
                {hasPrevFcts && (
                  <th className="text-right px-3 py-2 font-medium">
                    <ColHeader right label={t('modal.columns.prevCycle')} tooltip={t('modal.columns.prevCycleHint')} />
                  </th>
                )}
                {hasPrevFcts && (
                  <th className="text-right px-3 py-2 font-medium">
                    <ColHeader right label={t('modal.columns.deltaCycle')} tooltip={t('modal.columns.deltaCycleHint')} />
                  </th>
                )}
                {hasVendaAA && (
                  <th className="text-right px-3 py-2 font-medium">
                    <ColHeader right label={t('columns.yoy')} tooltip={t('modal.columns.yoySalesHint')} />
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(row => {
                const isExpanded = expanded.has(row.produtoId);
                const isSelected = selected.has(row.produtoId);
                const currentTotal = row.months.reduce(
                  (s, m) => s + (localUpdates[m.itemId] ?? m.newValue), 0,
                );

                return (
                  <React.Fragment key={row.produtoId}>
                    <tr className={cn(
                      'hover:bg-slate-50/80 transition-colors',
                      row.noData && 'opacity-50',
                    )}>
                      <td className="px-2 py-2 text-center">
                        <button
                          onClick={() => toggleExpand(row.produtoId)}
                          className="text-slate-400 hover:text-slate-600"
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!!row.noData}
                          onChange={() => toggleSelect(row.produtoId)}
                          className="accent-sky-600 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-500">{row.codigo}</td>
                      <td className="px-3 py-2">
                        <span className="text-slate-800 font-medium">{row.descricao}</span>
                        {row.classe && (
                          <span className="ml-1.5 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                            {row.classe}
                          </span>
                        )}
                        {row.noData && (
                          <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">
                            {t('modal.noData')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">{row.monthsCount}</td>
                      <td className="px-3 py-2 text-right">
                        <span className="font-semibold text-sky-700">{fmt(currentTotal)}</span>
                        {adjustDirty && row.valueLabel && (
                          <div className="text-[10px] text-slate-400 mt-0.5">{row.valueLabel}</div>
                        )}
                      </td>
                      {hasORC && (
                        <td className="px-3 py-2 text-right text-slate-500">{fmt(row.orcTotal)}</td>
                      )}
                      {hasORC && (
                        <td className="px-3 py-2 text-right">
                          {deltaPct(currentTotal, row.orcTotal) != null
                            ? <DeltaBadge value={deltaPct(currentTotal, row.orcTotal)!} />
                            : <span className="text-slate-300">—</span>}
                        </td>
                      )}
                      {hasPrevFcts && (
                        <td className="px-3 py-2 text-right text-slate-500">{fmt(row.prevFctsTotal)}</td>
                      )}
                      {hasPrevFcts && (
                        <td className="px-3 py-2 text-right">
                          {deltaPct(currentTotal, row.prevFctsTotal) != null
                            ? <DeltaBadge value={deltaPct(currentTotal, row.prevFctsTotal)!} />
                            : <span className="text-slate-300">—</span>}
                        </td>
                      )}
                      {hasVendaAA && (
                        <td className="px-3 py-2 text-right text-slate-500">{fmt(row.vendaAATotal)}</td>
                      )}
                    </tr>

                    {isExpanded && row.months.map(m => {
                      const mVal = localUpdates[m.itemId] ?? m.newValue;
                      // Enquanto editando: mostra o buffer; caso contrário o valor salvo
                      const displayVal = editBuffer[m.itemId] ?? String(mVal);
                      return (
                        <tr key={m.itemId} className="bg-slate-50/60 text-[11px] text-slate-600">
                          <td /><td />
                          <td className="pl-10 pr-3 py-1.5 text-slate-400 font-medium">
                            <span className="flex items-center gap-1.5">
                              {m.label}
                              {m.paisIso3 && (
                                <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 border border-indigo-100 px-1 py-0.5 rounded">
                                  {m.paisIso3}
                                </span>
                              )}
                            </span>
                          </td>
                          <td /><td />
                          <td className="px-3 py-1">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={displayVal}
                              onChange={e => handleMonthEdit(m.itemId, e.target.value)}
                              onBlur={() => commitMonthEdit(m.itemId)}
                              onFocus={e => e.target.select()}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  commitMonthEdit(m.itemId);
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                              className="w-24 text-right px-2 py-0.5 border border-slate-200 rounded-md text-xs font-semibold text-sky-700 outline-none focus:ring-1 focus:ring-sky-400 focus:border-sky-300 bg-white tabular-nums transition-colors"
                            />
                          </td>
                          {hasORC && (
                            <td className="px-3 py-1.5 text-right text-slate-400">{fmt(m.orc)}</td>
                          )}
                          {hasORC && (
                            <td className="px-3 py-1.5 text-right">
                              {deltaPct(mVal, m.orc) != null
                                ? <DeltaBadge value={deltaPct(mVal, m.orc)!} />
                                : <span className="text-slate-300">—</span>}
                            </td>
                          )}
                          {hasPrevFcts && (
                            <td className="px-3 py-1.5 text-right text-slate-400">{fmt(m.prevFcts)}</td>
                          )}
                          {hasPrevFcts && (
                            <td className="px-3 py-1.5 text-right">
                              {deltaPct(mVal, m.prevFcts) != null
                                ? <DeltaBadge value={deltaPct(mVal, m.prevFcts)!} />
                                : <span className="text-slate-300">—</span>}
                            </td>
                          )}
                          {hasVendaAA && (
                            <td className="px-3 py-1.5 text-right text-slate-400">{fmt(m.vendaAA)}</td>
                          )}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-white rounded-b-2xl">
          <span className="text-sm text-slate-500">
            {t('modal.productCount', { count: selected.size, total: rows.filter(r => !r.noData).length })}
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              {t('modal.cancel')}
            </button>
            <button
              onClick={() => onConfirm(selected, localUpdates, adjustDirty)}
              disabled={selected.size === 0}
              className={cn(
                'px-5 py-2 text-sm rounded-lg font-medium transition-colors',
                selected.size === 0
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700',
              )}
            >
              {resolvedConfirmLabel}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
