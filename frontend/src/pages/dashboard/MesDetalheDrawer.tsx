/**
 * Drawer aberto ao clicar num mês do gráfico de tendência: ORC × FCTS × Vendas,
 * desvio FCTS/Venda e atingimento vs ORC.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { useFormatter } from '../../hooks/useFormatter';
import { cn } from '../../components/shared/Common';
import { Drawer } from '../../components/shared/Drawer';
import type { TendenciaPoint } from './types';

interface MesDetalheDrawerProps {
  mes:               (TendenciaPoint & { desvio: number }) | null;
  onClose:           () => void;
  onViewConsolidado: () => void;
}

export const MesDetalheDrawer: React.FC<MesDetalheDrawerProps> = ({ mes, onClose, onViewConsolidado }) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const { fmt } = useFormatter();
  const MESES = t('months', { ns: 'common', returnObjects: true }) as string[];

  return (
    <Drawer
      isOpen={!!mes}
      onClose={onClose}
      title={mes ? (() => { const [y, m] = mes.month.split('-').map(Number); return `${MESES[m-1]}/${String(y).slice(2)}`; })() : ''}
      subtitle={t('legend.subtitle')}
    >
      {mes && (() => {
        const d = mes.desvio;
        const desvioColor = Math.abs(d) <= 10 ? 'text-emerald-600' : Math.abs(d) <= 20 ? 'text-amber-600' : 'text-red-600';
        const desvioKey = Math.abs(d) <= 10 ? 'ok' : Math.abs(d) <= 20 ? 'warning' : 'critical';
        const desvioLabel = t(`labels.deviation.${desvioKey}`);
        return (
          <div className="space-y-4">
            <div className={cn('flex items-center justify-between px-4 py-3 rounded-xl border', Math.abs(d) <= 10 ? 'bg-emerald-50 border-emerald-100' : Math.abs(d) <= 20 ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100')}>
              <span className="text-sm font-medium text-slate-600">{t('drawer.fctsVsSale')}</span>
              <div className="text-right">
                <p className={cn('text-xl font-bold', desvioColor)}>
                  {d >= 0 ? '+' : ''}{d.toFixed(1)}%
                </p>
                <p className={cn('text-[10px] font-bold', desvioColor)}>{desvioLabel}</p>
              </div>
            </div>
            <div className="space-y-3">
              {[
                { label: t('legend.orc'),   value: mes.orc,   color: 'text-slate-500', bg: 'bg-slate-50 border-slate-100' },
                { label: t('legend.fcts'),  value: mes.fcts,  color: 'text-blue-600',  bg: 'bg-blue-50 border-blue-100' },
                { label: t('legend.vendas'), value: mes.vendas, color: 'text-teal-600', bg: 'bg-teal-50 border-teal-100' },
              ].map(({ label, value, color, bg }) => (
                <div key={label} className={cn('flex items-center justify-between px-4 py-3 rounded-xl border', bg)}>
                  <span className="text-sm font-medium text-slate-600">{label}</span>
                  <span className={cn('text-base font-bold tabular-nums', color)}>{fmt(value)}</span>
                </div>
              ))}
            </div>
            {mes.orc > 0 && (
              <div className="px-4 py-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                <p className="text-xs text-slate-500 font-medium">{t('drawer.achievementVsORC')}</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${Math.min((mes.fcts / mes.orc) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold text-slate-700 tabular-nums">
                    {((mes.fcts / mes.orc) * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            )}
            <button
              onClick={onViewConsolidado}
              className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
            >
              {t('drawer.viewConsolidado')}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        );
      })()}
    </Drawer>
  );
};
