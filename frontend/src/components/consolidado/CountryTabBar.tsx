import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../shared/Common';
import { useCountryName } from '../../hooks/useCountryName';

const MAX_VISIBLE = 8;

interface PaisTab {
  iso3:         string;
  nome:         string;
  fctsAnual:    number;
  orcAnual:     number;
  vendasAnual?: number;
}

interface CountryTabBarProps {
  paises:   PaisTab[];
  selected: string | null;  // null = "Todos"
  onSelect: (iso3: string | null) => void;
}

const fmt = (v: number) =>
  v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000
    ? `${(v / 1_000).toFixed(1)}k`
    : String(v);

function CountryBadge({
  p, isActive, onSelect,
}: { p: PaisTab; isActive: boolean; onSelect: (iso3: string) => void }) {
  const countryName = useCountryName();
  const deltaOk = p.orcAnual > 0 && p.fctsAnual > 0;
  const delta   = deltaOk ? ((p.fctsAnual / p.orcAnual) - 1) * 100 : null;
  return (
    <button
      onClick={() => onSelect(p.iso3)}
      title={countryName(p.iso3, p.nome)}
      className={cn(
        'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap',
        isActive
          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
          : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700',
      )}
    >
      <span className={cn('font-mono', isActive ? 'text-indigo-600' : 'text-slate-400')}>
        {p.iso3}
      </span>
      {p.fctsAnual > 0 && (
        <span className={cn(
          'text-[10px] font-bold px-1 py-0.5 rounded',
          isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500',
        )}>
          {fmt(p.fctsAnual)}
        </span>
      )}
      {delta !== null && (
        <span className={cn(
          'text-[9px] font-bold',
          delta >= 0 ? 'text-emerald-600' : 'text-red-500',
        )}>
          {delta >= 0 ? '+' : ''}{delta.toFixed(0)}%
        </span>
      )}
    </button>
  );
}

export const CountryTabBar: React.FC<CountryTabBarProps> = ({ paises, selected, onSelect }) => {
  const countryName = useCountryName();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  // Fechar dropdown ao mudar seleção
  useEffect(() => { setDropdownOpen(false); }, [selected]);

  const ativos = paises
    .filter(p => p.orcAnual > 0 || p.fctsAnual > 0 || (p.vendasAnual ?? 0) > 0)
    .sort((a, b) => b.fctsAnual - a.fctsAnual);

  if (ativos.length === 0) return null;

  // Se o país selecionado está no overflow, promovê-lo para visível
  const selectedInOverflow =
    selected !== null &&
    ativos.findIndex(p => p.iso3 === selected) >= MAX_VISIBLE;

  const visible  = ativos.slice(0, MAX_VISIBLE);
  const overflow = ativos.slice(MAX_VISIBLE);

  // País selecionado que ficaria oculto — exibir como badge extra
  const promoted = selectedInOverflow
    ? ativos.find(p => p.iso3 === selected) ?? null
    : null;

  return (
    <div className="flex items-center gap-1 flex-wrap mb-3">
      {/* Botão "Todos" */}
      <button
        onClick={() => onSelect(null)}
        className={cn(
          'flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap',
          selected === null
            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
            : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700',
        )}
      >
        Todos
      </button>

      {/* Top N países */}
      {visible.map(p => (
        <CountryBadge
          key={p.iso3}
          p={p}
          isActive={selected === p.iso3}
          onSelect={onSelect}
        />
      ))}

      {/* País selecionado promovido do overflow */}
      {promoted && (
        <CountryBadge
          key={promoted.iso3}
          p={promoted}
          isActive
          onSelect={onSelect}
        />
      )}

      {/* Botão "+N" com dropdown */}
      {overflow.length > 0 && (
        <div ref={dropdownRef} className="relative flex-shrink-0">
          <button
            onClick={() => setDropdownOpen(v => !v)}
            className={cn(
              'flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap',
              dropdownOpen
                ? 'bg-slate-100 text-slate-700 border-slate-300'
                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700',
            )}
          >
            +{overflow.length}
            <ChevronDown className={cn('w-3 h-3 transition-transform', dropdownOpen && 'rotate-180')} />
          </button>

          {dropdownOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[160px] max-h-72 overflow-y-auto">
              {overflow.map(p => {
                const isActive = selected === p.iso3;
                const deltaOk  = p.orcAnual > 0 && p.fctsAnual > 0;
                const delta    = deltaOk ? ((p.fctsAnual / p.orcAnual) - 1) * 100 : null;
                return (
                  <button
                    key={p.iso3}
                    onClick={() => onSelect(p.iso3)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left',
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 font-semibold'
                        : 'text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    <span className="font-mono w-8 shrink-0">{p.iso3}</span>
                    <span className="flex-1 truncate text-slate-400">{countryName(p.iso3, p.nome)}</span>
                    {p.fctsAnual > 0 && (
                      <span className="text-[10px] font-bold text-slate-500 shrink-0">
                        {fmt(p.fctsAnual)}
                      </span>
                    )}
                    {delta !== null && (
                      <span className={cn(
                        'text-[9px] font-bold shrink-0',
                        delta >= 0 ? 'text-emerald-600' : 'text-red-500',
                      )}>
                        {delta >= 0 ? '+' : ''}{delta.toFixed(0)}%
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
