import React from 'react';
import { cn } from '../shared/Common';

// ── Configuração de status ────────────────────────────────────────────────────

export const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  APPROVED:  { label: 'Aprovado',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  SUBMITTED: { label: 'Pendente',  cls: 'bg-amber-50   text-amber-700  border-amber-200'   },
  REJECTED:  { label: 'Rejeitado', cls: 'bg-red-50     text-red-700    border-red-200'     },
  DRAFT:     { label: 'Rascunho',  cls: 'bg-slate-100  text-slate-500  border-slate-200'   },
};

// ── Badges ────────────────────────────────────────────────────────────────────

/**
 * Exibe a variação percentual entre v e base.
 * Assinatura intencional: recebe os dois valores brutos para calcular o delta internamente.
 */
export const DeltaBadge: React.FC<{ v: number; base: number }> = ({ v, base }) => {
  const d = base !== 0 ? ((v / base) - 1) * 100 : 0;
  const cls = d >= 0 ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50';
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-bold', cls)}>
      {d >= 0 ? '+' : ''}{d.toFixed(1)}%
    </span>
  );
};

export const StatusBadge: React.FC<{ status: string | null }> = ({ status }) => {
  if (!status) return <span className="text-xs text-slate-300">—</span>;
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.DRAFT;
  return (
    <span className={cn('px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase', cfg.cls)}>
      {cfg.label}
    </span>
  );
};
