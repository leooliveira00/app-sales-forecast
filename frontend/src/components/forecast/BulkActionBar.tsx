import React, { useState, useEffect, useRef } from 'react';
import { Percent, Hash, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ForecastItem } from '../../types/forecast';

interface BulkActionBarProps {
  familiaItems: ForecastItem[];
  isExport: boolean;
  fcts: Record<string, string>;
  onApplyPercent: (items: ForecastItem[], pct: number) => void;
  onSetValue: (items: ForecastItem[], value: number) => void;
  onCopyPrevious: (items: ForecastItem[]) => void;
  hasPrevious: boolean;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  familiaItems, isExport, fcts, onApplyPercent, onSetValue, onCopyPrevious, hasPrevious,
}) => {
  const { t } = useTranslation('forecast');
  const [pctInput, setPctInput]     = useState('');
  const [valueInput, setValueInput] = useState('');
  const [showPct, setShowPct]       = useState(false);
  const [showVal, setShowVal]       = useState(false);
  const pctRef = useRef<HTMLInputElement>(null);
  const valRef = useRef<HTMLInputElement>(null);

  const handlePct = () => {
    const n = parseFloat(pctInput);
    if (isNaN(n)) return;
    onApplyPercent(familiaItems, n);
    setPctInput('');
    setShowPct(false);
  };

  const handleVal = () => {
    const n = parseInt(valueInput, 10);
    if (isNaN(n) || n < 0) return;
    onSetValue(familiaItems, n);
    setValueInput('');
    setShowVal(false);
  };

  useEffect(() => { if (showPct) pctRef.current?.focus(); }, [showPct]);
  useEffect(() => { if (showVal) valRef.current?.focus(); }, [showVal]);

  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {showPct ? (
        <div className="flex items-center gap-1">
          <input
            ref={pctRef}
            type="number"
            className="w-16 text-center px-2 py-0.5 border border-violet-300 rounded text-xs outline-none focus:ring-1 focus:ring-violet-400"
            value={pctInput}
            onChange={(e) => setPctInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handlePct(); if (e.key === 'Escape') setShowPct(false); }}
            placeholder="%"
          />
          <button onClick={handlePct} className="text-[10px] font-bold text-violet-600 hover:text-violet-800 px-1">OK</button>
          <button onClick={() => setShowPct(false)} className="text-[10px] text-slate-400 hover:text-slate-600">✕</button>
        </div>
      ) : (
        <button
          onClick={() => { setShowVal(false); setShowPct(true); }}
          className="flex items-center gap-1 text-[10px] font-bold text-violet-600 hover:text-violet-800 border border-violet-200 hover:border-violet-400 px-2 py-0.5 rounded transition-colors bg-violet-50 hover:bg-violet-100"
          title={isExport ? t('bulk.applyPctTitle') : t('bulk.applyPctTitleProducts')}
        >
          <Percent className="w-2.5 h-2.5" /> {t('bulk.applyPct')}
        </button>
      )}

      {showVal ? (
        <div className="flex items-center gap-1">
          <input
            ref={valRef}
            type="number" min="0"
            className="w-20 text-center px-2 py-0.5 border border-sky-300 rounded text-xs outline-none focus:ring-1 focus:ring-sky-400"
            value={valueInput}
            onChange={(e) => setValueInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleVal(); if (e.key === 'Escape') setShowVal(false); }}
            placeholder="volume"
          />
          <button onClick={handleVal} className="text-[10px] font-bold text-sky-600 hover:text-sky-800 px-1">OK</button>
          <button onClick={() => setShowVal(false)} className="text-[10px] text-slate-400 hover:text-slate-600">✕</button>
        </div>
      ) : (
        <button
          onClick={() => { setShowPct(false); setShowVal(true); }}
          className="flex items-center gap-1 text-[10px] font-bold text-sky-600 hover:text-sky-800 border border-sky-200 hover:border-sky-400 px-2 py-0.5 rounded transition-colors bg-sky-50 hover:bg-sky-100"
          title={t('bulk.setValueTitle')}
        >
          <Hash className="w-2.5 h-2.5" /> {t('bulk.setValue')}
        </button>
      )}

      {hasPrevious && (
        <button
          onClick={() => onCopyPrevious(familiaItems)}
          className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 hover:text-emerald-800 border border-emerald-200 hover:border-emerald-400 px-2 py-0.5 rounded transition-colors bg-emerald-50 hover:bg-emerald-100"
          title={t('bulk.copyPrevTitle')}
        >
          <Copy className="w-2.5 h-2.5" /> {t('bulk.copyPrev')}
        </button>
      )}
    </div>
  );
};
