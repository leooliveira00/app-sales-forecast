/**
 * Alterações por família: produtos novos ou com FCST alterado vs ciclo anterior,
 * com mini-tabela mensal por produto.
 * Parte do painel de prévia da submissão (SubmissionPreviewPanel).
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Layers } from 'lucide-react';
import { cn, InfoTooltip } from '../../shared/Common';
import { fmt, monthLabel } from './helpers';
import { DesvioTag } from './DesvioTag';
import type { PreviewData } from './types';

export const FamiliasSection: React.FC<{ data: PreviewData }> = ({ data }) => {
  const [expandedFams, setExpandedFams] = useState<Set<string>>(new Set());
  const [expandedProds, setExpandedProds] = useState<Set<string>>(new Set());

  return (
    <>
      {data.familiaDetalhe && data.familiaDetalhe.length > 0 && (() => {
        // Filtra apenas famílias com produtos genuinamente alterados ou novos.
        // Usa comparação mês-a-mês nos meses overlapping para evitar falsos positivos
        // causados pela janela deslizante (o mês novo da janela tem prevFcts=0 em todos
        // os produtos, inflando o total anual mesmo sem alteração real do gestor).
        const familiasParaExibir = data.familiaDetalhe
          .map((fam) => {
            const prodsVisiveis = fam.produtos.filter((p) => {
              if (p.prevFctsTotal === 0 && p.fctsTotal > 0) return true; // produto novo na carteira
              return (p.meses ?? []).some(m => m.prevFcts > 0 && m.fcts > 0 && m.fcts !== m.prevFcts); // mês overlapping com valor diferente
            });
            return prodsVisiveis.length > 0 ? { ...fam, produtos: prodsVisiveis } : null;
          })
          .filter(Boolean) as typeof data.familiaDetalhe;

        const totalAlterados = familiasParaExibir.reduce((s, f) =>
          s + f.produtos.filter((p) => p.prevFctsTotal > 0).length, 0
        );
        const totalNovos = familiasParaExibir.reduce((s, f) =>
          s + f.produtos.filter((p) => p.prevFctsTotal === 0).length, 0
        );
        const allOpen = familiasParaExibir.every((f) => expandedFams.has(f.familia));

        const toggleAll = () => {
          if (allOpen) {
            setExpandedFams(new Set());
          } else {
            setExpandedFams(new Set(familiasParaExibir.map((f) => f.familia)));
          }
        };

        return (
          <div>
            <div className="flex items-center gap-1.5 mb-2 px-1 flex-wrap">
              <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Alterações por Família
              </span>
              <InfoTooltip
                text="Famílias e produtos com alteração em relação ao ciclo anterior — FCST diferente ou produto novo neste ciclo."
                position="bottom"
                width="w-72"
              />
              <span className="flex items-center gap-1 shrink-0">
                {totalAlterados > 0 && (
                  <span className="text-[9px] bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full font-bold">
                    {totalAlterados} alterado{totalAlterados !== 1 ? 's' : ''}
                  </span>
                )}
                {totalNovos > 0 && (
                  <span className="text-[9px] bg-sky-50 text-sky-600 border border-sky-200 px-1.5 py-0.5 rounded-full font-bold">
                    {totalNovos} novo{totalNovos !== 1 ? 's' : ''}
                  </span>
                )}
              </span>
              {familiasParaExibir.length > 0 && (
                <button
                  onClick={toggleAll}
                  className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded border transition-colors shrink-0 border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600"
                >
                  {allOpen ? 'Colapsar todas' : 'Expandir todas'}
                </button>
              )}
            </div>

            {familiasParaExibir.length === 0 && (
              <p className="text-[11px] text-slate-400 italic px-2 py-2 bg-slate-50 rounded-lg">
                Nenhuma alteração detectada em relação ao ciclo anterior.
              </p>
            )}

            <div className="space-y-1.5">
              {familiasParaExibir.map((fam) => {
                const isOpen = expandedFams.has(fam.familia);
                const toggleFam = () => setExpandedFams(prev => {
                  const next = new Set(prev);
                  isOpen ? next.delete(fam.familia) : next.add(fam.familia);
                  return next;
                });
                const severity =
                  Math.abs(fam.desvioORC) > 25 ? 'high' :
                  Math.abs(fam.desvioORC) > 10 ? 'mid'  : 'ok';

                const novosNaFam    = fam.produtos.filter((p) => p.prevFctsTotal === 0).length;
                const alteradosNaFam = fam.produtos.filter((p) => p.prevFctsTotal > 0).length;

                return (
                  <div key={fam.familia} className="rounded-lg border border-slate-100 overflow-hidden">
                    <button
                      onClick={toggleFam}
                      className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                    >
                      {isOpen
                        ? <ChevronUp   className="w-3 h-3 text-slate-400 shrink-0" />
                        : <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />}
                      <span className="font-bold text-slate-700 text-[11px] flex-1 truncate">{fam.familia}</span>

                      {/* Badges de novos e alterados */}
                      {novosNaFam > 0 && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-sky-50 text-sky-600 border-sky-200 shrink-0">
                          {novosNaFam} novo{novosNaFam !== 1 ? 's' : ''}
                        </span>
                      )}
                      {alteradosNaFam > 0 && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-amber-50 text-amber-600 border-amber-200 shrink-0">
                          {alteradosNaFam} alt.
                        </span>
                      )}

                      <span className="text-[10px] font-mono text-slate-500 ml-1 shrink-0">
                        ORC {fmt(fam.orcTotal)}
                      </span>
                      <span className="text-[10px] font-mono font-bold text-slate-800 ml-1 shrink-0">
                        FCST {fmt(fam.fctsTotal)}
                      </span>
                      <span className={cn(
                        'text-[10px] font-bold ml-1 shrink-0',
                        severity === 'high' ? 'text-red-600' :
                        severity === 'mid'  ? 'text-amber-600' : 'text-emerald-600'
                      )}>
                        {fam.desvioORC > 0 ? '+' : ''}{fam.desvioORC.toFixed(1)}%
                      </span>
                      {fam.deltaVsAnt !== null && (
                        <span className={cn(
                          'text-[9px] font-bold ml-1 px-1.5 py-0.5 rounded-full border shrink-0',
                          Math.abs(fam.deltaVsAnt) > 25
                            ? 'bg-red-50 text-red-600 border-red-200'
                            : Math.abs(fam.deltaVsAnt) > 10
                            ? 'bg-amber-50 text-amber-600 border-amber-200'
                            : 'bg-slate-50 text-slate-500 border-slate-200'
                        )}>
                          ant. {fam.deltaVsAnt > 0 ? '+' : ''}{fam.deltaVsAnt.toFixed(1)}%
                        </span>
                      )}
                    </button>

                    {isOpen && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 bg-white">
                              <th className="px-3 py-1.5 text-left">Cód.</th>
                              <th className="px-3 py-1.5 text-left">Produto</th>
                              <th className="px-3 py-1.5 text-center">Cl.</th>
                              <th className="px-3 py-1.5 text-right">ORC</th>
                              <th className="px-3 py-1.5 text-right">FCST Ant.</th>
                              <th className="px-3 py-1.5 text-right">FCST</th>
                              <th className="px-3 py-1.5 text-right">Δ/ORC</th>
                              <th className="px-3 py-1.5 text-right">Δ vs Ant.</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {fam.produtos.map((p) => {
                              const desvioORC  = p.orcTotal      > 0 ? ((p.fctsTotal / p.orcTotal      - 1) * 100) : null;
                              const deltaVsAnt = p.prevFctsTotal > 0 ? ((p.fctsTotal / p.prevFctsTotal - 1) * 100) : null;
                              const isNovo     = p.prevFctsTotal === 0 && p.fctsTotal > 0;
                              const prodKey    = `${fam.familia}|${p.codigo}`;
                              const isProdOpen = expandedProds.has(prodKey);

                              // Meses alterados (fcts ≠ prevFcts) para exibir na mini-tabela
                              const mesesAlterados = (p.meses ?? []).filter(
                                (m) => m.fcts > 0 && m.fcts !== m.prevFcts
                              );

                              // Calcula próximos 2 meses para urgência
                              const now    = new Date();
                              const urgent = (month: string) => {
                                const [y, mo] = month.split('-').map(Number);
                                const diff = (y - now.getFullYear()) * 12 + (mo - (now.getMonth() + 1));
                                return diff >= 0 && diff <= 1;
                              };

                              return (
                                <React.Fragment key={p.codigo}>
                                  <tr
                                    className={cn(
                                      'transition-colors',
                                      isNovo ? 'bg-sky-50/40' : '',
                                      mesesAlterados.length > 0
                                        ? 'cursor-pointer hover:bg-slate-50/80'
                                        : 'hover:bg-slate-50/40'
                                    )}
                                    onClick={() => {
                                      if (mesesAlterados.length === 0) return;
                                      setExpandedProds(prev => {
                                        const next = new Set(prev);
                                        isProdOpen ? next.delete(prodKey) : next.add(prodKey);
                                        return next;
                                      });
                                    }}
                                  >
                                    {/* chevron / meses */}
                                    <td className="px-3 py-1.5 font-mono text-slate-400 shrink-0">
                                      <div className="flex items-center gap-1">
                                        {mesesAlterados.length > 0
                                          ? isProdOpen
                                            ? <ChevronUp   className="w-3 h-3 text-slate-300 shrink-0" />
                                            : <ChevronDown className="w-3 h-3 text-slate-300 shrink-0" />
                                          : <span className="w-3 inline-block" />}
                                        {p.codigo}
                                      </div>
                                    </td>
                                    <td className="px-3 py-1.5 text-slate-700 font-medium max-w-[180px] truncate">
                                      {p.descricao}
                                      {isNovo && (
                                        <span className="ml-1 text-[8px] font-bold bg-sky-100 text-sky-600 px-1 py-0.5 rounded">NOVO</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-1.5 text-center">
                                      {p.classe
                                        ? <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-1 py-0.5 rounded">{p.classe}</span>
                                        : <span className="text-slate-200">—</span>}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono text-slate-500">{fmt(p.orcTotal)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-slate-400">
                                      {p.prevFctsTotal > 0 ? fmt(p.prevFctsTotal) : <span className="text-slate-200">—</span>}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono font-semibold text-slate-900">{fmt(p.fctsTotal)}</td>
                                    <td className="px-3 py-1.5 text-right">
                                      {desvioORC !== null
                                        ? <DesvioTag value={parseFloat(desvioORC.toFixed(1))} />
                                        : <span className="text-slate-200">—</span>}
                                    </td>
                                    <td className="px-3 py-1.5 text-right">
                                      {deltaVsAnt !== null
                                        ? <DesvioTag value={parseFloat(deltaVsAnt.toFixed(1))} />
                                        : <span className="text-slate-200">—</span>}
                                    </td>
                                  </tr>

                                  {/* Mini-tabela mensal (apenas meses alterados) */}
                                  {isProdOpen && mesesAlterados.length > 0 && (
                                    <tr>
                                      <td colSpan={8} className="px-0 py-0">
                                        <div className="bg-slate-50/80 border-t border-b border-slate-100 overflow-x-auto">
                                          <table className="w-full text-[10px]">
                                            <thead>
                                              <tr className="text-[9px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                                                <th className="pl-8 pr-2 py-1 text-left">Mês</th>
                                                <th className="px-2 py-1 text-right">ORC</th>
                                                <th className="px-2 py-1 text-right">FCST Ant.</th>
                                                <th className="px-2 py-1 text-right">FCST</th>
                                                <th className="px-2 py-1 text-right pr-3">Δ vs Ant.</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {mesesAlterados.map((m) => {
                                                const delta = m.prevFcts > 0
                                                  ? ((m.fcts / m.prevFcts) - 1) * 100
                                                  : null;
                                                const isUrgent = urgent(m.month);
                                                return (
                                                  <tr
                                                    key={m.month}
                                                    className={cn(
                                                      'border-b border-slate-100',
                                                      isUrgent ? 'bg-amber-50/60' : 'bg-white'
                                                    )}
                                                  >
                                                    <td className="pl-8 pr-2 py-1 font-medium text-slate-600 flex items-center gap-1">
                                                      {isUrgent && (
                                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                                                      )}
                                                      {monthLabel(m.month)}
                                                    </td>
                                                    <td className="px-2 py-1 text-right font-mono text-slate-400">{fmt(m.orc)}</td>
                                                    <td className="px-2 py-1 text-right font-mono text-slate-400">
                                                      {m.prevFcts > 0 ? fmt(m.prevFcts) : <span className="text-slate-200">—</span>}
                                                    </td>
                                                    <td className="px-2 py-1 text-right font-mono font-semibold text-slate-800">{fmt(m.fcts)}</td>
                                                    <td className="px-2 py-1 text-right pr-3">
                                                      {delta !== null
                                                        ? <DesvioTag value={parseFloat(delta.toFixed(1))} />
                                                        : isNovo
                                                          ? <span className="text-[9px] font-bold bg-sky-50 text-sky-600 px-1.5 py-0.5 rounded-full border border-sky-200">novo</span>
                                                          : <span className="text-[9px] font-bold bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded-full border border-teal-200">1º ciclo</span>}
                                                    </td>
                                                  </tr>
                                                );
                                              })}
                                            </tbody>
                                          </table>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </>
  );
};
