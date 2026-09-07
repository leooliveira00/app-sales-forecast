import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight as ChevronRightIcon, Trash2, BarChart2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../shared/Common';
import { fmt } from '../../types/forecast';
import type { ForecastItem } from '../../types/forecast';
import { BulkActionBar } from './BulkActionBar';
import { NacionalFamilyRows } from './NacionalFamilyRows';
import { ExportFamilyRows } from './ExportFamilyRows';
import { FamilySalesDetail } from './FamilySalesDetail';

interface UnitPais {
  iso3: string;
  nome: string;
}

interface FamilyGroupProps {
  familia: string;
  items: ForecastItem[];
  isExport: boolean;
  unitPaises: UnitPais[];
  isReadOnly: boolean;
  collapsed: boolean;
  onToggle: () => void;
  fcts: Record<string, string>;
  setFcts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  initialFcts: React.MutableRefObject<Record<string, string>>;
  saveFCTS: (itemId: string) => void;
  savingId: string | null;
  onBulkApplyPercent: (items: ForecastItem[], pct: number) => void;
  onBulkSetValue: (items: ForecastItem[], value: number) => void;
  onBulkCopyPrevious: (items: ForecastItem[]) => void;
  hasPrevious: boolean;
  onExclude: (item: ForecastItem) => void;
  onExcludeFamily: (items: ForecastItem[]) => void;
  onRestore: (item: ForecastItem) => void;
}

export const FamilyGroup: React.FC<FamilyGroupProps> = ({
  familia, items, isExport, unitPaises, isReadOnly, collapsed, onToggle,
  fcts, setFcts, initialFcts, saveFCTS, savingId,
  onBulkApplyPercent, onBulkSetValue, onBulkCopyPrevious, hasPrevious,
  onExclude, onExcludeFamily, onRestore,
}) => {
  const { t } = useTranslation('forecast');
  const [showFamilyDetail, setShowFamilyDetail] = useState(false);

  const familyAggregated = useMemo(() => {
    const salesMap = new Map<string, number>();
    const orcMap   = new Map<string, number>();
    for (const item of items) {
      item.salesHistory.forEach(h => salesMap.set(h.month, (salesMap.get(h.month) ?? 0) + h.qty));
      item.orcHistory.forEach(o => orcMap.set(o.month, (orcMap.get(o.month) ?? 0) + o.volumeORC));
    }
    const salesHistory = [...salesMap.entries()].sort().map(([month, qty]) => ({ month, qty }));
    const orcHistory   = [...orcMap.entries()].sort().map(([month, volumeORC]) => ({ month, volumeORC }));

    const last3  = salesHistory.slice(-3);
    const last6  = salesHistory.slice(-6);
    const avg = (arr: { qty: number }[]) =>
      arr.length ? Math.round(arr.reduce((s, h) => s + h.qty, 0) / arr.length) : null;

    return {
      salesHistory,
      orcHistory,
      avgTrim: avg(last3),
      avgSem:  avg(last6),
      avg12m:  avg(salesHistory),
    };
  }, [items]);

  // Funciona para NACIONAL e EXPORT: cada item tem seu próprio volumeORC e override
  const groupORC  = items.reduce((s, i) => s + (i.volumeORC ?? 0), 0);
  const groupFCTS = items.reduce((s, i) => {
    const v = Number(fcts[i.id] ?? i.overrides[0]?.volumeFCTS ?? '');
    return s + (isNaN(v) ? 0 : v);
  }, 0);

  const desvioGrupo = groupORC > 0 ? ((groupFCTS / groupORC - 1) * 100) : null;

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden mb-2">
      <div
        className="flex items-center gap-3 px-4 py-3 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors select-none"
        onClick={onToggle}
      >
        <div className="shrink-0 text-slate-400">
          {collapsed
            ? <ChevronRightIcon className="w-4 h-4" />
            : <ChevronDown      className="w-4 h-4" />}
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-bold text-slate-800 text-sm truncate">{familia}</span>
          <span className="text-[10px] font-bold text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded-full shrink-0">
            {items.length} SKU{items.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setShowFamilyDetail(v => !v); }}
            title="Resumo analítico da família"
            className={cn(
              "p-1 rounded transition-colors shrink-0",
              showFamilyDetail
                ? "text-sky-500 bg-sky-100"
                : "text-slate-400 hover:text-sky-500"
            )}
          >
            <BarChart2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-4 text-xs text-slate-500 shrink-0">
          <span>{t('columns.orc')} <span className="font-bold text-slate-700">{fmt(groupORC)}</span></span>
          <span>{t('columns.fcts')} <span className={cn(
            "font-bold",
            groupFCTS > 0 ? "text-slate-900" : "text-slate-400"
          )}>{groupFCTS > 0 ? fmt(groupFCTS) : '—'}</span></span>
          {desvioGrupo !== null && groupFCTS > 0 && (
            <span className={cn(
              "font-bold px-1.5 py-0.5 rounded text-[10px]",
              Math.abs(desvioGrupo) <= 5 ? "bg-emerald-100 text-emerald-700" :
              Math.abs(desvioGrupo) <= 15 ? "bg-amber-100 text-amber-700" :
                                             "bg-red-100 text-red-700"
            )}>
              {desvioGrupo > 0 ? '+' : ''}{desvioGrupo.toFixed(1)}%
            </span>
          )}
        </div>

        {!isReadOnly && (
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <BulkActionBar
              familiaItems={items}
              isExport={isExport}
              fcts={fcts}
              onApplyPercent={onBulkApplyPercent}
              onSetValue={onBulkSetValue}
              onCopyPrevious={onBulkCopyPrevious}
              hasPrevious={hasPrevious}
            />
            <button
              title="Excluir família do ciclo"
              onClick={() => onExcludeFamily(items)}
              className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {showFamilyDetail && (
        <FamilySalesDetail
          label={`${familia} — ${items.length} SKU${items.length !== 1 ? 's' : ''}`}
          avgTrim={familyAggregated.avgTrim}
          avgSem={familyAggregated.avgSem}
          avg12m={familyAggregated.avg12m}
          salesHistory={familyAggregated.salesHistory}
          orcHistory={familyAggregated.orcHistory}
          fcts={groupFCTS > 0 ? groupFCTS : null}
        />
      )}

      {!collapsed && (
        <div className="overflow-x-auto">
          {isExport
            ? <ExportFamilyRows
                items={items}
                fcts={fcts}
                setFcts={setFcts}
                initialFcts={initialFcts}
                saveFCTS={saveFCTS}
                savingId={savingId}
                isReadOnly={isReadOnly}
                onExclude={onExclude}
                onRestore={onRestore}
              />
            : <NacionalFamilyRows
                items={items}
                fcts={fcts}
                setFcts={setFcts}
                initialFcts={initialFcts}
                saveFCTS={saveFCTS}
                savingId={savingId}
                isReadOnly={isReadOnly}
                onExclude={onExclude}
                onRestore={onRestore}
              />
          }
        </div>
      )}
    </div>
  );
};
