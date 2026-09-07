import React, { useEffect, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../shared/Common';
import { InfoTooltip } from '../shared/Common';
import { fmt } from '../../types/forecast';
import { useFormatter } from '../../hooks/useFormatter';
import { CHART_COLORS } from '../../constants/chartColors';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TendenciaPoint {
  month: string;
  orc: number;
  fcts: number;
  vendas: number;
}

interface UnitKpiBarProps {
  totalFCTS: number;
  totalORC: number;
  familyCount: number;
  skuCount: number;
  filledCount: number;
  classeTopPct: number | null;
  isExport: boolean;
  unidadeVendaId: string;
  token: string;
  selectedCountry?: string | null;
}

// ── KPI ───────────────────────────────────────────────────────────────────────

interface KpiProps {
  label: string;
  value: number | null;
  sublabel?: string;
  sublabelColor?: 'neutral' | 'up' | 'down';
  tooltip?: string;
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
}

const Kpi: React.FC<KpiProps> = ({ label, value, sublabel, sublabelColor = 'neutral', tooltip, tooltipPosition = 'top' }) => {
  const { fmt: fmtLocale } = useFormatter();
  const sublabelCls =
    sublabelColor === 'up'   ? 'text-emerald-500' :
    sublabelColor === 'down' ? 'text-red-500'     : 'text-slate-400';
  return (
    <div className="flex flex-col items-center text-center min-w-[90px]">
      <span className="flex items-center gap-1 text-[10px] text-slate-400 uppercase tracking-wider leading-tight mb-1">
        {label}
        {tooltip && <InfoTooltip text={tooltip} position={tooltipPosition} textSize="text-[10px]" />}
      </span>
      <span className="text-xl font-bold text-slate-800 tabular-nums">
        {value != null ? fmtLocale(value) : '—'}
      </span>
      {sublabel && (
        <span className={`text-[10px] mt-0.5 font-medium ${sublabelCls}`}>{sublabel}</span>
      )}
    </div>
  );
};

// ── Tooltip ───────────────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }: any) => {
  const { t } = useTranslation('forecast');
  if (!active || !payload?.length) return null;
  const vendas = payload.find((p: any) => p.dataKey === 'vendas')?.value;
  const orc    = payload.find((p: any) => p.dataKey === 'orc')?.value;
  const fcts   = payload.find((p: any) => p.dataKey === 'fcts')?.value;
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-lg text-xs space-y-0.5">
      <p className="font-semibold text-slate-600 mb-1">{label}</p>
      {orc    != null && <p className="text-slate-500">{t('columns.orc')}: <span className="font-semibold">{fmt(orc)}</span></p>}
      {fcts   != null && <p className="text-blue-500 font-bold">{t('columns.fcts')}: <span className="font-bold">{fmt(fcts)}</span></p>}
      {vendas != null && <p className="text-teal-700 font-bold">{t('salesChart.chart.saleLabel')} {fmt(vendas)}</p>}
    </div>
  );
};

// ── Componente principal ──────────────────────────────────────────────────────

