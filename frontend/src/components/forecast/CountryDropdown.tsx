import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Globe, ChevronDown, Search, X, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../shared/Common';
import { useCountryName } from '../../hooks/useCountryName';

interface Country {
  iso3: string;
  nome: string;
}

export type FillStatus = 'filled' | 'partial' | 'empty';

interface CountryDropdownProps {
  paises:     Country[];
  selected:   string | null;
  onSelect:   (iso3: string | null) => void;
  fillStatus?: Record<string, FillStatus>;
  disabled?:  boolean;
}

function FillDot({ status, label }: { status: FillStatus; label: string }) {
  const DOT_COLOR: Record<FillStatus, string> = {
    filled:  'bg-emerald-400',
    partial: 'bg-amber-400',
    empty:   'bg-red-400',
  };
  return (
    <span
      title={label}
      className={cn('inline-block w-2 h-2 rounded-full shrink-0', DOT_COLOR[status])}
    />
  );
}

export const CountryDropdown: React.FC<CountryDropdownProps> = ({
  paises,
  selected,
  onSelect,
  fillStatus = {},
  disabled = false,
}) => {
  const { t } = useTranslation('forecast');
  const countryName = useCountryName();

  const statusLabels: Record<FillStatus, string> = {
    filled:  t('countrySelector.status.filled'),
    partial: t('countrySelector.status.partial'),
    empty:   t('countrySelector.status.empty'),
  };

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedCountry = paises.find(p => p.iso3 === selected) ?? null;

  const filtered = query.trim() === ''
    ? paises
    : paises.filter(p =>
        countryName(p.iso3, p.nome).toLowerCase().includes(query.toLowerCase()) ||
        p.nome.toLowerCase().includes(query.toLowerCase()) ||
        p.iso3.toLowerCase().includes(query.toLowerCase())
      );

  const openDropdown = useCallback(() => {
    setOpen(true);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const handleSelect = useCallback((iso3: string | null) => {
    onSelect(iso3);
    closeDropdown();
  }, [onSelect, closeDropdown]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, closeDropdown]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDropdown(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, closeDropdown]);

  const totalFilled  = paises.filter(p => fillStatus[p.iso3] === 'filled').length;
  const totalPartial = paises.filter(p => fillStatus[p.iso3] === 'partial').length;
  const totalEmpty   = paises.filter(p => fillStatus[p.iso3] === 'empty').length;
  const hasFillData  = paises.some(p => p.iso3 in fillStatus);

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Trigger */}
      <button
        onClick={disabled ? undefined : (open ? closeDropdown : openDropdown)}
        disabled={disabled}
        title={disabled ? t('countrySelector.lockedTooltip') : undefined}
        className={cn(
          'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl border transition-colors',
          disabled
            ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed opacity-70'
            : open
              ? 'border-indigo-300 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-200'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300',
        )}
      >
        {disabled
          ? <Lock className="w-4 h-4 text-slate-400 shrink-0" />
          : <Globe className="w-4 h-4 text-indigo-400 shrink-0" />
        }
        <span className="max-w-[180px] truncate">
          {selectedCountry ? (
            <>
              <span className="font-mono text-[10px] text-slate-400 mr-1">{selectedCountry.iso3}</span>
              {countryName(selectedCountry.iso3, selectedCountry.nome)}
            </>
          ) : (
            <span className="font-semibold">{t('countrySelector.allCountries')}</span>
          )}
        </span>
        {selected !== null && fillStatus[selected] && (
          <FillDot status={fillStatus[selected]} label={statusLabels[fillStatus[selected]]} />
        )}
        {selected === null && hasFillData && (
          <span className="flex items-center gap-1 ml-0.5">
            {totalFilled > 0  && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">{totalFilled}</span>}
            {totalPartial > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600  bg-amber-50  px-1.5 py-0.5 rounded-full">{totalPartial}</span>}
            {totalEmpty > 0   && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-600   bg-red-50   px-1.5 py-0.5 rounded-full">{totalEmpty}</span>}
          </span>
        )}
        <ChevronDown className={cn('w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-72 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-slate-100">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 rounded-lg border border-slate-200 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('countrySelector.searchPlaceholder')}
                className="flex-1 text-sm bg-transparent outline-none text-slate-700 placeholder-slate-400"
              />
              {query && (
                <button onClick={() => setQuery('')} className="text-slate-300 hover:text-slate-500">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Options list */}
          <div className="max-h-72 overflow-y-auto py-1">
            {/* "Todos" option */}
            {query === '' && (
              <button
                onClick={() => handleSelect(null)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left',
                  selected === null
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                <Globe className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="flex-1 font-semibold">{t('countrySelector.allCountries')}</span>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
                  {paises.length}
                </span>
              </button>
            )}

            {/* Legend row if fill data available */}
            {query === '' && hasFillData && (
              <div className="flex items-center gap-3 px-3 py-1.5 border-b border-slate-100 mb-0.5">
                {(['filled', 'partial', 'empty'] as FillStatus[]).map(s => (
                  <span key={s} className="flex items-center gap-1 text-[10px] text-slate-400">
                    <FillDot status={s} label={statusLabels[s]} />
                    {statusLabels[s]}
                  </span>
                ))}
              </div>
            )}

            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-slate-400">
                {t('countrySelector.noResults')}
              </p>
            )}

            {filtered.map(pais => {
              const status = fillStatus[pais.iso3];
              const isSelected = selected === pais.iso3;
              return (
                <button
                  key={pais.iso3}
                  onClick={() => handleSelect(pais.iso3)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left',
                    isSelected
                      ? 'bg-indigo-50 text-indigo-700 font-semibold'
                      : 'text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {status ? (
                    <FillDot status={status} label={statusLabels[status]} />
                  ) : (
                    <span className="w-2 h-2 shrink-0" />
                  )}
                  <span className="font-mono text-[10px] text-slate-400 w-8 shrink-0">{pais.iso3}</span>
                  <span className="flex-1 truncate">{countryName(pais.iso3, pais.nome)}</span>
                  {isSelected && (
                    <span className="text-[9px] font-bold text-indigo-400 bg-indigo-50 px-1.5 rounded-full border border-indigo-100">
                      {t('countrySelector.active')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
