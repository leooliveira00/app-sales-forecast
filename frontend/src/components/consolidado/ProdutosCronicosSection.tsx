import React, { useState, useMemo } from 'react';
import {
  ComposedChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Bug, ChevronDown, ChevronUp, ArrowUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn, InfoTooltip, InfoModal } from '../shared/Common';
import { useFormatter } from '../../hooks/useFormatter';
import { CHART_COLORS } from '../../constants/chartColors';
import { useIsMobile } from '../../hooks/useBreakpoint';

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface ProdutoCronico {
  unidadeVendaId:   string;
  produtoCodigo:    string;
  produtoDescricao: string;
  classe:           string | null;
  familia:          string | null;
  direcao:          'alta' | 'baixa';
  desvioMedio:      number;
  historico: { month: string; fcts: number; vendas: number; desvio: number }[];
}

export interface ProdutosCronicosSectionProps {
  cronicos:          ProdutoCronico[];
  /** Mapa código da unidade → descrição (admin passa; gestor omite → lista flat) */
  unitDescMap?:      Map<string, string>;
  /** Exibe campo de busca textual (default: true) */
  showFilter?:       boolean;
  /** Agrupa por unidade com header colapsável (default: true quando unitDescMap presente) */
  showUnitGrouping?: boolean;
}

// ── Modal de detalhe ──────────────────────────────────────────────────────────

