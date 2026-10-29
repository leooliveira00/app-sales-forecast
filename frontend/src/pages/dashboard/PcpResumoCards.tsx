/**
 * Segunda linha de KPIs da visão PCP: unidades sem submissão no ciclo (abre o drawer)
 * e desvio FCTS/ORC do ciclo.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '../../components/shared/Common';

interface PcpResumoCardsProps {
  unidadesSemSubmissao: number | null;
  totalUnidades:        number;
  desvioMedioFctsOrc:   number | null;
  /** Ex.: "Out/2026". */
  cicloLabel:           string;
  onOpenUnidades:       () => void;
}

export const PcpResumoCards: React.FC<PcpResumoCardsProps> = ({
  unidadesSemSubmissao, totalUnidades, desvioMedioFctsOrc, cicloLabel, onOpenUnidades,
}) => {
  const { t } = useTranslation(['dashboard', 'common']);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

      {/* Card PCP 1 — Unidades sem Submissão (clicável) */}
      <button
        onClick={onOpenUnidades}
        className={cn(
          'cursor-pointer bg-white p-6 rounded-2xl border shadow-sm text-left w-full transition-all duration-200 hover:shadow-md',
          unidadesSemSubmissao === null ? 'border-slate-200 hover:border-slate-300' :
          unidadesSemSubmissao > 0      ? 'border-amber-200 bg-amber-50/20 hover:border-amber-300' :
                                          'border-emerald-200 hover:border-emerald-300'
        )}
      >
        <div className="flex items-center justify-between mb-4">
          <div className={cn(
            'p-2 rounded-lg',
            unidadesSemSubmissao === null || unidadesSemSubmissao === 0
              ? 'bg-emerald-50 text-emerald-600'
              : 'bg-amber-50 text-amber-600'
          )}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
              {cicloLabel}
            </span>
            {unidadesSemSubmissao !== null && unidadesSemSubmissao > 0 && (
              <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                {t('labels.seeMore')}
              </span>
            )}
          </div>
        </div>
        <p className="text-sm font-medium text-slate-500 mb-1">{t('cards.unitsWithoutSubmission')}</p>
        {unidadesSemSubmissao === null ? (
          <p className="text-xl font-bold text-slate-300">—</p>
        ) : (
          <>
            <h3 className={cn(
              'text-2xl font-bold mb-1',
              unidadesSemSubmissao > 0 ? 'text-amber-600' : 'text-emerald-600'
            )}>
              {unidadesSemSubmissao}
              <span className="text-sm font-normal text-slate-400 ml-1">
                {t('labels.unitsWord', { count: unidadesSemSubmissao })}
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              {unidadesSemSubmissao === 0
                ? t('labels.allUnitsSubmittedDetail')
                : t('labels.unitsOf', { total: totalUnidades })}
            </p>
          </>
        )}
      </button>

      {/* Card PCP 2 — Desvio Médio FCTS/ORC */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className={cn(
            'p-2 rounded-lg',
            desvioMedioFctsOrc === null            ? 'bg-slate-50 text-slate-400' :
            Math.abs(desvioMedioFctsOrc) <= 10     ? 'bg-emerald-50 text-emerald-600' :
            Math.abs(desvioMedioFctsOrc) <= 25     ? 'bg-amber-50 text-amber-600' :
                                                      'bg-red-50 text-red-600'
          )}>
            {desvioMedioFctsOrc !== null && desvioMedioFctsOrc >= 0
              ? <TrendingUp className="w-5 h-5" />
              : <TrendingDown className="w-5 h-5" />}
          </div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
            {t('legend.fcts')} vs {t('legend.orc')}
          </span>
        </div>
        <p className="text-sm font-medium text-slate-500 mb-1">{t('cards.fctsOrcDeviation')}</p>
        {desvioMedioFctsOrc === null ? (
          <>
            <p className="text-xl font-bold text-slate-300">—</p>
            <p className="text-xs text-slate-400 mt-1">{t('labels.noDataCycle')}</p>
          </>
        ) : (
          <>
            <h3 className={cn(
              'text-2xl font-bold mb-1',
              Math.abs(desvioMedioFctsOrc) <= 10  ? 'text-emerald-600' :
              Math.abs(desvioMedioFctsOrc) <= 25  ? 'text-amber-600'   : 'text-red-600'
            )}>
              {desvioMedioFctsOrc > 0 ? '+' : ''}{desvioMedioFctsOrc.toFixed(1)}%
            </h3>
            <p className="text-xs text-slate-400">
              {desvioMedioFctsOrc > 0
                ? t('labels.overestimate')
                : t('labels.underestimate')}
            </p>
          </>
        )}
      </div>

    </div>
  );
};
