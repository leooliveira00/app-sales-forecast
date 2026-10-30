/**
 * Badge de desvio percentual (+/-) colorido por faixa.
 */
import React from 'react';
import { cn } from '../../shared/Common';

export const DesvioTag: React.FC<{ value: number }> = ({ value }) => (
  <span className={cn(
    "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
    Math.abs(value) <= 5  ? "bg-emerald-100 text-emerald-700" :
    Math.abs(value) <= 15 ? "bg-amber-100 text-amber-700"    :
                             "bg-red-100 text-red-700"
  )}>
    {value > 0 ? '+' : ''}{value.toFixed(1)}%
  </span>
);
