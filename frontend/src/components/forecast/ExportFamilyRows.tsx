import React, { useState, useMemo, useEffect } from 'react';
import { Globe, RotateCcw, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../shared/Common';
import { fmt, CLASSE_BADGE_COLORS } from '../../types/forecast';
import type { ForecastItem } from '../../types/forecast';
import { ProductSalesDetail } from './ProductSalesDetail';
import { useCountryName } from '../../hooks/useCountryName';

const COL_COUNT = 9;

interface ExportFamilyRowsProps {
  items: ForecastItem[];
  fcts: Record<string, string>;
  setFcts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  initialFcts: React.MutableRefObject<Record<string, string>>;
  saveFCTS: (itemId: string) => void;
  savingId: string | null;
  isReadOnly: boolean;
  onExclude?: (item: ForecastItem) => void;
  onRestore?: (item: ForecastItem) => void;
}

/**
 * Agrupa os ForecastItems EXPORT por produtoId.
 * Cada grupo tem um header com os totais e sub-linhas por país.
 */
function groupByProduct(items: ForecastItem[]): ForecastItem[][] {
  const map = new Map<string, ForecastItem[]>();
  for (const item of items) {
    const existing = map.get(item.produto.codigo) ?? [];
    existing.push(item);
    map.set(item.produto.codigo, existing);
  }
  return [...map.values()];
}

export const ExportFamilyRows: React.FC<ExportFamilyRowsProps> = ({
  items, fcts, setFcts, initialFcts, saveFCTS, savingId, isReadOnly, onExclude, onRestore,
}) => {
  const { t } = useTranslation('forecast');
  const countryName = useCountryName();
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  // Cada produto começa colapsado
  const [collapsedCodigos, setCollapsedCodigos] = useState<Set<string>>(
    () => new Set(items.map((i) => i.produto.codigo))
  );

  useEffect(() => {
    setCollapsedCodigos((prev) => {
      const next = new Set(prev);
      items.forEach((i) => { if (!next.has(i.produto.codigo)) next.add(i.produto.codigo); });
      return next;
    });
  }, [items]);

  const toggleProduct = (codigo: string) =>
    setCollapsedCodigos((prev) => {
      const next = new Set(prev);
      next.has(codigo) ? next.delete(codigo) : next.add(codigo);
      return next;
    });

  const toggleHistory = (id: string) =>
    setExpandedHistoryId((prev) => (prev === id ? null : id));

  const productGroups = useMemo(() => groupByProduct(items), [items]);

  return (
    <table className="w-full text-left">
      <thead>
        <tr className="bg-white text-slate-400 text-[10px] font-bold uppercase tracking-wider border-b border-slate-100">
          <th className="px-6 py-3">Código</th>
          <th className="px-6 py-3">Produto / País</th>
          <th className="px-4 py-3 text-center">Classe</th>
          <th className="px-4 py-3 text-right">{t('columns.orc')}</th>
          <th className="px-4 py-3 text-right">Sugestão IA</th>
          <th className="px-4 py-3 text-right">Δ vs Ant.</th>
          <th className="px-4 py-3 text-right w-40">{t('columns.fcts')}</th>
          <th className="px-4 py-3 text-right">Desvio</th>
          <th className="px-4 py-3 text-center w-14" />
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {productGroups.map((group) => {
          const firstItem      = group[0];
          const codigo         = firstItem.produto.codigo;
          const excluded       = firstItem.gestorExcluido;
          const isCollapsed    = collapsedCodigos.has(codigo);
          const isExpanded     = expandedHistoryId === codigo;

          const totalORC  = group.reduce((s, i) => s + (i.volumeORC ?? 0), 0);
          const totalFCTS = group.reduce((s, i) => {
            const v = Number(fcts[i.id] ?? i.overrides[0]?.volumeFCTS ?? '');
            return s + (isNaN(v) ? 0 : v);
          }, 0);
          const totalDesvio = totalORC > 0 && totalFCTS > 0
            ? ((totalFCTS / totalORC - 1) * 100) : null;

          const hasGroupDirty = !excluded && group.some((i) =>
            fcts[i.id] !== undefined && fcts[i.id] !== (initialFcts.current[i.id] ?? '')
          );

          return (
            <React.Fragment key={codigo}>
              {/* Linha do produto (totais agregados) */}
              <tr
                onClick={() => toggleProduct(codigo)}
                className={cn(
                  "cursor-pointer select-none bg-slate-50/50 hover:bg-slate-100/60 transition-colors",
                  excluded
                    ? "opacity-40"
                    : firstItem.source === 'MANUAL'
                      ? "border-l-4 border-violet-400"
                      : hasGroupDirty
                        ? "border-l-4 border-amber-300"
                        : ""
                )}
              >
                <td className="px-6 py-2">
                  <div className="flex items-center gap-1.5">
                    {isCollapsed
                      ? <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                      : <ChevronDown  className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
                    <span className={cn("font-mono text-xs font-bold", excluded ? "line-through text-slate-300" : "text-slate-400")}>
                      {codigo}
                    </span>
                    {firstItem.source === 'MANUAL' && (
                      <span className="text-[9px] font-bold bg-violet-100 text-violet-600 px-1 py-0.5 rounded">Manual</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-2">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-sm font-bold", excluded ? "line-through text-slate-400" : "text-slate-700")}>
                      {firstItem.produto.descricao}
                    </span>
                    {excluded && <span className="text-xs text-red-400 italic">Excluído do ciclo</span>}
                    {!isReadOnly && (
                      excluded ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); onRestore?.(firstItem); }}
                          className="ml-1 p-0.5 rounded text-emerald-500 hover:bg-emerald-50 transition-colors"
                          title="Restaurar produto no ciclo">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); onExclude?.(firstItem); }}
                          className="ml-1 p-0.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Remover produto deste ciclo">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )
                    )}
                  </div>
                </td>
                <td className="px-4 py-2 text-center">
                  {firstItem.produto.classe ? (
                    <span className={cn(
                      "inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold border",
                      CLASSE_BADGE_COLORS[firstItem.produto.classe] ?? 'bg-slate-100 text-slate-500 border-slate-200'
                    )}>
                      {firstItem.produto.classe}
                    </span>
                  ) : <span className="text-slate-200">—</span>}
                </td>
                <td className="px-4 py-2 text-right text-xs font-bold text-slate-500">{fmt(totalORC)}</td>
                <td className="px-4 py-2" />
                <td className="px-4 py-2 text-right tabular-nums">
                  {excluded ? <span className="text-slate-300 text-xs">—</span> : (() => {
                    // Delta agregado: soma prevFCTS de todos os países do grupo
                    const totalPrev = group.reduce((s, i) => s + (i.prevFCTS ?? 0), 0);
                    if (totalPrev === 0) return <span className="text-slate-300 text-xs">—</span>;
                    const delta = ((totalFCTS / totalPrev) - 1) * 100;
                    if (totalFCTS === 0) return <span className="text-slate-300 text-xs">—</span>;
                    return (
                      <span className={cn("text-xs font-bold",
                        delta > 0 ? "text-amber-600"
                      : delta < 0 ? "text-rose-500"
                      : "text-slate-400")}>
                        {delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : ''}{delta.toFixed(1)}%
                      </span>
                    );
                  })()}
                </td>
                <td className="px-4 py-2 text-right text-xs font-bold text-slate-700">{totalFCTS > 0 ? fmt(totalFCTS) : '—'}</td>
                <td className="px-4 py-2 text-right">
                  {totalDesvio !== null && (
                    <span className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded",
                      Math.abs(totalDesvio) <= 5 ? "bg-emerald-100 text-emerald-700" :
                      Math.abs(totalDesvio) <= 15 ? "bg-amber-100 text-amber-700" :
                                                     "bg-red-100 text-red-700"
                    )}>
                      {totalDesvio > 0 ? '+' : ''}{totalDesvio.toFixed(1)}%
                    </span>
                  )}
                </td>
                <td />
              </tr>

              {/* Linhas de país */}
              {!isCollapsed && !excluded && group.map((item) => {
                const fctsVal  = Number(fcts[item.id] ?? '');
                const orc      = item.volumeORC ?? 0;
                const desvio   = orc > 0 && !isNaN(fctsVal) && fcts[item.id]
                  ? ((fctsVal / orc - 1) * 100) : null;
                const isDirty  = fcts[item.id] !== undefined &&
                  fcts[item.id] !== (initialFcts.current[item.id] ?? '');

                return (
                  <tr key={item.id} className={cn(
                    "transition-colors",
                    isDirty ? "bg-amber-50/40" : "hover:bg-indigo-50/20"
                  )}>
                    <td className="px-6 py-2" />
                    <td className="px-6 py-2 pl-10">
                      <div className="flex items-center gap-1.5">
                        <Globe className="w-3 h-3 text-indigo-400 shrink-0" />
                        <span className="text-xs font-bold text-indigo-700">{item.paisIso3}</span>
                        <span className="text-xs text-slate-400 truncate max-w-[120px]">{countryName(item.paisIso3, item.pais?.nome)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2 text-right text-sm text-slate-600">{fmt(item.volumeORC)}</td>
                    <td className="px-4 py-2 text-right text-sm text-slate-500">{fmt(item.volumeIA)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {(() => {
                        if (!item.prevFCTS) return <span className="text-slate-300 text-xs">—</span>;
                        const cur = Number(fcts[item.id] ?? item.overrides[0]?.volumeFCTS ?? '');
                        if (isNaN(cur) || (!fcts[item.id] && !item.overrides[0]?.volumeFCTS)) return <span className="text-slate-300 text-xs">—</span>;
                        const delta = ((cur / item.prevFCTS) - 1) * 100;
                        return (
                          <span className={cn("text-xs font-bold",
                            delta > 0 ? "text-amber-600"
                          : delta < 0 ? "text-rose-500"
                          : "text-slate-400")}>
                            {delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : ''}{delta.toFixed(1)}%
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isReadOnly ? (
                        <span className="text-sm font-bold text-slate-900">
                          {fmt(item.overrides[0]?.volumeFCTS)}
                        </span>
                      ) : (
                        <input
                          type="text"
                          inputMode="numeric"
                          className="w-28 text-right px-3 py-1 border border-indigo-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                          value={fcts[item.id] ?? (item.overrides[0]?.volumeFCTS?.toString() ?? '')}
                          onChange={(e) => setFcts(prev => ({ ...prev, [item.id]: e.target.value.replace(/[^\d]/g, '') }))}
                          onBlur={() => saveFCTS(item.id)}
                          onKeyDown={(e) => e.key === 'Enter' && saveFCTS(item.id)}
                          onFocus={(e) => e.target.select()}
                          placeholder="0"
                        />
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {desvio !== null ? (
                        <span className={cn(
                          "text-xs font-bold",
                          Math.abs(desvio) <= 5 ? "text-emerald-600" :
                          Math.abs(desvio) <= 15 ? "text-amber-600" : "text-red-600"
                        )}>
                          {desvio > 0 ? '+' : ''}{desvio.toFixed(1)}%
                        </span>
                      ) : <span className="text-xs text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {savingId === item.id
                        ? <span className="text-xs text-indigo-500">...</span>
                        : null}
                    </td>
                  </tr>
                );
              })}

              {/* Toggle histórico de vendas */}
              {!isCollapsed && !excluded && (
                <tr
                  className="cursor-pointer select-none bg-slate-50/30 hover:bg-slate-100/60 transition-colors border-t border-slate-100"
                  onClick={() => toggleHistory(codigo)}
                >
                  <td colSpan={COL_COUNT} className="px-10 py-1.5">
                    <div className="flex items-center gap-1.5 text-slate-400">
                      {isExpanded
                        ? <ChevronDown className="w-3 h-3" />
                        : <ChevronRight className="w-3 h-3" />}
                      <span className="text-[10px] font-semibold uppercase tracking-wider">
                        {isExpanded ? 'Ocultar histórico' : 'Ver médias e histórico de vendas'}
                      </span>
                      {firstItem.avgTrim != null && !isExpanded && (
                        <span className="ml-2 text-[10px] text-slate-400">
                          Méd. 3M: <span className="font-bold text-slate-600">{fmt(firstItem.avgTrim)}</span>
                          {' · '}
                          Méd. 6M: <span className="font-bold text-slate-600">{fmt(firstItem.avgSem)}</span>
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )}

              {/* Detalhe histórico expandido */}
              {!isCollapsed && !excluded && isExpanded && (
                <ProductSalesDetail
                  item={firstItem}
                  colSpan={COL_COUNT}
                  fcts={totalFCTS > 0 ? totalFCTS : null}
                />
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
};
