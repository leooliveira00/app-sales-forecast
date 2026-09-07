import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useConsolidadoCache } from '../context/ConsolidadoCacheContext';
import {
  TrendingUp, ShoppingCart, Target, Activity, AlertCircle, Loader2,
  BarChart2, Bug, RefreshCw, X, CalendarRange, Download,
} from 'lucide-react';
import { WindowSelector } from '../components/consolidado/WindowSelector';
import { CountryTabBar } from '../components/consolidado/CountryTabBar';
import { useAuth } from '../hooks/useAuth';
import { useCountryName } from '../hooks/useCountryName';
import { useToast } from '../components/shared/ToastNotification';
import { cn, InfoTooltip } from '../components/shared/Common';
import { EvolucaoMensalChart } from '../components/consolidado/EvolucaoMensalChart';
import { FamiliaBreakdownSection } from '../components/consolidado/FamiliaBreakdownSection';
import { ProdutosCronicosSection } from '../components/consolidado/ProdutosCronicosSection';
import type { ProdutoCronico } from '../components/consolidado/ProdutosCronicosSection';
import { ExtracaoDadosModal } from '../components/consolidado/ExtracaoDadosModal';
import { useFormatter } from '../hooks/useFormatter';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface AcuraciaUnidade {
  codigo:        string;
  descricao:     string;
  acuracia:      number;
  bias:          number;
  ciclosValidos: number;
  totalVendas:   number;
}

interface TendenciaPoint {
  month:  string;
  label:  string;
  orc:    number;
  fcts:   number;
  vendas: number;
}

interface MesData {
  month: string;
  orc: number;
  fcts: number;
  vendas: number;
  submissionStatus: string | null;
}

interface ProdutoData {
  id:          string;
  codigo:      string;
  descricao:   string;
  familia:     string;
  orcAnual:    number;
  fctsAnual:   number;
  vendasAnual: number;
}

interface FamiliaMesItem {
  month:  string;
  orc:    number;
  fcts:   number;
  vendas: number;
}

interface UnidadeData {
  id:              string;
  codigo:          string;
  descricao:       string;
  tipo?:           string;
  orcAnual:        number;
  fctsAnual:       number;
  vendasAnual:     number;
  submissaoStatus: string | null;
  latestCycleFcts: number;
  prevCycleFcts:   number;
  porMes:          MesData[];
  produtos:        ProdutoData[];
  familiaMeses:    { familia: string; porMes: FamiliaMesItem[] }[];
}

interface PaisConsolidado {
  iso3:        string;
  nome:        string;
  orcAnual:    number;
  fctsAnual:   number;
  vendasAnual: number;
  porMes:      { month: string; orc: number; fcts: number; vendas: number }[];
}

interface ConsolidadoData {
  run:       { id: string; ano: number; status: string; aprovadoEm: string | null } | null;
  meses:     { month: string; orc: number; fcts: number; vendas: number }[];
  unidades:  UnidadeData[];
  crossYear?: boolean;
}

// Dados "pesados" carregados lazily após a carga principal
interface UnidadeDetailData {
  porMes:       MesData[];
  produtos:     ProdutoData[];
  familiaMeses: { familia: string; porMes: FamiliaMesItem[] }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Skeletons ─────────────────────────────────────────────────────────────────

const KpiCardSkeleton: React.FC = () => (
  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm animate-pulse">
    <div className="flex items-start justify-between mb-4">
      <div className="w-9 h-9 bg-slate-100 rounded-lg" />
      <div className="w-16 h-4 bg-slate-100 rounded-full" />
    </div>
    <div className="h-3 bg-slate-100 rounded w-2/3 mb-3" />
    <div className="h-7 bg-slate-100 rounded w-1/2 mb-2" />
    <div className="h-2 bg-slate-100 rounded w-1/3" />
  </div>
);

const ChartSkeleton: React.FC = () => (
  <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm animate-pulse">
    <div className="h-4 bg-slate-100 rounded w-1/3 mb-2" />
    <div className="h-3 bg-slate-100 rounded w-1/2 mb-6" />
    <div className="h-[280px] bg-slate-50 rounded-xl" />
  </div>
);

const UnitDetailSkeleton: React.FC = () => (
  <div className="animate-pulse space-y-3 py-2">
    <div className="flex gap-4 mb-4">
      <div className="h-4 bg-slate-100 rounded w-32" />
      <div className="h-4 bg-slate-100 rounded w-24" />
      <div className="h-4 bg-slate-100 rounded w-28" />
    </div>
    {[0, 1, 2, 3].map(i => (
      <div key={i} className="h-10 bg-slate-100 rounded-xl" />
    ))}
  </div>
);

const CountryTabBarSkeleton: React.FC = () => (
  <div className="flex items-center gap-2 mb-4 animate-pulse">
    {[44, 28, 32, 24, 36].map((w, i) => (
      <div key={i} className="h-8 bg-slate-100 rounded-full" style={{ width: `${w * 4}px` }} />
    ))}
  </div>
);

const TabSkeleton: React.FC = () => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-pulse">
    <div className="h-12 bg-slate-50 border-b border-slate-200 px-6 flex items-center gap-6">
      <div className="h-4 bg-slate-100 rounded w-44" />
      <div className="h-4 bg-slate-100 rounded w-32" />
    </div>
    <div className="p-6 space-y-4">
      {[0, 1, 2].map(i => (
        <div key={i} className="h-12 bg-slate-50 rounded-xl" />
      ))}
    </div>
  </div>
);

