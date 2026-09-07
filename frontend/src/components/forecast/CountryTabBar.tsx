import React from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../shared/Common';
import { useCountryName } from '../../hooks/useCountryName';

interface Country {
  iso3: string;
  nome: string;
}

interface CountryTabBarProps {
  paises: Country[];
  selected: string | null; // null = "Todos"
  onSelect: (iso3: string | null) => void;
}

export const CountryTabBar: React.FC<CountryTabBarProps> = ({ paises, selected, onSelect }) => {
  const { t } = useTranslation('forecast');
  const countryName = useCountryName();
  return (
    // Container externo: não rola, tem a borda inferior visível em toda a largura
    <div className="border-b border-slate-200 bg-white">
      {/* Área interna: scroll apenas horizontal dos tabs, sem scroll de página */}
      <div className="flex items-center gap-0 overflow-x-auto px-6 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Tab "Todos" */}
        <button
          onClick={() => onSelect(null)}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-t-lg -mb-px border-b-2 whitespace-nowrap transition-colors shrink-0',
            selected === null
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/40'
              : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50',
          )}
        >
          <Globe className="w-3.5 h-3.5" />
          {t('countrySelector.all')}
          <span className={cn(
            'ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full',
            selected === null
              ? 'bg-indigo-100 text-indigo-600'
              : 'bg-slate-100 text-slate-500',
          )}>
            {paises.length}
          </span>
        </button>

        {/* Um tab por país */}
        {paises.map(pais => (
          <button
            key={pais.iso3}
            onClick={() => onSelect(pais.iso3)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-t-lg -mb-px border-b-2 whitespace-nowrap transition-colors shrink-0',
              selected === pais.iso3
                ? 'border-indigo-600 text-indigo-700 bg-indigo-50/40'
                : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50',
            )}
          >
            <span className="font-mono text-[10px] text-slate-400">{pais.iso3}</span>
            <span className="text-sm">{countryName(pais.iso3, pais.nome)}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
