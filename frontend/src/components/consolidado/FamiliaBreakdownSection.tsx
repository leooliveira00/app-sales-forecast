import React, { useState, useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { BarChart2, ChevronDown, ChevronUp, ArrowUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn, InfoTooltip } from '../shared/Common';
import { DeltaBadge } from './ConsolidadoBadges';
import { useIsMobile } from '../../hooks/useBreakpoint';
import { useFormatter } from '../../hooks/useFormatter';

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface MesData {
  month:  string;
  orc:    number;
  fcts:   number;
  vendas: number;
}

interface ProdutoData {
  id:         string;
  codigo:     string;
  descricao:  string;
  familia:    string;
  orcAnual:   number;
  fctsAnual:  number;
  vendasAnual: number;
  /** Venda do ano anterior (mesmos meses com A.A. válido) — base do desvio FCST×A.A. */
  vendaAA?:       number | null;
  /** FCST dos mesmos meses com A.A. válido (filtro simétrico) */
  fctsForDesvio?: number | null;
}

interface FamiliaMesItem {
  month:  string;
  orc:    number;
  fcts:   number;
  vendas: number;
}

export interface FamiliaBreakdownSectionProps {
  unitCodigo:    string;
  familiaMeses:  { familia: string; porMes: FamiliaMesItem[] }[];
  produtos:      ProdutoData[];
  token:         string;
  /** Se fornecido, exibe toggle de evolução mensal da unidade (Secção A) */
  porMes?:       MesData[];
  orcAnual?:     number;
  fctsAnual?:    number;
  vendasAnual?:  number;
  acuraciaUnit?: { acuracia: number; bias: number; ciclosValidos: number };
  /** Janela do WindowSelector — propaga para o mini-gráfico por produto */
  startMonth?:   string;
  endMonth?:     string;
  /** País selecionado no CountryTabBar — filtra o mini-gráfico por produto */
  paisIso3?:     string;
}

// ── Componente ─────────────────────────────────────────────────────────────────

export const FamiliaBreakdownSection: React.FC<FamiliaBreakdownSectionProps> = ({
  unitCodigo,
  familiaMeses,
  produtos,
  token,
  porMes,
  orcAnual     = 0,
  fctsAnual    = 0,
  vendasAnual  = 0,
  acuraciaUnit,
  startMonth,
  endMonth,
  paisIso3,
}) => {
  const { t }    = useTranslation('consolidado');
  const { t: tc } = useTranslation('common');
  const { fmt }  = useFormatter();
  const months   = tc('months', { returnObjects: true }) as string[];
  const monthLabel = (iso: string) => months[new Date(iso).getUTCMonth()];

  // ── Estado local ───────────────────────────────────────────────────────────
  const [isUnitChartOpen,    setIsUnitChartOpen]    = useState(false);
  const [expandedFams,       setExpandedFams]       = useState<Set<string>>(new Set());
  const [expandedFamMonths,  setExpandedFamMonths]  = useState<Set<string>>(new Set());
  const [prodChartStatus,    setProdChartStatus]    = useState<Map<string, 'idle' | 'loading' | 'done'>>(new Map());
  const [prodChartData,      setProdChartData]      = useState<Map<string, MesData[]>>(new Map());
  const [famSort,            setFamSort]            = useState<'alfa' | 'orc' | 'fcts' | 'delta'>('alfa');
  const isMobile = useIsMobile();

  // ── Agrupamento de produtos por família ────────────────────────────────────
  const prodsByFam = useMemo(() => {
    const m = new Map<string, ProdutoData[]>();
    for (const p of produtos) {
      const fam = p.familia || tc('errors.noData');
      if (!m.has(fam)) m.set(fam, []);
      m.get(fam)!.push(p);
    }
    return m;
  }, [produtos, tc]);

  const familiasUnit = useMemo(() => {
    const entries = [...prodsByFam.entries()];
    switch (famSort) {
      case 'orc':   return entries.sort((a, b) => b[1].reduce((s, p) => s + p.orcAnual,  0) - a[1].reduce((s, p) => s + p.orcAnual,  0));
      case 'fcts':  return entries.sort((a, b) => b[1].reduce((s, p) => s + p.fctsAnual, 0) - a[1].reduce((s, p) => s + p.fctsAnual, 0));
      case 'delta': return entries.sort((a, b) => {
        const calcDelta = (ps: ProdutoData[]) => {
          const vendaAA = ps.reduce((s, p) => s + (p.vendaAA ?? 0),       0);
          const fcts    = ps.reduce((s, p) => s + (p.fctsForDesvio ?? 0), 0);
          return vendaAA > 0 ? Math.abs((fcts / vendaAA - 1) * 100) : 0;
        };
        return calcDelta(b[1]) - calcDelta(a[1]);
      });
      default: return entries.sort((a, b) => a[0].localeCompare(b[0]));
    }
  }, [prodsByFam, famSort]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const toggleFam = (fam: string) => setExpandedFams(prev => {
    const next = new Set(prev);
    next.has(fam) ? next.delete(fam) : next.add(fam);
    return next;
  });

  const toggleAllFams = (expand: boolean) =>
    setExpandedFams(expand ? new Set(familiasUnit.map(([f]) => f)) : new Set());

  const toggleFamMonth = (fam: string) => setExpandedFamMonths(prev => {
    const next = new Set(prev);
    next.has(fam) ? next.delete(fam) : next.add(fam);
    return next;
  });

  const toggleProdChart = (e: React.MouseEvent, prodKey: string, prodId: string) => {
    e.stopPropagation();
    const chartSt = prodChartStatus.get(prodKey) ?? 'idle';
    if (chartSt === 'idle') {
      setProdChartStatus(prev => new Map(prev).set(prodKey, 'loading'));
      const prodParams = new URLSearchParams({ unidadeVendaId: unitCodigo, produtoId: prodId });
      if (startMonth) prodParams.set('startMonth', startMonth);
      if (endMonth)   prodParams.set('endMonth',   endMonth);
      if (paisIso3)   prodParams.set('paisIso3',   paisIso3);
      fetch(
        `/api/forecast/produto-meses?${prodParams}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
        .then(r => r.ok ? r.json() : [])
        .then(d => {
          setProdChartData(prev => new Map(prev).set(prodKey, d));
          setProdChartStatus(prev => new Map(prev).set(prodKey, 'done'));
        })
        .catch(() => setProdChartStatus(prev => {
          const m = new Map(prev); m.delete(prodKey); return m;
        }));
    } else if (chartSt === 'done') {
      setProdChartStatus(prev => { const m = new Map(prev); m.delete(prodKey); return m; });
    }
  };

  // ── KPIs da mini chart da unidade ─────────────────────────────────────────
  const deltaVF = fctsAnual > 0 ? ((vendasAnual / fctsAnual) - 1) * 100 : null;

  // Tendência FCTS: compara média da 1ª metade vs 2ª metade do período
  const mesesComFcts = (porMes ?? []).filter(m => m.fcts > 0);
  const mid = Math.floor(mesesComFcts.length / 2);
  const tendencia = (() => {
    if (mesesComFcts.length < 2 || mid === 0) return null;
    const avgFirst  = mesesComFcts.slice(0, mid).reduce((s, m) => s + m.fcts, 0) / mid;
    const avgSecond = mesesComFcts.slice(mid).reduce((s, m) => s + m.fcts, 0) / (mesesComFcts.length - mid);
    return avgFirst > 0 ? ((avgSecond / avgFirst) - 1) * 100 : null;
  })();

  // Cobertura ORC: meses onde FCTS ≥ 95% do ORC
  const mesesComOrc   = (porMes ?? []).filter(m => m.orc > 0);
  const mesesCobertos = mesesComOrc.filter(m => m.fcts >= m.orc * 0.95).length;
  const totalMeses    = mesesComOrc.length;
  const chartDataPorMes = (porMes ?? []).map(m => ({
    name:   monthLabel(m.month),
    ORC:    m.orc,
    FCTS:   m.fcts,
    Vendas: m.vendas,
  }));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Secção A: Evolução mensal da unidade */}
      {porMes && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={(e) => { e.stopPropagation(); setIsUnitChartOpen(v => !v); }}
              title={isUnitChartOpen ? t('breakdown.hideEvolution') : t('breakdown.showEvolution')}
              className={cn(
                'p-1.5 rounded-lg transition-colors',
                isUnitChartOpen
                  ? 'bg-sky-600 text-white hover:bg-sky-700'
                  : 'bg-sky-50 text-sky-600 hover:bg-sky-100 border border-sky-100',
              )}
            >
              <BarChart2 className="w-3.5 h-3.5" />
            </button>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {t('breakdown.unitEvolution')}
              <InfoTooltip
                text={t('breakdown.unitEvolutionTooltip')}
                position="bottom"
                width="w-64"
              />
            </span>
          </div>

          {isUnitChartOpen && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm mb-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 pb-4 border-b border-slate-100">
                <div className="text-center">
                  <p className="inline-flex items-center justify-center gap-1 text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">
                    {t('breakdown.kpi.deltaFctsOrc')}
                    <InfoTooltip text={t('breakdown.kpi.deltaFctsOrcTooltip')} position="bottom" width="w-64" />
                  </p>
                  <div className="flex justify-center mt-0.5">
                    {orcAnual > 0
                      ? <DeltaBadge v={fctsAnual} base={orcAnual} />
                      : <span className="text-xs text-slate-300">—</span>}
                  </div>
                </div>
                <div className="text-center">
                  <p className="inline-flex items-center justify-center gap-1 text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">
                    {t('breakdown.kpi.deltaVendasFcts')}
                    <InfoTooltip text={t('breakdown.kpi.deltaVendasFctsTooltip')} position="bottom" width="w-64" />
                  </p>
                  <p className={cn('text-sm font-bold',
                    deltaVF === null ? 'text-slate-300' :
                    deltaVF >= -5   ? 'text-emerald-600' :
                    deltaVF >= -15  ? 'text-amber-600'   : 'text-red-600',
                  )}>
                    {deltaVF === null ? '—' : `${deltaVF > 0 ? '+' : ''}${deltaVF.toFixed(1)}%`}
                  </p>
                </div>
                <div className="text-center">
                  <p className="inline-flex items-center justify-center gap-1 text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">
                    {t('breakdown.kpi.tendencia')}
                    <InfoTooltip text={t('breakdown.kpi.tendenciaTooltip')} position="bottom" width="w-64" />
                  </p>
                  <p className={cn('text-sm font-bold',
                    tendencia === null  ? 'text-slate-300'   :
                    tendencia >= 0     ? 'text-emerald-600' : 'text-red-600',
                  )}>
                    {tendencia === null
                      ? '—'
                      : `${tendencia >= 0 ? '▲ +' : '▼ '}${tendencia.toFixed(1)}%`}
                  </p>
                </div>
                <div className="text-center">
                  <p className="inline-flex items-center justify-center gap-1 text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">
                    {t('breakdown.kpi.coberturaOrc')}
                    <InfoTooltip text={t('breakdown.kpi.coberturaOrcTooltip')} position="bottom" width="w-64" />
                  </p>
                  <p className={cn('text-sm font-bold',
                    totalMeses === 0                              ? 'text-slate-300'   :
                    mesesCobertos / totalMeses >= 0.75           ? 'text-emerald-600' :
                    mesesCobertos / totalMeses >= 0.50           ? 'text-amber-600'   : 'text-red-600',
                  )}>
                    {totalMeses === 0 ? '—' : `${mesesCobertos} de ${totalMeses}`}
                  </p>
                </div>
              </div>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartDataPorMes}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false}
                      tick={{ fill: '#64748b', fontSize: 10 }} />
                    <YAxis axisLine={false} tickLine={false}
                      tick={{ fill: '#64748b', fontSize: 10 }}
                      tickFormatter={(v) => v > 0 ? fmt(v) : '0'} />
                    <Tooltip
                      contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 4px 12px rgb(0 0 0 / 0.1)' }}
                      formatter={(v: number, name: string) => [fmt(v), name]}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }} />
                    <Bar    dataKey="Vendas" name={t('legend.vendas', { ns: 'dashboard' }) as string} fill="#0d9488" radius={[3, 3, 0, 0]} barSize={12} />
                    <Line   type="monotone" dataKey="ORC"  name={t('abbr.orc') as string} stroke="#94a3b8" strokeDasharray="5 5" strokeWidth={1.5} dot={false} />
                    <Line   type="monotone" dataKey="FCTS" name={t('abbr.fcts') as string} stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {/* Toolbar */}
        <div className={cn('flex mb-1 px-1 gap-2', isMobile ? 'flex-col' : 'items-center justify-between flex-wrap')}>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {t('breakdown.summaryProducts', { count: produtos.length })}
            {' · '}
            {t('breakdown.summaryFamilies', { count: familiasUnit.length })}
          </span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {acuraciaUnit && (
              <>
                <span className={cn(
                  'text-[10px] font-bold px-2 py-0.5 rounded-full border',
                  acuraciaUnit.acuracia >= 90 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                  acuraciaUnit.acuracia >= 75 ? 'bg-amber-50   text-amber-700   border-amber-200'   :
                                                'bg-red-50     text-red-700     border-red-200',
                )}>
                  {t('breakdown.accuracy')} {acuraciaUnit.acuracia.toFixed(1)}%
                </span>
                <span className={cn(
                  'text-[10px] font-bold px-2 py-0.5 rounded-full border',
                  acuraciaUnit.bias > 5  ? 'bg-orange-50 text-orange-700 border-orange-200' :
                  acuraciaUnit.bias < -5 ? 'bg-sky-50     text-sky-700    border-sky-200'   :
                                           'bg-emerald-50 text-emerald-700 border-emerald-200',
                )}>
                  {t('breakdown.bias')} {acuraciaUnit.bias > 0 ? '+' : ''}{acuraciaUnit.bias.toFixed(1)}%
                </span>
              </>
            )}
            {/* Sort das famílias */}
            <div className="flex items-center gap-1 border border-slate-200 rounded-lg px-1.5 py-0.5 bg-white">
              <ArrowUpDown className="w-2.5 h-2.5 text-slate-400" />
              {(['alfa', 'orc', 'fcts', 'delta'] as const).map((key) => {
                const label =
                  key === 'alfa'  ? t('breakdown.sort.az') :
                  key === 'orc'   ? t('breakdown.sort.orcDesc') :
                  key === 'fcts'  ? t('breakdown.sort.fctsDesc') :
                                    t('breakdown.sort.deltaDesc');
                return (
                  <button
                    key={key}
                    onClick={(e) => { e.stopPropagation(); setFamSort(key); }}
                    className={cn(
                      'text-[9px] font-bold px-1.5 py-0.5 rounded transition-colors',
                      famSort === key
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-slate-700',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); toggleAllFams(expandedFams.size < familiasUnit.length); }}
              className="text-[10px] font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1"
            >
              {expandedFams.size < familiasUnit.length
                ? <><ChevronDown className="w-3 h-3" /> {t('breakdown.expandAll')}</>
                : <><ChevronUp   className="w-3 h-3" /> {t('breakdown.collapseAll')}</>}
            </button>
          </div>
        </div>

        {familiasUnit.map(([fam, prods]) => {
          const isFamOpen = expandedFams.has(fam);
          const famOrc    = prods.reduce((s, p) => s + p.orcAnual,    0);
          const famFcts   = prods.reduce((s, p) => s + p.fctsAnual,   0);
          const famVendas = prods.reduce((s, p) => s + p.vendasAnual, 0);
          // Δ FCST × Vendas A.A. (filtro simétrico já aplicado por produto no backend)
          const famVendaAA      = prods.reduce((s, p) => s + (p.vendaAA ?? 0),       0);
          const famFctsForDesvio = prods.reduce((s, p) => s + (p.fctsForDesvio ?? 0), 0);
          const famDelta  = famVendaAA > 0 ? ((famFctsForDesvio / famVendaAA) - 1) * 100 : null;

          return (
            <div key={fam} className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
              <button
                onClick={(e) => { e.stopPropagation(); toggleFam(fam); }}
                className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
              >
                {isFamOpen
                  ? <ChevronUp   className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  : <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                <span className="font-bold text-slate-700 text-xs flex-1">{fam}</span>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded-full">
                  {prods.length} SKU{prods.length !== 1 ? 's' : ''}
                </span>
                <span className="hidden md:inline text-[10px] font-mono text-slate-500 ml-2">{t('abbr.orc')} {fmt(famOrc)}</span>
                <span className="hidden md:inline text-[10px] font-mono font-bold text-slate-700 ml-2">{t('abbr.fcts')} {fmt(famFcts)}</span>
                {famDelta !== null && (
                  <span className={cn('text-[10px] font-bold ml-2',
                    Math.abs(famDelta) <= 10 ? 'text-emerald-600' :
                    Math.abs(famDelta) <= 25 ? 'text-amber-600'   : 'text-red-600',
                  )}>
                    {famDelta > 0 ? '+' : ''}{famDelta.toFixed(1)}%
                  </span>
                )}
                <span className="hidden md:inline text-[10px] font-mono text-emerald-700 ml-2">{t('breakdown.table.salesShort')} {fmt(famVendas)}</span>
              </button>

              {isFamOpen && (() => {
                const isFamMonthOpen = expandedFamMonths.has(fam);
                const famMesData     = familiaMeses.find(f => f.familia === fam);
                const mesesComDados  = (famMesData?.porMes ?? []).filter(m => m.orc > 0 || m.fcts > 0 || m.vendas > 0);
                return (
                  <>
                    {mesesComDados.length > 0 && (
                      <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-50 border-b border-slate-100">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleFamMonth(fam); }}
                          title={isFamMonthOpen ? t('breakdown.hideMonthly') : t('breakdown.showMonthly')}
                          className={cn(
                            'p-1 rounded transition-colors',
                            isFamMonthOpen
                              ? 'bg-sky-600 text-white hover:bg-sky-700'
                              : 'bg-sky-50 text-sky-600 hover:bg-sky-100 border border-sky-100',
                          )}
                        >
                          <BarChart2 className="w-3 h-3" />
                        </button>
                        <span className="text-[10px] text-slate-400 font-medium">
                          {isFamMonthOpen ? t('breakdown.hideEvolution') : t('breakdown.showEvolution')}
                        </span>
                      </div>
                    )}

                    {isFamMonthOpen && mesesComDados.length > 0 && (
                      <div className="px-4 pt-2 pb-3 border-b border-slate-100 bg-sky-50/20">
                        <div className="h-[160px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={mesesComDados.map(m => ({
                              name:   monthLabel(m.month),
                              ORC:    m.orc,
                              FCTS:   m.fcts,
                              Vendas: m.vendas > 0 ? m.vendas : null,
                            }))}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                              <XAxis dataKey="name" axisLine={false} tickLine={false}
                                tick={{ fill: '#94a3b8', fontSize: 9 }} />
                              <YAxis axisLine={false} tickLine={false}
                                tick={{ fill: '#94a3b8', fontSize: 9 }}
                                tickFormatter={(v) => v > 0 ? fmt(v) : '0'} />
                              <Tooltip
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgb(0 0 0 / 0.1)', fontSize: 10 }}
                                formatter={(value, name) => [fmt(typeof value === 'number' ? value : 0), String(name)]}
                              />
                              <Legend iconType="circle" wrapperStyle={{ fontSize: '9px', paddingTop: '4px' }} />
                              <Bar  dataKey="Vendas" name={t('legend.vendas', { ns: 'dashboard' }) as string} fill="#0d9488" radius={[2, 2, 0, 0]} barSize={12} />
                              <Line type="monotone" dataKey="ORC"  name={t('abbr.orc') as string} stroke="#94a3b8" strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
                              <Line type="monotone" dataKey="FCTS" name={t('abbr.fcts') as string} stroke="#3b82f6" strokeWidth={2}   dot={false} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}

                    {/* Mobile: cards por produto */}
                    <div className="md:hidden divide-y divide-slate-100">
                      {prods.map(p => {
                        const hasAA = p.vendaAA != null && p.vendaAA > 0;
                        return (
                          <div key={p.codigo} className="px-4 py-3">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="min-w-0">
                                <p className="text-[10px] font-mono font-bold text-slate-400">{p.codigo}</p>
                                <p className="text-xs font-medium text-slate-800 leading-tight">{p.descricao}</p>
                              </div>
                              {hasAA
                                ? <DeltaBadge v={p.fctsForDesvio ?? 0} base={p.vendaAA ?? 0} />
                                : <span className="text-slate-300 text-xs">—</span>}
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                              <div className="bg-slate-50 rounded-lg px-2 py-1.5">
                                <p className="text-[9px] font-bold text-slate-400 uppercase mb-0.5">{t('abbr.fcts')}</p>
                                <p className="text-[10px] font-mono font-bold text-slate-800">{fmt(p.fctsAnual)}</p>
                              </div>
                              <div className="bg-slate-50 rounded-lg px-2 py-1.5">
                                <p className="text-[9px] font-bold text-slate-400 uppercase mb-0.5">{t('abbr.orc')}</p>
                                <p className="text-[10px] font-mono text-slate-500">{fmt(p.orcAnual)}</p>
                              </div>
                              <div className="bg-slate-50 rounded-lg px-2 py-1.5">
                                <p className="text-[9px] font-bold text-emerald-500 uppercase mb-0.5">{t('breakdown.table.sales')}</p>
                                <p className="text-[10px] font-mono font-bold text-emerald-700">{fmt(p.vendasAnual)}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop: tabela completa */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-white text-slate-400 text-[10px] font-bold uppercase tracking-tight border-b border-slate-100">
                            <th className="px-4 py-1.5 w-6 sticky left-0 bg-white z-10"></th>
                            <th className="px-4 py-1.5 sticky left-10 bg-white z-10">{t('breakdown.table.code')}</th>
                            <th className="px-4 py-1.5 sticky left-28 bg-white z-10">{t('breakdown.table.product')}</th>
                            <th className="px-4 py-1.5 text-right">{t('abbr.orc')}</th>
                            <th className="px-4 py-1.5 text-right">{t('abbr.fcts')}</th>
                            <th className="px-4 py-1.5 text-right">
                              <span className="inline-flex items-center gap-1 justify-end">
                                {t('breakdown.table.deltaAA')}
                                <InfoTooltip text={t('breakdown.table.deltaAATooltip')} position="bottom" width="w-72" />
                              </span>
                            </th>
                            <th className="px-4 py-1.5 text-right">{t('breakdown.table.sales')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {prods.map(p => {
                            const prodKey   = paisIso3 ? `${p.id}|${paisIso3}` : p.id;
                            const chartSt   = prodChartStatus.get(prodKey) ?? 'idle';
                            const chartRows = prodChartData.get(prodKey) ?? [];
                            const isChartOn = chartSt === 'done' && chartRows.length > 0;

                            return (
                              <React.Fragment key={p.codigo}>
                                <tr className={cn(
                                  'hover:bg-slate-50/60 transition-colors border-b border-slate-50',
                                  isChartOn && 'bg-sky-50/30',
                                )}>
                                  <td className="px-4 py-2 text-center sticky left-0 bg-inherit">
                                    <button
                                      onClick={(e) => toggleProdChart(e, prodKey, p.id)}
                                      title={t('breakdown.showProductChart')}
                                      className={cn(
                                        'p-0.5 rounded transition-colors',
                                        chartSt === 'loading' ? 'text-slate-300 animate-pulse' :
                                        isChartOn             ? 'bg-sky-600 text-white'         :
                                                                'text-slate-300 hover:text-sky-600',
                                      )}
                                    >
                                      <BarChart2 className="w-3 h-3" />
                                    </button>
                                  </td>
                                  <td className="px-4 py-2 font-mono text-slate-400 sticky left-10 bg-inherit">{p.codigo}</td>
                                  <td className="px-4 py-2 font-medium text-slate-700 max-w-[200px] truncate sticky left-28 bg-inherit">{p.descricao}</td>
                                  <td className="px-4 py-2 text-right font-mono text-slate-500">{fmt(p.orcAnual)}</td>
                                  <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">{fmt(p.fctsAnual)}</td>
                                  <td className="px-4 py-2 text-right">
                                    {p.vendaAA != null && p.vendaAA > 0
                                      ? <DeltaBadge v={p.fctsForDesvio ?? 0} base={p.vendaAA} />
                                      : <span className="text-slate-300 text-xs">—</span>}
                                  </td>
                                  <td className="px-4 py-2 text-right font-mono text-emerald-700">{fmt(p.vendasAnual)}</td>
                                </tr>
                                {isChartOn && (
                                  <tr>
                                    <td colSpan={7} className="px-4 pb-3 bg-sky-50/20 border-b border-slate-50">
                                      <div className="h-[120px] pt-2">
                                        <ResponsiveContainer width="100%" height="100%">
                                          <ComposedChart data={chartRows.map(m => ({
                                            name:   monthLabel(m.month),
                                            ORC:    m.orc,
                                            FCTS:   m.fcts,
                                            Vendas: m.vendas > 0 ? m.vendas : null,
                                          }))}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                            <XAxis dataKey="name" axisLine={false} tickLine={false}
                                              tick={{ fill: '#94a3b8', fontSize: 9 }} />
                                            <YAxis axisLine={false} tickLine={false}
                                              tick={{ fill: '#94a3b8', fontSize: 9 }}
                                              tickFormatter={(v) => v > 0 ? fmt(v) : '0'} />
                                            <Tooltip
                                              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgb(0 0 0 / 0.1)', fontSize: 10 }}
                                              formatter={(v: number, name: string) => [fmt(v), name]}
                                            />
                                            <Legend iconType="circle" wrapperStyle={{ fontSize: '9px', paddingTop: '4px' }} />
                                            <Bar  dataKey="Vendas" name={t('legend.vendas', { ns: 'dashboard' }) as string} fill="#0d9488" radius={[2, 2, 0, 0]} barSize={10} />
                                            <Line type="monotone" dataKey="ORC"  name={t('abbr.orc') as string} stroke="#94a3b8" strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
                                            <Line type="monotone" dataKey="FCTS" name={t('abbr.fcts') as string} stroke="#3b82f6" strokeWidth={2}   dot={false} />
                                          </ComposedChart>
                                        </ResponsiveContainer>
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
                  </>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
};
