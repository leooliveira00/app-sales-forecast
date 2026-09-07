import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Search, X, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '../shared/Common';
import { fmt } from '../../types/forecast';
import type { AnnualProduct } from '../../hooks/useAnnualForecastData';

interface CopyForecastModalProps {
  source:      AnnualProduct;
  candidates:  AnnualProduct[];            // produtos-alvo elegíveis (sem a origem, sem excluídos)
  fcts:        Record<string, string>;     // valores de FCST exibidos (estado vivo)
  onApply:     (updates: Record<string, number>, targetCount: number) => Promise<boolean>;
  onApplied:   () => void;                 // sucesso → página abre o prompt de exclusão da origem
  onClose:     () => void;
}

const fctsTotalOf = (prod: AnnualProduct, fcts: Record<string, string>): number =>
  prod.months.reduce((s, m) => {
    const v = Number(fcts[m.itemId] ?? '');
    return s + (isNaN(v) ? 0 : v);
  }, 0);

export const CopyForecastModal: React.FC<CopyForecastModalProps> = ({
  source, candidates, fcts, onApply, onApplied, onClose,
}) => {
  const { t } = useTranslation('forecast');
  const [query, setQuery]       = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving]     = useState(false);

  // FCST da origem por mês (verbatim — exatamente o que está na tela)
  const srcByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of source.months) {
      const v = Number(fcts[m.itemId] ?? '');
      map.set(m.month, isNaN(v) ? 0 : v);
    }
    return map;
  }, [source, fcts]);

  const sourceTotal = useMemo(() => fctsTotalOf(source, fcts), [source, fcts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(p =>
      p.codigo.toLowerCase().includes(q) || p.descricao.toLowerCase().includes(q));
  }, [candidates, query]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleApply = async () => {
    const targets = candidates.filter(p => selected.has(p.produtoId));
    if (targets.length === 0) return;

    const updates: Record<string, number> = {};
    for (const tp of targets) {
      for (const m of tp.months) {
        if (!srcByMonth.has(m.month)) continue; // só meses com correspondência na origem
        updates[m.itemId] = srcByMonth.get(m.month)!;
      }
    }
    setSaving(true);
    const ok = await onApply(updates, targets.length);
    setSaving(false);
    if (ok) onApplied();
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-lg w-full max-h-[85vh] flex flex-col bg-white rounded-2xl shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
              <Copy className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 leading-tight">{t('copyModal.title')}</h2>
              <p className="text-xs text-slate-400 leading-tight mt-0.5">
                {t('copyModal.from')}: <span className="font-mono font-semibold text-slate-600">{source.codigo}</span> — {source.descricao}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-300 hover:text-slate-500 rounded-lg hover:bg-slate-50 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Resumo da origem */}
        <div className="px-6 pt-3">
          <div className="flex items-center gap-3 px-3 py-2 bg-sky-50/60 border border-sky-100 rounded-xl text-xs">
            <span className="text-slate-500">{t('copyModal.totalFcts')}</span>
            <span className="font-bold text-slate-800 tabular-nums">{fmt(sourceTotal)}</span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500">{source.months.length} {t('copyModal.months')}</span>
          </div>
        </div>

        {/* Busca */}
        <div className="px-6 pt-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('copyModal.searchPlaceholder')}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
        </div>

        {/* Lista de alvos */}
        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">{t('copyModal.empty')}</p>
          ) : (
            filtered.map(p => {
              const isSel = selected.has(p.produtoId);
              const total = fctsTotalOf(p, fcts);
              return (
                <button
                  key={p.produtoId}
                  onClick={() => toggle(p.produtoId)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-xl border text-left transition-colors',
                    isSel ? 'bg-sky-50 border-sky-300' : 'bg-white border-slate-200 hover:bg-slate-50',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    readOnly
                    className="accent-sky-600 shrink-0 pointer-events-none"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-xs font-bold text-slate-400 mr-1.5">{p.codigo}</span>
                    <span className="text-sm text-slate-700">{p.descricao}</span>
                  </div>
                  {total > 0 && (
                    <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                      <AlertTriangle className="w-3 h-3" />
                      {t('copyModal.willOverwrite')}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
          <span className="text-sm text-slate-500">
            {t('copyModal.selectedCount', { count: selected.size })}
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              {t('copyModal.cancel')}
            </button>
            <button
              onClick={handleApply}
              disabled={selected.size === 0 || saving}
              className={cn(
                'px-5 py-2 text-sm rounded-lg font-bold transition-colors flex items-center gap-2',
                selected.size === 0 || saving
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-sky-600 text-white hover:bg-sky-700',
              )}
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? t('copyModal.applying') : t('copyModal.apply')}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
