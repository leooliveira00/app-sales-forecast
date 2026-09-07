import React, { useState, useMemo } from 'react';
import { X, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ForecastItem } from '../../types/forecast';
import { getFamilia } from '../../types/forecast';

interface ExcludedProductsModalProps {
  items: ForecastItem[];
  isReadOnly?: boolean;
  onRestore: (item: ForecastItem) => void;
  onRestoreFamily: (items: ForecastItem[]) => void;
  onRestoreAll: () => void;
  onClose: () => void;
}

export const ExcludedProductsModal: React.FC<ExcludedProductsModalProps> = ({
  items,
  isReadOnly = false,
  onRestore,
  onRestoreFamily,
  onRestoreAll,
  onClose,
}) => {
  const { t } = useTranslation('forecast');

  const grouped = useMemo(() => {
    const map = new Map<string, ForecastItem[]>();
    for (const item of items) {
      const fam = getFamilia(item);
      const list = map.get(fam) ?? [];
      list.push(item);
      map.set(fam, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleFamily = (fam: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(fam) ? next.delete(fam) : next.add(fam);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh] overflow-hidden">

        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-800">{t('excludedProducts.title')}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {t(`excludedProducts.subtitle_${items.length !== 1 ? 'other' : 'one'}`, {
                count: items.length,
                families: grouped.length,
              })}
              {isReadOnly && (
                <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[10px] font-semibold uppercase tracking-wide border border-amber-200">
                  {t('excludedProducts.readOnly')}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Lista por família */}
        <div className="overflow-y-auto overflow-x-hidden flex-1 divide-y divide-slate-100">
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">
              {t('excludedProducts.empty')}
            </p>
          ) : (
            grouped.map(([fam, famItems]) => {
              const isCollapsed = collapsed.has(fam);
              return (
                <div key={fam}>
                  <div
                    className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors select-none"
                    onClick={() => toggleFamily(fam)}
                  >
                    {isCollapsed
                      ? <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      : <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    }
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex-1 truncate">
                      {fam}
                    </span>
                    <span className="text-[10px] font-medium text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded-full">
                      {famItems.length}
                    </span>
                    {!isReadOnly && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRestoreFamily(famItems); }}
                        title={t('excludedProducts.restoreFamilyTitle')}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors shrink-0 ml-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        {t('excludedProducts.restoreFamily')}
                      </button>
                    )}
                  </div>

                  {!isCollapsed && (
                    <div className="divide-y divide-slate-50">
                      {famItems.map(item => (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 pl-8 pr-4 py-2.5 hover:bg-slate-50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <span className="font-mono text-[10px] text-slate-400 block">{item.produto.codigo}</span>
                            <span className="text-sm text-slate-700 truncate block">{item.produto.descricao}</span>
                          </div>
                          {!isReadOnly && (
                            <button
                              onClick={() => onRestore(item)}
                              title={t('excludedProducts.restoreProductTitle')}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors shrink-0"
                            >
                              <RotateCcw className="w-3 h-3" />
                              {t('excludedProducts.restoreProduct')}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Rodapé */}
        {!isReadOnly && items.length > 1 && (
          <div className="px-6 py-4 border-t border-slate-200 flex justify-end">
            <button
              onClick={onRestoreAll}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              {t('excludedProducts.restoreAll')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
