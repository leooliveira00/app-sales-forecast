import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { useIsMobile } from '../../hooks/useBreakpoint';
import { useFormatter } from '../../hooks/useFormatter';

export interface EvolucaoMensalDataPoint {
  name:   string;
  month:  string;
  ORC:    number;
  FCTS:   number;
  Vendas: number;
}

interface EvolucaoMensalChartProps {
  data:          EvolucaoMensalDataPoint[];
  onPointClick?: (month: string) => void;
}

export const EvolucaoMensalChart: React.FC<EvolucaoMensalChartProps> = ({ data, onPointClick }) => {
  const isMobile = useIsMobile();
  const { fmt } = useFormatter();
  const { t } = useTranslation('dashboard');

  const activeDot = (r: number) =>
    onPointClick
      ? {
          r,
          style: { cursor: 'pointer' },
          // Recharts chama onClick como (props, event); props traz o ponto de dados em
          // .payload em runtime, mas o tipo DotProps da lib não declara esse campo.
          onClick: (props: any) => {
            const m = props?.payload?.month;
            if (m) onPointClick(m);
          },
        }
      : { r };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data}
        margin={{ top: 5, right: isMobile ? 8 : 20, left: isMobile ? -28 : 0, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis
          dataKey="name"
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#64748b', fontSize: isMobile ? 9 : 11 }}
          interval={isMobile ? 1 : 0}
        />
        {!isMobile && (
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickFormatter={(v) => v > 0 ? fmt(v) : '0'}
          />
        )}
        <Tooltip
          contentStyle={{
            borderRadius: '12px',
            border: 'none',
            boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
            fontSize: isMobile ? '11px' : '13px',
          }}
          formatter={(v: number, name: string) => [fmt(v), name]}
        />
        {!isMobile && <Legend iconType="circle" wrapperStyle={{ paddingTop: '16px' }} />}
        <Line
          type="monotone" dataKey="ORC" name={t('legend.orc') as string} stroke="#94a3b8"
          strokeDasharray="5 5" strokeWidth={isMobile ? 1.5 : 2}
          dot={false} activeDot={activeDot(5)}
        />
        <Line
          type="monotone" dataKey="FCTS" name={t('legend.fcts') as string} stroke="#3b82f6"
          strokeWidth={isMobile ? 2 : 3}
          dot={isMobile ? false : { r: 3 }}
          activeDot={activeDot(7)}
        />
        <Line
          type="monotone" dataKey="Vendas" name={t('legend.vendas') as string} stroke="#0d9488"
          strokeWidth={isMobile ? 2 : 3}
          dot={isMobile ? false : { r: 3 }}
          activeDot={activeDot(7)}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};
