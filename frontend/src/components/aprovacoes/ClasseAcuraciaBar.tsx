import React from 'react';
import { cn } from '../shared/Common';

interface ClasseAcuraciaItem {
  classe: string;
  acuracia3M: number;
  skuCount: number;
}

interface ClasseAcuraciaBarProps {
  data: ClasseAcuraciaItem[];
  compact?: boolean;
}

export const ClasseAcuraciaBar: React.FC<ClasseAcuraciaBarProps> = ({ data, compact = false }) => {
  if (data.length === 0) {
    return (
      <p className="text-xs text-slate-400 italic px-1">Histórico insuficiente por classe.</p>
    );
  }

  return (
    <div className={cn('space-y-2', compact ? 'space-y-1.5' : 'space-y-2')}>
      {data.map((item) => (
        <div key={item.classe} className="flex items-center gap-2">
          <span className={cn(
            'font-mono font-bold shrink-0 text-center bg-slate-100 text-slate-600 rounded',
            compact ? 'text-[9px] px-1 py-0.5 w-6' : 'text-[10px] px-1.5 py-0.5 w-7'
          )}>
            {item.classe}
          </span>
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                item.acuracia3M >= 90 ? 'bg-emerald-500' :
                item.acuracia3M >= 75 ? 'bg-amber-500'   : 'bg-red-500'
              )}
              style={{ width: `${Math.min(item.acuracia3M, 100)}%` }}
            />
          </div>
          <span className={cn(
            'shrink-0 font-bold tabular-nums',
            compact ? 'text-[10px]' : 'text-xs',
            item.acuracia3M >= 90 ? 'text-emerald-600' :
            item.acuracia3M >= 75 ? 'text-amber-600'   : 'text-red-600'
          )}>
            {item.acuracia3M.toFixed(0)}%
          </span>
          <span className={cn(
            'shrink-0 text-slate-400',
            compact ? 'text-[9px]' : 'text-[10px]'
          )}>
            {item.skuCount} SKU{item.skuCount !== 1 ? 's' : ''}
          </span>
        </div>
      ))}
    </div>
  );
};
