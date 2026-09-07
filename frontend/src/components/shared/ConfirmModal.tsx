import React from 'react';
import { AlertTriangle, CheckCircle2, Trash2, X } from 'lucide-react';
import { cn } from './Common';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type ConfirmVariant = 'danger' | 'warning' | 'primary';

export interface ConfirmModalProps {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// ── Configuração por variante ─────────────────────────────────────────────────

const VARIANT_CFG: Record<ConfirmVariant, {
  icon: React.ReactNode;
  iconBg: string;
  btn: string;
}> = {
  danger: {
    icon:   <Trash2 className="w-5 h-5" />,
    iconBg: 'bg-red-50 text-red-600',
    btn:    'bg-red-600 hover:bg-red-700 shadow-red-600/20',
  },
  warning: {
    icon:   <AlertTriangle className="w-5 h-5" />,
    iconBg: 'bg-amber-50 text-amber-600',
    btn:    'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20',
  },
  primary: {
    icon:   <CheckCircle2 className="w-5 h-5" />,
    iconBg: 'bg-emerald-50 text-emerald-600',
    btn:    'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20',
  },
};

// ── Componente ────────────────────────────────────────────────────────────────

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel  = 'Cancelar',
  variant      = 'primary',
  loading      = false,
  onConfirm,
  onCancel,
}) => {
  const cfg = VARIANT_CFG[variant];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">

        {/* Cabeçalho */}
        <div className="flex items-start gap-3 px-6 pt-6 pb-4">
          <div className={cn('p-2 rounded-xl shrink-0', cfg.iconBg)}>
            {cfg.icon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-slate-900 text-base">{title}</h3>
            {message && (
              <p className="text-sm text-slate-500 mt-1 leading-relaxed">{message}</p>
            )}
          </div>
          <button
            onClick={onCancel}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-end gap-3 px-6 pb-6">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              'flex items-center gap-2 px-5 py-2 text-sm font-bold text-white rounded-xl transition-all shadow-lg disabled:opacity-50',
              cfg.btn,
            )}
          >
            {loading && (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            {loading ? 'Aguarde...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};