// ── Componente ─────────────────────────────────────────────────────────────────

export const ConsolidadoGestorPage: React.FC = () => {
  const { t } = useTranslation('consolidado');
  const countryName = useCountryName();
  const { fmt } = useFormatter();
  const MESES_LABEL = t('months', { ns: 'common', returnObjects: true }) as string[];
  const monthLabel  = (iso: string) => MESES_LABEL[new Date(iso).getUTCMonth()];

  const { token, activeUnidade } = useAuth();
  const { showToast }   = useToast();
  const consolidadoCache = useConsolidadoCache();

  const unidade = activeUnidade?.unidadeVenda;

  // Janela padrão: 12 meses terminando no último mês fechado (mês atual - 1)
  const [windowState, setWindowState] = useState(() => {
    const now   = new Date();
    const end   = new Date(now.getFullYear(), now.getMonth() - 1, 1)
                    .toISOString().substring(0, 7);
    const start = new Date(now.getFullYear(), now.getMonth() - 12, 1)
                    .toISOString().substring(0, 7);
    return { startMonth: start, endMonth: end };
  });
  const { startMonth, endMonth } = windowState;
  const crossYear = startMonth.substring(0, 4) !== endMonth.substring(0, 4);
  const [crossYearDismissed, setCrossYearDismissed] = useState(false);

  const prevCrossYear      = useRef(crossYear);
  const mainAbortRef       = useRef<AbortController | null>(null);
  const acurAbortRef       = useRef<AbortController | null>(null);
  const unitDetailAbortRef = useRef<AbortController | null>(null);
  if (prevCrossYear.current !== crossYear) {
    prevCrossYear.current = crossYear;
    if (crossYear) setCrossYearDismissed(false);
  }

  const uCodigo = unidade?.codigo ?? '';

  // Número de meses da janela selecionada — usado para identificar o snapshot correto
  const mesesCount = useMemo(() => {
    const s = new Date(`${startMonth}-01T00:00:00Z`);
    const e = new Date(`${endMonth}-01T00:00:00Z`);
    return (e.getUTCFullYear() - s.getUTCFullYear()) * 12
         + (e.getUTCMonth() - s.getUTCMonth()) + 1;
  }, [startMonth, endMonth]);

  // ── Chaves de cache por fonte ─────────────────────────────────────────────
  // "-leve" distingue do cache full (Fase 3 busca detalhe por unidade separadamente)
  const mainCacheKey  = `consolidado-gestor-leve|${startMonth}|${endMonth}|${uCodigo}`;
  const tendCacheKey  = `tendencia|${uCodigo}`;
  const acurCacheKey  = `acuracia-gestor|${mesesCount}|${endMonth}|${uCodigo}`;

  // ── Estado: lê cache sincronamente na inicialização ───────────────────────
  const [data,      setData]      = useState<ConsolidadoData | null>(() =>
    consolidadoCache.getCached(mainCacheKey) as ConsolidadoData | null ?? null
  );
  const [tendencia, setTendencia] = useState<TendenciaPoint[]>(() =>
    consolidadoCache.getCached(tendCacheKey) as TendenciaPoint[] ?? []
  );
  const [cronicos,  setCronicos]  = useState<ProdutoCronico[]>([]);
  const [isLoadingMain,      setIsLoadingMain]      = useState<boolean>(() => !consolidadoCache.getCached(mainCacheKey));
  const [isLoadingTendencia, setIsLoadingTendencia] = useState<boolean>(() => !consolidadoCache.getCached(tendCacheKey));
  const [isLoadingCronicos,  setIsLoadingCronicos]  = useState<boolean>(true);
  const [acuraciaGestor,     setAcuraciaGestor]     = useState<{ acuracia: number; bias: number; ciclosValidos: number; totalVendas: number } | null>(() =>
    consolidadoCache.getCached(acurCacheKey) as { acuracia: number; bias: number; ciclosValidos: number; totalVendas: number } | null ?? null
  );
  const [isLoadingAcuracia,  setIsLoadingAcuracia]  = useState<boolean>(() => !consolidadoCache.getCached(acurCacheKey));

  const [showExtracao,        setShowExtracao]        = useState(false);
  const [activeTab,           setActiveTab]           = useState<'divisao' | 'cronicos'>('divisao');

  // ── Detalhe lazy da unidade ────────────────────────────────────────────────
  const [unitDetail,          setUnitDetail]          = useState<UnidadeDetailData | null>(null);
  const [isLoadingUnitDetail, setIsLoadingUnitDetail] = useState(false);

  // ── EXPORT: países e drill-down por país ───────────────────────────────────
  const [paisesUnit,             setPaisesUnit]             = useState<PaisConsolidado[]>([]);
  const [isLoadingPaises,        setIsLoadingPaises]        = useState(false);
  const [selectedCountry,        setSelectedCountry]        = useState<string | null>(null);
  const [countryDetail,          setCountryDetail]          = useState<UnidadeDetailData | null>(null);
  const [isLoadingCountryDetail, setIsLoadingCountryDetail] = useState(false);

  // ── Fetch: consolidado principal ──────────────────────────────────────────
  const fetchMainData = useCallback(async (bustCache = false) => {
    if (!uCodigo) return;
    mainAbortRef.current?.abort();
    if (!bustCache) {
      const cached = consolidadoCache.getCached(mainCacheKey) as ConsolidadoData | null;
      if (cached) { setData(cached); setIsLoadingMain(false); return; }
    }
    const ctrl = new AbortController();
    mainAbortRef.current = ctrl;
    setIsLoadingMain(true);
    setData(null);
    try {
      const res = await fetch(
        `/api/orcamento/consolidado?startMonth=${startMonth}&endMonth=${endMonth}&lightweight=true`,
        { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal },
      );
      if (!res.ok) throw new Error();
      const d: ConsolidadoData = await res.json();
      setData(d);
      consolidadoCache.setCached(mainCacheKey, d);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      showToast(t('errors.load'), 'error');
    } finally {
      if (!ctrl.signal.aborted) setIsLoadingMain(false);
    }
  }, [token, startMonth, endMonth, uCodigo, consolidadoCache, mainCacheKey, showToast]);

  // ── Fetch: tendência (janela-independente — usa janela fixa interna) ───────
  const fetchTendenciaData = useCallback(async (bustCache = false) => {
    if (!uCodigo) return;
    if (!bustCache) {
      const cached = consolidadoCache.getCached(tendCacheKey) as TendenciaPoint[] | null;
      if (cached) { setTendencia(cached); setIsLoadingTendencia(false); return; }
    }
    setIsLoadingTendencia(true);
    try {
      const res = await fetch(
        `/api/forecast/tendencia?unidadeVendaId=${encodeURIComponent(uCodigo)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const d: TendenciaPoint[] = res.ok ? await res.json() : [];
      setTendencia(d);
      consolidadoCache.setCached(tendCacheKey, d);
    } catch {
      setTendencia([]);
    } finally {
      setIsLoadingTendencia(false);
    }
  }, [token, uCodigo, consolidadoCache, tendCacheKey]);

  // ── Fetch: produtos crônicos (janela-independente) ────────────────────────
  const fetchCronicosData = useCallback(async () => {
    if (!uCodigo) return;
    setIsLoadingCronicos(true);
    try {
      const res = await fetch(
        `/api/forecast/produtos-cronicos?unidadeVendaId=${encodeURIComponent(uCodigo)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const d: ProdutoCronico[] = res.ok ? await res.json() : [];
      setCronicos(d);
    } catch {
      setCronicos([]);
    } finally {
      setIsLoadingCronicos(false);
    }
  }, [token, uCodigo]);

  // ── Fetch: acurácia via snapshot ─────────────────────────────────────────
  const fetchAcuraciaGestorData = useCallback(async (bustCache = false) => {
    if (!uCodigo) return;
    acurAbortRef.current?.abort();
    if (!bustCache) {
      const cached = consolidadoCache.getCached(acurCacheKey) as { acuracia: number; bias: number; ciclosValidos: number; totalVendas: number } | null;
      if (cached) { setAcuraciaGestor(cached); setIsLoadingAcuracia(false); return; }
    }
    const ctrl = new AbortController();
    acurAbortRef.current = ctrl;
    setIsLoadingAcuracia(true);
    setAcuraciaGestor(null);
    try {
      const res = await fetch(
        `/api/forecast/acuracia-unidades?anchorMonth=${endMonth}&meses=${mesesCount}&startMonth=${startMonth}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal },
      );
      const d: AcuraciaUnidade[] = res.ok ? await res.json() : [];
      const row = d.find(u => u.codigo === uCodigo) ?? null;
      const result = row
        ? { acuracia: row.acuracia, bias: row.bias, ciclosValidos: row.ciclosValidos, totalVendas: row.totalVendas }
        : null;
      setAcuraciaGestor(result);
      consolidadoCache.setCached(acurCacheKey, result);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setAcuraciaGestor(null);
    } finally {
      if (!ctrl.signal.aborted) setIsLoadingAcuracia(false);
    }
  }, [token, uCodigo, mesesCount, endMonth, consolidadoCache, acurCacheKey]);

  // ── Fetch: detalhe da unidade (lazy, disparado após main carregar) ───────
  const fetchUnitDetail = useCallback(async () => {
    if (!uCodigo || !token) return;
    unitDetailAbortRef.current?.abort();
    const cacheKey = `unit-detail|${uCodigo}|${startMonth}|${endMonth}`;
    const cached = consolidadoCache.getCached(cacheKey) as UnidadeDetailData | null;
    if (cached) { setUnitDetail(cached); setIsLoadingUnitDetail(false); return; }
    const ctrl = new AbortController();
    unitDetailAbortRef.current = ctrl;
    setIsLoadingUnitDetail(true);
    setUnitDetail(null);
    try {
      const res = await fetch(
        `/api/orcamento/consolidado/unidade?unidadeVendaId=${encodeURIComponent(uCodigo)}&startMonth=${startMonth}&endMonth=${endMonth}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal },
      );
      const d: UnidadeDetailData = res.ok ? await res.json() : { porMes: [], produtos: [], familiaMeses: [] };
      setUnitDetail(d);
      consolidadoCache.setCached(cacheKey, d);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setUnitDetail(null);
    } finally {
      if (!ctrl.signal.aborted) setIsLoadingUnitDetail(false);
    }
  }, [token, uCodigo, startMonth, endMonth, consolidadoCache]);

  // Dispara todos os fetches em paralelo; cada um resolve e atualiza seu estado independentemente
  useEffect(() => { fetchMainData();            }, [fetchMainData]);
  useEffect(() => { fetchTendenciaData();       }, [fetchTendenciaData]);
  useEffect(() => { fetchCronicosData();        }, [fetchCronicosData]);
  useEffect(() => { fetchAcuraciaGestorData();  }, [fetchAcuraciaGestorData]);
  useEffect(() => { fetchUnitDetail();          }, [fetchUnitDetail]);

  // ── Dados da unidade (necessário antes dos efeitos EXPORT) ──────────────────
  const unitData = useMemo<UnidadeData | undefined>(
    () => data?.unidades.find(u => u.codigo === uCodigo),
    [data, uCodigo],
  );

  const isExport = unitData?.tipo === 'EXPORT';

  // ── EXPORT: fetch lista de países (quando unidade é EXPORT) ───────────────
  useEffect(() => {
    if (!isExport || !uCodigo || !token) return;
    // reset seleção ao mudar janela
    setSelectedCountry(null);
    setCountryDetail(null);
    setPaisesUnit([]);
    setIsLoadingPaises(true);

    fetch(
      `/api/orcamento/consolidado/unidade/paises?unidadeVendaId=${encodeURIComponent(uCodigo)}&startMonth=${startMonth}&endMonth=${endMonth}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
      .then(r => r.ok ? r.json() : [])
      .then((d: PaisConsolidado[]) => setPaisesUnit(d))
      .catch(() => setPaisesUnit([]))
      .finally(() => setIsLoadingPaises(false));
  }, [isExport, uCodigo, token, startMonth, endMonth]);

  // ── EXPORT: fetch detalhe do país selecionado ──────────────────────────────
  useEffect(() => {
    if (!selectedCountry || !uCodigo || !token) return;
    setIsLoadingCountryDetail(true);
    setCountryDetail(null);
    fetch(
      `/api/orcamento/consolidado/unidade/pais-detail?unidadeVendaId=${encodeURIComponent(uCodigo)}&paisIso3=${encodeURIComponent(selectedCountry)}&startMonth=${startMonth}&endMonth=${endMonth}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
      .then(r => r.ok ? r.json() : { porMes: [], produtos: [], familiaMeses: [] })
      .then((d: UnidadeDetailData) => setCountryDetail(d))
      .catch(() => setCountryDetail(null))
      .finally(() => setIsLoadingCountryDetail(false));
  }, [selectedCountry, uCodigo, token, startMonth, endMonth]);

  const handleRefresh = useCallback(() => {
    setUnitDetail(null);
    setSelectedCountry(null);
    setCountryDetail(null);
    setPaisesUnit([]);
    fetchMainData(true);
    fetchTendenciaData(true);
    fetchCronicosData();
    fetchAcuraciaGestorData(true);
    fetchUnitDetail();
  }, [fetchMainData, fetchTendenciaData, fetchCronicosData, fetchAcuraciaGestorData, fetchUnitDetail]);

  // Acurácia e Bias vindos do snapshot via fetchAcuraciaGestorData
  const acuraciaPeriodo = acuraciaGestor?.acuracia ?? null;
  const biasPeriodo     = acuraciaGestor?.bias     ?? null;
  const ciclosValidos   = acuraciaGestor?.ciclosValidos ?? 0;

  // ── Dados do gráfico de evolução ───────────────────────────────────────────
  const chartData = useMemo(() =>
    (unitData?.porMes ?? []).map(m => ({
      name:   monthLabel(m.month),
      month:  m.month,
      ORC:    m.orc,
      FCTS:   m.fcts,
      Vendas: m.vendas,
    })),
  [unitData]);

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const orcAnual    = unitData?.orcAnual    ?? 0;
  const fctsAnual   = unitData?.fctsAnual   ?? 0;
  const vendasAnual = unitData?.vendasAnual ?? 0;
  const atingFCTS   = orcAnual > 0 ? (fctsAnual   / orcAnual) * 100 : 0;

  // FCTS do período realizado (YTD): soma o FCTS de todos os meses até o último
  // mês com venda realizada. Base honesta para o atingimento de vendas.
  const fctsPeriodo = useMemo(() => {
    const meses = unitData?.porMes ?? [];
    let lastRealizedIdx = -1;
    meses.forEach((m, i) => { if (m.vendas > 0) lastRealizedIdx = i; });
    if (lastRealizedIdx < 0) return 0;
    return meses.slice(0, lastRealizedIdx + 1).reduce((s, m) => s + m.fcts, 0);
  }, [unitData]);
  const atingVendas = fctsPeriodo > 0 ? (vendasAnual / fctsPeriodo) * 100 : 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Header — sempre visível */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{t('title')}</h2>
            {unidade && (
              <span className="px-2 py-0.5 bg-sky-50 text-sky-700 text-[11px] font-bold rounded-full border border-sky-200">
                {unidade.descricao} - {unidade.codigo}
              </span>
            )}
            {data?.run && (
              <span className="px-2 py-0.5 bg-sky-50 text-sky-700 text-[11px] font-bold rounded-full border border-sky-100">
                {t('abbr.orc')} {data.run.ano}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-0.5">
            {t('pageSubtitle')}
          </p>
        </div>
        <div data-tour="consolidado-window" className="flex items-start gap-2 flex-wrap justify-end">
          {/* h-8 = altura do pill group do WindowSelector (p-1 + py-1 + text-xs),
              para os três controles alinharem pelo topo */}
          <button
            onClick={() => setShowExtracao(true)}
            disabled={!uCodigo}
            title={t('extracao.titulo')}
            // Só em desktop (md = 768px, mesmo corte de useIsMobile): a extração
            // pressupõe planilha, e o modal de filtros não cabe em tela pequena.
            className="hidden md:flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 hover:text-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            {t('extracao.botao')}
          </button>
          <WindowSelector
            startMonth={startMonth}
            endMonth={endMonth}
            onChange={(s, e) => setWindowState({ startMonth: s, endMonth: e })}
            years={[new Date().getFullYear() - 1, new Date().getFullYear()]}
          />
          <button
            onClick={handleRefresh}
            title={t('actions.reload', { ns: 'common' })}
            className="flex items-center justify-center h-8 w-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Aviso cross-year */}
      {crossYear && !crossYearDismissed && (
        <div className="flex items-start gap-3 px-4 py-3 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/70 rounded-xl mb-2 shadow-sm">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-100 flex-shrink-0 mt-0.5">
            <CalendarRange className="w-4 h-4 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900 leading-snug">
              {t('crossYear.titlePrefix')}<span className="font-bold">{startMonth.substring(0, 4)}</span>{t('crossYear.titleSeparator')}<span className="font-bold">{endMonth.substring(0, 4)}</span>
            </p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
              {t('crossYear.description')}
            </p>
          </div>
          <button
            onClick={() => setCrossYearDismissed(true)}
            title={t('actions.close', { ns: 'common' })}
            className="flex-shrink-0 p-1 rounded-md text-amber-400 hover:text-amber-700 hover:bg-amber-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Cards — skeleton enquanto consolidado principal carrega */}
      {isLoadingMain ? (
        <div data-tour="consolidado-kpis" className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          <KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton />
        </div>
      ) : data?.run && unitData ? (
        <div data-tour="consolidado-kpis" className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">

          {/* Bias do Forecast — skeleton próprio enquanto acurácia carrega */}
          <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 shadow-sm transition-all duration-200 hover:shadow-md hover:border-slate-300">
            {isLoadingAcuracia ? (
              <div className="animate-pulse space-y-3">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-9 h-9 bg-slate-100 rounded-lg" />
                </div>
                <div className="h-3 bg-slate-100 rounded w-2/3 mb-3" />
                <div className="h-7 bg-slate-100 rounded w-1/3 mb-2" />
                <div className="h-2 bg-slate-100 rounded w-1/2" />
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div className={cn(
                    'p-2 rounded-lg',
                    biasPeriodo === null        ? 'bg-slate-50 text-slate-400'     :
                    Math.abs(biasPeriodo) < 5   ? 'bg-emerald-50 text-emerald-600' :
                    Math.abs(biasPeriodo) < 15  ? 'bg-amber-50 text-amber-600'     :
                                             'bg-red-50 text-red-600',
                  )}>
                    <Activity className="w-5 h-5" />
                  </div>
                  {biasPeriodo !== null && (
                    <span className={cn(
                      'text-[10px] font-bold px-2 py-0.5 rounded-full',
                      biasPeriodo > 0   ? 'bg-amber-50 text-amber-700'   :
                      biasPeriodo < 0   ? 'bg-sky-50 text-sky-700'       :
                                      'bg-emerald-50 text-emerald-700',
                    )}>
                      {biasPeriodo > 0.5 ? t('kpi.biasOverEstimate') : biasPeriodo < -0.5 ? t('kpi.biasUnderEstimate') : t('kpi.biasCalibrated')}
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
                  {t('kpi.bias')}
                  <InfoTooltip
                    text={t('tooltips.bias')}
                    width="w-80"
                  />
                </p>
                {biasPeriodo === null ? (
                  <>
                    <p className="text-xl font-bold text-slate-300">—</p>
                    <p className="text-xs text-slate-400 mt-1">{t('waitingRealSales')}</p>
                  </>
                ) : (
                  <>
                    <h3 className={cn('text-2xl font-bold mb-1',
                      Math.abs(biasPeriodo) < 5  ? 'text-emerald-600' :
                      Math.abs(biasPeriodo) < 15 ? 'text-amber-600'   : 'text-red-600',
                    )}>
                      {biasPeriodo > 0 ? '+' : ''}{biasPeriodo.toFixed(1)}%
                    </h3>
                    <p className="text-xs text-slate-400">
                      {t('kpi.biasMonthsData', { count: ciclosValidos })}
                    </p>
                  </>
                )}
              </>
            )}
          </div>

          {/* FCTS vs ORC */}
          <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg w-fit mb-4">
              <TrendingUp className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
              {t('kpi.fctsVsOrc')}
              <InfoTooltip text={t('tooltips.fctsVsOrc')} width="w-64" />
            </p>
            <div className="flex items-end justify-between gap-2">
              <div>
                <h3 className="text-2xl font-bold text-slate-900 leading-tight">{fmt(fctsAnual)}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{t('kpi.orcLabel', { value: fmt(orcAnual) })}</p>
              </div>
              <span className={cn(
                'text-xs font-bold px-2 py-0.5 rounded-full mb-1',
                atingFCTS >= 95 ? 'bg-emerald-50 text-emerald-700' :
                atingFCTS >= 80 ? 'bg-amber-50   text-amber-700'   :
                                  'bg-red-50     text-red-700',
              )}>
                {atingFCTS.toFixed(1)}%
              </span>
            </div>
            <div className="mt-2 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={cn('h-full transition-all',
                  atingFCTS >= 95 ? 'bg-emerald-500' :
                  atingFCTS >= 80 ? 'bg-amber-500'   : 'bg-red-500',
                )}
                style={{ width: `${Math.min(atingFCTS, 100)}%` }}
              />
            </div>
          </div>

          {/* Vendas YTD */}
          <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg w-fit mb-4">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
              {t('kpi.sales')}
              <InfoTooltip text={t('tooltips.salesVsOrc')} width="w-64" />
            </p>
            <div className="flex items-baseline gap-2">
              <h3 className="text-2xl font-bold text-slate-900">{fmt(vendasAnual)}</h3>
              <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                {atingVendas.toFixed(1)}% FCST
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {t('kpi.salesSubtitle')}
            </p>
          </div>

          {/* Acurácia do Período — skeleton próprio enquanto acurácia carrega */}
          <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 shadow-sm">
            {isLoadingAcuracia ? (
              <div className="animate-pulse space-y-3">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-9 h-9 bg-slate-100 rounded-lg" />
                  <div className="w-16 h-4 bg-slate-100 rounded-full" />
                </div>
                <div className="h-3 bg-slate-100 rounded w-2/3 mb-3" />
                <div className="h-7 bg-slate-100 rounded w-1/3 mb-2" />
                <div className="h-2 bg-slate-100 rounded w-1/2" />
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div className="p-2 bg-violet-50 text-violet-600 rounded-lg">
                    <Target className="w-5 h-5" />
                  </div>
                  {acuraciaPeriodo !== null && (
                    <span className={cn(
                      'text-xs font-bold px-2 py-0.5 rounded-full',
                      acuraciaPeriodo >= 90 ? 'bg-emerald-50 text-emerald-700' :
                      acuraciaPeriodo >= 75 ? 'bg-amber-50   text-amber-700'   :
                                         'bg-red-50     text-red-700',
                    )}>
                      {acuraciaPeriodo >= 90 ? t('kpi.accuracyGood') : acuraciaPeriodo >= 75 ? t('kpi.accuracyRegular') : t('kpi.accuracyCritical')}
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
                  {t('kpi.accuracy')}
                  <InfoTooltip text={t('tooltips.accuracy')} width="w-80" />
                </p>
                {acuraciaPeriodo === null ? (
                  <>
                    <p className="text-xl font-bold text-slate-300">—</p>
                    <p className="text-xs text-slate-400 mt-1">{t('waitingRealSales')}</p>
                  </>
                ) : (
                  <>
                    <h3 className={cn('text-2xl font-bold mb-1',
                      acuraciaPeriodo >= 90 ? 'text-emerald-600' :
                      acuraciaPeriodo >= 75 ? 'text-amber-600'   : 'text-red-600',
                    )}>
                      {acuraciaPeriodo.toFixed(1)}%
                    </h3>
                    <p className="text-xs text-slate-400">
                      {t('kpi.accuracyMonthsData', { count: ciclosValidos })}
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* Sem orçamento global */}
      {!isLoadingMain && !data?.run && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <AlertCircle className="w-12 h-12 text-slate-200 mb-3" />
          <p className="font-medium">{t('noOrcamento.global')}</p>
          <p className="text-sm">{t('noOrcamento.globalHint')}</p>
        </div>
      )}

      {/* Unidade sem itens no período */}
      {!isLoadingMain && data?.run && !unitData && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <AlertCircle className="w-12 h-12 text-slate-200 mb-3" />
          <p className="font-medium">{t('noOrcamento.unit')}</p>
          <p className="text-sm">{t('noOrcamento.unitHint')}</p>
        </div>
      )}

      {/* Gráfico evolução mensal — skeleton enquanto consolidado carrega */}
      {isLoadingMain ? (
        <div data-tour="consolidado-chart"><ChartSkeleton /></div>
      ) : data?.run && unitData ? (
        <div data-tour="consolidado-chart" className="bg-white p-4 md:p-8 rounded-2xl border border-slate-200 shadow-sm">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-slate-900">{t('monthlyEvolution')}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{t('subtitle')}</p>
          </div>
          <div className="h-[200px] md:h-[280px]">
            <EvolucaoMensalChart data={chartData} />
          </div>
        </div>
      ) : null}

      {/* Tabs — skeleton enquanto consolidado carrega */}
      {isLoadingMain ? (
        <div data-tour="consolidado-tabs"><TabSkeleton /></div>
      ) : data?.run && unitData ? (
        <div data-tour="consolidado-tabs" className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Tab header */}
          <div className="flex items-center gap-0 border-b border-slate-200 px-6 pt-4">
            <button
              onClick={() => setActiveTab('divisao')}
              className={cn(
                'px-4 py-2 text-sm font-bold rounded-t-lg -mb-px border-b-2 transition-colors flex items-center gap-1.5',
                activeTab === 'divisao'
                  ? 'border-sky-600 text-sky-700'
                  : 'border-transparent text-slate-400 hover:text-slate-600',
              )}
            >
              <BarChart2 className="w-4 h-4" />
              {t('tabs.division')}
            </button>
            <button
              onClick={() => setActiveTab('cronicos')}
              className={cn(
                'px-4 py-2 text-sm font-bold rounded-t-lg -mb-px border-b-2 transition-colors flex items-center gap-1.5',
                activeTab === 'cronicos'
                  ? 'border-orange-500 text-orange-700'
                  : 'border-transparent text-slate-400 hover:text-slate-600',
              )}
            >
              <Bug className="w-4 h-4" />
              {t('tabs.cronicos')}
              {isLoadingCronicos ? (
                <span className="ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 animate-pulse">
                  •••
                </span>
              ) : cronicos.length > 0 ? (
                <span className="ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600">
                  {cronicos.length}
                </span>
              ) : null}
            </button>
          </div>

          {/* Tab: Detalhamento da Divisão */}
          {activeTab === 'divisao' && (
            <div className="p-6">
              {/* CountryTabBar — apenas para unidades EXPORT */}
              {isExport && isLoadingPaises && <CountryTabBarSkeleton />}
              {isExport && !isLoadingPaises && paisesUnit.length > 0 && (
                <CountryTabBar
                  paises={paisesUnit}
                  selected={selectedCountry}
                  onSelect={iso3 => {
                    setSelectedCountry(iso3);
                    setCountryDetail(null);
                  }}
                />
              )}

              {/* KPI row do país selecionado */}
              {isExport && selectedCountry && (() => {
                const p = paisesUnit.find(x => x.iso3 === selectedCountry);
                if (!p) return null;
                const delta = p.orcAnual > 0 ? ((p.fctsAnual / p.orcAnual) - 1) * 100 : null;
                return (
                  <div className="flex flex-wrap gap-3 mb-4 p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-indigo-500 uppercase tracking-wide">{t('country')}</span>
                      <span className="text-xs font-bold text-indigo-700">{p.iso3}</span>
                      <span className="text-xs text-slate-500">— {countryName(p.iso3, p.nome)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 ml-auto flex-wrap gap-y-1">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {t('abbr.orc')} {fmt(p.orcAnual)}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                        {t('abbr.fcts')} {fmt(p.fctsAnual)}
                      </span>
                      {delta !== null && (
                        <span className={cn(
                          'text-[10px] font-bold px-2 py-0.5 rounded-full',
                          delta >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600',
                        )}>
                          Δ {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
                        </span>
                      )}
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">
                        Vendas {fmt(p.vendasAnual)}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* FamiliaBreakdownSection — dados mudam conforme país selecionado */}
              {(() => {
                const loading  = selectedCountry ? isLoadingCountryDetail : isLoadingUnitDetail;
                const detail   = selectedCountry ? countryDetail          : unitDetail;
                const fOrc     = selectedCountry
                  ? (paisesUnit.find(p => p.iso3 === selectedCountry)?.orcAnual    ?? 0)
                  : orcAnual;
                const fFcts    = selectedCountry
                  ? (paisesUnit.find(p => p.iso3 === selectedCountry)?.fctsAnual   ?? 0)
                  : fctsAnual;
                const fVendas  = selectedCountry
                  ? (paisesUnit.find(p => p.iso3 === selectedCountry)?.vendasAnual ?? 0)
                  : vendasAnual;

                if (loading) return <UnitDetailSkeleton />;
                return (
                  <FamiliaBreakdownSection
                    unitCodigo={unitData.codigo}
                    familiaMeses={detail?.familiaMeses ?? []}
                    produtos={detail?.produtos ?? []}
                    token={token ?? ''}
                    porMes={detail?.porMes}
                    orcAnual={fOrc}
                    fctsAnual={fFcts}
                    vendasAnual={fVendas}
                    acuraciaUnit={
                      !selectedCountry && acuraciaPeriodo !== null && biasPeriodo !== null
                        ? { acuracia: acuraciaPeriodo, bias: biasPeriodo, ciclosValidos }
                        : undefined
                    }
                    startMonth={startMonth}
                    endMonth={endMonth}
                    paisIso3={selectedCountry ?? undefined}
                  />
                );
              })()}
            </div>
          )}

          {/* Tab: Produtos Crônicos */}
          {activeTab === 'cronicos' && (
            <div className="p-6">
              {isLoadingCronicos ? (
                <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">{t('loadingCronicos')}</span>
                </div>
              ) : (
                <ProdutosCronicosSection
                  cronicos={cronicos}
                  showFilter={false}
                  showUnitGrouping={false}
                />
              )}
            </div>
          )}
        </div>
      ) : null}

      {showExtracao && uCodigo && (
        <ExtracaoDadosModal
          token={token ?? ''}
          unidadeAtiva={uCodigo}
          defaultStartMonth={startMonth}
          defaultEndMonth={endMonth}
          onClose={() => setShowExtracao(false)}
        />
      )}
    </div>
  );
};
