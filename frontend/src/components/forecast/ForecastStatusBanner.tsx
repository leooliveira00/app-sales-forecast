import React from 'react';
import { AlertCircle, Calendar, CheckCircle2, Clock, X, XCircle, History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../shared/Common';
import { monthLabel } from '../../types/forecast';
import { useFormatter } from '../../hooks/useFormatter';
import { businessDateTimeParts, daysUntilBusinessDay } from '../../utils/businessDay';
import type { Submission } from '../../types/forecast';


interface ForecastStatusBannerProps {
  submission: Submission | null;
  cycleDate: Date | null;
  isHistorical: boolean;
  pendingReleaseDate?: string | null;
  availableUntil?: string | null;
  /** Dados do ciclo/submissão ainda carregando — evita banner que aparece e desaparece. */
  isLoading?: boolean;
  dismissed?: Set<string>;
  onDismiss?: (key: string) => void;
}

export const ForecastStatusBanner: React.FC<ForecastStatusBannerProps> = ({
  submission,
  cycleDate,
  isHistorical,
  pendingReleaseDate = null,
  availableUntil = null,
  isLoading = false,
  dismissed = new Set(),
  onDismiss,
}) => {
  const { t, i18n } = useTranslation('forecast');
  const { fmtDate } = useFormatter();

  // Countdown: usa a data de fechamento configurada no admin (availableUntil),
  // calculada no backend a partir do cycleCloseDay. Sem essa data não há contagem.
  //
  // A contagem é em DIAS DE CALENDÁRIO no fuso de negócio: o dia do fechamento
  // é 0 ("encerra hoje"), o anterior é 1 ("encerra amanhã"). Usar a diferença em
  // milissegundos arredondada para cima contava o dia corrente parcial como um dia
  // inteiro, deslocando toda a contagem em +1 (o dia 28 aparecia como "amanhã").
  const daysRemaining = availableUntil ? daysUntilBusinessDay(availableUntil) : null;
  const cycleIsActive =
    !pendingReleaseDate &&
    !isHistorical &&
    submission?.status !== 'SUBMITTED' &&
    submission?.status !== 'APPROVED' &&
    submission?.status !== 'REJECTED';
  // Enquanto os dados carregam, `submission` e `isHistorical` ainda não refletem a
  // realidade: submission=null faz `cycleIsActive` valer true e o aviso de prazo
  // aparecia por um instante para quem já submeteu, sendo trocado depois pelo
  // banner "Aguardando aprovação". Só conta o prazo com o ciclo já carregado.
  const showCountdown =
    !isLoading &&
    cycleIsActive &&
    daysRemaining !== null &&
    daysRemaining >= 0 &&
    daysRemaining <= 5;

  const DismissBtn = ({ bannerKey, colorCls }: { bannerKey: string; colorCls: string }) =>
    onDismiss ? (
      <button
        onClick={() => onDismiss(bannerKey)}
        className={cn(
          "shrink-0 p-0.5 rounded-md transition-colors",
          colorCls
        )}
        title={t('statusBanner.closeNotice')}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    ) : null;

  const cycleLabel = cycleDate ? monthLabel(cycleDate) : '';

  return (
    <>
      {showCountdown && daysRemaining !== null && !dismissed.has('countdown') && (
        <div className={cn(
          "flex items-center gap-3 p-4 rounded-xl border text-sm font-medium",
          daysRemaining <= 1
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-amber-200 bg-amber-50 text-amber-700"
        )}>
          <Calendar className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            {daysRemaining === 0
              ? t('statusBanner.cycleEndsToday')
              : daysRemaining === 1
              ? t('statusBanner.cycleEndsTomorrow')
              : t('statusBanner.cycleEndsDays', { days: daysRemaining })}
          </span>
          <DismissBtn
            bannerKey="countdown"
            colorCls={daysRemaining <= 1
              ? "text-red-400 hover:text-red-600 hover:bg-red-100"
              : "text-amber-400 hover:text-amber-600 hover:bg-amber-100"}
          />
        </div>
      )}

      {pendingReleaseDate && !dismissed.has('pending-release') && (
        <div className="flex items-start gap-3 px-5 py-4 rounded-2xl border border-sky-200 bg-sky-50 text-sky-800 text-sm">
          <Clock className="w-5 h-5 shrink-0 mt-0.5 text-sky-500" />
          <div className="flex-1">
            <p className="font-semibold mb-0.5">{t('statusBanner.pendingTitle')}</p>
            <p className="font-normal text-sky-700">
              {(() => {
                // Data e hora no fuso de negócio: o ciclo abre às 08h de Brasília,
                // instante que em UTC cai às 11h — ler os componentes UTC aqui
                // anunciaria o horário errado ao gestor.
                const { date, time } = businessDateTimeParts(pendingReleaseDate, i18n.language);
                return t('statusBanner.pendingAvailableAt', { date, time });
              })()}
            </p>
          </div>
          <DismissBtn bannerKey="pending-release" colorCls="text-sky-400 hover:text-sky-600 hover:bg-sky-100 mt-0.5" />
        </div>
      )}


      {/* APPROVED */}
      {submission?.status === 'APPROVED' && !dismissed.has('approved') && (
        <div className="flex items-start gap-4 px-5 py-4 rounded-2xl border border-emerald-200 bg-emerald-50">
          <div className="shrink-0 mt-0.5 flex items-center justify-center w-9 h-9 rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-emerald-800">{t('statusBanner.approvedTitle')}</p>
            <p className="text-xs text-emerald-600 mt-0.5">
              {submission.reviewedAt
                ? t('statusBanner.approvedSubtitleDate', { cycle: cycleLabel, date: fmtDate(submission.reviewedAt) })
                : t('statusBanner.approvedSubtitle', { cycle: cycleLabel })}
            </p>
          </div>
          <DismissBtn bannerKey="approved" colorCls="text-emerald-400 hover:text-emerald-600 hover:bg-emerald-100 mt-0.5" />
        </div>
      )}

      {/* SUBMITTED */}
      {submission?.status === 'SUBMITTED' && !dismissed.has('submitted') && (
        <div className="flex items-start gap-4 px-5 py-4 rounded-2xl border border-amber-200 bg-amber-50">
          <div className="shrink-0 mt-0.5 flex items-center justify-center w-9 h-9 rounded-full bg-amber-100 text-amber-600">
            <Clock className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-800">{t('statusBanner.submittedTitle')}</p>
            <p className="text-xs text-amber-600 mt-0.5">
              {submission.submittedAt
                ? t('statusBanner.submittedSubtitleDate', { cycle: cycleLabel, date: fmtDate(submission.submittedAt) })
                : t('statusBanner.submittedSubtitle', { cycle: cycleLabel })}
            </p>
          </div>
          <DismissBtn bannerKey="submitted" colorCls="text-amber-400 hover:text-amber-600 hover:bg-amber-100 mt-0.5" />
        </div>
      )}

      {/* DRAFT */}
      {submission?.status === 'DRAFT' && !dismissed.has('draft') && (
        <div className="flex items-center gap-4 px-5 py-3.5 rounded-2xl border border-slate-200 bg-slate-50">
          <AlertCircle className="w-4 h-4 shrink-0 text-slate-400" />
          <p className="flex-1 text-sm font-medium text-slate-500">
            {t('statusBanner.draftTitle', { cycle: cycleLabel })}
          </p>
          <DismissBtn bannerKey="draft" colorCls="text-slate-400 hover:text-slate-600 hover:bg-slate-200" />
        </div>
      )}

      {/* REJECTED — não é descartável: o usuário precisa agir */}
      {submission?.status === 'REJECTED' && (
        <div className="rounded-2xl border border-red-200 bg-white overflow-hidden shadow-sm">
          <div className="flex items-start gap-4 px-5 py-4 bg-red-50 border-b border-red-100">
            <div className="shrink-0 mt-0.5 flex items-center justify-center w-9 h-9 rounded-full bg-red-100 text-red-600">
              <XCircle className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-red-800">{t('statusBanner.rejectedTitle')}</p>
              <p className="text-xs text-red-500 mt-0.5">
                {submission.reviewedAt
                  ? t('statusBanner.rejectedSubtitleDate', { cycle: cycleLabel, date: fmtDate(submission.reviewedAt) })
                  : t('statusBanner.rejectedSubtitle', { cycle: cycleLabel })}
              </p>
            </div>
          </div>
          {submission.rejectionReason && (
            <div className="px-5 py-3 bg-white border-b border-red-100">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('statusBanner.rejectionReasonTitle')}</p>
              <p className="text-sm text-slate-700">{submission.rejectionReason}</p>
            </div>
          )}
          <div className="px-5 py-3 bg-red-50/50">
            <p className="text-xs text-red-500 font-medium">
              {t('statusBanner.rejectedInstructions')}
            </p>
          </div>
        </div>
      )}

      {isHistorical && !submission && !dismissed.has('historical') && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-sm font-medium">
          <History className="w-4 h-4 shrink-0" />
          <span className="flex-1">{t('statusBanner.historicalTitle')}</span>
          <DismissBtn bannerKey="historical" colorCls="text-amber-400 hover:text-amber-600 hover:bg-amber-100" />
        </div>
      )}
    </>
  );
};
