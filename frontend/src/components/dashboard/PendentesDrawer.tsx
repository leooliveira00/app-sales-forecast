import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2, CheckCircle2, ChevronUp, ChevronDown, ChevronRight,
} from 'lucide-react';
import { Drawer } from '../shared/Drawer';
import { useCountryName } from '../../hooks/useCountryName';

interface PendenteProduto {
  codigo: string;
  descricao: string;
  classe: string | null;
  /** EXPORT: país da combinação pendente (null para unidades nacionais) */
  paisIso3: string | null;
  pais: string | null;
}

interface PendentesResponse {
  total: number;
  familias: { familia: string; produtos: PendenteProduto[] }[];
}

interface PendentesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  token: string | null;
  /** Mês do ciclo (YYYY-MM-01) */
  month: string;
  onGoToForecast: () => void;
}

/**
 * Drawer de detalhamento do card "Produtos Preenchidos": lista os produtos
 * pendentes (sem FCTS em nenhum mês da janela), agrupados por família.
 * Busca os dados de forma lazy toda vez que é aberto.
 */
export const PendentesDrawer: React.FC<PendentesDrawerProps> = ({
  isOpen, onClose, token, month, onGoToForecast,
}) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const countryName = useCountryName();

  const [data, setData] = useState<PendentesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setExpanded(new Set());
    fetch(`/api/forecast/pendentes?month=${month}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : { total: 0, familias: [] })
      .then((res: PendentesResponse) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setData({ total: 0, familias: [] }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, month, token]);

  const toggle = (familia: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(familia) ? next.delete(familia) : next.add(familia);
    return next;
  });

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={t('cards.filledProducts')}
      subtitle={data ? t('drawer.pendingSubtitle', { count: data.total }) : undefined}
    >
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
        </div>
      ) : data && (
        data.total === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            </div>
            <p className="text-sm font-semibold text-emerald-700">{t('drawer.allFilled')}</p>
            <p className="text-xs text-slate-400">{t('drawer.allFilledDetail')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">{t('drawer.pendingDescription')}</p>

            {data.familias.map(({ familia, produtos }) => {
              const isExpanded = expanded.has(familia);
              return (
                <div key={familia} className="rounded-xl border border-slate-100 overflow-hidden">
                  <button
                    onClick={() => toggle(familia)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 transition-colors text-left"
                  >
                    {isExpanded
                      ? <ChevronUp className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      : <ChevronDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                    <span className="text-xs font-bold text-slate-700 flex-1">{familia}</span>
                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">
                      {produtos.length} SKU{produtos.length !== 1 ? 's' : ''}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="divide-y divide-slate-50">
                      {produtos.map((prod) => (
                        <div key={`${prod.codigo}|${prod.paisIso3 ?? ''}`} className="px-4 py-3 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-bold text-slate-700 font-mono">{prod.codigo}</p>
                              {prod.paisIso3 && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 bg-sky-50 text-sky-700 border border-sky-100">
                                  {countryName(prod.paisIso3, prod.pais)}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 truncate max-w-[220px]">{prod.descricao}</p>
                          </div>
                          {prod.classe && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 bg-slate-100 text-slate-500">
                              {prod.classe}
                            </span>
                          )}
                        </div>
                      ))}
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
