/**
 * Cards de KPI da visão do gestor: desvios críticos, produtos preenchidos,
 * status da submissão do mês e acurácia da unidade (3M).
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Clock, Loader2, Package, Target } from 'lucide-react';
import { useFormatter } from '../../hooks/useFormatter';
import { cn, InfoTooltip } from '../../components/shared/Common';
import type { AcuraciaUnidade, DashSummary, DesviosCriticos } from './types';

interface GestorKpiCardsProps {
  summary:            DashSummary | null;
  desvios:            DesviosCriticos | null;
  /** Sem ForecastRun no ciclo. */
  noData:             boolean;
  loadingAnalytics:   boolean;
  acuraciaGestorSnap: AcuraciaUnidade | null;
  subStatusCfg:       { cls: string; dot: string; label: string };
  submittedAt?:       string | null;
  /** Ex.: "Out/2026". */
  cicloLabel:         string;
  onOpenDesvios:      () => void;
  onOpenPendentes:    () => void;
}

export const GestorKpiCards: React.FC<GestorKpiCardsProps> = ({
  summary, desvios, noData, loadingAnalytics, acuraciaGestorSnap, subStatusCfg, submittedAt, cicloLabel,
  onOpenDesvios, onOpenPendentes,
}) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const { fmtDate } = useFormatter();

  return (
    <>
      {/* Card 1 — Desvios Críticos */}
      <button
        onClick={() => desvios && onOpenDesvios()}
        disabled={!desvios}
        className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-left w-full transition-all duration-200 hover:border-slate-300 hover:shadow-md cursor-pointer disabled:cursor-default"
      >
        <div className="flex items-center justify-between mb-4">
          <div className={cn(
            'p-2 rounded-lg',
            desvios && desvios.skusComDesvio > 0
              ? 'bg-amber-50 text-amber-600'
              : 'bg-emerald-50 text-emerald-600'
          )}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          {desvios && (
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
              {t('labels.desvioThreshold', { value: desvios.threshold })}
            </span>
          )}
        </div>
        <p className="text-sm font-medium text-slate-500 mb-1">{t('cards.criticalDeviations')}</p>
        {noData || !desvios ? (
          <p className="text-xl font-bold text-slate-300">—</p>
        ) : (
          <>
            <h3 className={cn(
              'text-2xl font-bold mb-1',
              desvios.skusComDesvio > 0 ? 'text-amber-600' : 'text-emerald-600'
            )}>
              {desvios.skusComDesvio}
              <span className="text-sm font-normal text-slate-400 ml-1">SKUs</span>
            </h3>
            <p className="text-xs text-slate-400">
              {desvios.skusComDesvio === 0
                ? t('labels.allWithinLimit')
                : t('labels.familiesCount', { count: desvios.familias.length })}
            </p>
          </>
        )}
      </button>

      {/* Card 2 — Produtos Preenchidos */}
      {(() => {
        const pendingCnt = summary ? summary.totalItems - summary.filledItems : 0;
        return (
          <button
            onClick={() => !noData && pendingCnt > 0 && onOpenPendentes()}
            disabled={noData || pendingCnt === 0}
            className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-left w-full transition-all duration-200 hover:border-slate-300 hover:shadow-md cursor-pointer disabled:cursor-default disabled:hover:border-slate-200 disabled:hover:shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg w-fit">
                <Package className="w-5 h-5" />
              </div>
              {!noData && pendingCnt > 0 && (
                <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                  {t('labels.pendingBadge', { count: pendingCnt })}
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-slate-500 mb-1">{t('cards.filledProducts')}</p>
            {noData ? (
              <p className="text-xl font-bold text-slate-300">—</p>
            ) : (
              <>
                <h3 className="text-2xl font-bold text-slate-900 mb-1">
                  {summary!.filledItems} / {summary!.totalItems}
                </h3>
                <p className="text-xs text-slate-400 font-medium">
                  {summary!.totalItems > 0
                    ? t('labels.portfolioPct', { value: ((summary!.filledItems / summary!.totalItems) * 100).toFixed(0) })
                    : t('labels.noData')}
                </p>
              </>
            )}
          </button>
        );
      })()}

      {/* Card 3 — Status do Mês */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="p-2 bg-amber-50 text-amber-600 rounded-lg w-fit mb-4">
          <Clock className="w-5 h-5" />
        </div>
        <p className="text-sm font-medium text-slate-500 mb-2">{t('cards.monthStatus')}</p>
        <div className="flex items-center gap-2 mb-1">
          <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', subStatusCfg.dot)} />
          <h3 className="text-xl font-bold text-slate-900">{subStatusCfg.label}</h3>
        </div>
        <p className="text-xs text-slate-400">
          {cicloLabel} — {t('labels.currentSubmission')}
        </p>
        {submittedAt && (
          <p className="text-xs text-slate-400 mt-0.5">
            {fmtDate(submittedAt)}
          </p>
        )}
      </div>

      {/* Card 4 — Acurácia do Forecast */}
      {(() => {
        const acurSnap = acuraciaGestorSnap?.acuracia ?? null;
        return (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className={cn(
              'p-2 rounded-lg w-fit mb-4',
              acurSnap === null      ? 'bg-slate-50 text-slate-400'    :
              acurSnap >= 90         ? 'bg-emerald-50 text-emerald-600' :
              acurSnap >= 75         ? 'bg-amber-50 text-amber-600'    :
                                       'bg-red-50 text-red-600'
            )}>
              <Target className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
              {t('cards.unitAccuracy')}
              <InfoTooltip
                text={t('tooltips.unitAccuracy')}
                width="w-80"
              />
            </p>
            {loadingAnalytics ? (
              <>
                <p className="text-xl font-bold text-slate-300">—</p>
                <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> {t('labels.calculating')}
                </p>
              </>
            ) : acurSnap === null ? (
              <>
                <p className="text-xl font-bold text-slate-300">—</p>
                <p className="text-xs text-slate-400 mt-1">{t('labels.waitingRealSales')}</p>
              </>
            ) : (
              <>
                <h3 className={cn(
                  'text-2xl font-bold mb-1',
                  acurSnap >= 90 ? 'text-emerald-600' :
                  acurSnap >= 75 ? 'text-amber-600'   : 'text-red-600'
                )}>
                  {acurSnap.toFixed(1)}%
                </h3>
                <p className="text-xs text-slate-400">
                  {t('kpi.accuracyMonthsData', { ns: 'consolidado', count: acuraciaGestorSnap?.ciclosValidos ?? 0 })}
                </p>
              </>
            )}
          </div>
        );
      })()}
    </>
  );
};
