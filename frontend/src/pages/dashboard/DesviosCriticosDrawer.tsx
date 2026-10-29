/**
 * Drawer do card "Desvios Críticos" (visão gestor): SKUs acima do limite de desvio,
 * agrupados por família expansível.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { useFormatter } from '../../hooks/useFormatter';
import { cn } from '../../components/shared/Common';
import { Drawer } from '../../components/shared/Drawer';
import type { DesviosCriticos } from './types';

interface DesviosCriticosDrawerProps {
  isOpen:         boolean;
  onClose:        () => void;
  desvios:        DesviosCriticos | null;
  onGoToForecast: () => void;
}

export const DesviosCriticosDrawer: React.FC<DesviosCriticosDrawerProps> = ({ isOpen, onClose, desvios, onGoToForecast }) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const { fmt } = useFormatter();
  const [expandedDesvioFamilies, setExpandedDesvioFamilies] = useState<Set<string>>(new Set());

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={t('cards.criticalDeviations')}
      subtitle={desvios
        ? desvios.skusComDesvio > 0
          ? t('drawer.skusAboveThreshold', { count: desvios.skusComDesvio, threshold: desvios.threshold })
          : t('labels.currentCycle')
        : undefined}
    >
      {desvios && (
        desvios.skusComDesvio === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            </div>
            <p className="text-sm font-semibold text-emerald-700">{t('labels.noDeviations')}</p>
            <p className="text-xs text-slate-400">{t('drawer.allWithinLimit', { threshold: desvios.threshold })}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              {t('drawer.deviationDescription', { threshold: desvios.threshold })}
            </p>

            {desvios.detalhe.map(({ familia, skus }) => {
              const isExpanded = expandedDesvioFamilies.has(familia);
              const maxDesvio = Math.max(...skus.map(s => Math.abs(s.desvio)));
              return (
                <div key={familia} className="rounded-xl border border-slate-100 overflow-hidden">
                  <button
                    onClick={() => setExpandedDesvioFamilies(prev => {
                      const next = new Set(prev);
                      next.has(familia) ? next.delete(familia) : next.add(familia);
                      return next;
                    })}
                    className="w-full flex items-center gap-2 px-4 py-2.5 bg-amber-50 hover:bg-amber-100 transition-colors text-left"
                  >
                    {isExpanded
                      ? <ChevronUp className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      : <ChevronDown className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                    <span className="text-xs font-bold text-slate-700 flex-1">{familia}</span>
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                      {skus.length} SKU{skus.length !== 1 ? 's' : ''}
                    </span>
                    <span className={cn(
                      'text-[10px] font-bold px-2 py-0.5 rounded-full',
                      maxDesvio > 30 ? 'bg-red-100 text-red-700' : 'bg-orange-50 text-orange-700'
                    )}>
                      {t('drawer.maxDeviation', { value: maxDesvio.toFixed(0) })}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="divide-y divide-slate-50">
                      {skus.map((sku) => {
                        const fmtV = fmt;
                        const isAlta = sku.desvio > 0;
                        return (
                          <div key={sku.codigo} className="px-4 py-3 space-y-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-xs font-bold text-slate-700 font-mono">{sku.codigo}</p>
                                <p className="text-[11px] text-slate-500 truncate max-w-[220px]">{sku.descricao}</p>
                              </div>
                              <span className={cn(
                                'text-xs font-bold px-2 py-0.5 rounded-full shrink-0',
                                isAlta ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                              )}>
                                {sku.desvio > 0 ? '+' : ''}{sku.desvio.toFixed(1)}%
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                              <div className="bg-slate-50 rounded-lg px-2.5 py-1.5">
                                <p className="text-slate-400 text-[9px] font-bold uppercase mb-0.5">{t('legend.vendaAA')}</p>
                                <p className="font-bold text-slate-600 tabular-nums">{fmtV(sku.volumeVendaAA)}</p>
                              </div>
                              <div className="bg-blue-50 rounded-lg px-2.5 py-1.5">
                                <p className="text-blue-400 text-[9px] font-bold uppercase mb-0.5">{t('legend.fcts')}</p>
                                <p className="font-bold text-blue-700 tabular-nums">{fmtV(sku.volumeFCTS)}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="pt-2 border-t border-slate-100 hidden md:block">
              <button
                onClick={onGoToForecast}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {t('actions.goToForecast')} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )
      )}
    </Drawer>
  );
};
