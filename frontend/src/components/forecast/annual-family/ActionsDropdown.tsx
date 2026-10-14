/**
 * Menu de ações em lote de uma família/produto: aceitar IA, média por critério, valor fixo,
 * distribuir total, percentual sobre IA/ORC e reverter — com entrada inline e portal.
 */
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, RotateCcw, Zap, Sparkles } from 'lucide-react';
import { cn } from '../../shared/Common';
import type { DistributeCriterion } from '../../../hooks/useAnnualForecastData';
import { CRITERIA_LABELS_KEYS } from './helpers';

// ── Actions dropdown ──────────────────────────────────────────────────────────

type InlineMode = 'value' | 'distribute' | 'percent' | null;

interface ActionsDropdownProps {
  hasIA:                  boolean;
  isExportAllCountries:   boolean;
  onPreviewAcceptIA:   () => void;
  onPreviewFillAvg:    (c: 'trim' | 'sem' | '12m' | 'aa') => void;
  onPreviewSetValue:   (v: number) => void;
  onPreviewDistribute: (total: number, c: DistributeCriterion) => void;
  onPreviewApplyPct:   (pct: number, basis: 'IA' | 'ORC') => void;
  onPreviewRevert:     () => void;
}

export const ActionsDropdown: React.FC<ActionsDropdownProps> = ({
  hasIA, isExportAllCountries,
  onPreviewAcceptIA, onPreviewFillAvg, onPreviewSetValue,
  onPreviewDistribute, onPreviewApplyPct, onPreviewRevert,
}) => {
  const { t } = useTranslation('forecast');
  const [open,        setOpen]        = useState(false);
  const [inlineMode,  setInlineMode]  = useState<InlineMode>(null);
  const [valueInput,  setValueInput]  = useState('');
  const [pctInput,    setPctInput]    = useState('');
  const [pctBasis,    setPctBasis]    = useState<'IA' | 'ORC'>('IA');
  const [distTotal,   setDistTotal]   = useState('');
  const [distCrit,    setDistCrit]    = useState<DistributeCriterion>('aa');
  const [dropPos,     setDropPos]     = useState<{ top?: number; bottom?: number; right: number } | null>(null);

  const triggerRef  = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setOpen(false);
        setInlineMode(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const right = window.innerWidth - rect.right;
      const APPROX_HEIGHT = 420;
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow >= APPROX_HEIGHT || spaceBelow >= rect.top) {
        setDropPos({ top: rect.bottom + 4, right });
      } else {
        setDropPos({ bottom: window.innerHeight - rect.top + 4, right });
      }
    }
    setOpen(v => !v);
    setInlineMode(null);
  };

  const close = () => { setOpen(false); setInlineMode(null); };

  const menuItem = (
    label: React.ReactNode,
    onClick: () => void,
    disabled = false,
    tooltip?: string,
  ) => (
    <button
      disabled={disabled}
      title={tooltip}
      onClick={() => { if (!disabled) { onClick(); } }}
      className={cn(
        'w-full text-left px-4 py-1.5 text-xs hover:bg-slate-50 transition-colors',
        disabled ? 'opacity-40 cursor-not-allowed' : 'text-slate-700 cursor-pointer',
      )}
    >
      {label}
    </button>
  );

  const section = (label: string) => (
    <div className="px-4 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-t border-slate-100 mt-1 pt-2">
      {label}
    </div>
  );

  return (
    <div onClick={e => e.stopPropagation()}>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className={cn(
          'flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors',
          open
            ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
            : 'bg-white text-emerald-600 border-emerald-200 hover:bg-emerald-50',
        )}
      >
        <Zap className="w-3 h-3" />
        {t('contextMenu.actions')}
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && dropPos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', ...dropPos }}
          className="w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-[200] py-1.5"
          onClick={e => e.stopPropagation()}
        >

          {/* Aceitar sugestão IA */}
          {menuItem(
            <span className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              {t('contextMenu.acceptIA')}
              {!hasIA && <span className="ml-auto text-[9px] text-slate-300">{t('contextMenu.noIAData')}</span>}
            </span>,
            () => { onPreviewAcceptIA(); close(); },
            !hasIA,
            t('contextMenu.acceptIAHint'),
          )}

          {section(t('contextMenu.fillWith'))}

          {menuItem(t('contextMenu.fillAvg3'), () => { onPreviewFillAvg('trim'); close(); }, isExportAllCountries,
            isExportAllCountries ? t('contextMenu.requiresCountryFilter') : t('contextMenu.fillAvg3Hint'))}
          {menuItem(t('contextMenu.fillAvg6'), () => { onPreviewFillAvg('sem');  close(); }, isExportAllCountries,
            isExportAllCountries ? t('contextMenu.requiresCountryFilter') : t('contextMenu.fillAvg6Hint'))}
          {menuItem(t('contextMenu.fillAvg12'), () => { onPreviewFillAvg('12m'); close(); }, isExportAllCountries,
            isExportAllCountries ? t('contextMenu.requiresCountryFilter') : t('contextMenu.fillAvg12Hint'))}
          {menuItem(t('contextMenu.fillYoY'), () => { onPreviewFillAvg('aa'); close(); }, isExportAllCountries,
            isExportAllCountries ? t('contextMenu.requiresCountryFilter') : t('contextMenu.fillYoYHint'))}

          {/* Valor fixo inline */}
          <div className="px-4 py-1">
            {inlineMode === 'value' ? (
              <div className="space-y-1.5 mt-0.5 mb-1">
                <input
                  autoFocus
                  type="number" min="0"
                  className="w-full text-xs px-2 py-1 border border-sky-300 rounded-lg outline-none focus:ring-1 focus:ring-sky-400"
                  value={valueInput}
                  placeholder={t('contextMenu.fixedValuePlaceholder')}
                  onChange={e => setValueInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const v = parseInt(valueInput, 10);
                      if (!isNaN(v) && v >= 0) { onPreviewSetValue(v); setValueInput(''); close(); }
                    }
                    if (e.key === 'Escape') setInlineMode(null);
                  }}
                />
                <button
                  onClick={() => {
                    const v = parseInt(valueInput, 10);
                    if (!isNaN(v) && v >= 0) { onPreviewSetValue(v); setValueInput(''); close(); }
                  }}
                  className="w-full text-[10px] font-bold text-emerald-600 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors"
                >
                  {t('contextMenu.viewPreview')}
                </button>
              </div>
            ) : (
              <button
                title={t('contextMenu.fixedValueHint')}
                onClick={() => setInlineMode('value')}
                className="w-full text-left text-xs text-slate-700 hover:text-emerald-600 py-0.5 transition-colors"
              >
                {t('contextMenu.fixedValueBtn')}
              </button>
            )}
          </div>

          {section(t('contextMenu.distribution'))}

          {/* Distribuir total inline */}
          <div className="px-4 py-1">
            {inlineMode === 'distribute' ? (
              <div className="space-y-1.5 mb-1">
                <input
                  autoFocus
                  type="number" min="0"
                  className="w-full text-xs px-2 py-1 border border-violet-300 rounded-lg outline-none focus:ring-1 focus:ring-violet-400"
                  value={distTotal}
                  placeholder={t('contextMenu.distributePlaceholder')}
                  onChange={e => setDistTotal(e.target.value)}
                />
                <select
                  value={isExportAllCountries && distCrit === 'aa' ? 'orc' : distCrit}
                  onChange={e => setDistCrit(e.target.value as DistributeCriterion)}
                  className="w-full text-xs px-2 py-1 border border-violet-300 rounded-lg outline-none bg-white focus:ring-1 focus:ring-violet-400 cursor-pointer"
                >
                  {(Object.entries(CRITERIA_LABELS_KEYS) as [DistributeCriterion, string][])
                    .filter(([k]) => !(isExportAllCountries && k === 'aa'))
                    .map(([k, v]) => (
                      <option key={k} value={k}>{t(v)}</option>
                    ))}
                </select>
                {isExportAllCountries && (
                  <p className="text-[10px] text-amber-600">{t('contextMenu.distributeAaRequiresCountry')}</p>
                )}
                <button
                  onClick={() => {
                    const total = parseInt(distTotal, 10);
                    if (!isNaN(total) && total > 0) { onPreviewDistribute(total, distCrit); setDistTotal(''); close(); }
                  }}
                  className="w-full text-[10px] font-bold text-emerald-600 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors"
                >
                  {t('contextMenu.viewPreview')}
                </button>
              </div>
            ) : (
              <button
                title={t('contextMenu.distributeTotalHint')}
                onClick={() => setInlineMode('distribute')}
                className="w-full text-left text-xs text-slate-700 hover:text-emerald-600 py-0.5 transition-colors"
              >
                {t('contextMenu.distributeTotalBtn')}
              </button>
            )}
          </div>

          {/* Ajustar % inline */}
          <div className="px-4 py-1">
            {inlineMode === 'percent' ? (
              <div className="space-y-1.5 mb-1">
                {/* Seletor de base */}
                <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setPctBasis('IA')}
                    disabled={!hasIA}
                    title={hasIA ? t('contextMenu.applyPctOver') : t('contextMenu.noIAData')}
                    className={cn(
                      'flex-1 px-2 py-1 transition-colors',
                      pctBasis === 'IA' && hasIA
                        ? 'bg-violet-600 text-white'
                        : !hasIA
                          ? 'bg-slate-50 text-slate-300 cursor-not-allowed'
                          : 'bg-white text-slate-500 hover:bg-slate-50',
                    )}
                  >
                    {t('contextMenu.basisIA')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPctBasis('ORC')}
                    title={`${t('contextMenu.applyPctOver')} ${t('columns.orc')}`}
                    className={cn(
                      'flex-1 px-2 py-1 border-l border-slate-200 transition-colors',
                      pctBasis === 'ORC'
                        ? 'bg-sky-600 text-white'
                        : 'bg-white text-slate-500 hover:bg-slate-50',
                    )}
                  >
                    {t('contextMenu.basisORC')}
                  </button>
                </div>
                <input
                  autoFocus
                  type="number"
                  className="w-full text-xs px-2 py-1 border border-emerald-300 rounded-lg outline-none focus:ring-1 focus:ring-emerald-400"
                  value={pctInput}
                  placeholder={t('contextMenu.pctPlaceholder')}
                  onChange={e => setPctInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const p = parseFloat(pctInput);
                      if (!isNaN(p)) { onPreviewApplyPct(p, pctBasis); setPctInput(''); close(); }
                    }
                    if (e.key === 'Escape') setInlineMode(null);
                  }}
                />
                <button
                  onClick={() => {
                    const p = parseFloat(pctInput);
                    if (!isNaN(p)) { onPreviewApplyPct(p, pctBasis); setPctInput(''); close(); }
                  }}
                  className="w-full text-[10px] font-bold text-emerald-600 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors"
                >
                  {t('contextMenu.viewPreview')}
                </button>
              </div>
            ) : (
              <button
                title={t('contextMenu.applyPctHint')}
                onClick={() => {
                  if (!hasIA) setPctBasis('ORC');
                  setInlineMode('percent');
                }}
                className="w-full text-left text-xs text-slate-700 hover:text-emerald-600 py-0.5 transition-colors"
              >
                {t('contextMenu.applyPctBtn')}
              </button>
            )}
          </div>

          {section(t('contextMenu.other'))}

          {menuItem(
            <span className="flex items-center gap-2 text-amber-700">
              <RotateCcw className="w-3.5 h-3.5 shrink-0" />
              {t('contextMenu.revertChanges')}
            </span>,
            () => { onPreviewRevert(); close(); },
            false,
            t('contextMenu.revertChangesHint'),
          )}
        </div>,
        document.body,
      )}
    </div>
  );
};
