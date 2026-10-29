/**
 * Drawer do card "Unidades sem Submissão" (visão PCP): unidades pendentes e já submetidas
 * no ciclo. A lista de unidades é buscada na primeira abertura.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ChevronRight, Loader2 } from 'lucide-react';
import { Drawer } from '../../components/shared/Drawer';

interface UnidadesSemSubmissaoDrawerProps {
  isOpen:          boolean;
  onClose:         () => void;
  token:           string | null;
  /** Códigos das unidades com alguma submissão no ciclo. */
  unidadesNoMes:   Set<string>;
  /** Ex.: "Out/2026". */
  cicloLabel:      string;
  pendentesCount:  number | null;
  onGoToApprovals: () => void;
}

export const UnidadesSemSubmissaoDrawer: React.FC<UnidadesSemSubmissaoDrawerProps> = ({
  isOpen, onClose, token, unidadesNoMes, cicloLabel, pendentesCount, onGoToApprovals,
}) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const [allUnidades, setAllUnidades] = useState<{ codigo: string; descricao: string }[]>([]);
  const [loadingUnidades, setLoadingUnidades] = useState(false);

  useEffect(() => {
    if (!isOpen || allUnidades.length > 0 || loadingUnidades) return;
    setLoadingUnidades(true);
    fetch('/api/unidades', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((data: { codigo: string; descricao: string }[]) => setAllUnidades(data))
      .catch(() => {})
      .finally(() => setLoadingUnidades(false));
  }, [isOpen, allUnidades.length, loadingUnidades, token]);

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={t('cards.unitsWithoutSubmission')}
      subtitle={`Ciclo ${cicloLabel} · ${pendentesCount ?? 0} pendente${pendentesCount !== 1 ? 's' : ''}`}
    >
      {loadingUnidades ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
        </div>
      ) : (() => {
        const pendingUnidades = allUnidades.filter(u => !unidadesNoMes.has(u.codigo));
        const submittedUnidades = allUnidades.filter(u => unidadesNoMes.has(u.codigo));
        return (
          <div className="space-y-5">
            {pendingUnidades.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                </div>
                <p className="text-sm font-semibold text-emerald-700">{t('labels.allUnitsSubmitted')}</p>
                <p className="text-xs text-slate-400">{t('labels.noPendingUnits')}</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('labels.pending')}</p>
                  {pendingUnidades.map(u => (
                    <div key={u.codigo} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-100">
                      <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-700">{u.descricao}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{u.codigo}</p>
                      </div>
                      <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full shrink-0">
                        {t('labels.waiting')}
                      </span>
                    </div>
                  ))}
                </div>
                {submittedUnidades.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('labels.submitted')}</p>
                    {submittedUnidades.map(u => (
                      <div key={u.codigo} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-100">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-700">{u.descricao}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{u.codigo}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="pt-2 border-t border-slate-100">
                  <button
                    onClick={onGoToApprovals}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-xl transition-colors"
                  >
                    {t('actions.goToApprovals')} <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })()}
    </Drawer>
  );
};
