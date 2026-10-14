/**
 * Tabela mensal de um produto (linha expandida): ORC, IA, comparativo YoY, FCTS editável
 * e desvio por mês. Na visão consolidada de países (`aggregated`) o FCTS é somente leitura.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn, InfoTooltip } from '../../shared/Common';
import { fmt } from '../../../types/forecast';
import type { AnnualMonthEntry } from '../../../hooks/useAnnualForecastData';
import { COL_COUNT, monthLabel } from './helpers';

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

export const MonthSubRows: React.FC<MonthSubRowsProps> = ({
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
