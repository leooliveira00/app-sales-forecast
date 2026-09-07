import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../shared/Common';
import { monthLabel } from '../../types/forecast';
import { useFormatter } from '../../hooks/useFormatter';
import type { ForecastRun } from '../../types/forecast';

interface CycleSelectorProps {
  availableRuns:  ForecastRun[];
  cycleParam:     string | null;
  isHistorical:   boolean;
  onCycleChange:  (key: string) => void;
  canPrevCycle?:  boolean;
  canNextCycle?:  boolean;
  onCyclePrev?:   () => void;
  onCycleNext?:   () => void;
}

export const CycleSelector: React.FC<CycleSelectorProps> = ({
  cycleParam,
  isHistorical,
  canPrevCycle,
  canNextCycle,
  onCyclePrev,
  onCycleNext,
}) => {
  const { t } = useTranslation('forecast');
  const { locale } = useFormatter();
  // Derive label from cycleParam
  const cycleLabel = React.useMemo(() => {
    if (!cycleParam) return '—';
    const [y, m] = cycleParam.split('-').map(Number);
    return monthLabel(new Date(Date.UTC(y, m - 1, 1)), locale);
  }, [cycleParam, locale]);

  return (
    <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-0.5">

        {/* Seta ← */}
        <button
          type="button"
          onClick={onCyclePrev}
          disabled={!canPrevCycle}
          title={t('cycleSelector.prevTitle')}
          className={cn(
            "p-1 rounded-lg transition-all",
            !canPrevCycle
              ? "text-slate-300 cursor-not-allowed"
              : "text-slate-400 hover:text-slate-700 hover:bg-white hover:shadow-sm cursor-pointer"
          )}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        {/* Chip do ciclo atual */}
        <div className={cn(
          "px-3 py-1 rounded-lg text-sm font-semibold select-none min-w-[82px] text-center transition-colors",
          isHistorical
            ? "bg-amber-50 text-amber-800 shadow-sm"
            : "bg-white text-slate-800 shadow-sm"
        )}>
          {cycleLabel}
          {isHistorical && (
            <span className="ml-1.5 text-[9px] font-bold text-amber-400 uppercase tracking-wide">
              {t('cycleSelector.historical')}
            </span>
          )}
        </div>

        {/* Seta → */}
        <button
          type="button"
          onClick={onCycleNext}
          disabled={!canNextCycle}
          title={t('cycleSelector.nextTitle')}
          className={cn(
            "p-1 rounded-lg transition-all",
            !canNextCycle
              ? "text-slate-300 cursor-not-allowed"
              : "text-slate-400 hover:text-slate-700 hover:bg-white hover:shadow-sm cursor-pointer"
          )}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>

    </div>
  );
};
