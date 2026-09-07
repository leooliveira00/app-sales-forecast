import React from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { cn } from '../shared/Common';
import { CHART_COLORS } from '../../constants/chartColors';
import { useIsMobile } from '../../hooks/useBreakpoint';

interface TendenciaPoint {
  month: string;
  orc: number;
  fcts: number;
  vendas: number;
}

interface ChartPoint extends TendenciaPoint {
  label: string;
  desvio: number | null;
}

const fmt = (v: number) => new Intl.NumberFormat('pt-BR').format(v);

interface TendenciaChartProps {
  data: TendenciaPoint[];
  onBarClick?: (point: TendenciaPoint & { desvio: number }) => void;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  const { t } = useTranslation('dashboard');
  if (!active || !payload?.length) return null;
  const orc    = payload.find((p: any) => p.dataKey === 'orc')?.value;
  const fcts   = payload.find((p: any) => p.dataKey === 'fcts')?.value;
  const vendas = payload.find((p: any) => p.dataKey === 'vendas')?.value;
  const desvio = payload.find((p: any) => p.dataKey === 'desvio')?.value;

  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-lg text-xs space-y-1 min-w-[160px]">
      <p className="font-bold text-slate-700 mb-2">{label}</p>
      {orc    != null && <p className="text-slate-400">{t('legend.orc')}: <span className="font-semibold text-slate-500">{fmt(orc)}</span></p>}
      {fcts   != null && <p style={{ color: CHART_COLORS.fcts }}>{t('legend.fcts')}: <span className="font-bold">{fmt(fcts)}</span></p>}
      {vendas != null && <p style={{ color: '#0d9488' }}>{t('legend.vendas')}: <span className="font-bold">{fmt(vendas)}</span></p>}
      {desvio != null && (
        <p className={cn(
          'font-bold pt-1 border-t border-slate-100 mt-1',
          Math.abs(desvio) <= 10 ? 'text-emerald-600' :
          Math.abs(desvio) <= 20 ? 'text-amber-600'   : 'text-red-600'
        )}>
          {t('tendencia.tooltipDeviation')} {desvio >= 0 ? '+' : ''}{desvio.toFixed(1)}%
        </p>
      )}
    </div>
  );
};

