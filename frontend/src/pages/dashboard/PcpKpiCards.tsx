/**
 * Primeira linha de KPIs da visão PCP (admin/consulta): progresso do ciclo, pendentes
 * de aprovação, taxa de aprovação direta no ano e acurácia global 3M.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock, Loader2, Package, Target } from 'lucide-react';
import { cn } from '../../components/shared/Common';
import type { AcuraciaUnidade, Submission } from './types';

interface PcpKpiCardsProps {
  /** Unidades com alguma submissão no ciclo. */
  submittedCount:   number;
  totalUnidades:    number;
  pendingCount:     number;
  submissions:      Submission[];
  refYear:          number;
  acuraciaGlobal:   number | null;
  acuraciaUnidades: AcuraciaUnidade[];
  loadingAnalytics: boolean;
  /** Ex.: "Out/2026". */
  cicloLabel:       string;
  onGoToApprovals:  () => void;
}

export const PcpKpiCards: React.FC<PcpKpiCardsProps> = ({
  submittedCount, totalUnidades, pendingCount, submissions, refYear, acuraciaGlobal, acuraciaUnidades,
  loadingAnalytics, cicloLabel, onGoToApprovals,
}) => {
  const { t } = useTranslation(['dashboard', 'common']);

  return (
    <>
      {/* PCP — Card 1: Progresso do Ciclo */}
      {(() => {
        const submitted  = submittedCount;
        const pct        = totalUnidades > 0 ? (submitted / totalUnidades) * 100 : 0;
        const allDone    = totalUnidades > 0 && submitted >= totalUnidades;
        const noneYet    = submitted === 0;
        return (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all duration-200 hover:shadow-md hover:border-slate-300">
            <div className="flex items-start justify-between mb-4">
              <div className={cn(
                'p-2 rounded-lg',
                allDone ? 'bg-emerald-50 text-emerald-600' :
                noneYet ? 'bg-slate-50 text-slate-400'     :
                          'bg-sky-50 text-sky-600'
              )}>
                <Package className="w-5 h-5" />
              </div>
              <span className={cn(
                'text-[10px] font-bold px-2 py-0.5 rounded-full',
                allDone ? 'bg-emerald-50 text-emerald-700' :
                noneYet ? 'bg-slate-100 text-slate-400'    :
                          'bg-sky-50 text-sky-700'
              )}>
                {pct.toFixed(0)}%
              </span>
            </div>
            <p className="text-sm font-medium text-slate-500 mb-1">{t('cards.cycleProgress')}</p>
            {totalUnidades === 0 ? (
              <p className="text-xl font-bold text-slate-300">—</p>
            ) : (
              <>
                <h3 className={cn(
                  'text-2xl font-bold mb-0.5',
                  allDone ? 'text-emerald-600' : noneYet ? 'text-slate-400' : 'text-sky-600'
                )}>
                  {submitted}
                  <span className="text-sm font-normal text-slate-400 ml-1">/ {totalUnidades} unidades</span>
                </h3>
                <p className="text-xs text-slate-400 mb-3">
                  {allDone ? t('labels.allSubmitted') : `${totalUnidades - submitted} ${t(totalUnidades - submitted !== 1 ? 'labels.pendingSuffix_other' : 'labels.pendingSuffix_one', { count: totalUnidades - submitted })}`} — {cicloLabel}
                </p>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', allDone ? 'bg-emerald-500' : 'bg-sky-500')}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* PCP — Card 2: Pendentes de Aprovação */}
      <button
        onClick={onGoToApprovals}
        className={cn(
          'cursor-pointer bg-white p-6 rounded-2xl border shadow-sm text-left w-full transition-all duration-200 hover:shadow-md',
          pendingCount > 0 ? 'border-amber-200 hover:border-amber-300' : 'border-slate-200 hover:border-slate-300'
        )}
      >
        <div className="flex items-start justify-between mb-4">
          <div className={cn(
            'p-2 rounded-lg',
            pendingCount > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-400'
          )}>
            <Clock className="w-5 h-5" />
          </div>
          {pendingCount > 0 && (
            <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              {t('labels.waiting')}
            </span>
          )}
        </div>
        <p className="text-sm font-medium text-slate-500 mb-1">{t('cards.pendingApproval')}</p>
        <h3 className={cn(
          'text-2xl font-bold mb-1',
          pendingCount > 0 ? 'text-amber-600' : 'text-slate-900'
        )}>
          {pendingCount}
        </h3>
        <p className="text-xs text-slate-400">
          {t('labels.pendingSubmissions', { count: pendingCount })}
        </p>
        {pendingCount > 0 && (
          <div className="mt-3 space-y-1.5">
            {submissions
              .filter(s => s.status === 'SUBMITTED')
              .slice(0, 2)
              .map(s => (
                <div key={s.id} className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span className="truncate">{s.unidadeVenda.descricao}</span>
                </div>
              ))}
            {pendingCount > 2 && (
              <p className="text-[10px] text-amber-600 font-semibold">
                {t('labels.moreToReview', { count: pendingCount - 2 })}
              </p>
            )}
          </div>
        )}
      </button>

      {/* PCP — Card 3: Aprovadas */}
      {/* PCP — Card 3: Taxa de Aprovação Direta */}
      {(() => {
        const subsDoAno = submissions.filter(s => {
          const d = new Date(s.refMonth);
          return d.getUTCFullYear() === refYear;
        });
        const aprovadas  = subsDoAno.filter(s => s.status === 'APPROVED').length;
        const rejeitadas = subsDoAno.filter(s => s.status === 'REJECTED').length;
        const base       = aprovadas + rejeitadas;
        const taxa       = base > 0 ? (aprovadas / base) * 100 : null;
        const retrabalho = rejeitadas;
        return (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all duration-200 hover:shadow-md hover:border-slate-300">
            <div className="flex items-start justify-between mb-4">
              <div className={cn(
                'p-2 rounded-lg',
                taxa === null       ? 'bg-slate-50 text-slate-400'  :
                taxa === 100        ? 'bg-emerald-50 text-emerald-600' :
                taxa >= 80          ? 'bg-emerald-50 text-emerald-600' :
                taxa >= 60          ? 'bg-amber-50 text-amber-600'  :
                                      'bg-red-50 text-red-600'
              )}>
                <CheckCircle2 className="w-5 h-5" />
              </div>
              {taxa !== null && (
                <span className={cn(
                  'text-[10px] font-bold px-2 py-0.5 rounded-full',
                  taxa === 100 ? 'bg-emerald-50 text-emerald-700' :
                  taxa >= 80   ? 'bg-emerald-50 text-emerald-700' :
                  taxa >= 60   ? 'bg-amber-50 text-amber-700'    :
                                 'bg-red-50 text-red-700'
                )}>
                  {taxa === 100 ? t('labels.noRejections') : t('labels.rework', { count: retrabalho })}
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-slate-500 mb-1">
              {t('cards.approvalRate')}
            </p>
            {taxa === null ? (
              <>
                <p className="text-xl font-bold text-slate-300">—</p>
                <p className="text-xs text-slate-400 mt-1">{t('labels.noApprovalsYear')}</p>
              </>
            ) : (
              <>
                <h3 className={cn(
                  'text-2xl font-bold mb-0.5',
                  taxa === 100 ? 'text-emerald-600' :
                  taxa >= 80   ? 'text-emerald-600' :
                  taxa >= 60   ? 'text-amber-600'   : 'text-red-600'
                )}>
                  {taxa.toFixed(0)}%
                </h3>
                <p className="text-xs text-slate-400 mb-3">
                  {t('labels.approvalStats', { approved: aprovadas, rejected: rejeitadas, year: refYear })}
                </p>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      taxa === 100 ? 'bg-emerald-500' : taxa >= 80 ? 'bg-emerald-500' : taxa >= 60 ? 'bg-amber-500' : 'bg-red-500'
                    )}
                    style={{ width: `${taxa}%` }}
                  />
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* PCP — Card 4: Acurácia Global 3M */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all duration-200 hover:shadow-md hover:border-slate-300">
        <div className="flex items-start justify-between mb-4">
          <div className={cn(
            'p-2 rounded-lg',
            acuraciaGlobal === null      ? 'bg-slate-50 text-slate-400'   :
            acuraciaGlobal >= 90         ? 'bg-emerald-50 text-emerald-600' :
            acuraciaGlobal >= 75         ? 'bg-amber-50 text-amber-600'    :
                                           'bg-red-50 text-red-600'
          )}>
            <Target className="w-5 h-5" />
          </div>
          {acuraciaGlobal !== null && (
            <span className={cn(
              'text-[10px] font-bold px-2 py-0.5 rounded-full',
              acuraciaGlobal >= 90 ? 'bg-emerald-50 text-emerald-700' :
              acuraciaGlobal >= 75 ? 'bg-amber-50 text-amber-700'     :
                                     'bg-red-50 text-red-700'
            )}>
              {acuraciaGlobal >= 90 ? t('labels.accuracyGood') : acuraciaGlobal >= 75 ? t('labels.accuracyRegular') : t('labels.accuracyCritical')}
            </span>
          )}
        </div>
        <p className="text-sm font-medium text-slate-500 mb-1">{t('cards.globalAccuracy')}</p>
        {loadingAnalytics ? (
          <>
            <p className="text-xl font-bold text-slate-300">—</p>
            <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> {t('labels.calculating')}
            </p>
          </>
        ) : acuraciaGlobal === null ? (
          <>
            <p className="text-xl font-bold text-slate-300">—</p>
            <p className="text-xs text-slate-400 mt-1">{t('labels.waitingRealSales')}</p>
          </>
        ) : (
          <>
            <h3 className={cn(
              'text-2xl font-bold mb-1',
              acuraciaGlobal >= 90 ? 'text-emerald-600' :
              acuraciaGlobal >= 75 ? 'text-amber-600'   : 'text-red-600'
            )}>
              {acuraciaGlobal.toFixed(1)}%
            </h3>
            <p className="text-xs text-slate-400">
              {t('labels.unitsAbove90', { above: acuraciaUnidades.filter(a => a.acuracia >= 90).length, total: acuraciaUnidades.length })}
            </p>
          </>
        )}
      </div>
    </>
  );
};
