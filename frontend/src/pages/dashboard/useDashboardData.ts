/**
 * Dados do Dashboard com cache por mês/perfil (ConsolidadoCacheContext).
 *
 * Busca em duas faixas para os KPIs aparecerem antes dos analytics pesados:
 *   1. summary + submissions (rápido)
 *   2. gestor: tendência, desvios e acurácia da unidade · PCP: crônicos e acurácia por unidade
 * O estado inicial vem do cache síncrono, então a navegação de volta ao Dashboard não pisca.
 */
import { useEffect, useState, useCallback } from 'react';
import { useConsolidadoCache } from '../../context/ConsolidadoCacheContext';
import { useToast } from '../../components/shared/ToastNotification';
import type { DashSummary, Submission, TendenciaPoint, DesviosCriticos, ProdutoCronico, AcuraciaUnidade, DashCacheShape } from './types';

interface UseDashboardDataParams {
  token:      string | null;
  monthParam: string;
  isGestor:   boolean;
  unidade?:   { codigo: string };
}

export function useDashboardData({ token, monthParam, isGestor, unidade }: UseDashboardDataParams) {
  const { showToast } = useToast();
  const dashCache = useConsolidadoCache();

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

  return {
    summary, submissions, tendencia, desvios, cronicos, acuraciaUnidades, acuraciaGestorSnap,
    loadingKpis, loadingAnalytics, fetchData,
  };
}
