/**
 * Detalhamento por país — apenas para unidades de exportação.
 * Parte do painel de prévia da submissão (SubmissionPreviewPanel).
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Globe } from 'lucide-react';
import { cn, InfoTooltip } from '../../shared/Common';
import { fmt, monthLabel } from './helpers';
import { DesvioTag } from './DesvioTag';
import type { PreviewData } from './types';

export const PaisesSection: React.FC<{ data: PreviewData }> = ({ data }) => {
  const [expandedPaises, setExpandedPaises] = useState<Set<string>>(new Set());
  const [expandedPaisFams, setExpandedPaisFams] = useState<Set<string>>(new Set());
  const [expandedProds, setExpandedProds] = useState<Set<string>>(new Set());

  return (
    <>
      {data.isExport && data.paisDetalhe && data.paisDetalhe.length > 0 && (() => {
        const allPaisOpen = data.paisDetalhe!.every((p) => expandedPaises.has(p.paisIso3));

        const toggleAllPaises = () => {
          if (allPaisOpen) {
            setExpandedPaises(new Set());
          } else {
            setExpandedPaises(new Set(data.paisDetalhe!.map((p) => p.paisIso3)));
          }
        };

        return (
          <div>
            <div className="flex items-center gap-1.5 mb-2 px-1 flex-wrap">
              <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Alterações por País (Export)
              </span>
              <InfoTooltip
                text="Detalhamento por país de destino das unidades de exportação — famílias e produtos com alteração vs. ciclo anterior."
                position="bottom"
                width="w-72"
              />
              <button
                onClick={toggleAllPaises}
                className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded border transition-colors shrink-0 border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600"
              >
                {allPaisOpen ? 'Colapsar todos' : 'Expandir todos'}
              </button>
            </div>

            <div className="space-y-1.5">
              {data.paisDetalhe!.map((pais) => {
                const isPaisOpen = expandedPaises.has(pais.paisIso3);
                const togglePais = () => setExpandedPaises((prev) => {
                  const next = new Set(prev);
                  isPaisOpen ? next.delete(pais.paisIso3) : next.add(pais.paisIso3);
                  return next;
                });
                const paisSeverity =
                  Math.abs(pais.desvioORC) > 25 ? 'high' :
                  Math.abs(pais.desvioORC) > 10 ? 'mid'  : 'ok';

                return (
                  <div key={pais.paisIso3} className="rounded-lg border border-slate-200 overflow-hidden">
                    {/* Cabeçalho país */}
                    <button
                      onClick={togglePais}
                      className="w-full flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 transition-colors text-left"
                    >
                      {isPaisOpen
                        ? <ChevronUp   className="w-3 h-3 text-slate-400 shrink-0" />
                        : <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />}
                      <Globe className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="font-bold text-slate-800 text-[11px] flex-1 truncate">{pais.paisNome}</span>
                      {pais.semFcts && (
                        <span className="text-[9px] font-bold bg-red-50 text-red-500 border border-red-200 px-1.5 py-0.5 rounded-full shrink-0">
                          Sem FCST
                        </span>
                      )}
                      <span className="text-[10px] font-mono text-slate-500 ml-1 shrink-0">
                        ORC {fmt(pais.orcTotal)}
                      </span>
                      <span className="text-[10px] font-mono font-bold text-slate-800 ml-1 shrink-0">
                        FCST {fmt(pais.fctsTotal)}
                      </span>
                      <span className={cn(
                        'text-[10px] font-bold ml-1 shrink-0',
                        paisSeverity === 'high' ? 'text-red-600' :
                        paisSeverity === 'mid'  ? 'text-amber-600' : 'text-emerald-600'
                      )}>
                        {pais.desvioORC > 0 ? '+' : ''}{pais.desvioORC.toFixed(1)}%
                      </span>
                      {pais.deltaVsAnt !== null && (
                        <span className={cn(
                          'text-[9px] font-bold ml-1 px-1.5 py-0.5 rounded-full border shrink-0',
                          Math.abs(pais.deltaVsAnt) > 25
                            ? 'bg-red-50 text-red-600 border-red-200'
                            : Math.abs(pais.deltaVsAnt) > 10
                            ? 'bg-amber-50 text-amber-600 border-amber-200'
                            : 'bg-slate-50 text-slate-500 border-slate-200'
                        )}>
                          ant. {pais.deltaVsAnt > 0 ? '+' : ''}{pais.deltaVsAnt.toFixed(1)}%
                        </span>
                      )}
                    </button>

                    {/* Famílias do país */}
                    {isPaisOpen && (
                      <div className="divide-y divide-slate-100">
                        {pais.familias.map((fam) => {
                          const famKey   = `${pais.paisIso3}|${fam.familia}`;
                          const isFamOpen = expandedPaisFams.has(famKey);
                          const toggleFam = () => setExpandedPaisFams((prev) => {
                            const next = new Set(prev);
                            isFamOpen ? next.delete(famKey) : next.add(famKey);
                            return next;
                          });
                          const famSeverity =
                            Math.abs(fam.desvioORC) > 25 ? 'high' :
                            Math.abs(fam.desvioORC) > 10 ? 'mid'  : 'ok';
                          const novosNaFam     = fam.produtos.filter((p) => p.prevFctsTotal === 0).length;
                          const alteradosNaFam = fam.produtos.filter((p) => p.prevFctsTotal > 0).length;

                          return (
                            <div key={famKey}>
                              <button
                                onClick={toggleFam}
                                className="w-full flex items-center gap-2 px-4 py-1.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                              >
                                {isFamOpen
                                  ? <ChevronUp   className="w-3 h-3 text-slate-300 shrink-0" />
                                  : <ChevronDown className="w-3 h-3 text-slate-300 shrink-0" />}
                                <span className="font-semibold text-slate-600 text-[11px] flex-1 truncate">{fam.familia}</span>
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
                                  famSeverity === 'high' ? 'text-red-600' :
                                  famSeverity === 'mid'  ? 'text-amber-600' : 'text-emerald-600'
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

                              {isFamOpen && (
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
                                        const prodKey    = `${pais.paisIso3}|${fam.familia}|${p.codigo}`;
                                        const isProdOpen = expandedProds.has(prodKey);
                                        const mesesAlterados = (p.meses ?? []).filter((m) => m.fcts !== m.prevFcts);
                                        const now = new Date();
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
                                                setExpandedProds((prev) => {
                                                  const next = new Set(prev);
                                                  isProdOpen ? next.delete(prodKey) : next.add(prodKey);
                                                  return next;
                                                });
                                              }}
                                            >
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
                                                                  : <span className="text-[9px] font-bold bg-sky-50 text-sky-600 px-1.5 py-0.5 rounded-full border border-sky-200">novo</span>}
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