const CronicoModal: React.FC<{
  cronico:  ProdutoCronico | null;
  onClose:  () => void;
}> = ({ cronico, onClose }) => {
  const { t } = useTranslation('consolidado');
  const { fmt, locale } = useFormatter();
  const isMobile = useIsMobile();
  if (!cronico) return null;
  const hist    = cronico.historico;
  const salesLabel = t('cronicos.tableHeaders.sales');
  const achievLabel = t('cronicos.tableHeaders.achievement');
  const chartData = hist.map(h => ({
    name:        new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(new Date(h.month).getUTCFullYear(), new Date(h.month).getUTCMonth(), 1))),
    FCTS:        h.fcts,
    Vendas:      h.vendas,
    Atingimento: h.fcts > 0 ? +(h.vendas / h.fcts * 100).toFixed(1) : null,
  }));
  const hf = hist.filter(h => h.fcts > 0);
  const atingMedio = hf.length > 0
    ? hf.reduce((s, h) => s + h.vendas / h.fcts * 100, 0) / hf.length
    : null;

  return (
    <InfoModal
      isOpen={!!cronico}
      onClose={onClose}
      title={cronico.produtoDescricao}
      subtitle={`${cronico.produtoCodigo} · ${cronico.unidadeVendaId}${cronico.familia ? ` · ${cronico.familia}` : ''}`}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={cn('text-sm font-bold px-3 py-1 rounded-full',
            cronico.direcao === 'alta' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700',
          )}>
            {cronico.direcao === 'alta' ? t('cronicos.excFcts') : t('cronicos.defFcts')}
          </span>
          {atingMedio !== null && (
            <span className={cn('text-sm font-bold',
              atingMedio >= 90 ? 'text-emerald-600' :
              atingMedio >= 70 ? 'text-amber-600'   : 'text-red-600',
            )}>
              {t('cronicos.avgAchievement', { value: atingMedio.toFixed(0) })}
            </span>
          )}
        </div>

        {chartData.length > 0 && (
          <div className={isMobile ? 'h-[160px]' : 'h-[220px]'}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 40, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis yAxisId="vol" axisLine={false} tickLine={false}
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                  width={40} />
                <YAxis yAxisId="pct" orientation="right" axisLine={false} tickLine={false}
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={42} />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(v: number, name: string) => [
                    name === achievLabel ? `${v.toFixed(1)}%` : fmt(v), name,
                  ]}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '12px', fontSize: '11px' }} />
                <Bar yAxisId="pct" dataKey="Atingimento" name={achievLabel as string} barSize={10} radius={[3, 3, 0, 0]}>
                  {chartData.map((entry, idx) => {
                    const a = entry.Atingimento;
                    return (
                      <Cell key={idx} fill={
                        a === null ? '#e2e8f0' :
                        a >= 90   ? '#6ee7b7' :
                        a >= 70   ? '#fcd34d' : '#fca5a5'
                      } />
                    );
                  })}
                </Bar>
                <Line yAxisId="vol" type="monotone" dataKey="FCTS" name={t('abbr.fcts') as string} stroke={CHART_COLORS.fcts}
                  strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line yAxisId="vol" type="monotone" dataKey="Vendas" name={salesLabel as string} stroke={CHART_COLORS.vendas}
                  strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="rounded-xl border border-slate-100 overflow-hidden">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="px-3 py-2">{t('cronicos.tableHeaders.month')}</th>
                <th className="px-3 py-2 text-right" style={{ color: CHART_COLORS.fcts }}>{t('abbr.fcts')}</th>
                <th className="px-3 py-2 text-right" style={{ color: CHART_COLORS.vendas }}>{salesLabel}</th>
                <th className="px-3 py-2 text-right">{t('cronicos.tableHeaders.achievement')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {hist.map((h, i) => {
                const ating    = h.fcts > 0 ? h.vendas / h.fcts * 100 : null;
                const semVenda = h.fcts > 0 && h.vendas === 0;
                const d = new Date(h.month);
                const mesLabel = `${new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)))}/${String(d.getUTCFullYear()).slice(2)}`;
                return (
                  <tr key={i} className={cn('transition-colors',
                    semVenda ? 'bg-slate-50 hover:bg-slate-100' : 'hover:bg-slate-50',
                  )}>
                    <td className="px-3 py-2 font-medium text-slate-600 whitespace-nowrap">{mesLabel}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-700">{fmt(h.fcts)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-700">
                      {semVenda
                        ? <span className="text-[10px] font-bold bg-slate-700 text-white px-1.5 py-0.5 rounded">{t('cronicos.noVenda')}</span>
                        : fmt(h.vendas)}
                    </td>
                    <td className={cn('px-3 py-2 text-right font-bold tabular-nums',
                      semVenda      ? 'text-slate-800' :
                      ating === null ? 'text-slate-300' :
                      ating >= 90   ? 'text-emerald-600' :
                      ating >= 70   ? 'text-amber-600'   : 'text-red-600',
                    )}>
                      {semVenda ? '0%' : ating !== null ? `${ating.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </InfoModal>
  );
};

// ── Tabela de itens crônicos (linha única) ────────────────────────────────────

const CronicoTable: React.FC<{
  items:     ProdutoCronico[];
  onSelect:  (c: ProdutoCronico) => void;
}> = ({ items, onSelect }) => {
  const { t } = useTranslation('consolidado');
  const { fmt, locale } = useFormatter();
  const isMobile = useIsMobile();

  const monthShort = (iso: string) => {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  };

  if (isMobile) {
    return (
      <div className="divide-y divide-slate-100">
        {items.map((c, i) => {
          const histComFcts = c.historico.filter(h => h.fcts > 0);
          const atingMedio  = histComFcts.length > 0
            ? histComFcts.reduce((s, h) => s + h.vendas / h.fcts * 100, 0) / histComFcts.length
            : null;
          return (
            <button
              key={i}
              onClick={() => onSelect(c)}
              className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="min-w-0">
                  <p className="text-[10px] font-mono font-bold text-slate-400">{c.produtoCodigo}</p>
                  <p className="text-xs font-medium text-slate-800 leading-tight">{c.produtoDescricao}</p>
                </div>
                {atingMedio !== null && (
                  <span className={cn('text-sm font-bold tabular-nums shrink-0',
                    atingMedio >= 90 ? 'text-emerald-600' :
                    atingMedio >= 70 ? 'text-amber-600'   : 'text-red-600',
                  )}>
                    {atingMedio.toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border',
                  c.direcao === 'alta'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-sky-50 text-sky-700 border-sky-200',
                )}>
                  {c.direcao === 'alta' ? t('cronicos.excFctsShort') : t('cronicos.defFctsShort')}
                </span>
                {c.classe && (
                  <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                    {c.classe}
                  </span>
                )}
                <div className="flex items-center gap-1 ml-auto">
                  {c.historico.map((h, hi) => {
                    const ating    = h.fcts > 0 ? h.vendas / h.fcts * 100 : null;
                    const semVenda = h.fcts > 0 && h.vendas === 0;
                    const atingLbl = ating !== null ? `${ating.toFixed(0)}%` : '—';
                    const badgeClr = ating === null   ? 'bg-slate-100 text-slate-400'     :
                                     semVenda         ? 'bg-slate-800 text-white'          :
                                     ating >= 90      ? 'bg-emerald-50 text-emerald-700'   :
                                     ating >= 70      ? 'bg-amber-50 text-amber-700'       :
                                                        'bg-red-50 text-red-700';
                    return (
                      <span key={hi} className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded', badgeClr)}>
                        {semVenda ? '0%' : atingLbl}
                      </span>
                    );
                  })}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="bg-white text-slate-400 text-[10px] font-bold uppercase tracking-wider border-b border-slate-100">
          <th className="px-4 py-2">{t('cronicos.tableHeaders.code')}</th>
          <th className="px-4 py-2">{t('cronicos.tableHeaders.product')}</th>
          <th className="px-4 py-2">{t('cronicos.tableHeaders.class')}</th>
          <th className="px-4 py-2 text-center">{t('cronicos.tableHeaders.direction')}</th>
          <th className="px-4 py-2 text-right">
            <span className="inline-flex items-center gap-1 justify-end">
              {t('cronicos.tableHeaders.avgAchievement')}
              <InfoTooltip
                text={t('cronicos.tableHeaders.avgAchievementTooltip')}
                position="bottom"
                width="w-80"
              />
            </span>
          </th>
          <th className="px-4 py-2">
            <span className="inline-flex items-center gap-1">
              {t('cronicos.tableHeaders.history')}
              <InfoTooltip
                text={t('cronicos.tableHeaders.historyTooltip')}
                position="bottom"
                width="w-72"
              />
            </span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {items.map((c, i) => {
          const histComFcts = c.historico.filter(h => h.fcts > 0);
          const atingMedio  = histComFcts.length > 0
            ? histComFcts.reduce((s, h) => s + h.vendas / h.fcts * 100, 0) / histComFcts.length
            : null;
          return (
            <tr key={i} className="hover:bg-slate-50/60 transition-colors">
              <td className="px-4 py-2.5 font-mono text-xs font-bold text-slate-600">{c.produtoCodigo}</td>
              <td className="px-4 py-2.5 text-slate-800 font-medium max-w-[220px] truncate text-xs">{c.produtoDescricao}</td>
              <td className="px-4 py-2.5">
                <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                  {c.classe ?? '—'}
                </span>
              </td>
              <td className="px-4 py-2.5 text-center">
                <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                  c.direcao === 'alta'
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-sky-50 text-sky-700 border border-sky-200',
                )}>
                  {c.direcao === 'alta' ? t('cronicos.excFctsShort') : t('cronicos.defFctsShort')}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right">
                {atingMedio !== null ? (
                  <span className={cn('font-bold tabular-nums text-sm',
                    atingMedio >= 90 ? 'text-emerald-600' :
                    atingMedio >= 70 ? 'text-amber-600'   : 'text-red-600',
                  )}>
                    {atingMedio.toFixed(0)}%
                  </span>
                ) : (
                  <span className="text-slate-300 text-xs">—</span>
                )}
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  {c.historico.map((h, hi) => {
                    const ating     = h.fcts > 0 ? h.vendas / h.fcts * 100 : null;
                    const semVenda  = h.fcts > 0 && h.vendas === 0;
                    const atingLbl  = ating !== null ? `${ating.toFixed(0)}%` : '—';
                    const badgeClr  = ating === null   ? 'bg-slate-100 text-slate-400' :
                                      semVenda         ? 'bg-slate-800 text-white'      :
                                      ating >= 90      ? 'bg-emerald-50 text-emerald-700' :
                                      ating >= 70      ? 'bg-amber-50 text-amber-700'    :
                                                         'bg-red-50 text-red-700';
                    const mesLabel  = monthShort(h.month);
                    const tipLabel  = semVenda
                      ? t('cronicos.noVendaTooltip', { month: mesLabel, fcts: fmt(h.fcts) })
                      : `${mesLabel}: ${t('cronicos.tableHeaders.achievement').toLowerCase()} ${atingLbl}`;
                    return (
                      <button
                        key={hi}
                        onClick={() => onSelect(c)}
                        title={tipLabel}
                        className={cn(
                          'text-[9px] font-bold px-1.5 py-0.5 rounded cursor-pointer hover:opacity-70 transition-opacity',
                          badgeClr,
                        )}
                      >
                        {semVenda ? '0%' : atingLbl}
                      </button>
                    );
                  })}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
  );
};

// ── Bloco por Família (modo gestor) ──────────────────────────────────────────

type ItemSortMode = 'alfa' | 'ating-asc' | 'ating-desc' | 'direcao';
type SortPillsComponent = React.FC<{ options: { key: string; label: string }[]; value: string; onChange: (v: any) => void }>;

const FamiliaBlock: React.FC<{
  familia:   string;
  items:     ProdutoCronico[];
  isOpen:    boolean;
  altaCount: number;
  baixaCount: number;
  minAting:  number | null;
  onToggle:  () => void;
  onSelect:  (c: ProdutoCronico) => void;
  sortItems: (items: ProdutoCronico[], mode: ItemSortMode) => ProdutoCronico[];
  SortPills: SortPillsComponent;
  ITEM_SORT_OPTIONS: { key: string; label: string }[];
  sortLabel: string;
  excShort: string;
  defShort: string;
  minAchievLabel: (v: number) => string;
}> = ({ familia, items, isOpen, altaCount, baixaCount, minAting, onToggle, onSelect, sortItems, SortPills, ITEM_SORT_OPTIONS, sortLabel, excShort, defShort, minAchievLabel }) => {
  const [itemSortMode, setItemSortMode] = useState<ItemSortMode>('ating-asc');
  const sortedItems = sortItems(items, itemSortMode);
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
          <span className="font-bold text-slate-800 text-sm flex-1 min-w-0 truncate">{familia}</span>
          <span className="text-[10px] font-bold bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full shrink-0">
            {items.length} SKU{items.length !== 1 ? 's' : ''}
          </span>
        </div>
        {(altaCount > 0 || baixaCount > 0 || minAting !== null) && (
          <div className="flex flex-wrap gap-1.5 mt-1.5 pl-6">
            {altaCount > 0 && (
              <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                {altaCount} {excShort}
              </span>
            )}
            {baixaCount > 0 && (
              <span className="text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 rounded-full">
                {baixaCount} {defShort}
              </span>
            )}
            {minAting !== null && (
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                minAting < 70 ? 'bg-red-100 text-red-700' :
                minAting < 90 ? 'bg-amber-50 text-amber-700' :
                                'bg-emerald-50 text-emerald-700',
              )}>
                {minAchievLabel(minAting)}
              </span>
            )}
          </div>
        )}
      </button>
      {isOpen && (
        <>
          <div className="flex items-center gap-2 flex-wrap px-4 py-2 border-b border-slate-100 bg-white">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{sortLabel}</span>
            <SortPills options={ITEM_SORT_OPTIONS} value={itemSortMode} onChange={setItemSortMode} />
          </div>
          <CronicoTable items={sortedItems} onSelect={onSelect} />
        </>
      )}
    </div>
  );
};

// ── Bloco por Unidade (modo admin) ────────────────────────────────────────────

const UnidadeBlock: React.FC<{
  unidade:   string;
  unitLabel: string;
  items:     ProdutoCronico[];
  isOpen:    boolean;
  altaCount: number;
  baixaCount: number;
  minAting:  number | null;
  onToggle:  () => void;
  onSelect:  (c: ProdutoCronico) => void;
  sortItems: (items: ProdutoCronico[], mode: ItemSortMode) => ProdutoCronico[];
  SortPills: SortPillsComponent;
  ITEM_SORT_OPTIONS: { key: string; label: string }[];
  sortLabel: string;
  excShort: string;
  defShort: string;
  minAchievLabel: (v: number) => string;
}> = ({ unitLabel, items, isOpen, altaCount, baixaCount, minAting, onToggle, onSelect, sortItems, SortPills, ITEM_SORT_OPTIONS, sortLabel, excShort, defShort, minAchievLabel }) => {
  const [itemSortMode, setItemSortMode] = useState<ItemSortMode>('ating-asc');
  const sortedItems = sortItems(items, itemSortMode);
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
          <span className="font-bold text-slate-800 text-sm flex-1 min-w-0 truncate">{unitLabel}</span>
          <span className="text-[10px] font-bold bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full shrink-0">
            {items.length} SKU{items.length !== 1 ? 's' : ''}
          </span>
        </div>
        {(altaCount > 0 || baixaCount > 0 || minAting !== null) && (
          <div className="flex flex-wrap gap-1.5 mt-1.5 pl-6">
            {altaCount > 0 && (
              <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                {altaCount} {excShort}
              </span>
            )}
            {baixaCount > 0 && (
              <span className="text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 rounded-full">
                {baixaCount} {defShort}
              </span>
            )}
            {minAting !== null && (
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                minAting < 70 ? 'bg-red-100 text-red-700'    :
                minAting < 90 ? 'bg-amber-50 text-amber-700'  :
                                'bg-emerald-50 text-emerald-700',
              )}>
                {minAchievLabel(minAting)}
              </span>
            )}
          </div>
        )}
      </button>
      {isOpen && (
        <>
          <div className="flex items-center gap-2 flex-wrap px-4 py-2 border-b border-slate-100 bg-white">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{sortLabel}</span>
            <SortPills options={ITEM_SORT_OPTIONS} value={itemSortMode} onChange={setItemSortMode} />
          </div>
          <CronicoTable items={sortedItems} onSelect={onSelect} />
        </>
      )}
    </div>
  );
};

// ── Componente principal ───────────────────────────────────────────────────────

export const ProdutosCronicosSection: React.FC<ProdutosCronicosSectionProps> = ({
  cronicos,
  unitDescMap,
  showFilter       = true,
  showUnitGrouping = !!unitDescMap,
}) => {
  const { t } = useTranslation('consolidado');
  const [expandedUnidades, setExpandedUnidades] = useState<Set<string>>(new Set());
  const [expandedFamilias, setExpandedFamilias] = useState<Set<string>>(new Set());
  const [filterText,       setFilterText]       = useState('');
  const [modalCronico,     setModalCronico]      = useState<ProdutoCronico | null>(null);
  const [famSortMode,      setFamSortMode]       = useState<'alfa' | 'ating-asc' | 'ating-desc' | 'alta' | 'baixa'>('alfa');
  const [unitSortMode,     setUnitSortMode]      = useState<'alfa' | 'count' | 'ating-asc'>('alfa');

  const excShort = t('cronicos.excFctsShort');
  const defShort = t('cronicos.defFctsShort');
  const minAchievLabel = (v: number) => t('cronicos.minAchievement', { value: v.toFixed(0) });

  // Helper: calcula atingimento médio de um crônico
  const getAting = (c: ProdutoCronico) => {
    const hf = c.historico.filter(h => h.fcts > 0);
    return hf.length > 0 ? hf.reduce((s, h) => s + h.vendas / h.fcts * 100, 0) / hf.length : null;
  };

  // Helper: ordena lista de crônicos dado um modo
  const sortItems = (items: ProdutoCronico[], mode: 'alfa' | 'ating-asc' | 'ating-desc' | 'direcao') => {
    switch (mode) {
      case 'alfa':       return [...items].sort((a, b) => a.produtoDescricao.localeCompare(b.produtoDescricao));
      case 'ating-asc':  return [...items].sort((a, b) => (getAting(a) ?? 999) - (getAting(b) ?? 999));
      case 'ating-desc': return [...items].sort((a, b) => (getAting(b) ?? -1)  - (getAting(a) ?? -1));
      case 'direcao':    return [...items].sort((a, b) => a.direcao.localeCompare(b.direcao));
      default:           return items;
    }
  };

  const cronicosFiltrados = useMemo(() => {
    if (!filterText) return cronicos;
    const q = filterText.toLowerCase();
    return cronicos.filter(c =>
      c.unidadeVendaId.toLowerCase().includes(q) ||
      c.familia?.toLowerCase().includes(q) ||
      c.classe?.toLowerCase().includes(q) ||
      c.produtoDescricao.toLowerCase().includes(q),
    );
  }, [cronicos, filterText]);

  // ── Sort pill component (shared) ──
  const SortPills = ({ options, value, onChange }: {
    options: { key: string; label: string }[];
    value: string;
    onChange: (v: any) => void;
  }) => (
    <div className="flex items-center gap-1 border border-slate-200 rounded-lg px-1.5 py-0.5 bg-white">
      <ArrowUpDown className="w-2.5 h-2.5 text-slate-400 shrink-0" />
      {options.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            'text-[9px] font-bold px-1.5 py-0.5 rounded transition-colors whitespace-nowrap',
            value === key ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-700',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  // ── Sort options ──
  const FAM_SORT_OPTIONS  = [
    { key: 'alfa',       label: t('cronicos.sort.az')       },
    { key: 'ating-asc',  label: t('cronicos.sort.atingUp')  },
    { key: 'ating-desc', label: t('cronicos.sort.atingDown') },
    { key: 'alta',       label: t('cronicos.sort.excFcts')  },
    { key: 'baixa',      label: t('cronicos.sort.defFcts')  },
  ];
  const UNIT_SORT_OPTIONS = [
    { key: 'alfa',      label: t('cronicos.sort.az')       },
    { key: 'count',     label: t('cronicos.sort.countDown') },
    { key: 'ating-asc', label: t('cronicos.sort.worstUp')  },
  ];
  const ITEM_SORT_OPTIONS = [
    { key: 'alfa',       label: t('cronicos.sort.az')        },
    { key: 'ating-asc',  label: t('cronicos.sort.worstUp')   },
    { key: 'ating-desc', label: t('cronicos.sort.bestDown')  },
    { key: 'direcao',    label: t('cronicos.sort.direction') },
  ];

  const toggleUnidade = (u: string) => setExpandedUnidades(prev => {
    const next = new Set(prev); next.has(u) ? next.delete(u) : next.add(u); return next;
  });

  const toggleFamilia = (f: string) => setExpandedFamilias(prev => {
    const next = new Set(prev); next.has(f) ? next.delete(f) : next.add(f); return next;
  });

  // ── Sort de famílias (modo gestor) ──
  const sortFamilias = (entries: [string, ProdutoCronico[]][]) => {
    switch (famSortMode) {
      case 'ating-asc': return entries.sort((a, b) => {
        const getMinAting = (items: ProdutoCronico[]) => {
          const ats = items.map(c => getAting(c)).filter((v): v is number => v !== null);
          return ats.length > 0 ? Math.min(...ats) : 999;
        };
        return getMinAting(a[1]) - getMinAting(b[1]);
      });
      case 'ating-desc': return entries.sort((a, b) => {
        const getMaxAting = (items: ProdutoCronico[]) => {
          const ats = items.map(c => getAting(c)).filter((v): v is number => v !== null);
          return ats.length > 0 ? Math.max(...ats) : -1;
        };
        return getMaxAting(b[1]) - getMaxAting(a[1]);
      });
      case 'alta':  return entries.sort((a, b) => b[1].filter(c => c.direcao === 'alta').length  - a[1].filter(c => c.direcao === 'alta').length);
      case 'baixa': return entries.sort((a, b) => b[1].filter(c => c.direcao === 'baixa').length - a[1].filter(c => c.direcao === 'baixa').length);
      default:      return entries.sort((a, b) => a[0].localeCompare(b[0]));
    }
  };

  // ── Sort de unidades (modo admin) ──
  const sortUnidades = (entries: [string, ProdutoCronico[]][]) => {
    switch (unitSortMode) {
      case 'count': return entries.sort((a, b) => b[1].length - a[1].length);
      case 'ating-asc': return entries.sort((a, b) => {
        const getMin = (items: ProdutoCronico[]) => {
          const ats = items.map(c => getAting(c)).filter((v): v is number => v !== null);
          return ats.length > 0 ? Math.min(...ats) : 999;
        };
        return getMin(a[1]) - getMin(b[1]);
      });
      default: return entries.sort((a, b) => a[0].localeCompare(b[0]));
    }
  };

  if (cronicos.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 text-slate-400">
        <Bug className="w-10 h-10 text-slate-200 mb-3" />
        <p className="font-medium">{t('cronicos.empty')}</p>
        <p className="text-sm">{t('cronicos.emptyHint')}</p>
      </div>
    );
  }

  if (!showUnitGrouping) {
    const byFamilia = new Map<string, ProdutoCronico[]>();
    for (const c of cronicos) {
      const key = c.familia || 'Outros';
      if (!byFamilia.has(key)) byFamilia.set(key, []);
      byFamilia.get(key)!.push(c);
    }
    const familias      = sortFamilias([...byFamilia.entries()]);
    const allFamExpanded = familias.every(([f]) => expandedFamilias.has(f));

    const toggleAllFam = (expand: boolean) =>
      setExpandedFamilias(expand ? new Set(familias.map(([f]) => f)) : new Set());

    return (
      <div className="space-y-4">
        {/* Resumo + ordenadores + expandir/colapsar */}
        <div className="flex items-center gap-4 flex-wrap">
          <p className="text-sm text-slate-500">
            <span className="font-bold text-slate-900">{t('cronicos.summaryProducts', { count: cronicos.length })}</span>
            {' '}{t('cronicos.summaryIn')}{' '}
            <span className="font-bold text-slate-700">{t('cronicos.summaryFamilies', { count: familias.length })}</span>
            {' · '}
            <span className="text-red-600 font-semibold">{cronicos.filter(c => c.direcao === 'alta').length} {excShort}</span>
            {' · '}
            <span className="text-blue-600 font-semibold">{cronicos.filter(c => c.direcao === 'baixa').length} {defShort}</span>
          </p>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <SortPills options={FAM_SORT_OPTIONS} value={famSortMode} onChange={setFamSortMode} />
            <button
              onClick={() => toggleAllFam(!allFamExpanded)}
              className="text-xs font-bold text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1"
            >
              {allFamExpanded
                ? <><ChevronUp   className="w-3 h-3" /> {t('cronicos.collapseAll')}</>
                : <><ChevronDown className="w-3 h-3" /> {t('cronicos.expandAll')}</>}
            </button>
          </div>
        </div>

        {/* Acordeão por família */}
        <div className="space-y-3">
          {familias.map(([familia, items]) => {
            const isOpen     = expandedFamilias.has(familia);
            const altaCount  = items.filter(c => c.direcao === 'alta').length;
            const baixaCount = items.filter(c => c.direcao === 'baixa').length;
            const atingamentos = items.map(c => getAting(c)).filter((a): a is number => a !== null);
            const minAting = atingamentos.length > 0 ? Math.min(...atingamentos) : null;

            return (
              <FamiliaBlock
                key={familia}
                familia={familia}
                items={items}
                isOpen={isOpen}
                altaCount={altaCount}
                baixaCount={baixaCount}
                minAting={minAting}
                onToggle={() => toggleFamilia(familia)}
                onSelect={setModalCronico}
                sortItems={sortItems}
                SortPills={SortPills}
                ITEM_SORT_OPTIONS={ITEM_SORT_OPTIONS}
                sortLabel={t('cronicos.sort.label')}
                excShort={excShort}
                defShort={defShort}
                minAchievLabel={minAchievLabel}
              />
            );
          })}
        </div>

        <CronicoModal cronico={modalCronico} onClose={() => setModalCronico(null)} />
      </div>
    );
  }

  // ── Modo agrupado por unidade (admin) ─────────────────────────────────────
  const byUnidade = new Map<string, typeof cronicosFiltrados>();
  for (const c of cronicosFiltrados) {
    if (!byUnidade.has(c.unidadeVendaId)) byUnidade.set(c.unidadeVendaId, []);
    byUnidade.get(c.unidadeVendaId)!.push(c);
  }
  const unidades = sortUnidades([...byUnidade.entries()]);
  const allExpanded = unidades.every(([u]) => expandedUnidades.has(u));

  const toggleAll = (expand: boolean) =>
    setExpandedUnidades(expand ? new Set(unidades.map(([u]) => u)) : new Set());

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <p className="text-sm text-slate-500">
          <span className="font-bold text-slate-900">{t('cronicos.summaryProducts', { count: cronicosFiltrados.length })}</span>
          {' '}{t('cronicos.summaryIn')}{' '}
          <span className="font-bold text-slate-700">{t('cronicos.summaryUnits', { count: unidades.length })}</span>
          {' · '}
          <span className="text-red-600 font-semibold">{cronicosFiltrados.filter(c => c.direcao === 'alta').length} {excShort}</span>
          {' · '}
          <span className="text-blue-600 font-semibold">{cronicosFiltrados.filter(c => c.direcao === 'baixa').length} {defShort}</span>
        </p>
        {showFilter && (
          <input
            type="text"
            placeholder={t('cronicos.filterPlaceholder')}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="flex-1 min-w-[200px] max-w-sm text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-sky-500"
          />
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <SortPills options={UNIT_SORT_OPTIONS} value={unitSortMode} onChange={setUnitSortMode} />
          <button
            onClick={() => toggleAll(!allExpanded)}
            className="text-xs font-bold text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1"
          >
            {allExpanded
              ? <><ChevronUp   className="w-3 h-3" /> {t('cronicos.collapseAll')}</>
              : <><ChevronDown className="w-3 h-3" /> {t('cronicos.expandAll')}</>}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {unidades.map(([unidade, items]) => {
          const isOpen      = expandedUnidades.has(unidade);
          const altaCount   = items.filter(c => c.direcao === 'alta').length;
          const baixaCount  = items.filter(c => c.direcao === 'baixa').length;
          const unitLabel   = unitDescMap?.get(unidade) ?? unidade;
          const atingimentos = items.map(c => getAting(c)).filter((a): a is number => a !== null);
          const minAting = atingimentos.length > 0 ? Math.min(...atingimentos) : null;

          return (
            <UnidadeBlock
              key={unidade}
              unidade={unidade}
              unitLabel={unitLabel}
              items={items}
              isOpen={isOpen}
              altaCount={altaCount}
              baixaCount={baixaCount}
              minAting={minAting}
              onToggle={() => toggleUnidade(unidade)}
              onSelect={setModalCronico}
              sortItems={sortItems}
              SortPills={SortPills}
              ITEM_SORT_OPTIONS={ITEM_SORT_OPTIONS}
              sortLabel={t('cronicos.sort.label')}
              excShort={excShort}
              defShort={defShort}
              minAchievLabel={minAchievLabel}
            />
          );
        })}
      </div>

      <CronicoModal cronico={modalCronico} onClose={() => setModalCronico(null)} />
    </div>
  );
};