export const UnitKpiBar: React.FC<UnitKpiBarProps> = ({
  totalFCTS, totalORC, familyCount, skuCount, filledCount, classeTopPct, isExport,
  unidadeVendaId, token, selectedCountry,
}) => {
  const { t } = useTranslation('forecast');
  const { fmt: fmtLocale } = useFormatter();
  const [expanded, setExpanded]     = useState(false);
  const [tendencia, setTendencia]   = useState<TendenciaPoint[]>([]);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    if (!unidadeVendaId || !token) return;
    setLoading(true);
    const url = `/api/forecast/tendencia?unidadeVendaId=${encodeURIComponent(unidadeVendaId)}&meses=12`
      + (selectedCountry ? `&paisIso3=${encodeURIComponent(selectedCountry)}` : '');
    fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : [])
      .then((d: TendenciaPoint[]) => setTendencia(d))
      .catch(() => setTendencia([]))
      .finally(() => setLoading(false));
  }, [unidadeVendaId, token, selectedCountry]);

  // ── Médias a partir das vendas reais ──────────────────────────────────────
  const avg = (arr: TendenciaPoint[]) =>
    arr.length ? Math.round(arr.reduce((s, p) => s + p.vendas, 0) / arr.length) : null;

  // Filtro defensivo: só meses com vendas fechadas (protege contra mês aberto com vendas=0)
  const validTendencia = tendencia.filter(p => p.vendas > 0);

  const avgTrim = avg(validTendencia.slice(-3));
  const avgSem  = avg(validTendencia.slice(-6));
  const avg12m  = avg(validTendencia);

  const months = t('months', { ns: 'common', returnObjects: true }) as string[];
  const toLabel = (iso: string) => {
    const [y, m] = iso.split('-').map(Number);
    return `${months[m - 1]}/${String(y).slice(2)}`;
  };

  // Rótulo do último mês fechado disponível (referência dos indicadores)
  const lastClosedLabel = validTendencia.length > 0
    ? toLabel(validTendencia[validTendencia.length - 1].month)
    : null;

  const tendenciaPct =
    avgTrim != null && avgSem != null && avgSem > 0
      ? ((avgTrim / avgSem) - 1) * 100
      : null;

  const tendenciaLabel =
    tendenciaPct != null
      ? t('salesChart.kpi.tendLabel', { arrow: tendenciaPct >= 0 ? '↑' : '↓', pct: Math.abs(tendenciaPct).toFixed(1) })
      : undefined;

  const tendenciaColor: KpiProps['sublabelColor'] =
    tendenciaPct == null ? 'neutral' :
    tendenciaPct > 1     ? 'up'      :
    tendenciaPct < -1    ? 'down'    : 'neutral';

  // Δ Ano Anterior: compara avgTrim (últimos 3M) com mesmo trimestre do ano passado
  const avg3mLastYear = validTendencia.length >= 12 ? avg(validTendencia.slice(0, 3)) : null;
  const yoyPct =
    avgTrim != null && avg3mLastYear != null && avg3mLastYear > 0
      ? ((avgTrim / avg3mLastYear) - 1) * 100
      : null;
  const yoyLabel =
    yoyPct != null
      ? t('salesChart.kpi.yoyVsLabel', { arrow: yoyPct >= 0 ? '▲' : '▼', pct: Math.abs(yoyPct).toFixed(1) })
      : undefined;
  const yoyColor: KpiProps['sublabelColor'] =
    yoyPct == null ? 'neutral' :
    yoyPct > 0     ? 'up'      :
    yoyPct < 0     ? 'down'    : 'neutral';

  // Completude: cor do badge de preenchimento
  const filledColor =
    filledCount >= skuCount         ? 'text-emerald-600 font-bold' :
    filledCount >= skuCount * 0.8   ? 'text-amber-600  font-bold' :
                                      'text-red-500    font-bold';

  // ── Completude de preenchimento (barra principal — perspectiva do gestor) ──
  const fillPct = skuCount > 0 ? Math.min((filledCount / skuCount) * 100, 100) : 0;

  const barColor =
    fillPct >= 100 ? 'bg-emerald-500' :
    fillPct >= 80  ? 'bg-amber-500'   :
    isExport        ? 'bg-indigo-500'  : 'bg-sky-500';

  const pctBadge =
    fillPct >= 100 ? 'bg-emerald-100 text-emerald-700' :
    fillPct >= 80  ? 'bg-amber-100 text-amber-700'     :
                     'bg-slate-100 text-slate-500';

  // ── Volume FCTS vs ORC (referência secundária) ────────────────────────────
  const orcPct = totalORC > 0 ? (totalFCTS / totalORC) * 100 : 0;

  // ── Dados do gráfico ──────────────────────────────────────────────────────
  const chartData = tendencia.map((p, idx) => ({
    month:    toLabel(p.month),
    vendas:   p.vendas,
    orc:      p.orc  > 0 ? p.orc  : null,
    fcts:     p.fcts > 0 ? p.fcts : null,
    isRecent: idx >= tendencia.length - 3,
  }));

  const hasChart = chartData.length > 0;
  const hasOrc   = chartData.some(d => d.orc  != null);
  const hasFcts  = chartData.some(d => d.fcts != null);

  const accentColor = '#0d9488';
  const accentBg    = isExport ? 'bg-indigo-50 text-indigo-600' : 'bg-sky-50 text-sky-600';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      {/* ── Linha principal: FCTS vs ORC ─────────────────────────────── */}
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={cn("p-1.5 rounded-lg", accentBg)}>
              <TrendingUp className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-slate-700">{t('salesChart.fillTitle')}</span>
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <span className={filledColor}>{filledCount}</span>
              <span>/{skuCount} {t('salesChart.skusSuffix', { count: familyCount })}</span>
              <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', pctBadge)}>
                {fillPct.toFixed(0)}%
              </span>
              <InfoTooltip
                text={t('salesChart.skusTooltip')}
                position="bottom"
                width="w-64"
                textSize="text-[10px]"
              />
            </span>
          </div>
          <div className="flex items-center gap-3">
            {totalORC > 0 && (
              <div className="text-xs text-slate-400 flex items-center gap-1">
                <span className="uppercase tracking-wider">{t('salesChart.kpi.volLabel')}</span>
                <span className="font-semibold text-slate-600">{fmt(totalFCTS)}</span>
                <span>/</span>
                <span>{fmt(totalORC)}</span>
                <span className="text-slate-300">·</span>
                <span className={cn(
                  'font-medium',
                  orcPct > 100 ? 'text-amber-600 font-bold' : 'text-slate-500'
                )}>
                  {orcPct.toFixed(1)}% {t('columns.orc')}
                </span>
                <InfoTooltip
                  text={t('salesChart.volTooltip')}
                  position="bottom"
                  width="w-72"
                  textSize="text-[10px]"
                />
              </div>
            )}
            <button
              onClick={() => setExpanded(p => !p)}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 border border-slate-200 hover:bg-slate-50 px-2.5 py-1 rounded-lg transition-colors"
            >
              {expanded
                ? <><ChevronUp className="w-3.5 h-3.5" /> {t('salesChart.hide')}</>
                : <><ChevronDown className="w-3.5 h-3.5" /> {t('salesChart.viewHistory')}</>
              }
            </button>
          </div>
        </div>

        {/* Barra de progresso — baseada em SKUs preenchidos */}
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={cn('h-full transition-all duration-700', barColor)}
            style={{ width: `${fillPct}%` }}
          />
        </div>

        {/* Médias resumidas (sempre visíveis) */}
        {!loading && (avgTrim != null || avgSem != null || avg12m != null) && (
          <div className="mt-3 flex items-center gap-4 text-xs text-slate-500 flex-wrap">
            {avgTrim != null && (
              <span className="flex items-center gap-1">
                {t('salesChart.kpi.avg3mLabel')} <span className="font-bold text-slate-700">{fmtLocale(avgTrim)}</span>
                {tendenciaLabel && (
                  <span className={cn(
                    'ml-1 font-semibold',
                    tendenciaColor === 'up'   ? 'text-emerald-500' :
                    tendenciaColor === 'down' ? 'text-red-500'     : 'text-slate-400'
                  )}>
                    {tendenciaLabel}
                  </span>
                )}
                <InfoTooltip
                  text={t('salesChart.kpi.avg3mTooltip')}
                  position="top"
                  textSize="text-[10px]"
                />
              </span>
            )}
            {avgSem != null && (
              <span className="flex items-center gap-1">
                {t('salesChart.kpi.avg6mLabel')} <span className="font-bold text-slate-700">{fmtLocale(avgSem)}</span>
                <InfoTooltip
                  text={t('salesChart.kpi.avg6mTooltip')}
                  position="top"
                  textSize="text-[10px]"
                />
              </span>
            )}
            {classeTopPct != null ? (
              <span className="flex items-center gap-1">
                {t('salesChart.kpi.classeTopPct')} <span className="font-bold text-emerald-600">{classeTopPct}%</span>
                <span className="text-slate-400 ml-0.5">{t('salesChart.kpi.volLabel')}</span>
                <InfoTooltip
                  text={t('salesChart.kpi.classeTopTooltip')}
                  position="top"
                  textSize="text-[10px]"
                />
              </span>
            ) : avg12m != null ? (
              <span className="flex items-center gap-1">
                {t('salesChart.kpi.avg12mLabel')} <span className="font-bold text-slate-700">{fmtLocale(avg12m)}</span>
                <InfoTooltip
                  text={t('salesChart.kpi.avg12mTooltip')}
                  position="top"
                  textSize="text-[10px]"
                />
              </span>
            ) : null}
            {lastClosedLabel && (
              <span className="text-slate-300 border-l border-slate-200 pl-3">
                {t('salesChart.kpi.until')} <span className="font-medium text-slate-400">{lastClosedLabel}</span>
              </span>
            )}
          </div>
        )}
        {loading && (
          <p className="mt-2 text-xs text-slate-400 animate-pulse">{t('salesChart.loadingHistory')}</p>
        )}
      </div>

      {/* ── Painel expandido: KPIs + gráfico ─────────────────────────── */}
      {expanded && (
        <div className={cn(
          'px-5 pb-5 pt-1 border-t rounded-b-2xl overflow-hidden',
          isExport ? 'bg-indigo-50/30 border-indigo-100' : 'bg-sky-50/30 border-sky-100'
        )}>
          <p className={cn(
            'text-[10px] font-bold uppercase tracking-wider mb-4',
            isExport ? 'text-indigo-600' : 'text-sky-600'
          )}>
            {t('salesChart.analyticsSummary')}
          </p>

          <div className="flex flex-wrap items-start gap-8">
            {/* KPIs */}
            <div className="flex items-center gap-6 shrink-0">
              <Kpi
                label={t('salesChart.kpi.avgTrim')}
                value={avgTrim}
                sublabel={tendenciaLabel}
                sublabelColor={tendenciaColor}
                tooltip={t('salesChart.kpi.avgTrimTooltip')}
                tooltipPosition="bottom"
              />
              <div className="w-px h-10 bg-slate-200 self-center" />
              <Kpi
                label={t('salesChart.kpi.avgSem')}
                value={avgSem}
                sublabel={t('salesChart.kpi.avgSemSublabel')}
                tooltip={t('salesChart.kpi.avgSemTooltip')}
                tooltipPosition="bottom"
              />
              <div className="w-px h-10 bg-slate-200 self-center" />
              <Kpi
                label={t('salesChart.kpi.projAnual')}
                value={avg12m != null ? avg12m * 12 : null}
                sublabel={t('salesChart.kpi.projAnualSublabel')}
                tooltip={t('salesChart.kpi.projAnualTooltip')}
                tooltipPosition="bottom"
              />
              {avg3mLastYear != null && (
                <>
                  <div className="w-px h-10 bg-slate-200 self-center" />
                  <Kpi
                    label={t('salesChart.kpi.deltaYoy')}
                    value={avg3mLastYear}
                    sublabel={yoyLabel}
                    sublabelColor={yoyColor}
                    tooltip={t('salesChart.kpi.deltaYoyTooltip')}
                    tooltipPosition="bottom"
                  />
                </>
              )}
            </div>

            {/* Gráfico */}
            {hasChart ? (
              <div className="flex-1 min-w-[240px]">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-2">
                  {t('salesChart.chart.salesTitle', { count: chartData.length })}
                  {hasOrc && (
                    <span className="ml-2 text-slate-400 font-semibold">· {t('columns.orc')}</span>
                  )}
                  {hasFcts && (
                    <span className="ml-2 text-blue-400 font-semibold">· {t('columns.fcts')}</span>
                  )}
                </p>
                <ResponsiveContainer width="100%" height={90}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 36, left: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 9, fill: '#94a3b8' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis hide domain={[0, 'auto']} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(148,163,184,0.1)' }} />
                    <Bar dataKey="vendas" barSize={14} radius={[3, 3, 0, 0]}>
                      {chartData.map((d, idx) => (
                        <Cell
                          key={idx}
                          fill={d.isRecent ? accentColor : '#cbd5e1'}
                        />
                      ))}
                    </Bar>
                    {hasOrc && (
                      <Line
                        dataKey="orc"
                        stroke={CHART_COLORS.orc}
                        strokeWidth={1.5}
                        strokeDasharray="5 4"
                        dot={false}
                        connectNulls={false}
                        isAnimationActive
                        animationDuration={1000}
                        animationBegin={150}
                      />
                    )}
                    {hasFcts && (
                      <Line
                        dataKey="fcts"
                        stroke={CHART_COLORS.fcts}
                        strokeWidth={1.5}
                        strokeDasharray="3 2"
                        dot={false}
                        connectNulls={false}
                        isAnimationActive
                        animationDuration={1000}
                        animationBegin={400}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="text-[9px] text-slate-300 mt-1 flex items-center gap-3">
                  <span>{t('salesChart.chart.legend')}</span>
                  {hasOrc  && <span className="text-slate-400">{t('salesChart.chart.legendOrc')}</span>}
                  {hasFcts && <span className="text-blue-400">{t('salesChart.chart.legendFcts')}</span>}
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic pt-3">
                {t('salesChart.noHistory')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
