import React, { useState, useEffect, useMemo } from 'react';
import { TrendingUp, Loader2, Target, ArrowLeftRight, ShieldAlert } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { cn, InfoTooltip } from '../shared/Common';
import { CHART_COLORS } from '../../constants/chartColors';
import { PreviewData, TendenciaPoint } from './submission-preview/types';
import { fmt, MESES, calcScore, SCORE_CFG } from './submission-preview/helpers';
import { DesvioTag } from './submission-preview/DesvioTag';
import { ExcluidosSection } from './submission-preview/ExcluidosSection';
import { FamiliasSection } from './submission-preview/FamiliasSection';
import { FctsPendenteSection } from './submission-preview/FctsPendenteSection';
import { PaisesSection } from './submission-preview/PaisesSection';

interface SubmissionPreviewPanelProps {
  submissionId: string;
  unidadeVendaId: string;
  token: string | null;
}

// ── Componente principal ──────────────────────────────────────────────────

export const SubmissionPreviewPanel: React.FC<SubmissionPreviewPanelProps> = ({
  submissionId, unidadeVendaId, token,
}) => {
  const [data,        setData]        = useState<PreviewData | null>(null);
  const [tendencia,   setTendencia]   = useState<TendenciaPoint[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(false);
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(false);

    Promise.all([
      fetch(`/api/submissions/${submissionId}/preview`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`/api/forecast/tendencia?unidadeVendaId=${unidadeVendaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ])
      .then(async ([prevRes, tendRes]) => {
        if (prevRes.ok) setData(await prevRes.json());
        else setError(true);
        if (tendRes.ok) setTendencia(await tendRes.json());
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [submissionId, unidadeVendaId, token]);

  // Δ FCST vs ciclo anterior
  const deltaCiclo = useMemo(() => {
    if (!data || data.prevFctsTotal === 0 || data.resumo.totalFCTS === 0) return null;
    return ((data.resumo.totalFCTS / data.prevFctsTotal) - 1) * 100;
  }, [data]);

  // Score de Risco
  const score = useMemo(() => {
    if (!data) return null;
    return calcScore(data.resumo.desvio, deltaCiclo, data.topDesvios.length);
  }, [data, deltaCiclo]);

  // Acurácia 3M — lida direto do snapshot da unidade (WAPE, ciclos aprovados)
  const acuracia3M = useMemo(() => {
    if (!data || data.classeAcuracia.length === 0) return null;
    return data.classeAcuracia[0]?.acuracia3M ?? null;
  }, [data]);

  // Dados do mini gráfico
  const chartData = useMemo(() =>
    tendencia.slice(-6).map((p) => {
      const [y, mo] = p.month.split('-');
      const label = `${MESES[parseInt(mo, 10) - 1]}/${y.slice(2)}`;
      return { label, fcts: p.fcts || null, vendas: p.vendas || null };
    }),
    [tendencia]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-slate-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Carregando prévia do forecast...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="py-4 text-center text-xs text-slate-400">
        Não foi possível carregar os dados do forecast.
      </div>
    );
  }

  const { resumo } = data;
  const progressPct = resumo.totalORC > 0
    ? Math.min((resumo.totalFCTS / resumo.totalORC) * 100, 100)
    : 0;

  return (
    <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">

      {/* Score de Risco + KPI resumo */}
      <div className="flex flex-wrap items-center gap-3 px-1">

        {/* Score de Risco */}
        {score && (
          <span className={cn(
            'flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border',
            SCORE_CFG[score].cls
          )}>
            <ShieldAlert className="w-3 h-3" />
            {SCORE_CFG[score].label}
            <InfoTooltip
              text="Score calculado com base no desvio FCST/ORC, variação vs. ciclo anterior e número de produtos com desvio >15%."
              position="bottom"
              width="w-72"
            />
          </span>
        )}

        {/* KPI FCST / ORC */}
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-sky-50 text-sky-600 rounded-lg">
            <TrendingUp className="w-3.5 h-3.5" />
          </div>
          <div className="text-xs text-slate-500 flex items-center gap-1">
            FCST Total <span className="font-bold text-slate-900 ml-1">{fmt(resumo.totalFCTS)}</span>
            <span className="mx-1 text-slate-300">/</span>
            ORC <span className="font-bold text-slate-700">{fmt(resumo.totalORC)}</span>
            <InfoTooltip
              text="Soma do FCST submetido vs. ORC para os meses preenchidos neste ciclo. O % indica o desvio."
              position="bottom"
              width="w-72"
            />
          </div>
          <DesvioTag value={resumo.desvio} />
        </div>

        {/* Barra de progresso */}
        <div className="flex-1 min-w-[120px]">
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                progressPct >= 95 ? "bg-emerald-500" :
                progressPct >= 80 ? "bg-amber-500"   : "bg-sky-500"
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Δ vs ciclo anterior + Acurácia 3M — mesma linha */}
      {(deltaCiclo !== null || acuracia3M !== null) && (
        <div className="flex items-center gap-3 px-1 py-2 rounded-lg bg-slate-50 border border-slate-100 flex-wrap">

          {deltaCiclo !== null && (
            <>
              <ArrowLeftRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="text-xs text-slate-500 flex items-center gap-1">
                Δ vs. ciclo ant.:
                <InfoTooltip
                  text="Variação percentual do FCST total deste ciclo em relação ao FCST do ciclo anterior. Identifica se o gestor está prevendo crescimento ou retração."
                  position="bottom"
                  width="w-72"
                />
              </span>
              <span className={cn(
                'text-xs font-bold',
                Math.abs(deltaCiclo) <= 10  ? 'text-emerald-600' :
                Math.abs(deltaCiclo) <= 25  ? 'text-amber-600'   : 'text-red-600'
              )}>
                {deltaCiclo > 0 ? '+' : ''}{deltaCiclo.toFixed(1)}%
              </span>
              {Math.abs(deltaCiclo) > 25 && (
                <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-full shrink-0">
                  ⚠ Variação alta
                </span>
              )}
            </>
          )}

          {acuracia3M !== null && (
            <>
              {deltaCiclo !== null && <span className="text-slate-200 select-none">|</span>}
              <Target className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="text-xs text-slate-500 flex items-center gap-1">
                Acurácia 3M:
                <InfoTooltip
                  text="Acurácia WAPE dos últimos 3 meses fechados com ciclos aprovados. Mesma métrica exibida no consolidado."
                  position="bottom"
                  width="w-72"
                />
              </span>
              <span className={cn(
                'text-xs font-bold',
                acuracia3M >= 90 ? 'text-emerald-600' :
                acuracia3M >= 75 ? 'text-amber-600'   : 'text-red-600'
              )}>
                {acuracia3M.toFixed(1)}%
              </span>
            </>
          )}

          {deltaCiclo !== null && (
            <span className="text-[10px] text-slate-400 ml-auto shrink-0">
              ciclo ant.: {fmt(data.prevFctsTotal)}
            </span>
          )}
        </div>
      )}

      {/* Mini gráfico tendência (últimos 6 meses) */}
      {chartData.length > 0 && (
        <div className="px-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            Tendência últimos 6 meses (FCST vs Vendas)
            <InfoTooltip
              text="Evolução do FCST vs. vendas reais nos últimos 6 meses fechados."
              position="bottom"
              width="w-72"
            />
          </p>
          <div className="h-[80px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 10, borderRadius: 8, border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={(v, name) => [v != null ? fmt(Number(v)) : '-', name as string]}
                />
                <Line type="monotone" dataKey="fcts"   name="FCST"   stroke={CHART_COLORS.fcts}   strokeWidth={1.5} dot={false} connectNulls />
                <Line type="monotone" dataKey="vendas" name="Vendas" stroke={CHART_COLORS.vendas} strokeWidth={2}   dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Produtos excluídos neste ciclo */}
      <ExcluidosSection data={data} />

      {/* Detalhamento por família — apenas alterações */}
      <FamiliasSection data={data} />

      {/* FCST Pendente: produtos sem FCST no último mês da janela, agrupados por família */}
      <FctsPendenteSection data={data} />

      {/* Detalhamento por País — apenas para unidades de exportação */}
      <PaisesSection data={data} />

      {(!data.familiaDetalhe || data.familiaDetalhe.length === 0) &&
       (!data.produtosExcluidos || data.produtosExcluidos.length === 0) && (
        <p className="text-xs text-slate-400 italic px-1">
          Nenhum dado de forecast encontrado para este ciclo.
        </p>
      )}
    </div>
  );
};
