import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { cn } from '../shared/Common';

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

interface Submission {
  id: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  refMonth: string;
}

interface SubmissoesChartProps {
  submissions: Submission[];
}

export const SubmissoesChart: React.FC<SubmissoesChartProps> = ({ submissions }) => {
  const chartData = MESES.map((m, i) => {
    const monthSubs = submissions.filter(s => new Date(s.refMonth).getUTCMonth() === i);
    return {
      name:       m,
      Aprovadas:  monthSubs.filter(s => s.status === 'APPROVED').length,
      Pendentes:  monthSubs.filter(s => s.status === 'SUBMITTED').length,
      Rejeitadas: monthSubs.filter(s => s.status === 'REJECTED').length,
    };
  });

  return (
    <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Submissões por Mês</h3>
          <p className="text-sm text-slate-500">Volume de forecasts submetidos, aprovados e rejeitados</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {[
            { color: 'bg-emerald-400', label: 'Aprovadas'  },
            { color: 'bg-amber-400',   label: 'Pendentes'  },
            { color: 'bg-red-400',     label: 'Rejeitadas' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-200 text-xs font-medium text-slate-600">
              <div className={cn('w-3 h-3 rounded-sm', color)} /> {label}
            </div>
          ))}
        </div>
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: '#f8fafc' }}
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
            />
            <Bar dataKey="Aprovadas"  fill="#34d399" radius={[4,4,0,0]} barSize={18} />
            <Bar dataKey="Pendentes"  fill="#fbbf24" radius={[4,4,0,0]} barSize={18} />
            <Bar dataKey="Rejeitadas" fill="#f87171" radius={[4,4,0,0]} barSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
