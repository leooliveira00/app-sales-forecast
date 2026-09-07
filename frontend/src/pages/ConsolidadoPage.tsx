import React, { useState, useEffect, useCallback, useMemo, useRef, } from 'react';
import { useConsolidadoCache } from '../context/ConsolidadoCacheContext';
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp, BarChart2, ShoppingCart,
  ChevronDown, ChevronUp, AlertCircle, Loader2, Bug, Target, Activity, RefreshCw, X, CalendarRange,
  Download,
} from 'lucide-react';
import { WindowSelector } from '../components/consolidado/WindowSelector';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/shared/ToastNotification';
import { cn, InfoTooltip } from '../components/shared/Common';
import { Drawer } from '../components/shared/Drawer';
import { DeltaBadge } from '../components/consolidado/ConsolidadoBadges';
import { EvolucaoMensalChart } from '../components/consolidado/EvolucaoMensalChart';
import { FamiliaBreakdownSection } from '../components/consolidado/FamiliaBreakdownSection';
import { ProdutosCronicosSection } from '../components/consolidado/ProdutosCronicosSection';
import type { ProdutoCronico } from '../components/consolidado/ProdutosCronicosSection';
import { CountryTabBar } from '../components/consolidado/CountryTabBar';
import { DivisaoCardList } from '../components/consolidado/DivisaoCardList';
import { ExtracaoDadosModal } from '../components/consolidado/ExtracaoDadosModal';
import { CHART_COLORS } from '../constants/chartColors';
import { useIsMobile } from '../hooks/useBreakpoint';
import { useTranslation } from 'react-i18next';
import { useFormatter } from '../hooks/useFormatter';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface MesData {
  month: string;
  orc: number;
  fcts: number;
  vendas: number;
  submissionStatus: string | null;
}

interface ProdutoData {
  id: string;
  codigo: string;
  descricao: string;
  familia: string;
  orcAnual: number;
  fctsAnual: number;
  vendasAnual: number;
}

interface FamiliaMesItem {
  month: string;
  orc: number;
  fcts: number;
  vendas: number;
}

interface PaisConsolidado {
  iso3:        string;
  nome:        string;
  orcAnual:    number;
  fctsAnual:   number;
  vendasAnual: number;
  porMes:      { month: string; orc: number; fcts: number; vendas: number }[];
}

interface UnidadeData {
  id: string;
  codigo: string;
  descricao: string;
  tipo?: string;
  orcAnual: number;
  fctsAnual: number;
  vendasAnual: number;
  submissaoStatus: string | null;
  latestCycleFcts: number;
  prevCycleFcts: number;
  vendaAA?: number | null;
  fctsForDesvio?: number | null;
  porMes: MesData[];
  produtos: ProdutoData[];
  familiaMeses: { familia: string; porMes: FamiliaMesItem[] }[];
}

interface ConsolidadoData {
  run: { id: string; ano: number; status: string; aprovadoEm: string | null } | null;
  meses: { month: string; orc: number; fcts: number; vendas: number }[];
  unidades: UnidadeData[];
  crossYear?: boolean;
}

// Dados "pesados" carregados lazily ao expandir uma unidade
interface UnidadeDetailData {
  porMes:       MesData[];
  produtos:     ProdutoData[];
  familiaMeses: { familia: string; porMes: FamiliaMesItem[] }[];
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

const fmt = (v: number) => new Intl.NumberFormat('pt-BR').format(v);


const calcDeltaCiclo = (latestCycleFcts: number, prevCycleFcts: number): number | null => {
  if (prevCycleFcts <= 0 || latestCycleFcts <= 0) return null;
  return ((latestCycleFcts / prevCycleFcts) - 1) * 100;
};

const DeltaCicloBadge: React.FC<{ value: number | null }> = ({ value }) => {
  if (value === null) return <span className="text-slate-300 text-xs">—</span>;
  return (
    <span className={cn(
      'text-xs font-bold',
      Math.abs(value) <= 10 ? 'text-emerald-600' :
      Math.abs(value) <= 25 ? 'text-amber-600'   : 'text-red-600',
    )}>
      {value > 0 ? '+' : ''}{value.toFixed(1)}%
    </span>
  );
};

const AcuraciaBadge: React.FC<{ acuracia: number | null }> = ({ acuracia }) => {
  if (acuracia === null) return <span className="text-slate-300 text-xs">—</span>;
  return (
    <span className={cn(
      'text-xs font-bold tabular-nums',
      acuracia >= 90 ? 'text-emerald-600' :
      acuracia >= 75 ? 'text-amber-600'   : 'text-red-600',
    )}>
      {acuracia.toFixed(1)}%
    </span>
  );
};

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

const TableSkeleton: React.FC = () => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-pulse">
    <div className="h-12 bg-slate-50 border-b border-slate-200 px-6 flex items-center gap-6">
      <div className="h-4 bg-slate-100 rounded w-36" />
      <div className="h-4 bg-slate-100 rounded w-28" />
    </div>
    <div className="px-6 py-4 space-y-3">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="flex items-center gap-4 py-2">
          <div className="w-4 h-4 bg-slate-100 rounded" />
          <div className="flex-1 space-y-1">
            <div className="h-3 bg-slate-100 rounded w-24" />
            <div className="h-2 bg-slate-100 rounded w-16" />
          </div>
          <div className="h-3 bg-slate-100 rounded w-16" />
          <div className="h-3 bg-slate-100 rounded w-16" />
          <div className="h-3 bg-slate-100 rounded w-12" />
          <div className="h-3 bg-slate-100 rounded w-12" />
          <div className="h-3 bg-slate-100 rounded w-12" />
          <div className="h-3 bg-slate-100 rounded w-16" />
          <div className="h-3 bg-slate-100 rounded w-20" />
          <div className="h-5 bg-slate-100 rounded-full w-16" />
        </div>
      ))}
    </div>
  </div>
);

