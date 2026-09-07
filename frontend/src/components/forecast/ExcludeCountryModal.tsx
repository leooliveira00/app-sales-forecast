import React from 'react';
import { Globe, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AnnualProduct } from '../../hooks/useAnnualForecastData';

interface ExcludeCountryModalProps {
  produto:  AnnualProduct;
  paisNome: string;
  onConfirm: (scope: 'country' | 'all') => void;
  onClose:   () => void;
}

export const ExcludeCountryModal: React.FC<ExcludeCountryModalProps> = ({
  produto, paisNome, onConfirm, onClose,
}) => {
  const { t } = useTranslation('forecast');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-red-500" />
            <h3 className="font-bold text-slate-900 text-sm">{t('excludeModal.title')}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-1">
          <p className="text-sm text-slate-700">
            {t('excludeModal.scopeQuestion', { name: produto.descricao })}
          </p>
          <p className="text-xs text-slate-400 pt-1">
            {t('excludeModal.code')} {produto.codigo}
          </p>
        </div>

        <div className="px-6 pb-6 grid grid-cols-2 gap-3">
          <button
            onClick={() => onConfirm('country')}
            className="flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border-2 border-indigo-200 bg-indigo-50 hover:bg-indigo-100 hover:border-indigo-300 transition-colors text-left"
          >
            <Globe className="w-4 h-4 text-indigo-500" />
            <span className="text-xs font-bold text-indigo-700">{t('excludeModal.countryOnly', { country: paisNome })}</span>
            <span className="text-[10px] text-indigo-400 text-center">{t('excludeModal.countryOnlyHint')}</span>
          </button>

          <button
            onClick={() => onConfirm('all')}
            className="flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border-2 border-red-200 bg-red-50 hover:bg-red-100 hover:border-red-300 transition-colors text-left"
          >
            <Trash2 className="w-4 h-4 text-red-500" />
            <span className="text-xs font-bold text-red-700">{t('excludeModal.allCountries')}</span>
            <span className="text-[10px] text-red-400 text-center">{t('excludeModal.allCountriesHint')}</span>
          </button>
        </div>

        <div className="px-6 pb-5">
          <button
            onClick={onClose}
            className="w-full py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-xl border border-slate-200 transition-colors"
          >
            {t('excludeModal.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
