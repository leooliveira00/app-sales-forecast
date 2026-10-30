/**
 * Produtos que o gestor excluiu do portfólio neste ciclo (seção recolhível).
 * Parte do painel de prévia da submissão (SubmissionPreviewPanel).
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import { InfoTooltip } from '../../shared/Common';
import { fmt } from './helpers';
import type { PreviewData } from './types';

export const ExcluidosSection: React.FC<{ data: PreviewData }> = ({ data }) => {
  const [showExcluidos, setShowExcluidos] = useState(false);

  return (
    <>
      {data.produtosExcluidos && data.produtosExcluidos.length > 0 && (
        <div>
          <button
            onClick={() => setShowExcluidos(v => !v)}
            className="w-full flex items-center gap-1.5 mb-2 px-1 hover:text-slate-600 text-slate-400 transition-colors"
          >
            <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-red-500">
              Produtos excluídos neste ciclo
            </span>
            <span className="ml-1 text-[9px] bg-red-50 text-red-500 border border-red-200 px-1.5 py-0.5 rounded-full font-bold shrink-0">
              {data.produtosExcluidos.length}
            </span>
            <InfoTooltip
              text="Produtos excluídos pelo gestor neste ciclo. Mostrado o volume do FCST do ciclo anterior e ORC anual para apoiar a decisão."
              position="bottom"
              width="w-72"
            />
            {showExcluidos ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
          </button>
          {showExcluidos && (
            <div className="rounded-lg border border-red-100 overflow-hidden mb-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-red-50 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-red-100">
                    <th className="px-3 py-1.5 text-left">Cód.</th>
                    <th className="px-3 py-1.5 text-left">Produto</th>
                    <th className="px-3 py-1.5 text-center">Cl.</th>
                    <th className="px-3 py-1.5 text-left">Família</th>
                    <th className="px-3 py-1.5 text-right">
                      <span className="inline-flex items-center gap-0.5">
                        FCST Ant.
                        <InfoTooltip text="FCST total submetido no ciclo anterior para este produto." position="top" width="w-56" />
                      </span>
                    </th>
                    <th className="px-3 py-1.5 text-right">
                      <span className="inline-flex items-center gap-0.5">
                        ORC Anual
                        <InfoTooltip text="Orçamento anual previsto para este produto." position="top" width="w-48" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-50">
                  {data.produtosExcluidos.map((p) => (
                    <tr key={p.codigo} className="hover:bg-red-50/40 transition-colors">
                      <td className="px-3 py-1.5 font-mono text-slate-400">{p.codigo}</td>
                      <td className="px-3 py-1.5 text-slate-600 font-medium max-w-[160px] truncate">{p.descricao}</td>
                      <td className="px-3 py-1.5 text-center">
                        {p.classe
                          ? <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-1 py-0.5 rounded">{p.classe}</span>
                          : <span className="text-slate-200">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-[10px] text-slate-400">{p.familia}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">
                        {p.prevFctsTotal > 0 ? fmt(p.prevFctsTotal) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-400">
                        {p.orcTotal > 0 ? fmt(p.orcTotal) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
};