// ── Componente principal ──────────────────────────────────────────────────────

export const ConsolidadoPage: React.FC = () => {
  const { token } = useAuth();
  const { showToast } = useToast();
  const consolidadoCache = useConsolidadoCache();
  const isMobile = useIsMobile();
  const { t } = useTranslation('common');
  const { t: tc } = useTranslation('consolidado');
  useFormatter();
  const MESES_LABEL = t('months', { returnObjects: true }) as string[];
  const monthLabel = (iso: string) => MESES_LABEL[new Date(`${iso.substring(0, 7)}-01T00:00:00Z`).getUTCMonth()];

  // Janela padrão: 12 meses terminando no último mês fechado (mês atual - 1)
  const [windowState, setWindowState] = useState(() => {
    const now    = new Date();
    const end    = new Date(now.getFullYear(), now.getMonth() - 1, 1)
                     .toISOString().substring(0, 7);
    const start  = new Date(now.getFullYear(), now.getMonth() - 12, 1)
                     .toISOString().substring(0, 7);
    return { startMonth: start, endMonth: end };
  });
  const { startMonth, endMonth } = windowState;
  const crossYear = startMonth.substring(0, 4) !== endMonth.substring(0, 4);
  const [crossYearDismissed, setCrossYearDismissed] = useState(false);
  const [showExtracao,       setShowExtracao]       = useState(false);

  const prevCrossYear   = useRef(crossYear);
  const mainAbortRef    = useRef<AbortController | null>(null);
  const acurAbortRef    = useRef<AbortController | null>(null);
  if (prevCrossYear.current !== crossYear) {
    prevCrossYear.current = crossYear;
    if (crossYear) setCrossYearDismissed(false);
  }

  // Número de meses da janela selecionada — usado para identificar o snapshot correto
  const mesesCount = useMemo(() => {
    const s = new Date(`${startMonth}-01T00:00:00Z`);
    const e = new Date(`${endMonth}-01T00:00:00Z`);
    return (e.getUTCFullYear() - s.getUTCFullYear()) * 12
         + (e.getUTCMonth() - s.getUTCMonth()) + 1;
  }, [startMonth, endMonth]);

  // ── Chaves de cache por fonte ─────────────────────────────────────────────
  // "-leve" distingue do cache full (Fase 3 busca detalhe por unidade separadamente)
  const mainCacheKey  = `consolidado-main-leve|${startMonth}|${endMonth}`;
  const acurCacheKey  = `acuracia|${mesesCount}|${endMonth}`;
  const cronCacheKey  = 'cronicos';

  // ── Estado: lê cache sincronamente na inicialização ───────────────────────
  const [data,     setData]     = useState<ConsolidadoData | null>(() =>
    consolidadoCache.getCached(mainCacheKey) as ConsolidadoData | null ?? null
  );
  const [acuracia, setAcuracia] = useState<AcuraciaUnidade[]>(() =>
    consolidadoCache.getCached(acurCacheKey) as AcuraciaUnidade[] ?? []
  );
  const [cronicos, setCronicos] = useState<ProdutoCronico[]>([]);
  const [isLoadingMain,     setIsLoadingMain]     = useState<boolean>(() => !consolidadoCache.getCached(mainCacheKey));
  const [isLoadingAcuracia, setIsLoadingAcuracia] = useState<boolean>(() => !consolidadoCache.getCached(acurCacheKey));
  const [isLoadingCronicos, setIsLoadingCronicos] = useState<boolean>(true);

  const [expandedUnit,         setExpandedUnit]         = useState<string | null>(null);
  const [activeTab,            setActiveTab]            = useState<'divisoes' | 'cronicos'>('divisoes');
  const [drawerMesConsolidado, setDrawerMesConsolidado] = useState<string | null>(null);
  const [highlightedUnit,      setHighlightedUnit]      = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Detalhe lazy por unidade (Fase 3) ─────────────────────────────────────
  const [unitDetails,    setUnitDetails]    = useState<Map<string, UnidadeDetailData>>(new Map());
  const [loadingUnitIds, setLoadingUnitIds] = useState<Set<string>>(new Set());

  // ── Breakdown por país para unidades EXPORT ───────────────────────────────
  const [paisDetails,    setPaisDetails]    = useState<Map<string, PaisConsolidado[]>>(new Map());
  const [loadingPaisIds, setLoadingPaisIds] = useState<Set<string>>(new Set());

  // ── Drill-down por país: país selecionado por unidade + detalhe país×familia×produto ──
  const [selectedCountryByUnit, setSelectedCountryByUnit] = useState<Map<string, string | null>>(new Map());
  const [countryPaisDetail,     setCountryPaisDetail]     = useState<Map<string, UnidadeDetailData>>(new Map());
  const [loadingPaisDetail,     setLoadingPaisDetail]     = useState<Set<string>>(new Set());

  // Limpa detalhes ao mudar janela para evitar dados obsoletos
  useEffect(() => {
    setUnitDetails(new Map());
    setPaisDetails(new Map());
    setSelectedCountryByUnit(new Map());
    setCountryPaisDetail(new Map());
    setExpandedUnit(null);
  }, [startMonth, endMonth]);

  // Dispara fetch do detalhe quando uma unidade é expandida e ainda não carregada
  useEffect(() => {
    if (!expandedUnit || !token) return;
    if (unitDetails.has(expandedUnit)) return;
    const codigo = expandedUnit;
    setLoadingUnitIds(prev => new Set(prev).add(codigo));
    fetch(
      `/api/orcamento/consolidado/unidade?unidadeVendaId=${encodeURIComponent(codigo)}&startMonth=${startMonth}&endMonth=${endMonth}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
      .then(res => res.ok ? res.json() : null)
      .then((d: UnidadeDetailData | null) => {
        if (d) setUnitDetails(prev => new Map(prev).set(codigo, d));
      })
      .catch(() => {})
      .finally(() => setLoadingUnitIds(prev => {
        const next = new Set(prev); next.delete(codigo); return next;
      }));
  }, [expandedUnit, startMonth, endMonth, token, unitDetails]);

  // Dispara fetch de países quando unidade EXPORT é expandida
  useEffect(() => {
    if (!expandedUnit || !token) return;
    const u = data?.unidades.find(u => u.codigo === expandedUnit);
    if (u?.tipo !== 'EXPORT') return;
    if (paisDetails.has(expandedUnit)) return;
    const codigo = expandedUnit;
    setLoadingPaisIds(prev => new Set(prev).add(codigo));
    fetch(
      `/api/orcamento/consolidado/unidade/paises?unidadeVendaId=${encodeURIComponent(codigo)}&startMonth=${startMonth}&endMonth=${endMonth}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
      .then(res => res.ok ? res.json() : [])
      .then((d: PaisConsolidado[]) => setPaisDetails(prev => new Map(prev).set(codigo, d)))
      .catch(() => {})
      .finally(() => setLoadingPaisIds(prev => {
        const next = new Set(prev); next.delete(codigo); return next;
      }));
  }, [expandedUnit, data, startMonth, endMonth, token, paisDetails]);

  // Dispara fetch de detalhe por país quando um país é selecionado numa unidade EXPORT
  useEffect(() => {
    if (!expandedUnit || !token) return;
    const iso3 = selectedCountryByUnit.get(expandedUnit);
    if (!iso3) return;
    const cacheKey = `${expandedUnit}|${iso3}`;
    if (countryPaisDetail.has(cacheKey)) return;
    setLoadingPaisDetail(prev => new Set(prev).add(cacheKey));
    fetch(
      `/api/orcamento/consolidado/unidade/pais-detail?unidadeVendaId=${encodeURIComponent(expandedUnit)}&paisIso3=${encodeURIComponent(iso3)}&startMonth=${startMonth}&endMonth=${endMonth}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
      .then(res => res.ok ? res.json() : null)
      .then((d: UnidadeDetailData | null) => {
        if (d) setCountryPaisDetail(prev => new Map(prev).set(cacheKey, d));
      })
      .catch(() => {})
      .finally(() => setLoadingPaisDetail(prev => {
        const next = new Set(prev); next.delete(cacheKey); return next;
      }));
  }, [expandedUnit, selectedCountryByUnit, startMonth, endMonth, token, countryPaisDetail]);

  // ── Fetch: consolidado principal ──────────────────────────────────────────
  const fetchMainData = useCallback(async (bustCache = false) => {
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
      showToast('Erro ao carregar consolidado', 'error');
    } finally {
      if (!ctrl.signal.aborted) setIsLoadingMain(false);
    }
  }, [token, startMonth, endMonth, consolidadoCache, mainCacheKey, showToast]);

  // ── Fetch: acurácia por unidade ───────────────────────────────────────────
  const fetchAcuraciaData = useCallback(async (bustCache = false) => {
    acurAbortRef.current?.abort();
    if (!bustCache) {
      const cached = consolidadoCache.getCached(acurCacheKey) as AcuraciaUnidade[] | null;
      if (cached) { setAcuracia(cached); setIsLoadingAcuracia(false); return; }
    }
    const ctrl = new AbortController();
    acurAbortRef.current = ctrl;
    setIsLoadingAcuracia(true);
    setAcuracia([]);
    try {
      const res = await fetch(
        `/api/forecast/acuracia-unidades?anchorMonth=${endMonth}&meses=${mesesCount}&startMonth=${startMonth}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal },
      );
      const d: AcuraciaUnidade[] = res.ok ? await res.json() : [];
      setAcuracia(d);
      consolidadoCache.setCached(acurCacheKey, d);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setAcuracia([]);
    } finally {
      if (!ctrl.signal.aborted) setIsLoadingAcuracia(false);
    }
  }, [token, mesesCount, endMonth, consolidadoCache, acurCacheKey]);

  // ── Fetch: produtos crônicos (janela-independente) ────────────────────────
  const fetchCronicosData = useCallback(async () => {
    setIsLoadingCronicos(true);
    try {
      const res = await fetch(
        '/api/forecast/produtos-cronicos',
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const d: ProdutoCronico[] = res.ok ? await res.json() : [];
      setCronicos(d);
    } catch {
      setCronicos([]);
    } finally {
      setIsLoadingCronicos(false);
    }
  }, [token]);

  // Dispara todos os fetches em paralelo; cada um resolve e atualiza seu estado independentemente
  useEffect(() => { fetchMainData();     }, [fetchMainData]);
  useEffect(() => { fetchAcuraciaData(); }, [fetchAcuraciaData]);
  useEffect(() => { fetchCronicosData(); }, [fetchCronicosData]);

  const handleRefresh = useCallback(() => {
    fetchMainData(true);
    fetchAcuraciaData(true);
    fetchCronicosData();
  }, [fetchMainData, fetchAcuraciaData, fetchCronicosData]);


  // ── KPIs derivados do consolidado ─────────────────────────────────────────
  const totalORC    = data?.unidades.reduce((s, u) => s + u.orcAnual,    0) ?? 0;
  const totalFCTS   = data?.unidades.reduce((s, u) => s + u.fctsAnual,   0) ?? 0;
  const totalVendas = data?.unidades.reduce((s, u) => s + u.vendasAnual, 0) ?? 0;
  const atingFCTS   = totalORC > 0 ? (totalFCTS   / totalORC) * 100 : 0;

  // FCTS do período realizado (YTD): soma o FCTS de todos os meses até o último
  // mês com venda realizada — base do atingimento de vendas (vs orçado anual).
  const fctsPeriodo = useMemo(() => {
    const meses = data?.meses ?? [];
    let lastRealizedIdx = -1;
    meses.forEach((m, i) => { if (m.vendas > 0) lastRealizedIdx = i; });
    if (lastRealizedIdx < 0) return 0;
    return meses.slice(0, lastRealizedIdx + 1).reduce((s, m) => s + m.fcts, 0);
  }, [data]);
  const atingVendas = fctsPeriodo > 0 ? (totalVendas / fctsPeriodo) * 100 : 0;

  const acuraciaMap = useMemo(() => {
    const m = new Map<string, AcuraciaUnidade>();
    for (const a of acuracia) m.set(a.codigo, a);
    return m;
  }, [acuracia]);

  const evolutionData = (data?.meses ?? []).map((m) => ({
    name:   monthLabel(m.month),
    month:  m.month,
    ORC:    m.orc,
    FCTS:   m.fcts,
    Vendas: m.vendas,
  }));

  const divisionData = (data?.unidades ?? []).map((u) => ({
    name:   u.descricao,
    codigo: u.codigo,
    ORC:    u.orcAnual,
    FCTS:   u.fctsAnual,
    Vendas: u.vendasAnual,
  }));

  const divisionDataMobile = [...divisionData]
    .sort((a, b) => b.FCTS - a.FCTS)
    .slice(0, 5)
    .map(d => ({ ...d, name: d.name.length > 10 ? d.name.slice(0, 10) + '…' : d.name }));

  const handleDivisionBarClick = useCallback((payload: any) => {
    const codigo = payload?.codigo;
    if (!codigo) return;
    setExpandedUnit(codigo);
    setActiveTab('divisoes');
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedUnit(codigo);
    highlightTimerRef.current = setTimeout(() => setHighlightedUnit(null), 2000);
    setTimeout(() => {
      document.getElementById(`unit-row-${codigo}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }, []);

  const unitDescMap = useMemo(() =>
    new Map(data?.unidades.map(u => [u.codigo, u.descricao]) ?? []),
  [data]);

  const acuraciaMedia = useMemo(() => {
    if (acuracia.length === 0) return null;
    const totalPeso = acuracia.reduce((s, a) => s + (a.totalVendas || a.ciclosValidos), 0);
    if (totalPeso === 0) return null;
    return acuracia.reduce((s, a) => s + a.acuracia * (a.totalVendas || a.ciclosValidos), 0) / totalPeso;
  }, [acuracia]);

  const biasMedia = useMemo(() => {
    if (acuracia.length === 0) return null;
    const totalPeso = acuracia.reduce((s, a) => s + (a.totalVendas || a.ciclosValidos), 0);
    if (totalPeso === 0) return null;
    return acuracia.reduce((s, a) => s + a.bias * (a.totalVendas || a.ciclosValidos), 0) / totalPeso;
  }, [acuracia]);

  return (
    <div className="space-y-8">
      {/* Header — sempre visível */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Consolidado</h2>
            <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[11px] font-semibold rounded-full tracking-wide uppercase">
              Executivo
            </span>
            {data?.run && (
              <span className="px-2 py-0.5 bg-sky-50 text-sky-700 text-[11px] font-bold rounded-full border border-sky-100">
                {tc('abbr.orc')} {data.run.ano}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-0.5">
            {tc('corporateView')}
          </p>
        </div>
        <div data-tour="consolidado-window" className="flex items-start gap-3 flex-wrap justify-end">
          {/* h-8 = altura do pill group do WindowSelector, para alinhar pelo topo */}
          <button
            onClick={() => setShowExtracao(true)}
            title={tc('extracao.titulo')}
            // Só em desktop (md = 768px, mesmo corte de useIsMobile): a extração
            // pressupõe planilha, e o modal de filtros não cabe em tela pequena.
            className="hidden md:flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 hover:text-slate-800 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            {tc('extracao.botao')}
          </button>
          <WindowSelector
            startMonth={startMonth}
            endMonth={endMonth}
            onChange={(s, e) => setWindowState({ startMonth: s, endMonth: e })}
            years={[new Date().getFullYear() - 1, new Date().getFullYear()]}
          />
          <button
            onClick={handleRefresh}
            title="Recarregar dados"
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
              Período multi-ano: <span className="font-bold">{startMonth.substring(0, 4)}</span> – <span className="font-bold">{endMonth.substring(0, 4)}</span>
            </p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
              {tc('crossYear.description')}
            </p>
          </div>
          <button
            onClick={() => setCrossYearDismissed(true)}
            title="Fechar aviso"
            className="flex-shrink-0 p-1 rounded-md text-amber-400 hover:text-amber-700 hover:bg-amber-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Cards — skeleton enquanto consolidado carrega */}
      {isLoadingMain ? (
        <div data-tour="consolidado-kpis" className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          <KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton />
        </div>
      ) : data?.run ? (
        <div data-tour="consolidado-kpis" className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">

          {/* Card — Bias do Forecast (skeleton próprio enquanto acuracia carrega) */}
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
                    biasMedia === null       ? 'bg-slate-50 text-slate-400' :
                    Math.abs(biasMedia) < 5  ? 'bg-emerald-50 text-emerald-600' :
                    Math.abs(biasMedia) < 15 ? 'bg-amber-50 text-amber-600' :
                                               'bg-red-50 text-red-600',
                  )}>
                    <Activity className="w-5 h-5" />
                  </div>
                  {biasMedia !== null && (
                    <span className={cn(
                      'text-[10px] font-bold px-2 py-0.5 rounded-full',
                      biasMedia > 0   ? 'bg-amber-50 text-amber-700' :
                      biasMedia < 0   ? 'bg-sky-50 text-sky-700'     :
                                        'bg-emerald-50 text-emerald-700',
                    )}>
                      {biasMedia > 0.5 ? '↑ sobre-estima' : biasMedia < -0.5 ? '↓ sub-estima' : '✓ calibrado'}
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
                  Bias do Forecast
                  <InfoTooltip
                    text={tc('tooltips.bias')}
                    width="w-80"
                  />
                </p>
                {biasMedia === null ? (
                  <>
                    <p className="text-xl font-bold text-slate-300">—</p>
                    <p className="text-xs text-slate-400 mt-1">Aguardando vendas reais</p>
                  </>
                ) : (
                  <>
                    <h3 className={cn(
                      'text-2xl font-bold mb-1',
                      Math.abs(biasMedia) < 5  ? 'text-emerald-600' :
                      Math.abs(biasMedia) < 15 ? 'text-amber-600'   : 'text-red-600',
                    )}>
                      {biasMedia > 0 ? '+' : ''}{biasMedia.toFixed(1)}%
                    </h3>
                    <p className="text-xs text-slate-400">
                      {acuracia.filter(a => Math.abs(a.bias) < 5).length} unidades calibradas
                    </p>
                  </>
                )}
              </>
            )}
          </div>

          {/* Card — FCTS vs ORC */}
          <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg w-fit mb-4">
              <TrendingUp className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
              {tc('kpi.fctsVsOrc')}
              <InfoTooltip text={tc('tooltips.fctsVsOrc')} width="w-64" />
            </p>
            <div className="flex items-end justify-between gap-2">
              <div>
                <h3 className="text-2xl font-bold text-slate-900 leading-tight">{fmt(totalFCTS)}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{tc('abbr.orc')} {fmt(totalORC)}</p>
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

          {/* Card — Vendas Realizadas */}
          <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg w-fit mb-4">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
              Vendas Realizadas (YTD)
              <InfoTooltip text={tc('tooltips.salesVsOrc')} width="w-64" />
            </p>
            <div className="flex items-baseline gap-2">
              <h3 className="text-2xl font-bold text-slate-900">{fmt(totalVendas)}</h3>
              <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                {atingVendas.toFixed(1)}% FCST
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {`unidades faturadas no período`}
            </p>
          </div>

          {/* Card — Acurácia 3M (skeleton próprio enquanto acuracia carrega) */}
          <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 shadow-sm">
            {isLoadingAcuracia ? (
              <div className="animate-pulse space-y-3">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-9 h-9 bg-slate-100 rounded-lg" />
                  <div className="w-20 h-4 bg-slate-100 rounded-full" />
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
                  {acuraciaMedia !== null && (
                    <span className={cn(
                      'text-xs font-bold px-2 py-0.5 rounded-full',
                      acuraciaMedia >= 90 ? 'bg-emerald-50 text-emerald-700' :
                      acuraciaMedia >= 75 ? 'bg-amber-50   text-amber-700'   :
                                            'bg-red-50     text-red-700',
                    )}>
                      média {acuraciaMedia.toFixed(1)}%
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
                  Acurácia do Período
                  <InfoTooltip text={tc('tooltips.accuracy')} width="w-80" />
                </p>
                {acuraciaMedia === null ? (
                  <>
                    <p className="text-xl font-bold text-slate-300">—</p>
                    <p className="text-xs text-slate-400 mt-1">Aguardando vendas reais</p>
                  </>
                ) : (
                  <>
                    <h3 className={cn(
                      'text-2xl font-bold mb-1',
                      acuraciaMedia >= 90 ? 'text-emerald-600' :
                      acuraciaMedia >= 75 ? 'text-amber-600'   : 'text-red-600',
                    )}>
                      {acuraciaMedia.toFixed(1)}%
                    </h3>
                    <p className="text-xs text-slate-400">
                      {acuracia.filter(a => a.acuracia >= 90).length} unidades ≥90%
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* Sem orçamento */}
      {!isLoadingMain && !data?.run && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <AlertCircle className="w-12 h-12 text-slate-200 mb-3" />
          <p className="font-medium">Nenhum orçamento aprovado para o período selecionado.</p>
          <p className="text-sm">Aguarde a carga do OrcamentoRun pelo administrador.</p>
        </div>
      )}

      {/* Gráficos — skeleton enquanto consolidado carrega */}
      {isLoadingMain ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div data-tour="consolidado-chart"><ChartSkeleton /></div>
          <ChartSkeleton />
        </div>
      ) : data?.run ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Evolução mensal */}
          <div data-tour="consolidado-chart" className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{tc('monthlyEvolution')}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{tc('evolutionSubtitle')}</p>
              </div>
            </div>
            <div className="h-[200px] md:h-[280px]">
              <EvolucaoMensalChart data={evolutionData} onPointClick={setDrawerMesConsolidado} />
            </div>
          </div>

          {/* Por divisão */}
          <div className="bg-white p-4 md:p-8 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-start justify-between mb-4 md:mb-6">
              <div>
                <h3 className="text-base md:text-lg font-bold text-slate-900">{tc('abbr.orc')} · {tc('abbr.fcts')} · Vendas por Divisão</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {isMobile ? tc('top5ByFcts') : tc('clickDivisionHint')}
                </p>
              </div>
            </div>
            <div className="h-[200px] md:h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={isMobile ? divisionDataMobile : divisionData}
                  layout="vertical"
                  margin={{ left: isMobile ? 8 : 40, right: isMobile ? 4 : 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#475569', fontSize: isMobile ? 9 : 11, fontWeight: 600 }}
                    width={isMobile ? 72 : 100}
                  />
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: isMobile ? '11px' : '13px' }}
                    formatter={(v, name) => [fmt(typeof v === 'number' ? v : 0), name ?? '']}
                  />
                  {!isMobile && (
                    <Legend iconType="circle" wrapperStyle={{ paddingTop: '8px', fontSize: '11px', color: '#475569' }} />
                  )}
                  <Bar dataKey="ORC"  name={tc('abbr.orc') as string}  fill="#94a3b8" radius={[0, 4, 4, 0]} barSize={isMobile ? 7 : 11} style={{ cursor: 'pointer' }} onClick={handleDivisionBarClick} />
                  <Bar dataKey="FCTS" name={tc('abbr.fcts') as string} fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={isMobile ? 7 : 11} style={{ cursor: 'pointer' }} onClick={handleDivisionBarClick} />
                  <Bar dataKey="Vendas" fill="#0d9488" radius={[0, 4, 4, 0]} barSize={isMobile ? 7 : 11} style={{ cursor: 'pointer' }} onClick={handleDivisionBarClick} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ) : null}

      {/* Tabs — skeleton enquanto consolidado carrega */}
      {isLoadingMain ? (
        <div data-tour="consolidado-tabs"><TableSkeleton /></div>
      ) : data?.run ? (
        <div data-tour="consolidado-tabs" className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Tab header */}
          <div className="flex items-center gap-0 border-b border-slate-200 px-6 pt-4">
            <button
              onClick={() => setActiveTab('divisoes')}
              className={cn(
                'px-4 py-2 text-sm font-bold rounded-t-lg -mb-px border-b-2 transition-colors',
                activeTab === 'divisoes'
                  ? 'border-sky-600 text-sky-700'
                  : 'border-transparent text-slate-400 hover:text-slate-600',
              )}
            >
              <BarChart2 className="w-4 h-4 inline mr-1.5" />
              {tc('tabs.division')}
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
              Produtos Crônicos
              {isLoadingCronicos ? (
                <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 animate-pulse">
                  •••
                </span>
              ) : cronicos.length > 0 ? (
                <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600">
                  {cronicos.length}
                </span>
              ) : null}
            </button>
          </div>

          {/* ── Tab: Divisões ─────────────────────────────────────────────── */}
          {activeTab === 'divisoes' && (isMobile ? (
            <DivisaoCardList
              unidades={data.unidades}
              acuraciaMap={acuraciaMap}
              isLoadingAcuracia={isLoadingAcuracia}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-200">
                    <th className="px-6 py-4 w-10"></th>
                    <th className="px-6 py-4">Divisão</th>
                    <th className="px-6 py-4 text-right">
                      <span className="inline-flex items-center gap-1 justify-end">
                        {tc('abbr.orc')} Anual
                        <InfoTooltip text="Orçamento aprovado." position="bottom" width="w-44" />
                      </span>
                    </th>
                    <th className="px-6 py-4 text-right">
                      <span className="inline-flex items-center gap-1 justify-center">
                        {tc('abbr.fcts')}
                        <InfoTooltip text={`Soma do ${tc('abbr.fcts')} aprovado.`} position="bottom" width="w-52" />
                      </span>
                    </th>
                    <th className="px-6 py-4 text-right">
                      <span className="inline-flex items-center gap-1 justify-end">
                        {tc('breakdown.table.deltaAA')}
                        <InfoTooltip text={tc('breakdown.table.deltaAATooltip')} position="bottom" width="w-72" />
                      </span>
                    </th>
                    <th className="px-6 py-4 text-right">
                      <span className="inline-flex items-center gap-1 justify-end">
                        Δ Ciclo Ant.
                        <InfoTooltip text={`Variação do ${tc('abbr.fcts')} total entre o ciclo mais recente e o ciclo anterior para esta unidade.`} position="bottom" width="w-72" />
                      </span>
                    </th>
                    <th className="px-6 py-4 text-right">
                      <span className="inline-flex items-center gap-1 justify-end">
                        Acurácia 3M
                        <InfoTooltip text={`Média da acurácia do ${tc('abbr.fcts')} vs. vendas reais nos últimos 3 meses fechados.`} position="bottom" width="w-72" />
                      </span>
                    </th>
                    <th className="px-6 py-4 text-right">
                      <span className="inline-flex items-center gap-1 justify-end">
                        Vendas YTD
                        <InfoTooltip text="Vendas reais acumuladas desde Janeiro até ao último mês fechado do ano selecionado." position="bottom" width="w-64" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.unidades.map((u) => {
                    const isExpanded = expandedUnit === u.codigo;
                    const deltaCiclo = calcDeltaCiclo(u.latestCycleFcts ?? 0, u.prevCycleFcts ?? 0);
                    const acuraciaU  = acuraciaMap.get(u.codigo);

                    return (
                      <React.Fragment key={u.codigo}>
                        <tr
                          id={`unit-row-${u.codigo}`}
                          className={cn(
                            'hover:bg-slate-50 transition-all duration-500 cursor-pointer',
                            highlightedUnit === u.codigo && 'ring-2 ring-inset ring-sky-400 bg-sky-50',
                          )}
                          onClick={() => setExpandedUnit(isExpanded ? null : u.codigo)}
                        >
                          <td className="px-6 py-4">
                            {isExpanded
                              ? <ChevronUp   className="w-4 h-4 text-slate-400" />
                              : <ChevronDown className="w-4 h-4 text-slate-400" />}
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                              {u.descricao}
                              {u.tipo === 'EXPORT' && (
                                <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded-full border border-indigo-100">
                                  EXPORT
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400">{u.codigo}</div>
                          </td>
                          <td className="px-6 py-4 text-right font-mono text-sm text-slate-500">{fmt(u.orcAnual)}</td>
                          <td className="px-6 py-4 text-right font-mono text-sm font-semibold text-slate-900">{fmt(u.fctsAnual)}</td>
                          <td className="px-6 py-4 text-right">
                            {u.vendaAA != null && u.vendaAA > 0
                              ? <DeltaBadge v={u.fctsForDesvio ?? 0} base={u.vendaAA} />
                              : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          <td className="px-6 py-4 text-right"><DeltaCicloBadge value={deltaCiclo} /></td>
                          <td className="px-6 py-4 text-right">
                            {isLoadingAcuracia
                              ? <span className="inline-block w-10 h-3 bg-slate-100 rounded animate-pulse" />
                              : <AcuraciaBadge acuracia={acuraciaU?.acuracia ?? null} />
                            }
                          </td>
                          <td className="px-6 py-4 text-right font-mono text-sm text-emerald-700">{fmt(u.vendasAnual)}</td>
                        </tr>

                        {/* Linha expandida — detalhe carregado lazily */}
                        {isExpanded && (() => {
                          const selectedIso3  = selectedCountryByUnit.get(u.codigo) ?? null;
                          const paises        = paisDetails.get(u.codigo) ?? [];
                          const cacheKey      = selectedIso3 ? `${u.codigo}|${selectedIso3}` : null;
                          const selectedPais  = paises.find(p => p.iso3 === selectedIso3) ?? null;

                          // Decide qual dado passar ao FamiliaBreakdownSection
                          const isCountryLoading = cacheKey ? loadingPaisDetail.has(cacheKey) : false;
                          const familiaData = selectedIso3 && cacheKey
                            ? countryPaisDetail.get(cacheKey) ?? null
                            : unitDetails.get(u.codigo) ?? null;
                          const isFamiliaLoading = selectedIso3 ? isCountryLoading : loadingUnitIds.has(u.codigo);

                          // Métricas para o FamiliaBreakdownSection (mudam com o país selecionado)
                          const fOrc    = selectedPais?.orcAnual    ?? u.orcAnual;
                          const fFcts   = selectedPais?.fctsAnual   ?? u.fctsAnual;
                          const fVendas = selectedPais?.vendasAnual ?? u.vendasAnual;

                          return (
                            <tr>
                              <td colSpan={8} className="px-6 py-4 bg-slate-50/50">

                                {/* CountryTabBar — apenas para EXPORT */}
                                {u.tipo === 'EXPORT' && !loadingPaisIds.has(u.codigo) && paises.length > 0 && (
                                  <CountryTabBar
                                    paises={paises}
                                    selected={selectedIso3}
                                    onSelect={iso3 => setSelectedCountryByUnit(prev => new Map(prev).set(u.codigo, iso3))}
                                  />
                                )}

                                {/* Tabela resumo — apenas na aba "Todos" de unidades EXPORT */}
                                {u.tipo === 'EXPORT' && selectedIso3 === null && paises.length > 0 && (
                                  <div className="mb-4 rounded-xl border border-indigo-100 overflow-hidden">
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="bg-indigo-50 text-xs text-slate-500 font-medium">
                                          <th className="px-4 py-2 text-left text-indigo-600 font-semibold">País</th>
                                          <th className="px-4 py-2 text-right">{tc('abbr.orc')}</th>
                                          <th className="px-4 py-2 text-right">{tc('abbr.fcts')}</th>
                                          <th className="px-4 py-2 text-right">Δ {tc('abbr.fcts')}/{tc('abbr.orc')}</th>
                                          <th className="px-4 py-2 text-right">Vendas</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 bg-white">
                                        {paises.map(p => (
                                          <tr
                                            key={p.iso3}
                                            className="hover:bg-indigo-50/40 cursor-pointer transition-colors"
                                            onClick={() => setSelectedCountryByUnit(prev => new Map(prev).set(u.codigo, p.iso3))}
                                          >
                                            <td className="px-4 py-2">
                                              <span className="font-mono text-xs text-slate-400 mr-2">{p.iso3}</span>
                                              <span className="text-sm text-slate-700 font-medium">{p.nome}</span>
                                            </td>
                                            <td className="px-4 py-2 text-right font-mono text-xs text-slate-500">{fmt(p.orcAnual)}</td>
                                            <td className="px-4 py-2 text-right font-mono text-xs font-semibold text-slate-900">{fmt(p.fctsAnual)}</td>
                                            <td className="px-4 py-2 text-right"><DeltaBadge v={p.fctsAnual} base={p.orcAnual} /></td>
                                            <td className="px-4 py-2 text-right font-mono text-xs text-emerald-700">{fmt(p.vendasAnual)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}

                                {/* KPI row do país selecionado */}
                                {u.tipo === 'EXPORT' && selectedPais && (
                                  <div className="flex items-center gap-4 mb-3 px-2 py-2 bg-indigo-50/60 rounded-lg border border-indigo-100 text-xs">
                                    <span className="font-bold text-indigo-700">{selectedPais.nome}</span>
                                    <span className="text-slate-500">ORC <span className="font-mono font-semibold text-slate-700">{fmt(selectedPais.orcAnual)}</span></span>
                                    <span className="text-slate-500">{tc('abbr.fcts')} <span className="font-mono font-semibold text-slate-900">{fmt(selectedPais.fctsAnual)}</span></span>
                                    <DeltaBadge v={selectedPais.fctsAnual} base={selectedPais.orcAnual} />
                                    <span className="text-slate-500">Vendas <span className="font-mono font-semibold text-emerald-700">{fmt(selectedPais.vendasAnual)}</span></span>
                                  </div>
                                )}

                                {/* FamiliaBreakdownSection — dados mudam com país selecionado */}
                                {isFamiliaLoading ? (
                                  <UnitDetailSkeleton />
                                ) : familiaData ? (
                                  <FamiliaBreakdownSection
                                    unitCodigo={u.codigo}
                                    familiaMeses={familiaData.familiaMeses}
                                    produtos={familiaData.produtos}
                                    token={token ?? ''}
                                    porMes={familiaData.porMes}
                                    orcAnual={fOrc}
                                    fctsAnual={fFcts}
                                    vendasAnual={fVendas}
                                    acuraciaUnit={selectedIso3 ? undefined : acuraciaU}
                                    startMonth={startMonth}
                                    endMonth={endMonth}
                                    paisIso3={selectedIso3 ?? undefined}
                                  />
                                ) : (
                                  <div className="text-sm text-slate-400 py-4 text-center">
                                    Sem dados de detalhe disponíveis.
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })()}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {/* ── Tab: Produtos Crônicos ─────────────────────────────────────── */}
          {activeTab === 'cronicos' && (
            <div className="p-6">
              {isLoadingCronicos ? (
                <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Carregando produtos crônicos...</span>
                </div>
              ) : (
                <ProdutosCronicosSection
                  cronicos={cronicos}
                  unitDescMap={unitDescMap}
                  showFilter={true}
                  showUnitGrouping={true}
                />
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* ── Drawer: Evolução Mensal → por divisão ─────────────────────────────── */}
      {(() => {
        const mesData = data?.meses.find(m => m.month === drawerMesConsolidado);
        const label = drawerMesConsolidado
          ? `${monthLabel(drawerMesConsolidado)}/${new Date(`${drawerMesConsolidado}T00:00:00Z`).getUTCFullYear()}`
          : '';
        return (
          <Drawer
            isOpen={!!drawerMesConsolidado}
            onClose={() => setDrawerMesConsolidado(null)}
            title={tc('drawerTitle', { label })}
            subtitle={tc('drawerSubtitle')}
          >
            {drawerMesConsolidado && data && (
              <div className="space-y-3">
                {mesData && (
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {[
                      { label: `${tc('abbr.orc')} Total`,             value: mesData.orc,    color: 'text-slate-500' },
                      { label: `${tc('abbr.fcts')} Total`,             value: mesData.fcts,   color: 'text-blue-600'  },
                      { label: `${tc('breakdown.table.sales')} Total`, value: mesData.vendas, color: 'text-teal-600'  },
                    ].map(({ label: l, value, color }) => (
                      <div key={l} className="bg-slate-50 rounded-xl px-3 py-2.5 text-center">
                        <p className="text-[10px] text-slate-400 mb-0.5">{l}</p>
                        <p className={cn('text-sm font-bold tabular-nums', color)}>{fmt(value)}</p>
                      </div>
                    ))}
                  </div>
                )}
                {data.unidades.map((u) => {
                  // Usa detalhe lazy se disponível; fallback para porMes do lightweight
                  const porMesSource = unitDetails.get(u.codigo)?.porMes ?? u.porMes;
                  const m = porMesSource.find(pm => pm.month === drawerMesConsolidado);
                  if (!m) return null;
                  const pct = m.orc > 0 ? (m.fcts / m.orc) * 100 : null;
                  return (
                    <div key={u.codigo} className="rounded-xl border border-slate-100 px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-700">{u.codigo}</p>
                          <p className="text-[10px] text-slate-400">{u.descricao}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {m.submissionStatus && (
                            <span className={cn(
                              'text-[9px] font-bold px-1.5 py-0.5 rounded-full border',
                              m.submissionStatus === 'APPROVED'  ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                              m.submissionStatus === 'SUBMITTED' ? 'bg-amber-50 text-amber-700 border-amber-200'       :
                              m.submissionStatus === 'REJECTED'  ? 'bg-red-50 text-red-700 border-red-200'             :
                                                                    'bg-slate-100 text-slate-500 border-slate-200',
                            )}>
                              {t(`status.${m.submissionStatus ?? 'DRAFT'}`)}
                            </span>
                          )}
                          <button
                            onClick={() => {
                              setDrawerMesConsolidado(null);
                              handleDivisionBarClick(u);
                            }}
                            title={tc('viewDivisionFamilies')}
                            className="text-[9px] font-bold text-sky-600 hover:text-sky-800 bg-sky-50 hover:bg-sky-100 px-2 py-0.5 rounded-full border border-sky-200 transition-colors whitespace-nowrap"
                          >
                            {tc('viewDivision')}
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 text-center text-[11px]">
                        <div>
                          <p className="text-slate-400 text-[9px]">{tc('abbr.orc')}</p>
                          <p className="font-semibold text-slate-500 tabular-nums">{fmt(m.orc)}</p>
                        </div>
                        <div>
                          <p className="text-[9px]" style={{ color: CHART_COLORS.fcts }}>{tc('abbr.fcts')}</p>
                          <p className="font-bold tabular-nums" style={{ color: CHART_COLORS.fcts }}>{fmt(m.fcts)}</p>
                        </div>
                        <div>
                          <p className="text-[9px]" style={{ color: CHART_COLORS.vendas }}>{tc('breakdown.table.sales')}</p>
                          <p className="font-bold tabular-nums" style={{ color: CHART_COLORS.vendas }}>{fmt(m.vendas)}</p>
                        </div>
                      </div>
                      {pct !== null && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(pct, 100)}%`,
                                backgroundColor: pct >= 90 ? '#10b981' : pct >= 75 ? '#f59e0b' : '#ef4444',
                              }}
                            />
                          </div>
                          <span className="text-[10px] font-bold text-slate-500 tabular-nums">{pct.toFixed(0)}%</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Drawer>
        );
      })()}

      {/* Visão corporativa: sem unidade ativa — o modal abre com todas marcadas
          e o usuário escolhe as unidades desejadas. */}
      {showExtracao && (
        <ExtracaoDadosModal
          token={token ?? ''}
          defaultStartMonth={startMonth}
          defaultEndMonth={endMonth}
          onClose={() => setShowExtracao(false)}
        />
      )}
    </div>
  );
};
