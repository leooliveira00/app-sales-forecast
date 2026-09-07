import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp, Loader2,
  ChevronDown, ChevronUp, Target, ArrowLeftRight, ShieldAlert, Layers, XCircle, Globe,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { cn, InfoTooltip } from '../shared/Common';
import { CHART_COLORS } from '../../constants/chartColors';

// ── Tipos ─────────────────────────────────────────────────────────────────

interface MonthSummary {
  targetMonth: string;
  totalORC: number;
  totalFCTS: number;
  prevFcts: number;
  desvio: number;
}

interface TopDesvio {
  codigo: string;
  descricao: string;
  familia: string;
  targetMonth: string;
  volumeORC: number;
  volumeFCTS: number;
  desvio: number;
}

interface ClasseAcuracia {
  classe: string;
  acuracia3M: number;
  skuCount: number;
}

interface ProdutoMes {
  month: string;
  orc: number;
  fcts: number;
  prevFcts: number;
}

interface ProdutoDetalhe {
  codigo: string;
  descricao: string;
  classe: string | null;
  familia: string;
  orcTotal: number;
  fctsTotal: number;
  prevFctsTotal: number;
  meses: ProdutoMes[];
}

interface FamiliaDetalhe {
  familia: string;
  orcTotal: number;
  fctsTotal: number;
  prevFctsTotal: number;
  desvioORC: number;
  deltaVsAnt: number | null;
  produtos: ProdutoDetalhe[];
}

interface ProdutoExcluido {
  codigo: string;
  descricao: string;
  classe: string | null;
  familia: string;
  orcTotal: number;
  prevFctsTotal: number;
}

interface FamiliaPaisDetalhe {
  familia: string;
  orcTotal: number;
  fctsTotal: number;
  prevFctsTotal: number;
  desvioORC: number;
  deltaVsAnt: number | null;
  produtos: ProdutoDetalhe[];
}

interface PaisDetalhe {
  paisIso3: string;
  paisNome: string;
  orcTotal: number;
  fctsTotal: number;
  prevFctsTotal: number;
  desvioORC: number;
  deltaVsAnt: number | null;
  semFcts: boolean;
  familias: FamiliaPaisDetalhe[];
}

interface PreviewData {
  months: MonthSummary[];
  topDesvios: TopDesvio[];
  resumo: { totalORC: number; totalFCTS: number; desvio: number };
  prevFctsTotal: number;
  classeAcuracia: ClasseAcuracia[];
  familiaDetalhe: FamiliaDetalhe[];
  produtosExcluidos: ProdutoExcluido[];
  paisDetalhe?: PaisDetalhe[];
  isExport?: boolean;
}

interface TendenciaPoint {
  month: string;
  label: string;
  orc: number;
  fcts: number;
  vendas: number;
}

interface SubmissionPreviewPanelProps {
  submissionId: string;
  unidadeVendaId: string;
  token: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

const fmt = (v: number) => new Intl.NumberFormat('pt-BR').format(v);

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const monthLabel = (iso: string) => {
  const [y, m] = iso.split('-');
  const mes = MESES[parseInt(m, 10) - 1] ?? iso;
  return y ? `${mes}/${y.slice(2)}` : mes;
};

const DesvioTag: React.FC<{ value: number }> = ({ value }) => (
  <span className={cn(
    "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
    Math.abs(value) <= 5  ? "bg-emerald-100 text-emerald-700" :
    Math.abs(value) <= 15 ? "bg-amber-100 text-amber-700"    :
                             "bg-red-100 text-red-700"
  )}>
    {value > 0 ? '+' : ''}{value.toFixed(1)}%
  </span>
);

// ── Score de Risco ────────────────────────────────────────────────────────

const calcScore = (
  desvioFctsOrc: number,
  deltaCiclo: number | null,
  topDesviosCount: number
): 'ok' | 'atencao' | 'risco' => {
  let pontos = 0;
  if (Math.abs(desvioFctsOrc) > 25) pontos += 2;
  else if (Math.abs(desvioFctsOrc) > 10) pontos += 1;

  if (deltaCiclo !== null) {
    if (Math.abs(deltaCiclo) > 25) pontos += 2;
    else if (Math.abs(deltaCiclo) > 10) pontos += 1;
  }

  if (topDesviosCount >= 4) pontos += 2;
  else if (topDesviosCount >= 2) pontos += 1;

  if (pontos >= 4) return 'risco';
  if (pontos >= 2) return 'atencao';
  return 'ok';
};

const SCORE_CFG = {
  ok:      { label: 'Dentro do normal', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  atencao: { label: 'Atenção',          cls: 'bg-amber-50   text-amber-700   border-amber-200',   dot: 'bg-amber-500'   },
  risco:   { label: 'Risco Alto',       cls: 'bg-red-50     text-red-700     border-red-200',     dot: 'bg-red-500'     },
};

// ── Componente principal ──────────────────────────────────────────────────

export const SubmissionPreviewPanel: React.FC<SubmissionPreviewPanelProps> = ({
  submissionId, unidadeVendaId, token,
}) => {
  const [data,        setData]        = useState<PreviewData | null>(null);
  const [tendencia,   setTendencia]   = useState<TendenciaPoint[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(false);
  const [expandedFams, setExpandedFams] = useState<Set<string>>(new Set());
  const [expandedProds, setExpandedProds] = useState<Set<string>>(new Set());
  const [showExcluidos, setShowExcluidos] = useState(false);
  const [expandedPaises, setExpandedPaises] = useState<Set<string>>(new Set());
  const [expandedPaisFams, setExpandedPaisFams] = useState<Set<string>>(new Set());
  const [horizonOpen, setHorizonOpen] = useState(false);
  const [expandedHorizonFams, setExpandedHorizonFams] = useState<Set<string>>(new Set());
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

      {/* Detalhamento por família — apenas alterações */}
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

      {/* FCST Pendente: produtos sem FCST no último mês da janela, agrupados por família */}
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

      {/* Detalhamento por País — apenas para unidades de exportação */}
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

      {(!data.familiaDetalhe || data.familiaDetalhe.length === 0) &&
       (!data.produtosExcluidos || data.produtosExcluidos.length === 0) && (
        <p className="text-xs text-slate-400 italic px-1">
          Nenhum dado de forecast encontrado para este ciclo.
        </p>
      )}
    </div>
  );
};
