import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../shared/Common';

/** Soma N meses a uma string "YYYY-MM" */
function addMonths(ym: string, n: number): string {
  const d = new Date(`${ym}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().substring(0, 7);
}

/** Retorna a data atual como "YYYY-MM" */
function currentMonth(): string {
  return new Date().toISOString().substring(0, 7);
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface WindowSelectorProps {
  startMonth: string;   // "YYYY-MM"
  endMonth: string;     // "YYYY-MM"
  onChange: (start: string, end: string) => void;
  years?: number[];     // ex: [2025, 2026] — adiciona botões de preset por ano
  className?: string;
}

// ── Componente ────────────────────────────────────────────────────────────────

export const WindowSelector: React.FC<WindowSelectorProps> = ({
  startMonth, endMonth, onChange, years, className,
}) => {
  const { t } = useTranslation('common');
  const months = t('months', { returnObjects: true }) as string[];

  const fmtMonth = (ym: string): string => {
    const [y, m] = ym.split('-');
    return `${months[parseInt(m, 10) - 1]}/${y}`;
  };

  const start = new Date(`${startMonth}-01T00:00:00Z`);
  const end   = new Date(`${endMonth}-01T00:00:00Z`);
  const windowMonths = Math.round(
    (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  ) + 1;

  const setPreset = (m: number) => {
    const newEnd   = addMonths(currentMonth(), -1);
    const newStart = addMonths(newEnd, -(m - 1));
    onChange(newStart, newEnd);
  };

  const shift = (delta: number) => {
    onChange(addMonths(startMonth, delta), addMonths(endMonth, delta));
  };

  const isActivePreset  = (m: number) => windowMonths === m;
  const isActiveYear    = (y: number) => startMonth === `${y}-01` && endMonth === `${y}-12`;

  const pillBtn = (active: boolean) => cn(
    'px-2.5 py-1 rounded-lg text-xs font-semibold transition-all duration-150 select-none',
    active
      ? 'bg-white text-slate-800 shadow-sm'
      : 'text-slate-500 hover:text-slate-700',
  );

  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>

      {/* Pill group principal */}
      <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-0.5">

        {/* Seta esquerda */}
        <button
          onClick={() => shift(-1)}
          title={t('windowSelector.back')}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white hover:shadow-sm transition-all"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        {/* Presets de duração */}
        {([3, 6, 12] as const).map((p) => (
          <button key={p} onClick={() => setPreset(p)} className={pillBtn(isActivePreset(p))}>
            {p}M
          </button>
        ))}

        {/* Separador */}
        {years && years.length > 0 && (
          <span className="w-px h-4 bg-slate-200 mx-0.5 shrink-0" />
        )}

        {/* Presets por ano */}
        {years && years.map((y) => (
          <button key={y} onClick={() => onChange(`${y}-01`, `${y}-12`)} className={pillBtn(isActiveYear(y))}>
            {y}
          </button>
        ))}

        {/* Seta direita */}
        <button
          onClick={() => shift(1)}
          title={t('windowSelector.forward')}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white hover:shadow-sm transition-all"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Intervalo atual — linha auxiliar discreta */}
      <span className="text-[11px] text-slate-400 font-medium tracking-wide select-none pr-1">
        {fmtMonth(startMonth)}
        <span className="mx-1 text-slate-300">–</span>
        {fmtMonth(endMonth)}
      </span>

    </div>
  );
};
