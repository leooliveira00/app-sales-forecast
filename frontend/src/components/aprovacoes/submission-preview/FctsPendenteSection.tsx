/**
 * FCST pendente: produtos sem FCST no último mês da janela, agrupados por família.
 * Parte do painel de prévia da submissão (SubmissionPreviewPanel).
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { InfoTooltip } from '../../shared/Common';
import { MESES } from './helpers';
import type { PreviewData } from './types';

export const FctsPendenteSection: React.FC<{ data: PreviewData }> = ({ data }) => {
  const [horizonOpen, setHorizonOpen] = useState(false);
  const [expandedHorizonFams, setExpandedHorizonFams] = useState<Set<string>>(new Set());

  return (
    <>
      {data.familiaDetalhe && data.familiaDetalhe.length > 0 && (() => {
        type HorizonProd = {
          codigo: string; descricao: string; classe: string | null;
        };
        type HorizonFam = {
          familia: string; produtos: HorizonProd[];
        };

        // Determina o mês horizonte = mês máximo presente na janela atual
        const allMonthsInWindow = data.familiaDetalhe.flatMap(f =>
          f.produtos.flatMap(p => (p.meses ?? []).map(m => m.month))
        );
        const horizonMonth = [...allMonthsInWindow].sort().at(-1);
        if (!horizonMonth) return null;

        // Agrupa por família produtos com fcts=0 no mês horizonte
        const famMap = new Map<string, HorizonProd[]>();
        for (const fam of data.familiaDetalhe) {
          for (const p of fam.produtos) {
            const horizonMes = (p.meses ?? []).find(m => m.month === horizonMonth);
            if (!horizonMes || horizonMes.fcts > 0) continue;
            if (!famMap.has(fam.familia)) famMap.set(fam.familia, []);
            famMap.get(fam.familia)!.push({ codigo: p.codigo, descricao: p.descricao, classe: p.classe });
          }
        }
        if (famMap.size === 0) return null;

        const familias: HorizonFam[] = [...famMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([familia, produtos]) => ({
            familia,
            produtos: produtos.sort((a, b) => a.codigo.localeCompare(b.codigo)),
          }));

        const totalProdos = familias.reduce((s, f) => s + f.produtos.length, 0);
        const horizonLabel = `${MESES[parseInt(horizonMonth.split('-')[1], 10) - 1]}/${horizonMonth.split('-')[0].slice(2)}`;

        const allFamsOpen = familias.every(f => expandedHorizonFams.has(f.familia));
        const toggleAllHorizon = () => {
          if (allFamsOpen) setExpandedHorizonFams(new Set());
          else setExpandedHorizonFams(new Set(familias.map(f => f.familia)));
        };

        return (
          <div className="mt-3">
            {/* Cabeçalho da seção */}
            <div className="flex items-center gap-1.5 mb-2 px-1 flex-wrap">
              <button
                onClick={() => setHorizonOpen(o => !o)}
                className="flex items-center gap-1.5 text-left"
              >
                {horizonOpen
                  ? <ChevronUp   className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  : <ChevronDown className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">
                  FCST Pendente
                </span>
              </button>
              <span className="text-[10px] font-mono font-semibold text-amber-500">
                — {horizonLabel}
              </span>
              <InfoTooltip
                text="Produtos com FCST não preenchido no último mês da janela. A janela avançou um mês neste ciclo e esses produtos não foram revisados para o novo mês."
                position="bottom"
                width="w-80"
              />
              <span className="text-[9px] bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full font-bold shrink-0">
                {totalProdos} produto{totalProdos !== 1 ? 's' : ''} · {familias.length} famíli{familias.length !== 1 ? 'as' : 'a'}
              </span>
              {horizonOpen && (
                <button
                  onClick={toggleAllHorizon}
                  className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded border transition-colors shrink-0 border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600"
                >
                  {allFamsOpen ? 'Colapsar todas' : 'Expandir todas'}
                </button>
              )}
            </div>

            {horizonOpen && (
              <div className="space-y-1.5">
                {familias.map(({ familia, produtos }) => {
                  const isFamOpen = expandedHorizonFams.has(familia);
                  const toggleFam = () => setExpandedHorizonFams(prev => {
                    const next = new Set(prev);
                    isFamOpen ? next.delete(familia) : next.add(familia);
                    return next;
                  });

                  return (
                    <div key={familia} className="rounded-lg border border-amber-100 overflow-hidden">
                      <button
                        onClick={toggleFam}
                        className="w-full flex items-center gap-2 px-3 py-2 bg-amber-50/60 hover:bg-amber-50 transition-colors text-left"
                      >
                        {isFamOpen
                          ? <ChevronUp   className="w-3 h-3 text-amber-400 shrink-0" />
                          : <ChevronDown className="w-3 h-3 text-amber-400 shrink-0" />}
                        <span className="font-bold text-slate-700 text-[11px] flex-1 truncate">{familia}</span>
                        <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full shrink-0">
                          {produtos.length} produto{produtos.length !== 1 ? 's' : ''}
                        </span>
                      </button>

                      {isFamOpen && (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-[9px] font-bold uppercase tracking-wider text-slate-400 border-b border-amber-100 bg-white">
                              <th className="px-3 py-1.5 text-left">Código</th>
                              <th className="px-3 py-1.5 text-left">Produto</th>
                              <th className="px-3 py-1.5 text-center">Cl.</th>
                              <th className="px-3 py-1.5 text-right">{horizonLabel}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-amber-50">
                            {produtos.map(p => (
                              <tr key={p.codigo} className="hover:bg-amber-50/30 transition-colors">
                                <td className="px-3 py-1.5 font-mono text-slate-400">{p.codigo}</td>
                                <td className="px-3 py-1.5 text-slate-700 font-medium max-w-[200px] truncate">{p.descricao}</td>
                                <td className="px-3 py-1.5 text-center">
                                  {p.classe
                                    ? <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-1 py-0.5 rounded">{p.classe}</span>
                                    : <span className="text-slate-200">—</span>}
                                </td>
                                <td className="px-3 py-1.5 text-right">
                                  <span className="text-[9px] font-bold bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full border border-amber-200">
                                    Não revisado
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
    </>
  );
};
