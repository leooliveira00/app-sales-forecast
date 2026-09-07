import React from 'react';
import { cn } from '../shared/Common';
import { DeltaBadge } from './ConsolidadoBadges';

const fmt = (v: number) => new Intl.NumberFormat('pt-BR').format(v);

interface UnidadeItem {
  codigo: string;
  descricao: string;
  tipo?: string;
  orcAnual: number;
  fctsAnual: number;
  vendasAnual: number;
  latestCycleFcts: number;
  prevCycleFcts: number;
  vendaAA?: number | null;
  fctsForDesvio?: number | null;
}

interface AcuraciaItem {
  acuracia: number;
}

interface DivisaoCardListProps {
  unidades: UnidadeItem[];
  acuraciaMap: Map<string, AcuraciaItem>;
  isLoadingAcuracia: boolean;
}

const DeltaCicloBadge: React.FC<{ latest: number; prev: number }> = ({ latest, prev }) => {
  if (prev <= 0 || latest <= 0) return <span className="text-slate-300 text-xs">—</span>;
  const value = ((latest / prev) - 1) * 100;
  return (
    <span className={cn(
      'text-xs font-bold',
      Math.abs(value) <= 10 ? 'text-emerald-600' :
      Math.abs(value) <= 25 ? 'text-amber-600'   : 'text-red-600',
    )}>
      {value > 0 ? '+' : ''}{value.toFixed(1)}%
    </span>
  );
};

const AcuraciaBadge: React.FC<{ acuracia: number | null; loading: boolean }> = ({ acuracia, loading }) => {
  if (loading) return <span className="inline-block w-8 h-3 bg-slate-100 rounded animate-pulse" />;
  if (acuracia === null) return <span className="text-slate-300 text-xs">—</span>;
  return (
    <span className={cn(
      'text-xs font-bold tabular-nums',
      acuracia >= 90 ? 'text-emerald-600' :
      acuracia >= 75 ? 'text-amber-600'   : 'text-red-600',
    )}>
      {acuracia.toFixed(1)}%
    </span>
  );
};

export const DivisaoCardList: React.FC<DivisaoCardListProps> = ({
  unidades,
  acuraciaMap,
  isLoadingAcuracia,
}) => {
  return (
    <div className="divide-y divide-slate-100">
      {unidades.map((u) => {
        const acuraciaU = acuraciaMap.get(u.codigo);
        return (
          <div key={u.codigo} className="px-4 py-4">
            {/* Nome e badge */}
            <div className="flex items-start gap-2 mb-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-bold text-slate-800 leading-tight">{u.descricao}</span>
                  {u.tipo === 'EXPORT' && (
                    <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded-full border border-indigo-100 shrink-0">
                      EXPORT
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-400 font-mono">{u.codigo}</span>
              </div>
            </div>

            {/* Métricas principais — 3 colunas */}
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="bg-slate-50 rounded-xl px-3 py-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">FCST</p>
                <p className="text-sm font-bold text-slate-900 tabular-nums leading-tight">{fmt(u.fctsAnual)}</p>
              </div>
              <div className="bg-slate-50 rounded-xl px-3 py-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Δ FCST/A.A.</p>
                {u.vendaAA != null && u.vendaAA > 0
                  ? <DeltaBadge v={u.fctsForDesvio ?? 0} base={u.vendaAA} />
                  : <span className="text-slate-300 text-xs">—</span>}
              </div>
              <div className="bg-slate-50 rounded-xl px-3 py-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Acurácia</p>
                <AcuraciaBadge acuracia={acuraciaU?.acuracia ?? null} loading={isLoadingAcuracia} />
              </div>
            </div>

            {/* Linha secundária */}
            <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
              <span>ORC <span className="font-mono font-semibold text-slate-700">{fmt(u.orcAnual)}</span></span>
              <span className="text-slate-200">·</span>
              <span>Δ Ciclo <DeltaCicloBadge latest={u.latestCycleFcts} prev={u.prevCycleFcts} /></span>
              <span className="text-slate-200">·</span>
              <span>Vendas YTD <span className="font-mono font-semibold text-emerald-700">{fmt(u.vendasAnual)}</span></span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
