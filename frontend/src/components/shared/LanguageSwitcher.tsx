import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import ReactCountryFlag from 'react-country-flag';
import { setLanguage } from '../../i18n';
import { cn } from './Common';

const LANGS = [
  { code: 'pt', countryCode: 'BR', label: 'Português' },
  { code: 'es', countryCode: 'ES', label: 'Español'  },
  { code: 'en', countryCode: 'US', label: 'English'  },
] as const;

interface LanguageSwitcherProps {
  className?: string;
  /** 'inline' = 3 flags side-by-side (login page). 'popover' = single flag + dropdown (default). */
  variant?: 'inline' | 'popover';
  /** Direction the popover opens. Default: 'up' */
  popoverDir?: 'up' | 'down';
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  className,
  variant = 'popover',
  popoverDir = 'up',
}) => {
  const { i18n } = useTranslation();
  const current = LANGS.find(l => l.code === i18n.language) ?? LANGS[0];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (variant === 'inline') {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        {LANGS.map(({ code, countryCode, label }) => (
          <div key={code} className="relative group">
            <button
              onClick={() => setLanguage(code)}
              title={label}
              aria-label={label}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-md transition-all overflow-hidden',
                i18n.language === code
                  ? 'opacity-100 brightness-110 scale-110'
                  : 'opacity-40 hover:opacity-75'
              )}
            >
              <ReactCountryFlag countryCode={countryCode} svg style={{ width: '1.5rem', height: '1.5rem', borderRadius: '3px' }} />
            </button>
            <div className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <div className="w-2 h-2 bg-slate-800 rotate-45 mx-auto -mb-1" />
              <div className="bg-slate-800 text-white text-[11px] font-medium px-2 py-1 rounded-md whitespace-nowrap shadow-lg">{label}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <div className="relative group/trigger">
        <button
          onClick={() => setOpen(v => !v)}
          aria-label={current.label}
          className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-white/10 transition-colors"
        >
          <ReactCountryFlag countryCode={current.countryCode} svg style={{ width: '1.25rem', height: '1.25rem', borderRadius: '3px' }} />
        </button>
        {!open && (
          <div className="pointer-events-none absolute right-full mr-2 top-1/2 -translate-y-1/2 z-50 opacity-0 group-hover/trigger:opacity-100 transition-opacity duration-150">
            <div className="bg-slate-800 text-white text-[11px] font-medium px-2 py-1 rounded-md whitespace-nowrap shadow-lg">{current.label}</div>
          </div>
        )}
      </div>

      {open && (
        <div className={cn(
          'absolute right-0 z-50 min-w-[140px] bg-slate-800 border border-slate-700 rounded-xl shadow-xl py-1 overflow-hidden',
          popoverDir === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
        )}>
          {LANGS.map(({ code, countryCode, label }) => (
            <button
              key={code}
              onClick={() => { setLanguage(code); setOpen(false); }}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors',
                i18n.language === code
                  ? 'bg-white/10 text-white font-semibold'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white'
              )}
            >
              <ReactCountryFlag countryCode={countryCode} svg style={{ width: '1.25rem', height: '1.25rem', borderRadius: '3px' }} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
