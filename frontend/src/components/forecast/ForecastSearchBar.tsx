import React from 'react';
import { Search, X, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../shared/Common';
import { CLASSE_ORDER, CLASSE_BADGE_COLORS, CLASSE_BADGE_ACTIVE } from '../../types/forecast';

// Adiciona hover às cores inativas
const CLASSE_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(CLASSE_BADGE_COLORS).map(([k, v]) => [k, `${v} hover:brightness-95`])
);

interface ForecastSearchBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedClasses: Set<string>;
  onClassToggle: (c: string) => void;
  filteredTotal: number;
  totalFamilies: number;
  onlyDivergentes: boolean;
  onToggleDivergentes: (v: boolean) => void;
  divergentesCount: number;
}

export const ForecastSearchBar: React.FC<ForecastSearchBarProps> = ({
  searchQuery,
  onSearchChange,
  selectedClasses,
  onClassToggle,
  filteredTotal,
  totalFamilies,
  onlyDivergentes,
  onToggleDivergentes,
  divergentesCount,
}) => {
  const { t } = useTranslation('forecast');
  const isFiltering = searchQuery.length > 0 || selectedClasses.size > 0;

  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
      {/* Input de busca */}
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder={t('searchBar.placeholder')}
          className="w-full pl-8 pr-8 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-300 placeholder:text-slate-300 transition"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Chips de classe — multi-select */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {CLASSE_ORDER.map(c => (
          <button
            key={c}
            onClick={() => onClassToggle(c)}
            title={c === 'F' ? t('searchBar.mostProfitable') : c === 'A' ? t('searchBar.lessProfitable') : t('searchBar.classLabel', { class: c })}
            className={cn(
              "px-2 py-0.5 rounded text-[11px] font-bold border transition-all",
              selectedClasses.has(c) ? CLASSE_BADGE_ACTIVE[c] : CLASSE_COLORS[c]
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Toggle: somente divergências (FCTS vs ORC) */}
      <button
        onClick={() => onToggleDivergentes(!onlyDivergentes)}
        title={t('searchBar.deviationFilter')}
        className={cn(
          "flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold border transition-all flex-shrink-0",
          onlyDivergentes
            ? "bg-amber-500 text-white border-amber-500 shadow-sm shadow-amber-200"
            : "bg-white text-slate-500 border-slate-200 hover:border-amber-300 hover:text-amber-600"
        )}
      >
        <AlertTriangle className="w-3 h-3" />
        {t('searchBar.divergences')}
        {divergentesCount > 0 && (
          <span className={cn(
            "ml-0.5 px-1 py-0 rounded-full text-[9px] font-bold",
            onlyDivergentes ? "bg-white/30" : "bg-amber-100 text-amber-700"
          )}>
            {divergentesCount}
          </span>
        )}
      </button>

      {/* Contador */}
      {isFiltering ? (
        <span className="text-[11px] text-slate-400 flex-shrink-0 whitespace-nowrap">
          {t('searchBar.familiesCount', { filtered: filteredTotal, total: totalFamilies })}
        </span>
      ) : (
        <span className="text-[11px] text-slate-400 flex-shrink-0 whitespace-nowrap">
          {totalFamilies} {t('searchBar.family', { count: totalFamilies })}
        </span>
      )}
    </div>
  );
};
