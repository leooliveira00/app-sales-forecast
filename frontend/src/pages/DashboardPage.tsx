import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFormatter } from '../hooks/useFormatter';
import { useConsolidadoCache } from '../context/ConsolidadoCacheContext';
import {
  Package, CheckCircle2,
  Clock, AlertCircle, Loader2, AlertTriangle, Target,
  TrendingDown, TrendingUp, Bug, ChevronRight, ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/shared/ToastNotification';
import { cn, InfoTooltip } from '../components/shared/Common';
import { Drawer } from '../components/shared/Drawer';
import { TendenciaChart } from '../components/dashboard/TendenciaChart';
import { PendentesDrawer } from '../components/dashboard/PendentesDrawer';
import { useIsMobile } from '../hooks/useBreakpoint';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface DashSummary {
  run: { id: string; executedAt: string } | null;
  totalORC: number;
  totalFCTS: number;
  totalItems: number;
  filledItems: number;
  totalUnidadesAtivas: number;
}

interface Submission {
  id: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  unidadeVenda: { codigo: string; descricao: string };
  autor: { nome: string };
  refMonth: string;
  submittedAt: string | null;
  rejectionReason?: string | null;
}

interface TendenciaPoint {
  month: string;
  orc: number;
  fcts: number;
  vendas: number;
}

interface DesvioSku {
  codigo: string;
  descricao: string;
  volumeFCTS: number;
  volumeVendaAA: number;
  desvio: number;
}

interface DesviosCriticos {
  skusComDesvio: number;
  familias: string[];
  threshold: number;
  detalhe: { familia: string; skus: DesvioSku[] }[];
}

interface ProdutoCronico {
  unidadeVendaId: string;
  produtoCodigo: string;
  produtoDescricao: string;
  classe: string | null;
  familia: string | null;
  direcao: 'alta' | 'baixa';
  desvioMedio: number;
}

interface AcuraciaUnidade {
  codigo: string;
  descricao: string;
  acuracia: number;
  bias: number;
  ciclosValidos: number;
  totalVendas: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const toMonthParam = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

const STATUS_CLS: Record<string, { cls: string; dot: string }> = {
  APPROVED:  { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  SUBMITTED: { cls: 'bg-amber-50   text-amber-700  border-amber-200',   dot: 'bg-amber-500'   },
  REJECTED:  { cls: 'bg-red-50     text-red-700    border-red-200',     dot: 'bg-red-500'     },
  DRAFT:     { cls: 'bg-slate-100  text-slate-500  border-slate-200',   dot: 'bg-slate-400'   },
};

type DashCacheShape = {
  summary:             DashSummary | null;
  submissions:         Submission[];
  tendencia:           TendenciaPoint[];
  desvios:             DesviosCriticos | null;
  cronicos:            ProdutoCronico[];
  acuraciaUnidades:    AcuraciaUnidade[];
  acuraciaGestorSnap:  AcuraciaUnidade | null;
};

// ── Componente principal ──────────────────────────────────────────────────────

export const DashboardPage: React.FC = () => {
  const { token, user, activeUnidade } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const dashCache = useConsolidadoCache();
  const { t } = useTranslation(['dashboard', 'common']);
  const { fmt, fmtDate } = useFormatter();
  const MESES = t('months', { ns: 'common', returnObjects: true }) as string[];

  const isGestor = user?.perfil === 'gestor';
  const unidade  = activeUnidade?.unidadeVenda;
  const isMobile = useIsMobile();

  const [refDate] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const monthParam = toMonthParam(refDate);

  // ── Inicialização do estado diretamente do cache ────────────────────────────
  const _dashCacheKey = `dashboard|${monthParam}|${isGestor ? (unidade?.codigo ?? '') : 'pcp'}`;
  const _dashCached   = dashCache.getCached(_dashCacheKey) as DashCacheShape | null;

  const [summary,     setSummary]     = useState<DashSummary | null>  (() => _dashCached?.summary          ?? null);
  const [submissions, setSubmissions] = useState<Submission[]>        (() => _dashCached?.submissions       ?? []);
  const [tendencia,   setTendencia]   = useState<TendenciaPoint[]>    (() => _dashCached?.tendencia         ?? []);
  const [desvios,     setDesvios]     = useState<DesviosCriticos | null>(() => _dashCached?.desvios         ?? null);
  const [cronicos,    setCronicos]    = useState<ProdutoCronico[]>    (() => _dashCached?.cronicos           ?? []);
  const [acuraciaUnidades,  setAcuraciaUnidades]  = useState<AcuraciaUnidade[]>(() => _dashCached?.acuraciaUnidades ?? []);
  const [acuraciaGestorSnap, setAcuraciaGestorSnap] = useState<AcuraciaUnidade | null>(() => _dashCached?.acuraciaGestorSnap ?? null);

  // Dois estados de loading separados para exibir KPIs assim que chegarem,
  // sem esperar pelos analytics pesados (cronicos + acuracia)
  const [loadingKpis,      setLoadingKpis]      = useState<boolean>(() => !_dashCached);
  const [loadingAnalytics, setLoadingAnalytics] = useState<boolean>(() => !_dashCached);

  // ── Drawers ────────────────────────────────────────────────────────────────
  const [showDesviosDrawer, setShowDesviosDrawer] = useState(false);
  const [expandedDesvioFamilies, setExpandedDesvioFamilies] = useState<Set<string>>(new Set());
  const [drawerMes, setDrawerMes] = useState<(TendenciaPoint & { desvio: number }) | null>(null);
  const [showUnidadesDrawer, setShowUnidadesDrawer] = useState(false);
  const [allUnidades, setAllUnidades] = useState<{ codigo: string; descricao: string }[]>([]);
  const [loadingUnidades, setLoadingUnidades] = useState(false);

  // Drawer: Produtos pendentes (detalhe do card "Produtos Preenchidos")
  const [showPendentesDrawer, setShowPendentesDrawer] = useState(false);

  useEffect(() => {
    if (!showUnidadesDrawer || allUnidades.length > 0 || loadingUnidades) return;
    setLoadingUnidades(true);
    fetch('/api/unidades', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((data: { codigo: string; descricao: string }[]) => setAllUnidades(data))
      .catch(() => {})
      .finally(() => setLoadingUnidades(false));
  }, [showUnidadesDrawer, allUnidades.length, loadingUnidades, token]);

  const fetchData = useCallback((bustCache = false) => {
    const cacheKey = `dashboard|${monthParam}|${isGestor ? (unidade?.codigo ?? '') : 'pcp'}`;

    // Verificar cache antes de buscar (exceto quando forçado)
    if (!bustCache) {
      const cached = dashCache.getCached(cacheKey) as DashCacheShape | null;
      if (cached) {
        setSummary(cached.summary);
        setSubmissions(cached.submissions);
        setTendencia(cached.tendencia);
        setDesvios(cached.desvios);
        setCronicos(cached.cronicos);
        setAcuraciaUnidades(cached.acuraciaUnidades);
        setAcuraciaGestorSnap(cached.acuraciaGestorSnap ?? null);
        setLoadingKpis(false);
        setLoadingAnalytics(false);
        return;
      }
    }

    setLoadingKpis(true);
    setLoadingAnalytics(true);

    const headers = { Authorization: `Bearer ${token}` };

    let summaryResult: DashSummary | null = null;
    let submissionsResult: Submission[] = [];

    // Faixa 1 — dados rápidos: summary + submissions (~200-400ms)
    const kpiTask = Promise.all([
      fetch(`/api/forecast/summary?month=${monthParam}`, { headers }),
      fetch('/api/submissions', { headers }),
    ]).then(async ([sumRes, subRes]) => {
      if (sumRes.ok) { summaryResult = await sumRes.json(); setSummary(summaryResult); }
      if (subRes.ok) { submissionsResult = await subRes.json(); setSubmissions(submissionsResult); }
    }).finally(() => setLoadingKpis(false));

    // Faixa 2 — analytics pesados: crônicos + acurácia (gestor: tendência + desvios + acuracia-unidades)
    const analyticsRequests: Promise<Response | null>[] = isGestor && unidade
      ? [
          fetch(`/api/forecast/tendencia?unidadeVendaId=${unidade.codigo}`, { headers }),
          fetch(`/api/forecast/desvios?unidadeVendaId=${unidade.codigo}&month=${monthParam}`, { headers }),
          fetch('/api/forecast/acuracia-unidades?meses=3', { headers }),
        ]
      : [
          fetch('/api/forecast/produtos-cronicos', { headers }),
          fetch('/api/forecast/acuracia-unidades?meses=3', { headers }),
        ];

    let tendenciaResult: TendenciaPoint[] = [];
    let desviosResult: DesviosCriticos | null = null;
    let cronicosResult: ProdutoCronico[] = [];
    let acuraciaResult: AcuraciaUnidade[] = [];
    let acuraciaGestorSnapResult: AcuraciaUnidade | null = null;

    const analyticsTask = Promise.all(analyticsRequests).then(async ([resA, resB, resC]) => {
      if (isGestor) {
        if (resA?.ok) { tendenciaResult = await resA.json(); setTendencia(tendenciaResult); }
        if (resB?.ok) { desviosResult   = await resB.json(); setDesvios(desviosResult); }
        if (resC?.ok) {
          const acurList: AcuraciaUnidade[] = await resC.json();
          acuraciaGestorSnapResult = acurList.find(u => u.codigo === unidade?.codigo) ?? null;
          setAcuraciaGestorSnap(acuraciaGestorSnapResult);
        }
      } else {
        if (resA?.ok) { cronicosResult  = await resA.json(); setCronicos(cronicosResult); }
        if (resB?.ok) { acuraciaResult  = await resB.json(); setAcuraciaUnidades(acuraciaResult); }
      }
    }).finally(() => setLoadingAnalytics(false));

    Promise.allSettled([kpiTask, analyticsTask]).then((results) => {
      const failed = results.some(r => r.status === 'rejected');
      if (failed) showToast('Erro ao carregar parte do dashboard', 'error');

      // Salvar no cache apenas quando ambas as faixas terminarem com sucesso
      dashCache.setCached(cacheKey, {
        summary:            summaryResult,
        submissions:        submissionsResult,
        tendencia:          tendenciaResult,
        desvios:            desviosResult,
        cronicos:           cronicosResult,
        acuraciaUnidades:   acuraciaResult,
        acuraciaGestorSnap: acuraciaGestorSnapResult,
      });
    });
  }, [token, monthParam, isGestor, unidade, dashCache]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Métricas derivadas ─────────────────────────────────────────────────────

  const currentMonth = refDate.getMonth();

  const currentMonthSub = isGestor
    ? submissions.find(s => {
        const d = new Date(s.refMonth);
        return d.getUTCFullYear() === refDate.getFullYear()
            && d.getUTCMonth()    === refDate.getMonth();
      })
    : null;
  const _subStatus = currentMonthSub?.status ?? 'DRAFT';
  const subStatusCfg = {
    ...STATUS_CLS[_subStatus],
    label: t(`status.${_subStatus}`, { ns: 'common' }),
  };

  const pendingCount  = submissions.filter(s => s.status === 'SUBMITTED').length;


  // Banner de rejeição: submissão REJECTED do ciclo corrente
  const rejectedSub = isGestor
    ? submissions.find(s => {
        const d = new Date(s.refMonth);
        return s.status === 'REJECTED'
            && d.getUTCFullYear() === refDate.getFullYear()
            && d.getUTCMonth()    === refDate.getMonth();
      })
    : null;

  // ── Métricas PCP (admin/controladoria) ─────────────────────────────────

  // Total de unidades activas vem do summary (backend) — não depende de submissions históricas
  const totalUnidades = summary?.totalUnidadesAtivas ?? 0;

  // Unidades únicas com alguma submissão no ciclo corrente
  const unidadesNoMes = useMemo(() => {
    const submissoesMes = submissions.filter(s => {
      const d = new Date(s.refMonth);
      return d.getUTCFullYear() === refDate.getFullYear()
          && d.getUTCMonth()    === refDate.getMonth();
    });
    return new Set(submissoesMes.map(s => s.unidadeVenda.codigo));
  }, [submissions, refDate]);

  const unidadesSemSubmissao = totalUnidades > 0
    ? Math.max(0, totalUnidades - unidadesNoMes.size)
    : null;

  // Desvio FCTS/ORC do ciclo corrente (baseado no summary global do ciclo)
  const desvioMedioFctsOrc = useMemo(() => {
    if (!summary || summary.totalORC === 0 || summary.totalFCTS === 0) return null;
    return ((summary.totalFCTS / summary.totalORC) - 1) * 100;
  }, [summary]);

  // Acurácia global 3M — média ponderada pelo volume de vendas de cada unidade
  const acuraciaGlobal = useMemo(() => {
    if (acuraciaUnidades.length === 0) return null;
    const totalPeso = acuraciaUnidades.reduce((s, a) => s + (a.totalVendas || a.ciclosValidos), 0);
    if (totalPeso === 0) return null;
    return parseFloat(
      (acuraciaUnidades.reduce((s, a) => s + a.acuracia * (a.totalVendas || a.ciclosValidos), 0) / totalPeso).toFixed(1)
    );
  }, [acuraciaUnidades]);

  const noData = !summary?.run;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900">{t('title')}</h2>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-sm text-slate-500">
            {MESES[currentMonth]} {refDate.getFullYear()}
            {isGestor && unidade && (
              <span className="ml-2 px-2 py-0.5 bg-sky-50 text-sky-700 text-xs font-bold rounded-full border border-sky-200">
                {unidade.codigo} — {unidade.descricao}
              </span>
            )}
          </p>
          <button
            onClick={() => fetchData(true)}
            title={t('actions.reload', { ns: 'common' })}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* KPI cards: aparecem assim que summary + submissions chegam */}
      {loadingKpis ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> {t('actions.loading', { ns: 'common' })}
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div data-tour="dashboard-kpis" className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">

            {isGestor ? (
              <>
                {/* Card 1 — Desvios Críticos */}
                <button
                  onClick={() => desvios && setShowDesviosDrawer(true)}
                  disabled={!desvios}
                  className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-left w-full transition-all duration-200 hover:border-slate-300 hover:shadow-md cursor-pointer disabled:cursor-default"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className={cn(
                      'p-2 rounded-lg',
                      desvios && desvios.skusComDesvio > 0
                        ? 'bg-amber-50 text-amber-600'
                        : 'bg-emerald-50 text-emerald-600'
                    )}>
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    {desvios && (
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                        {t('labels.desvioThreshold', { value: desvios.threshold })}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-slate-500 mb-1">{t('cards.criticalDeviations')}</p>
                  {noData || !desvios ? (
                    <p className="text-xl font-bold text-slate-300">—</p>
                  ) : (
                    <>
                      <h3 className={cn(
                        'text-2xl font-bold mb-1',
                        desvios.skusComDesvio > 0 ? 'text-amber-600' : 'text-emerald-600'
                      )}>
                        {desvios.skusComDesvio}
                        <span className="text-sm font-normal text-slate-400 ml-1">SKUs</span>
                      </h3>
                      <p className="text-xs text-slate-400">
                        {desvios.skusComDesvio === 0
                          ? t('labels.allWithinLimit')
                          : t('labels.familiesCount', { count: desvios.familias.length })}
                      </p>
                    </>
                  )}
                </button>

                {/* Card 2 — Produtos Preenchidos */}
                {(() => {
                  const pendingCnt = summary ? summary.totalItems - summary.filledItems : 0;
                  return (
                    <button
                      onClick={() => !noData && pendingCnt > 0 && setShowPendentesDrawer(true)}
                      disabled={noData || pendingCnt === 0}
                      className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-left w-full transition-all duration-200 hover:border-slate-300 hover:shadow-md cursor-pointer disabled:cursor-default disabled:hover:border-slate-200 disabled:hover:shadow-sm"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg w-fit">
                          <Package className="w-5 h-5" />
                        </div>
                        {!noData && pendingCnt > 0 && (
                          <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                            {t('labels.pendingBadge', { count: pendingCnt })}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-slate-500 mb-1">{t('cards.filledProducts')}</p>
                      {noData ? (
                        <p className="text-xl font-bold text-slate-300">—</p>
                      ) : (
                        <>
                          <h3 className="text-2xl font-bold text-slate-900 mb-1">
                            {summary!.filledItems} / {summary!.totalItems}
                          </h3>
                          <p className="text-xs text-slate-400 font-medium">
                            {summary!.totalItems > 0
                              ? t('labels.portfolioPct', { value: ((summary!.filledItems / summary!.totalItems) * 100).toFixed(0) })
                              : t('labels.noData')}
                          </p>
                        </>
                      )}
                    </button>
                  );
                })()}

                {/* Card 3 — Status do Mês */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="p-2 bg-amber-50 text-amber-600 rounded-lg w-fit mb-4">
                    <Clock className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-medium text-slate-500 mb-2">{t('cards.monthStatus')}</p>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', subStatusCfg.dot)} />
                    <h3 className="text-xl font-bold text-slate-900">{subStatusCfg.label}</h3>
                  </div>
                  <p className="text-xs text-slate-400">
                    {MESES[currentMonth]}/{refDate.getFullYear()} — {t('labels.currentSubmission')}
                  </p>
                  {currentMonthSub?.submittedAt && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {fmtDate(currentMonthSub.submittedAt)}
                    </p>
                  )}
                </div>

                {/* Card 4 — Acurácia do Forecast */}
                {(() => {
                  const acurSnap = acuraciaGestorSnap?.acuracia ?? null;
                  return (
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div className={cn(
                        'p-2 rounded-lg w-fit mb-4',
                        acurSnap === null      ? 'bg-slate-50 text-slate-400'    :
                        acurSnap >= 90         ? 'bg-emerald-50 text-emerald-600' :
                        acurSnap >= 75         ? 'bg-amber-50 text-amber-600'    :
                                                 'bg-red-50 text-red-600'
                      )}>
                        <Target className="w-5 h-5" />
                      </div>
                      <p className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
                        {t('cards.unitAccuracy')}
                        <InfoTooltip
                          text={t('tooltips.unitAccuracy')}
                          width="w-80"
                        />
                      </p>
                      {loadingAnalytics ? (
                        <>
                          <p className="text-xl font-bold text-slate-300">—</p>
                          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> {t('labels.calculating')}
                          </p>
                        </>
                      ) : acurSnap === null ? (
                        <>
                          <p className="text-xl font-bold text-slate-300">—</p>
                          <p className="text-xs text-slate-400 mt-1">{t('labels.waitingRealSales')}</p>
                        </>
                      ) : (
                        <>
                          <h3 className={cn(
                            'text-2xl font-bold mb-1',
                            acurSnap >= 90 ? 'text-emerald-600' :
                            acurSnap >= 75 ? 'text-amber-600'   : 'text-red-600'
                          )}>
                            {acurSnap.toFixed(1)}%
                          </h3>
                          <p className="text-xs text-slate-400">
                            {t('kpi.accuracyMonthsData', { ns: 'consolidado', count: acuraciaGestorSnap?.ciclosValidos ?? 0 })}
                          </p>
                        </>
                      )}
                    </div>
                  );
                })()}
              </>
            ) : (
              <>
                {/* Controladoria — Card 1: Progresso do Ciclo */}
                {(() => {
                  const submitted  = unidadesNoMes.size;
                  const pct        = totalUnidades > 0 ? (submitted / totalUnidades) * 100 : 0;
                  const allDone    = totalUnidades > 0 && submitted >= totalUnidades;
                  const noneYet    = submitted === 0;
                  return (
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all duration-200 hover:shadow-md hover:border-slate-300">
                      <div className="flex items-start justify-between mb-4">
                        <div className={cn(
                          'p-2 rounded-lg',
                          allDone ? 'bg-emerald-50 text-emerald-600' :
                          noneYet ? 'bg-slate-50 text-slate-400'     :
                                    'bg-sky-50 text-sky-600'
                        )}>
                          <Package className="w-5 h-5" />
                        </div>
                        <span className={cn(
                          'text-[10px] font-bold px-2 py-0.5 rounded-full',
                          allDone ? 'bg-emerald-50 text-emerald-700' :
                          noneYet ? 'bg-slate-100 text-slate-400'    :
                                    'bg-sky-50 text-sky-700'
                        )}>
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                      <p className="text-sm font-medium text-slate-500 mb-1">{t('cards.cycleProgress')}</p>
                      {totalUnidades === 0 ? (
                        <p className="text-xl font-bold text-slate-300">—</p>
                      ) : (
                        <>
                          <h3 className={cn(
                            'text-2xl font-bold mb-0.5',
                            allDone ? 'text-emerald-600' : noneYet ? 'text-slate-400' : 'text-sky-600'
                          )}>
                            {submitted}
                            <span className="text-sm font-normal text-slate-400 ml-1">/ {totalUnidades} unidades</span>
                          </h3>
                          <p className="text-xs text-slate-400 mb-3">
                            {allDone ? t('labels.allSubmitted') : `${totalUnidades - submitted} ${t(totalUnidades - submitted !== 1 ? 'labels.pendingSuffix_other' : 'labels.pendingSuffix_one', { count: totalUnidades - submitted })}`} — {MESES[currentMonth]}/{refDate.getFullYear()}
                          </p>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={cn('h-full rounded-full transition-all', allDone ? 'bg-emerald-500' : 'bg-sky-500')}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}

                {/* Controladoria — Card 2: Pendentes de Aprovação */}
                <button
                  onClick={() => navigate('/aprovacoes')}
                  className={cn(
                    'cursor-pointer bg-white p-6 rounded-2xl border shadow-sm text-left w-full transition-all duration-200 hover:shadow-md',
                    pendingCount > 0 ? 'border-amber-200 hover:border-amber-300' : 'border-slate-200 hover:border-slate-300'
                  )}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className={cn(
                      'p-2 rounded-lg',
                      pendingCount > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-400'
                    )}>
                      <Clock className="w-5 h-5" />
                    </div>
                    {pendingCount > 0 && (
                      <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                        {t('labels.waiting')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-slate-500 mb-1">{t('cards.pendingApproval')}</p>
                  <h3 className={cn(
                    'text-2xl font-bold mb-1',
                    pendingCount > 0 ? 'text-amber-600' : 'text-slate-900'
                  )}>
                    {pendingCount}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {t('labels.pendingSubmissions', { count: pendingCount })}
                  </p>
                  {pendingCount > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {submissions
                        .filter(s => s.status === 'SUBMITTED')
                        .slice(0, 2)
                        .map(s => (
                          <div key={s.id} className="flex items-center gap-2 text-[11px] text-slate-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                            <span className="truncate">{s.unidadeVenda.descricao}</span>
                          </div>
                        ))}
                      {pendingCount > 2 && (
                        <p className="text-[10px] text-amber-600 font-semibold">
                          {t('labels.moreToReview', { count: pendingCount - 2 })}
                        </p>
                      )}
                    </div>
                  )}
                </button>

                {/* Controladoria — Card 3: Aprovadas */}
                {/* Controladoria — Card 3: Taxa de Aprovação Direta */}
                {(() => {
                  const subsDoAno = submissions.filter(s => {
                    const d = new Date(s.refMonth);
                    return d.getUTCFullYear() === refDate.getFullYear();
                  });
                  const aprovadas  = subsDoAno.filter(s => s.status === 'APPROVED').length;
                  const rejeitadas = subsDoAno.filter(s => s.status === 'REJECTED').length;
                  const base       = aprovadas + rejeitadas;
                  const taxa       = base > 0 ? (aprovadas / base) * 100 : null;
                  const retrabalho = rejeitadas;
                  return (
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all duration-200 hover:shadow-md hover:border-slate-300">
                      <div className="flex items-start justify-between mb-4">
                        <div className={cn(
                          'p-2 rounded-lg',
                          taxa === null       ? 'bg-slate-50 text-slate-400'  :
                          taxa === 100        ? 'bg-emerald-50 text-emerald-600' :
                          taxa >= 80          ? 'bg-emerald-50 text-emerald-600' :
                          taxa >= 60          ? 'bg-amber-50 text-amber-600'  :
                                                'bg-red-50 text-red-600'
                        )}>
                          <CheckCircle2 className="w-5 h-5" />
                        </div>
                        {taxa !== null && (
                          <span className={cn(
                            'text-[10px] font-bold px-2 py-0.5 rounded-full',
                            taxa === 100 ? 'bg-emerald-50 text-emerald-700' :
                            taxa >= 80   ? 'bg-emerald-50 text-emerald-700' :
                            taxa >= 60   ? 'bg-amber-50 text-amber-700'    :
                                           'bg-red-50 text-red-700'
                          )}>
                            {taxa === 100 ? t('labels.noRejections') : t('labels.rework', { count: retrabalho })}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-slate-500 mb-1">
                        {t('cards.approvalRate')}
                      </p>
                      {taxa === null ? (
                        <>
                          <p className="text-xl font-bold text-slate-300">—</p>
                          <p className="text-xs text-slate-400 mt-1">{t('labels.noApprovalsYear')}</p>
                        </>
                      ) : (
                        <>
                          <h3 className={cn(
                            'text-2xl font-bold mb-0.5',
                            taxa === 100 ? 'text-emerald-600' :
                            taxa >= 80   ? 'text-emerald-600' :
                            taxa >= 60   ? 'text-amber-600'   : 'text-red-600'
                          )}>
                            {taxa.toFixed(0)}%
                          </h3>
                          <p className="text-xs text-slate-400 mb-3">
                            {t('labels.approvalStats', { approved: aprovadas, rejected: rejeitadas, year: refDate.getFullYear() })}
                          </p>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all',
                                taxa === 100 ? 'bg-emerald-500' : taxa >= 80 ? 'bg-emerald-500' : taxa >= 60 ? 'bg-amber-500' : 'bg-red-500'
                              )}
                              style={{ width: `${taxa}%` }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}

                {/* Controladoria — Card 4: Acurácia Global 3M */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all duration-200 hover:shadow-md hover:border-slate-300">
                  <div className="flex items-start justify-between mb-4">
                    <div className={cn(
                      'p-2 rounded-lg',
                      acuraciaGlobal === null      ? 'bg-slate-50 text-slate-400'   :
                      acuraciaGlobal >= 90         ? 'bg-emerald-50 text-emerald-600' :
                      acuraciaGlobal >= 75         ? 'bg-amber-50 text-amber-600'    :
                                                     'bg-red-50 text-red-600'
                    )}>
                      <Target className="w-5 h-5" />
                    </div>
                    {acuraciaGlobal !== null && (
                      <span className={cn(
                        'text-[10px] font-bold px-2 py-0.5 rounded-full',
                        acuraciaGlobal >= 90 ? 'bg-emerald-50 text-emerald-700' :
                        acuraciaGlobal >= 75 ? 'bg-amber-50 text-amber-700'     :
                                               'bg-red-50 text-red-700'
                      )}>
                        {acuraciaGlobal >= 90 ? t('labels.accuracyGood') : acuraciaGlobal >= 75 ? t('labels.accuracyRegular') : t('labels.accuracyCritical')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-slate-500 mb-1">{t('cards.globalAccuracy')}</p>
                  {loadingAnalytics ? (
                    <>
                      <p className="text-xl font-bold text-slate-300">—</p>
                      <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> {t('labels.calculating')}
                      </p>
                    </>
                  ) : acuraciaGlobal === null ? (
                    <>
                      <p className="text-xl font-bold text-slate-300">—</p>
                      <p className="text-xs text-slate-400 mt-1">{t('labels.waitingRealSales')}</p>
                    </>
                  ) : (
                    <>
                      <h3 className={cn(
                        'text-2xl font-bold mb-1',
                        acuraciaGlobal >= 90 ? 'text-emerald-600' :
                        acuraciaGlobal >= 75 ? 'text-amber-600'   : 'text-red-600'
                      )}>
                        {acuraciaGlobal.toFixed(1)}%
                      </h3>
                      <p className="text-xs text-slate-400">
                        {t('labels.unitsAbove90', { above: acuraciaUnidades.filter(a => a.acuracia >= 90).length, total: acuraciaUnidades.length })}
                      </p>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* PCP — Segunda linha de cards (apenas admin/controladoria) */}
          {!isGestor && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Card PCP 1 — Unidades sem Submissão (clicável) */}
              <button
                onClick={() => setShowUnidadesDrawer(true)}
                className={cn(
                  'cursor-pointer bg-white p-6 rounded-2xl border shadow-sm text-left w-full transition-all duration-200 hover:shadow-md',
                  unidadesSemSubmissao === null ? 'border-slate-200 hover:border-slate-300' :
                  unidadesSemSubmissao > 0      ? 'border-amber-200 bg-amber-50/20 hover:border-amber-300' :
                                                  'border-emerald-200 hover:border-emerald-300'
                )}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className={cn(
                    'p-2 rounded-lg',
                    unidadesSemSubmissao === null || unidadesSemSubmissao === 0
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-amber-50 text-amber-600'
                  )}>
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                      {MESES[currentMonth]}/{refDate.getFullYear()}
                    </span>
                    {unidadesSemSubmissao !== null && unidadesSemSubmissao > 0 && (
                      <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                        {t('labels.seeMore')}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-sm font-medium text-slate-500 mb-1">{t('cards.unitsWithoutSubmission')}</p>
                {unidadesSemSubmissao === null ? (
                  <p className="text-xl font-bold text-slate-300">—</p>
                ) : (
                  <>
                    <h3 className={cn(
                      'text-2xl font-bold mb-1',
                      unidadesSemSubmissao > 0 ? 'text-amber-600' : 'text-emerald-600'
                    )}>
                      {unidadesSemSubmissao}
                      <span className="text-sm font-normal text-slate-400 ml-1">
                        {t('labels.unitsWord', { count: unidadesSemSubmissao })}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      {unidadesSemSubmissao === 0
                        ? t('labels.allUnitsSubmittedDetail')
                        : t('labels.unitsOf', { total: totalUnidades })}
                    </p>
                  </>
                )}
              </button>

              {/* Card PCP 2 — Desvio Médio FCTS/ORC */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className={cn(
                    'p-2 rounded-lg',
                    desvioMedioFctsOrc === null            ? 'bg-slate-50 text-slate-400' :
                    Math.abs(desvioMedioFctsOrc) <= 10     ? 'bg-emerald-50 text-emerald-600' :
                    Math.abs(desvioMedioFctsOrc) <= 25     ? 'bg-amber-50 text-amber-600' :
                                                              'bg-red-50 text-red-600'
                  )}>
                    {desvioMedioFctsOrc !== null && desvioMedioFctsOrc >= 0
                      ? <TrendingUp className="w-5 h-5" />
                      : <TrendingDown className="w-5 h-5" />}
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                    {t('legend.fcts')} vs {t('legend.orc')}
                  </span>
                </div>
                <p className="text-sm font-medium text-slate-500 mb-1">{t('cards.fctsOrcDeviation')}</p>
                {desvioMedioFctsOrc === null ? (
                  <>
                    <p className="text-xl font-bold text-slate-300">—</p>
                    <p className="text-xs text-slate-400 mt-1">{t('labels.noDataCycle')}</p>
                  </>
                ) : (
                  <>
                    <h3 className={cn(
                      'text-2xl font-bold mb-1',
                      Math.abs(desvioMedioFctsOrc) <= 10  ? 'text-emerald-600' :
                      Math.abs(desvioMedioFctsOrc) <= 25  ? 'text-amber-600'   : 'text-red-600'
                    )}>
                      {desvioMedioFctsOrc > 0 ? '+' : ''}{desvioMedioFctsOrc.toFixed(1)}%
                    </h3>
                    <p className="text-xs text-slate-400">
                      {desvioMedioFctsOrc > 0
                        ? t('labels.overestimate')
                        : t('labels.underestimate')}
                    </p>
                  </>
                )}
              </div>

            </div>
          )}

          {/* Banner de rejeição — gestor */}
          {rejectedSub && (
            <div className="rounded-2xl border border-red-200 bg-white overflow-hidden shadow-sm">
              <div className="flex items-start gap-4 px-5 py-4 bg-red-50 border-b border-red-100">
                <div className="shrink-0 mt-0.5 flex items-center justify-center w-9 h-9 rounded-full bg-red-100 text-red-600">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-red-800">{t('rejection.title')}</p>
                  <p className="text-xs text-red-500 mt-0.5">
                    {MESES[new Date(rejectedSub.refMonth).getUTCMonth()]}/{new Date(rejectedSub.refMonth).getUTCFullYear()}
                  </p>
                </div>
                <button
                  onClick={() => navigate('/meu-forecast')}
                  className="shrink-0 self-center text-xs font-bold text-red-600 hover:text-red-700 bg-white hover:bg-red-50 border border-red-200 hover:border-red-300 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                >
                  {t('actions.goToForecast')}
                </button>
              </div>
              {rejectedSub.rejectionReason && (
                <div className="px-5 py-3 bg-white border-b border-red-100">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('rejection.reasonLabel')}</p>
                  <p className="text-sm text-slate-700">{rejectedSub.rejectionReason}</p>
                </div>
              )}
              <div className="px-5 py-3 bg-red-50/50">
                <p className="text-xs text-red-500 font-medium">{t('rejection.reviewHint')}</p>
              </div>
            </div>
          )}

          {/* Card Produtos Crônicos — admin/controladoria */}
          {!isGestor && cronicos.length > 0 && (() => {
            // Índice de atingimento: desvio=(fcts/vendas-1)*100 → ating=100/(1+desvio/100)
            const atingimento = (c: ProdutoCronico) => {
              if (c.desvioMedio <= -100) return 200; // edge case
              return parseFloat((100 / (1 + c.desvioMedio / 100)).toFixed(1));
            };
            const altaCount  = cronicos.filter(c => c.direcao === 'alta').length;
            const baixaCount = cronicos.filter(c => c.direcao === 'baixa').length;
            const exProduto  = cronicos[0];
            const exAting    = exProduto ? atingimento(exProduto) : null;
            return (
              <button
                onClick={() => navigate('/consolidado')}
                className="cursor-pointer w-full bg-white border border-orange-200 hover:border-orange-300 rounded-2xl px-6 py-5 text-left shadow-sm hover:shadow-md transition-all duration-200 group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-50 text-orange-500 rounded-lg">
                      <Bug className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-orange-700">
                        {t('cronicos.persistentDeviation', { count: cronicos.length })}
                      </p>
                      <p className="text-xs text-orange-500">{t('cronicos.cycles')}</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-orange-600 group-hover:text-orange-800 transition-colors shrink-0 mt-0.5">
                    {t('cronicos.viewConsolidado')}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {altaCount > 0 && (
                    <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                      {altaCount} Exc. FCTS
                    </span>
                  )}
                  {baixaCount > 0 && (
                    <span className="text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 rounded-full">
                      {baixaCount} Déf. FCTS
                    </span>
                  )}
                  {exProduto && exAting !== null && (
                    <span className="text-[10px] text-slate-500 ml-1">
                      ex.: <span className="font-mono font-bold text-slate-700">{exProduto.produtoCodigo}</span>
                      {' '}
                      <span className={cn(
                        'font-bold',
                        exAting >= 90 ? 'text-emerald-600' :
                        exAting >= 70 ? 'text-amber-600'   : 'text-red-600'
                      )}>
                        ({t('cronicos.achievement', { value: exAting.toFixed(0) })})
                      </span>
                    </span>
                  )}
                </div>
              </button>
            );
          })()}

          {/* Gráfico / analytics — skeleton enquanto os dados pesados carregam */}
          {loadingAnalytics ? (
            <div className="animate-pulse bg-slate-100 rounded-2xl h-64" />
          ) : isGestor ? (
            tendencia.length > 0
              ? <TendenciaChart data={tendencia} onBarClick={setDrawerMes} />
              : (
                <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center py-16 text-slate-400">
                  <AlertCircle className="w-10 h-10 text-slate-200 mb-3" />
                  <p className="font-medium">{t('tendencia.noData')}</p>
                  <p className="text-sm">{t('tendencia.noDataDetail')}</p>
                </div>
              )
          ) : (
            /* Acurácia por Unidade — substitui o gráfico de Submissões/mês (pouco acionável para PCP) */
            <div className="bg-white p-4 md:p-8 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{t('tendencia.title')}</h3>
                  <p className="text-sm text-slate-500">
                    {t('tendencia.deviationSubtitle')}
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { color: 'bg-emerald-400', label: '≥ 80%'  },
                    { color: 'bg-amber-400',   label: '65–80%' },
                    { color: 'bg-red-400',     label: '< 65%'  },
                  ].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-medium text-slate-600">
                      <div className={cn('w-2.5 h-2.5 rounded-sm', color)} /> {label}
                    </div>
                  ))}
                </div>
              </div>
              {acuraciaUnidades.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-300">
                  <AlertCircle className="w-8 h-8 mb-2" />
                  <p className="text-sm">{t('tendencia.waitingData')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {[...acuraciaUnidades]
                    .sort((a, b) => a.acuracia - b.acuracia)
                    .map(u => {
                      const pct   = Math.min(Math.max(u.acuracia, 0), 100);
                      const color = pct >= 80 ? 'bg-emerald-500' : pct >= 65 ? 'bg-amber-500' : 'bg-red-500';
                      const text  = pct >= 80 ? 'text-emerald-700' : pct >= 65 ? 'text-amber-700' : 'text-red-700';
                      const biasTxt = u.bias > 0.5
                        ? `↑ +${u.bias.toFixed(1)}%`
                        : u.bias < -0.5
                          ? `↓ ${u.bias.toFixed(1)}%`
                          : '✓';
                      return (
                        <div key={u.codigo} className="flex items-center gap-3">
                          <div className={cn('shrink-0 text-right', isMobile ? 'w-20' : 'w-36')}>
                            <p className="text-xs font-bold text-slate-700 truncate" title={u.descricao}>{u.descricao}</p>
                            <p className={cn('text-[10px] font-medium', text)}>{biasTxt}</p>
                          </div>
                          <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={cn('h-full rounded-full transition-all', color)}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={cn('w-12 text-right text-xs font-bold shrink-0', text)}>
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Drawer: Unidades sem Submissão ───────────────────────────────── */}
      <Drawer
        isOpen={showUnidadesDrawer}
        onClose={() => setShowUnidadesDrawer(false)}
        title={t('cards.unitsWithoutSubmission')}
        subtitle={`Ciclo ${MESES[currentMonth]}/${refDate.getFullYear()} · ${unidadesSemSubmissao ?? 0} pendente${unidadesSemSubmissao !== 1 ? 's' : ''}`}
      >
        {loadingUnidades ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
          </div>
        ) : (() => {
          const pendingUnidades = allUnidades.filter(u => !unidadesNoMes.has(u.codigo));
          const submittedUnidades = allUnidades.filter(u => unidadesNoMes.has(u.codigo));
          return (
            <div className="space-y-5">
              {pendingUnidades.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                  </div>
                  <p className="text-sm font-semibold text-emerald-700">{t('labels.allUnitsSubmitted')}</p>
                  <p className="text-xs text-slate-400">{t('labels.noPendingUnits')}</p>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('labels.pending')}</p>
                    {pendingUnidades.map(u => (
                      <div key={u.codigo} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-100">
                        <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-700">{u.descricao}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{u.codigo}</p>
                        </div>
                        <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full shrink-0">
                          {t('labels.waiting')}
                        </span>
                      </div>
                    ))}
                  </div>
                  {submittedUnidades.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('labels.submitted')}</p>
                      {submittedUnidades.map(u => (
                        <div key={u.codigo} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-100">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-slate-700">{u.descricao}</p>
                            <p className="text-[10px] text-slate-400 font-mono">{u.codigo}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="pt-2 border-t border-slate-100">
                    <button
                      onClick={() => { setShowUnidadesDrawer(false); navigate('/aprovacoes'); }}
                      className="w-full flex items-center justify-center gap-2 py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-xl transition-colors"
                    >
                      {t('actions.goToApprovals')} <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </Drawer>

      {/* ── Drawer: Desvios Críticos ─────────────────────────────────────── */}
      <Drawer
        isOpen={showDesviosDrawer}
        onClose={() => setShowDesviosDrawer(false)}
        title={t('cards.criticalDeviations')}
        subtitle={desvios
          ? desvios.skusComDesvio > 0
            ? t('drawer.skusAboveThreshold', { count: desvios.skusComDesvio, threshold: desvios.threshold })
            : t('labels.currentCycle')
          : undefined}
      >
        {desvios && (
          desvios.skusComDesvio === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              </div>
              <p className="text-sm font-semibold text-emerald-700">{t('labels.noDeviations')}</p>
              <p className="text-xs text-slate-400">{t('drawer.allWithinLimit', { threshold: desvios.threshold })}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                {t('drawer.deviationDescription', { threshold: desvios.threshold })}
              </p>

              {desvios.detalhe.map(({ familia, skus }) => {
                const isExpanded = expandedDesvioFamilies.has(familia);
                const maxDesvio = Math.max(...skus.map(s => Math.abs(s.desvio)));
                return (
                  <div key={familia} className="rounded-xl border border-slate-100 overflow-hidden">
                    <button
                      onClick={() => setExpandedDesvioFamilies(prev => {
                        const next = new Set(prev);
                        next.has(familia) ? next.delete(familia) : next.add(familia);
                        return next;
                      })}
                      className="w-full flex items-center gap-2 px-4 py-2.5 bg-amber-50 hover:bg-amber-100 transition-colors text-left"
                    >
                      {isExpanded
                        ? <ChevronUp className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        : <ChevronDown className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                      <span className="text-xs font-bold text-slate-700 flex-1">{familia}</span>
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                        {skus.length} SKU{skus.length !== 1 ? 's' : ''}
                      </span>
                      <span className={cn(
                        'text-[10px] font-bold px-2 py-0.5 rounded-full',
                        maxDesvio > 30 ? 'bg-red-100 text-red-700' : 'bg-orange-50 text-orange-700'
                      )}>
                        {t('drawer.maxDeviation', { value: maxDesvio.toFixed(0) })}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="divide-y divide-slate-50">
                        {skus.map((sku) => {
                          const fmtV = fmt;
                          const isAlta = sku.desvio > 0;
                          return (
                            <div key={sku.codigo} className="px-4 py-3 space-y-1.5">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-xs font-bold text-slate-700 font-mono">{sku.codigo}</p>
                                  <p className="text-[11px] text-slate-500 truncate max-w-[220px]">{sku.descricao}</p>
                                </div>
                                <span className={cn(
                                  'text-xs font-bold px-2 py-0.5 rounded-full shrink-0',
                                  isAlta ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                                )}>
                                  {sku.desvio > 0 ? '+' : ''}{sku.desvio.toFixed(1)}%
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-[11px]">
                                <div className="bg-slate-50 rounded-lg px-2.5 py-1.5">
                                  <p className="text-slate-400 text-[9px] font-bold uppercase mb-0.5">{t('legend.vendaAA')}</p>
                                  <p className="font-bold text-slate-600 tabular-nums">{fmtV(sku.volumeVendaAA)}</p>
                                </div>
                                <div className="bg-blue-50 rounded-lg px-2.5 py-1.5">
                                  <p className="text-blue-400 text-[9px] font-bold uppercase mb-0.5">{t('legend.fcts')}</p>
                                  <p className="font-bold text-blue-700 tabular-nums">{fmtV(sku.volumeFCTS)}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="pt-2 border-t border-slate-100 hidden md:block">
                <button
                  onClick={() => { setShowDesviosDrawer(false); navigate('/meu-forecast'); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  {t('actions.goToForecast')} <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        )}
      </Drawer>

      {/* ── Drawer: Produtos Pendentes ───────────────────────────────────── */}
      <PendentesDrawer
        isOpen={showPendentesDrawer}
        onClose={() => setShowPendentesDrawer(false)}
        token={token}
        month={monthParam}
        onGoToForecast={() => { setShowPendentesDrawer(false); navigate('/meu-forecast'); }}
      />

      {/* ── Drawer: Detalhe do mês (TendenciaChart) ─────────────────────── */}
      <Drawer
        isOpen={!!drawerMes}
        onClose={() => setDrawerMes(null)}
        title={drawerMes ? (() => { const [y, m] = drawerMes.month.split('-').map(Number); return `${MESES[m-1]}/${String(y).slice(2)}`; })() : ''}
        subtitle={t('legend.subtitle')}
      >
        {drawerMes && (() => {
          const d = drawerMes.desvio;
          const desvioColor = Math.abs(d) <= 10 ? 'text-emerald-600' : Math.abs(d) <= 20 ? 'text-amber-600' : 'text-red-600';
          const desvioKey = Math.abs(d) <= 10 ? 'ok' : Math.abs(d) <= 20 ? 'warning' : 'critical';
          const desvioLabel = t(`labels.deviation.${desvioKey}`);
          return (
            <div className="space-y-4">
              <div className={cn('flex items-center justify-between px-4 py-3 rounded-xl border', Math.abs(d) <= 10 ? 'bg-emerald-50 border-emerald-100' : Math.abs(d) <= 20 ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100')}>
                <span className="text-sm font-medium text-slate-600">{t('drawer.fctsVsSale')}</span>
                <div className="text-right">
                  <p className={cn('text-xl font-bold', desvioColor)}>
                    {d >= 0 ? '+' : ''}{d.toFixed(1)}%
                  </p>
                  <p className={cn('text-[10px] font-bold', desvioColor)}>{desvioLabel}</p>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { label: t('legend.orc'),   value: drawerMes.orc,   color: 'text-slate-500', bg: 'bg-slate-50 border-slate-100' },
                  { label: t('legend.fcts'),  value: drawerMes.fcts,  color: 'text-blue-600',  bg: 'bg-blue-50 border-blue-100' },
                  { label: t('legend.vendas'), value: drawerMes.vendas, color: 'text-teal-600', bg: 'bg-teal-50 border-teal-100' },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} className={cn('flex items-center justify-between px-4 py-3 rounded-xl border', bg)}>
                    <span className="text-sm font-medium text-slate-600">{label}</span>
                    <span className={cn('text-base font-bold tabular-nums', color)}>{fmt(value)}</span>
                  </div>
                ))}
              </div>
              {drawerMes.orc > 0 && (
                <div className="px-4 py-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                  <p className="text-xs text-slate-500 font-medium">{t('drawer.achievementVsORC')}</p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full"
                        style={{ width: `${Math.min((drawerMes.fcts / drawerMes.orc) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold text-slate-700 tabular-nums">
                      {((drawerMes.fcts / drawerMes.orc) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
              <button
                onClick={() => { setDrawerMes(null); navigate('/consolidado'); }}
                className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
              >
                {t('drawer.viewConsolidado')}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          );
        })()}
      </Drawer>
    </div>
  );
};
