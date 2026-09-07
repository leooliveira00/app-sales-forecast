import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { HelpCircle, X } from 'lucide-react';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── InfoTooltip ───────────────────────────────────────────────────────────────
// Ícone "?" com tooltip via Portal (position:fixed) — escapa de qualquer
// contexto overflow:hidden/auto, sem clipping em tabelas ou panels.
// Posicionamento clampeado ao viewport para não cortar em mobile.

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

const TOOLTIP_OFFSET = 8;
const VIEWPORT_MARGIN = 8;

// Converte classe Tailwind w-* em px para cálculo de clamp
const tailwindWidthPx = (cls: string): number => {
  const map: Record<string, number> = {
    'w-40': 160, 'w-44': 176, 'w-48': 192, 'w-52': 208,
    'w-56': 224, 'w-60': 240, 'w-64': 256, 'w-72': 288,
    'w-80': 320, 'w-96': 384,
  };
  return map[cls] ?? 224;
};

export const InfoTooltip: React.FC<{
  text: string;
  position?: TooltipPosition;
  width?: string;
  textSize?: string;
}> = ({ text, position = 'top', width = 'w-56', textSize = 'text-[10px]' }) => {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords]   = useState({ top: 0, left: 0, transformY: '-100%' });

  const compute = useCallback((el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const vw   = window.innerWidth;
    const vh   = window.innerHeight;
    const tipW = Math.min(tailwindWidthPx(width), vw - VIEWPORT_MARGIN * 2);
    let top = 0;
    let left = 0;
    let transformY = '-100%';

    if (position === 'top' || position === 'bottom') {
      const centered = rect.left + rect.width / 2 - tipW / 2;
      left = Math.max(VIEWPORT_MARGIN, Math.min(centered, vw - tipW - VIEWPORT_MARGIN));
      if (position === 'top') {
        top = rect.top - TOOLTIP_OFFSET;
        transformY = '-100%';
        // Se não cabe em cima, vai para baixo
        if (top - 60 < 0) { top = rect.bottom + TOOLTIP_OFFSET; transformY = '0%'; }
      } else {
        top = rect.bottom + TOOLTIP_OFFSET;
        transformY = '0%';
        if (top + 60 > vh) { top = rect.top - TOOLTIP_OFFSET; transformY = '-100%'; }
      }
    } else if (position === 'left') {
      top  = rect.top + rect.height / 2;
      left = Math.max(VIEWPORT_MARGIN, rect.left - tipW - TOOLTIP_OFFSET);
      transformY = '-50%';
    } else {
      top  = rect.top + rect.height / 2;
      left = Math.min(rect.right + TOOLTIP_OFFSET, vw - tipW - VIEWPORT_MARGIN);
      transformY = '-50%';
    }

    setCoords({ top, left, transformY });
    setVisible(true);
  }, [position, width]);

  const handleMouseEnter = useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    compute(e.currentTarget as HTMLElement);
  }, [compute]);

  const handleMouseLeave = useCallback(() => setVisible(false), []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    if (visible) { setVisible(false); return; }
    compute(e.currentTarget as HTMLElement);
  }, [visible, compute]);

  const arrowLeft = coords.left === VIEWPORT_MARGIN || coords.left >= window.innerWidth - tailwindWidthPx(width) - VIEWPORT_MARGIN
    ? undefined
    : '50%';

  const tooltip = visible ? createPortal(
    <div
      style={{
        position:      'fixed',
        top:           coords.top,
        left:          coords.left,
        transform:     `translateY(${coords.transformY})`,
        zIndex:        9999,
        pointerEvents: 'none',
        maxWidth:      `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
        width:         tailwindWidthPx(width),
      }}
      className={cn(
        'px-3 py-2 leading-relaxed text-white bg-slate-800 rounded-lg shadow-xl',
        textSize,
      )}
    >
      {text}
    </div>,
    document.body
  ) : null;

  return (
    <>
      <span
        className="inline-flex items-center shrink-0 cursor-help"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        <HelpCircle className="w-3 h-3 text-slate-300 hover:text-slate-500 transition-colors" />
      </span>
      {tooltip}
    </>
  );
};

export const DeltaBadge: React.FC<{ value: number }> = ({ value }) => {
  const isPositive = value > 0;
  const isZero = value === 0;

  return (
    <span className={cn(
      'inline-flex items-center font-medium text-xs',
      isPositive ? 'text-emerald-600' : isZero ? 'text-slate-500' : 'text-red-600'
    )}>
      {isPositive ? '↑' : isZero ? '' : '↓'} {Math.abs(value).toFixed(1)}%
    </span>
  );
};

export const MargemBadge: React.FC<{ pct: number }> = ({ pct }) => {
  let colorClass = 'bg-red-50 text-red-600 border-red-200';
  if (pct >= 40) colorClass = 'bg-emerald-50 text-emerald-600 border-emerald-200';
  else if (pct >= 25) colorClass = 'bg-amber-50 text-amber-600 border-amber-200';

  return (
    <span className={cn(
      'px-2 py-0.5 rounded text-xs font-mono border',
      colorClass
    )}>
      {pct.toFixed(1)}%
    </span>
  );
};

export const InfoModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: string;
}> = ({ isOpen, onClose, title, subtitle, children, maxWidth = 'max-w-2xl' }) => {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className={cn('bg-white rounded-2xl shadow-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200', maxWidth)}>
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors ml-4 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto max-h-[80vh]">
          {children}
        </div>
      </div>
    </div>
  );
};

export const ConfirmModal: React.FC<{
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
}> = ({ isOpen, title, message, onConfirm, onCancel, confirmText = 'Confirmar', cancelText = 'Cancelar', isDanger }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-2">{title}</h3>
          <p className="text-slate-600">{message}</p>
        </div>
        <div className="bg-slate-50 p-4 flex justify-end gap-3">
          <button 
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            {cancelText}
          </button>
          <button 
            onClick={onConfirm}
            className={cn(
              "px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors",
              isDanger ? "bg-red-600 hover:bg-red-700" : "bg-sky-600 hover:bg-sky-700"
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export const EmptyState: React.FC<{ icon: React.ReactNode; title: string; message: string }> = ({ icon, title, message }) => (
  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 mb-4">
      {icon}
    </div>
    <h3 className="text-lg font-medium text-slate-900 mb-1">{title}</h3>
    <p className="text-slate-500 max-w-xs">{message}</p>
  </div>
);

export const LoadingSkeleton: React.FC<{ type: 'table' | 'card' }> = ({ type }) => {
  if (type === 'card') {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 animate-pulse">
        <div className="h-4 bg-slate-200 rounded w-1/3 mb-4"></div>
        <div className="h-8 bg-slate-200 rounded w-1/2 mb-2"></div>
        <div className="h-4 bg-slate-200 rounded w-full"></div>
      </div>
    );
  }

  return (
    <div className="w-full animate-pulse">
      <div className="h-10 bg-slate-100 rounded mb-4"></div>
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="h-12 bg-slate-50 rounded mb-2"></div>
      ))}
    </div>
  );
};
