import React, { useState } from 'react';
import { Save, RotateCcw, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn, InfoTooltip } from '../shared/Common';
import { fmt, CLASSE_BADGE_COLORS } from '../../types/forecast';
import type { ForecastItem } from '../../types/forecast';
import { ProductSalesDetail } from './ProductSalesDetail';

// Número de colunas da tabela — usado para o colSpan da linha expansível
const COL_COUNT = 9;

interface NacionalFamilyRowsProps {
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

export const NacionalFamilyRows: React.FC<NacionalFamilyRowsProps> = ({
  items, fcts, setFcts, initialFcts, saveFCTS, savingId, isReadOnly, onExclude, onRestore,
}) => {
  const { t } = useTranslation('forecast');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) =>
    setExpandedId(prev => (prev === id ? null : id));

  return (
    <table className="w-full text-left">
      <thead>
        <tr className="bg-white text-slate-400 text-[10px] font-bold uppercase tracking-wider border-b border-slate-100">
          <th className="px-6 py-3">Código</th>
          <th className="px-6 py-3">Produto</th>
          <th className="px-6 py-3 text-center">Classe</th>
          <th className="px-6 py-3 text-right">
            <span className="inline-flex items-center gap-1 justify-end">
              ORC
              <InfoTooltip text="Volume orçado para este produto no mês alvo." position="bottom" textSize="text-[10px]" />
            </span>
          </th>
          <th className="px-6 py-3 text-right">
            <span className="inline-flex items-center gap-1 justify-end">
              Sugestão IA
              <InfoTooltip text="Volume sugerido baseado em histórico e sazonalidade." position="bottom" textSize="text-[10px]" />
            </span>
          </th>
          <th className="px-6 py-3 text-right">
            <span className="inline-flex items-center gap-1 justify-end">
              Venda A.A.
              <InfoTooltip text={`% ${t('columns.fcts')} x Volume de venda do mês no ano anterior.`} position="bottom" width="w-64" textSize="text-[10px]" />
            </span>
          </th>
          <th className="px-6 py-3 text-right w-40">
            <span className="inline-flex items-center gap-1 justify-end">
              {t('columns.fcts')}
              <InfoTooltip text={t('columns.fctsHint')} position="bottom" textSize="text-[10px]" />
            </span>
          </th>
          <th className="px-6 py-3 text-right">
            <span className="inline-flex items-center gap-1 justify-end">
              Desvio
              <InfoTooltip text={t('columns.desvioMonthHint')} position="bottom" textSize="text-[10px]" />
            </span>
          </th>
          <th className="px-6 py-3 text-center w-20" />
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {items.map((item) => {
          const fctsVal  = Number(fcts[item.id] ?? '');
          const orc      = item.volumeORC ?? 0;
          const desvio   = orc > 0 && !isNaN(fctsVal) && fcts[item.id]
            ? ((fctsVal / orc - 1) * 100) : null;
          const excluded = item.gestorExcluido;
          const isExpanded = expandedId === item.id;

          const isDirty = !excluded
            && fcts[item.id] !== undefined
            && fcts[item.id] !== (initialFcts.current[item.id] ?? '');

          return (
            <React.Fragment key={item.id}>
              <tr className={cn(
                "transition-colors",
                excluded
                  ? "opacity-40 bg-red-50/30"
                  : item.source === 'MANUAL'
                    ? "border-l-4 border-violet-400 bg-violet-50/30"
                    : isDirty
                      ? "border-l-4 border-amber-300 bg-amber-50/40"
                      : isExpanded
                        ? "bg-slate-50"
                        : "hover:bg-slate-50/60"
              )}>
                <td className="px-6 py-2.5">
                  <div className="flex items-center gap-1.5">
                    {/* Botão de expansão */}
                    <button
                      onClick={() => toggleExpand(item.id)}
                      className="p-0.5 rounded text-slate-300 hover:text-sky-500 transition-colors"
                      title={isExpanded ? 'Recolher histórico' : 'Visualizar médias de venda'}
                    >
                      {isExpanded
                        ? <ChevronUp className="w-3.5 h-3.5" />
                        : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                    <span className={cn("font-mono text-xs font-bold", excluded ? "line-through text-slate-300" : "text-slate-400")}>
                      {item.produto.codigo}
                    </span>
                    {item.source === 'MANUAL' && (
                      <span className="text-[9px] font-bold bg-violet-100 text-violet-600 px-1 py-0.5 rounded">Manual</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-2.5">
                  <span className={cn("text-sm", excluded ? "line-through text-slate-400" : "text-slate-800")}>
                    {item.produto.descricao}
                  </span>
                </td>
                <td className="px-6 py-2.5 text-center">
                  {item.produto.classe ? (
                    <span className={cn(
                      "inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold border",
                      CLASSE_BADGE_COLORS[item.produto.classe] ?? 'bg-slate-100 text-slate-500 border-slate-200'
                    )}>
                      {item.produto.classe}
                    </span>
                  ) : <span className="text-slate-200">—</span>}
                </td>
                <td className="px-6 py-2.5 text-right text-sm text-slate-600">{excluded ? '—' : fmt(item.volumeORC)}</td>
                <td className="px-6 py-2.5 text-right text-sm text-slate-500">{excluded ? '—' : fmt(item.volumeIA)}</td>
                <td className="px-6 py-2.5 text-right tabular-nums">
                  {excluded ? <span className="text-slate-300 text-xs">—</span> : (() => {
                    // Venda real do mesmo mês no ano anterior (a partir do salesHistory)
                    const targetKey = item.month.substring(0, 7);        // "2026-03-01" → "2026-03"
                    const prevYearKey = `${Number(targetKey.substring(0, 4)) - 1}-${targetKey.substring(5, 7)}`;
                    const vendaAnoAnterior = item.salesHistory.find(h => h.month.substring(0, 7) === prevYearKey)?.qty ?? null;
                    if (vendaAnoAnterior == null) return <span className="text-slate-300 text-xs">—</span>;
                    const cur = Number(fcts[item.id] ?? item.overrides[0]?.volumeFCTS ?? '');
                    const deltaPct = !isNaN(cur) && cur > 0 && vendaAnoAnterior > 0
                      ? ((cur / vendaAnoAnterior) - 1) * 100 : null;
                    return (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-xs font-medium text-slate-600">{fmt(vendaAnoAnterior)}</span>
                        {deltaPct != null && (
                          <span className={cn("text-[10px] font-bold",
                            deltaPct > 0  ? "text-amber-600"
                          : deltaPct < 0  ? "text-rose-500"
                          : "text-slate-400")}>
                            {deltaPct > 0 ? '▲ +' : '▼ '}{Math.abs(deltaPct).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </td>
                <td className="px-6 py-2.5 text-right">
                  {excluded ? (
                    <span className="text-xs text-red-400 italic">Excluído</span>
                  ) : isReadOnly ? (
                    <span className="text-sm font-bold text-slate-900">{fmt(item.overrides[0]?.volumeFCTS)}</span>
                  ) : (
                    <input
                      data-fcts-input
                      type="text"
                      inputMode="numeric"
                      className="w-32 text-right px-3 py-1 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500 bg-white"
                      value={fcts[item.id] ?? ''}
                      onChange={(e) => setFcts(prev => ({ ...prev, [item.id]: e.target.value.replace(/[^\d]/g, '') }))}
                      onBlur={() => saveFCTS(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          saveFCTS(item.id);
                          // Avança para o próximo input FCTS visível na página
                          const all = Array.from(
                            document.querySelectorAll<HTMLInputElement>('[data-fcts-input]')
                          );
                          const idx = all.indexOf(e.currentTarget);
                          all[idx + 1]?.focus();
                        }
                      }}
                      onFocus={(e) => e.target.select()}
                      placeholder="0"
                    />
                  )}
                </td>
                <td className="px-6 py-2.5 text-right">
                  {!excluded && desvio !== null ? (
                    <span className={cn(
                      "text-xs font-bold",
                      Math.abs(desvio) <= 5 ? "text-emerald-600" :
                      Math.abs(desvio) <= 15 ? "text-amber-600" : "text-red-600"
                    )}>
                      {desvio > 0 ? '+' : ''}{desvio.toFixed(1)}%
                    </span>
                  ) : <span className="text-xs text-slate-300">—</span>}
                </td>
                <td className="px-6 py-2.5 text-center">
                  <div className="flex items-center justify-center gap-1">
                    {savingId === item.id ? (
                      <span className="text-xs text-sky-500">...</span>
                    ) : (
                      !excluded && item.overrides[0] && !isReadOnly && (
                        <Save className="w-3.5 h-3.5 text-emerald-400" />
                      )
                    )}
                    {!isReadOnly && (
                      excluded ? (
                        <button
                          onClick={() => onRestore?.(item)}
                          className="p-1 rounded text-emerald-500 hover:bg-emerald-50 transition-colors"
                          title="Restaurar produto no ciclo"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => onExclude?.(item)}
                          className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Remover produto deste ciclo"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )
                    )}
                  </div>
                </td>
              </tr>

              {/* Linha expansível com histórico de vendas */}
              {isExpanded && (
                <ProductSalesDetail
                  item={item}
                  colSpan={COL_COUNT}
                  fcts={fcts[item.id] ? Number(fcts[item.id]) : (item.overrides[0]?.volumeFCTS ?? null)}
                />
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
};
