import React from 'react';
import { TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../shared/Common';
import { fmt } from '../../types/forecast';

interface ForecastKpiBarProps {
  totalFCTS: number;
  totalORC: number;
  familyCount: number;
  skuCount: number;
  isExport: boolean;
}

export const ForecastKpiBar: React.FC<ForecastKpiBarProps> = ({
  totalFCTS, totalORC, familyCount, skuCount, isExport,
}) => {
  const { t } = useTranslation('forecast');
  const progressPct = totalORC > 0 ? Math.min((totalFCTS / totalORC) * 100, 100) : 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={cn(
            "p-1.5 rounded-lg",
            isExport ? "bg-indigo-50 text-indigo-600" : "bg-sky-50 text-sky-600"
          )}>
            <TrendingUp className="w-4 h-4" />
          </div>
          <span className="text-sm font-bold text-slate-700">{t('columns.fcts')} vs {t('columns.orc')}</span>
          <span className="text-xs text-slate-400">{familyCount} famílias · {skuCount} SKUs</span>
        </div>
        <div className="text-sm text-slate-500">
          <span className="font-bold text-slate-900">{fmt(totalFCTS)}</span> / {fmt(totalORC)}
          <span className={cn(
            "ml-2 text-xs font-bold px-2 py-0.5 rounded-full",
            progressPct >= 95 ? "bg-emerald-100 text-emerald-700" :
            progressPct >= 80 ? "bg-amber-100 text-amber-700" :
                                "bg-slate-100 text-slate-500"
          )}>
            {progressPct.toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full transition-all duration-700",
            progressPct >= 95 ? "bg-emerald-500" :
            progressPct >= 80 ? "bg-amber-500" :
            isExport ? "bg-indigo-500" : "bg-sky-500"
          )}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
};
