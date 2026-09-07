import React from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { fmt } from '../../types/forecast';
import type { ForecastItem } from '../../types/forecast';
import { useFormatter } from '../../hooks/useFormatter';
import { InfoTooltip } from '../shared/Common';
import { CHART_COLORS } from '../../constants/chartColors';

interface ProductSalesDetailProps {
  item: ForecastItem;
  colSpan: number;
  fcts?: number | null;
  fctsHistory?: Array<{ month: string; fcts: number }>;
}

// ── KPI ───────────────────────────────────────────────────────────────────────

interface KpiProps {
  label: string;
  value: number | null;
  sublabel?: string;
  sublabelColor?: 'neutral' | 'up' | 'down';
  tooltip?: string;
}

const Kpi: React.FC<KpiProps> = ({ label, value, sublabel, sublabelColor = 'neutral', tooltip }) => {
  const { fmt: fmtLocale } = useFormatter();
  const sublabelCls =
    sublabelColor === 'up'   ? 'text-emerald-500' :
    sublabelColor === 'down' ? 'text-red-500'     :
                               'text-slate-400';

  return (
    <div className="flex flex-col items-center text-center min-w-[90px]">
      <span className="flex items-center gap-1 text-[10px] text-slate-400 uppercase tracking-wider leading-tight mb-1">
        {label}
        {tooltip && <InfoTooltip text={tooltip} position="bottom" textSize="text-[10px]" />}
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

// ── Tooltip personalizado ─────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }: any) => {
  const { t } = useTranslation('forecast');
  if (active && payload?.length) {
    const qty     = payload.find((p: any) => p.dataKey === 'qty')?.value;
    const orc     = payload.find((p: any) => p.dataKey === 'orc')?.value;
    const fctsVal = payload.find((p: any) => p.dataKey === 'fcts')?.value;
    return (
      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-lg text-xs space-y-0.5">
        <p className="font-semibold text-slate-600 mb-1">{label}</p>
        {orc != null && <p className="text-slate-500">ORC: <span className="font-semibold">{fmt(orc)}</span></p>}
        {qty != null && <p className="text-teal-700 font-bold">{t('salesChart.chart.saleLabel')} {fmt(qty)}</p>}
        {fctsVal != null && <p className="text-blue-500 font-bold">{t('columns.fcts')}: {fmt(fctsVal)}</p>}
      </div>
    );
  }
  return null;
};

// ── Componente principal ──────────────────────────────────────────────────────

export const ProductSalesDetail: React.FC<ProductSalesDetailProps> = ({ item, colSpan, fcts, fctsHistory }) => {
  const { t } = useTranslation('forecast');
  const { locale, fmt: fmtLocale } = useFormatter();

  const monthLabel = (iso: string): string => {
    const d = new Date(iso);
    const m = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    return `${m}/${String(d.getUTCFullYear()).slice(2)}`;
  };

  // Construir lookup de orcHistory por chave de mês
  const orcByMonth = new Map(
    item.orcHistory.map(o => [monthLabel(o.month), o.volumeORC])
  );

  // Quando fctsHistory fornecido, lookup por mês; caso contrário, usa escalar
  const fctsByMonth = new Map((fctsHistory ?? []).map(f => [monthLabel(f.month), f.fcts]));

  const data = item.salesHistory.map(h => {
    const label = monthLabel(h.month);
    return {
      month: label,
      qty:   h.qty,
      orc:   orcByMonth.get(label) ?? null,
      fcts:  fctsHistory ? (fctsByMonth.get(label) ?? null) : (fcts ?? null),
    };
  });

  const hasData      = data.length > 0;
  const hasOrc       = item.orcHistory.length > 0;
  const hasFctsLine  = fctsHistory ? fctsHistory.length > 0 : fcts != null;
  const lastFctsValue = fctsHistory
    ? (fctsHistory[fctsHistory.length - 1]?.fcts ?? null)
    : fcts ?? null;

  // ── Tendência: avgTrim vs avgSem ───────────────────────────────────────────
  const tendenciaPct =
    item.avgTrim != null && item.avgSem != null && item.avgSem > 0
      ? ((item.avgTrim / item.avgSem) - 1) * 100
      : null;

  const tendenciaLabel = tendenciaPct != null
    ? t('salesChart.kpi.tendLabel', { arrow: tendenciaPct >= 0 ? '↑' : '↓', pct: Math.abs(tendenciaPct).toFixed(1) })
    : undefined;
  const tendenciaColor: KpiProps['sublabelColor'] =
    tendenciaPct == null ? 'neutral' :
    tendenciaPct > 1     ? 'up'      :
    tendenciaPct < -1    ? 'down'    : 'neutral';

  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-6 pb-5 pt-2 bg-slate-50/80 border-b border-slate-100"
      >
        <div className="flex flex-wrap items-start gap-8">

          {/* ── KPIs ─────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-6 shrink-0 pt-1">
            <Kpi
              label={t('salesChart.kpi.avgTrim')}
              value={item.avgTrim}
              sublabel={tendenciaLabel}
              sublabelColor={tendenciaColor}
              tooltip={t('salesChart.kpi.avgTrimTooltip')}
            />
            <div className="w-px h-10 bg-slate-200 self-center" />
            <Kpi
              label={t('salesChart.kpi.avgSem')}
              value={item.avgSem}
              sublabel={t('salesChart.kpi.avgSemSublabel')}
              tooltip={t('salesChart.kpi.avgSemTooltip')}
            />
            <div className="w-px h-10 bg-slate-200 self-center" />
            <Kpi
              label={t('salesChart.kpi.projAnual')}
              value={item.avg12m != null ? item.avg12m * 12 : null}
              sublabel={t('salesChart.kpi.projAnualSublabel')}
              tooltip={t('salesChart.kpi.projAnualTooltip')}
            />
          </div>

          {/* ── Gráfico ──────────────────────────────────────────────────── */}
          {hasData ? (
            <div className="flex-1 min-w-[240px]">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-2">
                {t('salesChart.chart.historyTitle', { count: data.length })}
                {hasOrc && (
                  <span className="ml-2 text-slate-400 font-semibold">· ORC</span>
                )}
                {hasFctsLine && (
                  <span className="ml-2 text-blue-400 font-semibold">· {t('columns.fcts')}</span>
                )}
              </p>
              <ResponsiveContainer width="100%" height={90}>
                <ComposedChart data={data} margin={{ top: 4, right: 36, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 9, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis hide domain={[0, 'auto']} />
                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ fill: 'rgba(148,163,184,0.1)' }}
                  />
                  <Bar dataKey="qty" barSize={14} radius={[3, 3, 0, 0]}>
                    {data.map((_, idx) => (
                      <Cell
                        key={idx}
                        fill={idx >= data.length - 3 ? '#0d9488' : '#cbd5e1'}
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
                  {hasFctsLine && (
                    <Line
                      dataKey="fcts"
                      stroke={CHART_COLORS.fcts}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      connectNulls
                      isAnimationActive
                      animationDuration={1000}
                      animationBegin={400}
                      label={(props: any) => {
                        if (props.index !== data.length - 1 || lastFctsValue == null) return <g />;
                        const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(lastFctsValue);
                        return (
                          <text x={props.x + 6} y={props.y} fill={CHART_COLORS.fcts} fontSize={9} dominantBaseline="middle">
                            {compact}
                          </text>
                        );
                      }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
              <p className="text-[9px] text-slate-300 mt-1">
                {t('salesChart.chart.legend')}
                {hasOrc && <span className="text-slate-400 ml-2">{t('salesChart.chart.legendOrc')}</span>}
                {hasFctsLine && <span className="text-blue-300 ml-2">{t('salesChart.chart.legendFctsLine')}</span>}
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic pt-3">
              {t('salesChart.noHistoryProduct')}
            </p>
          )}

        </div>
      </td>
    </tr>
  );
};