export const TendenciaChart: React.FC<TendenciaChartProps> = ({ data, onBarClick }) => {
  const isMobile = useIsMobile();
  const { t } = useTranslation('dashboard');
  const months = t('months', { ns: 'common', returnObjects: true }) as string[];

  const chartData: ChartPoint[] = data.map(p => {
    const [year, monthNum] = p.month.split('-').map(Number);
    return {
      ...p,
      label:  `${months[monthNum - 1]}/${String(year).slice(2)}`,
      desvio: p.vendas > 0 ? ((p.fcts / p.vendas) - 1) * 100 : null,
    };
  });

  const handleChartClick = (state: any) => {
    if (!onBarClick) return;
    const idx = state?.activeTooltipIndex ?? state?.activeIndex;
    if (idx == null || idx < 0 || idx >= chartData.length) return;
    const point = chartData[idx];
    if (!point || point.desvio == null) return;
    onBarClick(point as TendenciaPoint & { desvio: number });
  };

  return (
    <div className="bg-white p-4 md:p-8 rounded-2xl border border-slate-200 shadow-sm">
      {/* Header */}
      <div className="mb-4 md:mb-6">
        <div className="flex items-start justify-between gap-2 mb-2 md:mb-3">
          <div>
            <h3 className="text-base md:text-lg font-bold text-slate-900">
              {t('tendencia.chartTitle')}
            </h3>
            <p className="text-xs md:text-sm text-slate-500 mt-0.5">
              {isMobile
                ? t('tendencia.subtitleMobile')
                : onBarClick ? t('tendencia.subtitleDesktop') : t('tendencia.subtitleDesktopNoClick')}
            </p>
          </div>
        </div>

        {/* Legenda */}
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 items-center">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <svg width="16" height="4" viewBox="0 0 16 4">
              <line x1="0" y1="2" x2="16" y2="2" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            {t('legend.orc')}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <svg width="16" height="4" viewBox="0 0 16 4">
              <line x1="0" y1="2" x2="16" y2="2" stroke={CHART_COLORS.fcts} strokeWidth="2.5" />
            </svg>
            {t('legend.fcts')}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <svg width="16" height="4" viewBox="0 0 16 4">
              <line x1="0" y1="2" x2="16" y2="2" stroke="#0d9488" strokeWidth="3" />
            </svg>
            {t('legend.vendas')}
          </div>
          <div className="flex items-center gap-1 text-xs font-medium text-slate-500 pl-2 border-l border-slate-200">
            <span className="w-2.5 h-3 rounded-sm bg-green-400 inline-block" />
            <span className="w-2.5 h-3 rounded-sm bg-amber-400 inline-block" />
            <span className="w-2.5 h-3 rounded-sm bg-rose-400  inline-block" />
            <span className="ml-1">{t('tendencia.deviationPct')}</span>
          </div>
        </div>
      </div>

      {/* Gráfico */}
      <div className="h-[200px] md:h-[300px] [&_div:focus]:outline-none">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 5, right: isMobile ? 8 : 48, left: isMobile ? -20 : 0, bottom: 5 }}
            onClick={handleChartClick}
            style={{ cursor: onBarClick ? 'pointer' : 'default' }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="label"
              axisLine={false} tickLine={false}
              tick={{ fill: '#64748b', fontSize: isMobile ? 9 : 11 }}
              interval={isMobile ? 2 : 0}
              dy={8}
            />
            <YAxis
              yAxisId="vol"
              axisLine={false} tickLine={false}
              tick={{ fill: '#64748b', fontSize: isMobile ? 9 : 11 }}
              tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
              width={isMobile ? 30 : 40}
            />
            <YAxis
              yAxisId="pct"
              orientation="right"
              axisLine={false} tickLine={false}
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
              width={isMobile ? 0 : 44}
              hide={isMobile}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine yAxisId="pct" y={0} stroke="#e2e8f0" strokeWidth={1} />
            <Bar
              yAxisId="pct"
              dataKey="desvio"
              name="Desvio %"
              barSize={isMobile ? 6 : 10}
              radius={[3, 3, 0, 0]}
            >
              {chartData.map((entry, idx) => {
                const d = entry.desvio;
                const color =
                  d == null         ? '#e2e8f0' :
                  Math.abs(d) <= 10 ? '#4ade80' :
                  Math.abs(d) <= 20 ? '#fbbf24' : '#fb7185';
                return <Cell key={idx} fill={color} />;
              })}
            </Bar>
            <Line
              yAxisId="vol"
              type="monotone" dataKey="orc" name={t('legend.orc') as string}
              stroke="#94a3b8" strokeDasharray="5 4" strokeWidth={1.5}
              dot={false} activeDot={{ r: 4 }}
            />
            <Line
              yAxisId="vol"
              type="monotone" dataKey="fcts" name={t('legend.fcts') as string}
              stroke={CHART_COLORS.fcts} strokeWidth={isMobile ? 2 : 2.5}
              dot={isMobile ? false : { r: 2.5, fill: CHART_COLORS.fcts }}
              activeDot={{ r: 5 }}
            />
            <Line
              yAxisId="vol"
              type="monotone" dataKey="vendas" name="Vendas"
              stroke="#0d9488" strokeWidth={isMobile ? 2.5 : 3.5}
              dot={isMobile ? false : { r: 3, fill: '#0d9488' }}
              activeDot={{ r: 6 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="hidden md:block text-[10px] text-slate-400 mt-2 text-right">
        {t('tendencia.tooltipDeviation')} {t('tendencia.desvioLegend')}
      </p>
    </div>
  );
};
