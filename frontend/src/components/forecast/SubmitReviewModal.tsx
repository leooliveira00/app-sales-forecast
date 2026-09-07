import React, { useMemo, useState } from 'react';
import { X, Send, AlertTriangle, CheckCircle2, Globe, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn, InfoTooltip } from '../shared/Common';
import { useCountryName } from '../../hooks/useCountryName';
import {
  fmt, monthLabel, getFamilia, getFamilyClasse,
  CLASSE_BADGE_COLORS,
} from '../../types/forecast';
import type { ForecastItem } from '../../types/forecast';
import type { AnnualProduct } from '../../hooks/useAnnualForecastData';

type AlteredEntry = {
  id:               string;
  produtoCodigo:    string;
  produtoDescricao: string;
  classe:           string | null;
  familia:          string;
  month:            string;
  prevFCTS:         number | null;
  fcts:             number;
};

interface SubmitReviewModalProps {
  items:           ForecastItem[];
  annualProducts?: AnnualProduct[];
  cycleDate:       Date;
  targetDate?:     Date;
  isExport:        boolean;
  unidade:         { codigo: string; descricao: string };
  paises?:         { iso3: string; nome: string }[];
  submitting:      boolean;
  onConfirm:       () => void;
  onClose:         () => void;
}

const DESVIO_THRESHOLD = 20;

// ── helpers ──────────────────────────────────────────────────────────────────

function desvioColor(pct: number | null): string {
  if (pct === null) return 'text-slate-300';
  const abs = Math.abs(pct);
  if (abs <= 5)  return 'text-emerald-600';
  if (abs <= 15) return 'text-amber-600';
  return 'text-red-600';
}

// Desvio percentual (FCTS / referência − 1) × 100. Referência hoje é a Venda A.A.,
// somada apenas dos meses com base válida (filtro simétrico — FCTS também só
// considera esses meses, via fctsForDesvio).
function desvioGlobal(fcts: number, ref: number): number | null {
  return ref > 0 ? (fcts / ref - 1) * 100 : null;
}

// ── componente ────────────────────────────────────────────────────────────────

export const SubmitReviewModal: React.FC<SubmitReviewModalProps> = ({
  items, annualProducts = [], cycleDate, isExport, unidade, paises = [], submitting, onConfirm, onClose,
}) => {
  const { t } = useTranslation('forecast');
  const countryName = useCountryName();

  // ── KPIs globais ─────────────────────────────────────────────────────────

  const { totalORC, totalFCTS, totalVendaAA, totalFctsForDesvio, skuFilled, skuEmpty } = useMemo(() => {
    let totalORC = 0, totalFCTS = 0, totalVendaAA = 0, totalFctsForDesvio = 0, skuFilled = 0, skuEmpty = 0;

    if (isExport) {
      const produtosFilled = new Set<string>();
      const produtosAll    = new Set<string>();
      for (const item of items) {
        totalORC  += item.volumeORC ?? 0;
        totalFCTS += item.overrides[0]?.volumeFCTS ?? 0;
        totalVendaAA       += item.vendaAA ?? 0;
        totalFctsForDesvio += item.fctsForDesvio ?? 0;
        produtosAll.add(item.produto.codigo);
        if ((item.overrides[0]?.volumeFCTS ?? 0) > 0) produtosFilled.add(item.produto.codigo);
      }
      skuFilled = produtosFilled.size;
      skuEmpty  = produtosAll.size - produtosFilled.size;
    } else {
      for (const item of items) {
        totalORC  += item.volumeORC ?? 0;
        totalFCTS += item.overrides[0]?.volumeFCTS ?? 0;
        totalVendaAA       += item.vendaAA ?? 0;
        totalFctsForDesvio += item.fctsForDesvio ?? 0;
        (item.overrides[0]?.volumeFCTS ?? 0) > 0 ? skuFilled++ : skuEmpty++;
      }
    }
    return { totalORC, totalFCTS, totalVendaAA, totalFctsForDesvio, skuFilled, skuEmpty };
  }, [items, isExport]);

  const globalDesvio = desvioGlobal(totalFctsForDesvio, totalVendaAA);

  // ── Resumo por família ────────────────────────────────────────────────────

  type FamSummary = {
    familia: string;
    classe: string;
    famItems: ForecastItem[];
    totalORC: number;
    totalFCTS: number;
    totalVendaAA: number;
    totalFctsForDesvio: number;
    filled: number;
    total: number;
    countriesWithFCTS: number;
    totalCountries: number;
  };

  const familySummaries = useMemo((): FamSummary[] => {
    const map = new Map<string, ForecastItem[]>();
    for (const item of items) {
      const fam = getFamilia(item);
      const list = map.get(fam) ?? [];
      list.push(item);
      map.set(fam, list);
    }
    return Array.from(map.entries())
      .map(([familia, famItems]) => {
        let totalORC = 0, totalFCTS = 0, totalVendaAA = 0, totalFctsForDesvio = 0, filled = 0;
        let countriesWithFCTS = 0, totalCountries = 0;

        if (isExport) {
          const produtosFilled   = new Set<string>();
          const countriesWithSet = new Set<string>();
          const countriesAllSet  = new Set<string>();
          for (const item of famItems) {
            totalORC  += item.volumeORC ?? 0;
            totalFCTS += item.overrides[0]?.volumeFCTS ?? 0;
            totalVendaAA       += item.vendaAA ?? 0;
            totalFctsForDesvio += item.fctsForDesvio ?? 0;
            if (item.paisIso3) countriesAllSet.add(item.paisIso3);
            if ((item.overrides[0]?.volumeFCTS ?? 0) > 0) {
              if (item.paisIso3) countriesWithSet.add(item.paisIso3);
              produtosFilled.add(item.produto.codigo);
            }
          }
          countriesWithFCTS = countriesWithSet.size;
          totalCountries    = countriesAllSet.size;
          const produtosAll = new Set(famItems.map(i => i.produto.codigo));
          filled = produtosFilled.size;
          return {
            familia, classe: getFamilyClasse(famItems),
            famItems, totalORC, totalFCTS, totalVendaAA, totalFctsForDesvio,
            filled, total: produtosAll.size,
            countriesWithFCTS, totalCountries,
          };
        } else {
          for (const item of famItems) {
            totalORC  += item.volumeORC ?? 0;
            totalFCTS += item.overrides[0]?.volumeFCTS ?? 0;
            totalVendaAA       += item.vendaAA ?? 0;
            totalFctsForDesvio += item.fctsForDesvio ?? 0;
            if ((item.overrides[0]?.volumeFCTS ?? 0) > 0) filled++;
          }
          return {
            familia, classe: getFamilyClasse(famItems),
            famItems, totalORC, totalFCTS, totalVendaAA, totalFctsForDesvio,
            filled, total: famItems.length,
            countriesWithFCTS, totalCountries,
          };
        }
      })
      .sort((a, b) => b.totalORC - a.totalORC);
  }, [items, isExport]);

  // ── Resumo por país (export) ──────────────────────────────────────────────

  type CountrySummary = {
    iso3: string;
    nome: string;
    skuWithFCTS: number;
    totalSku: number;
    totalORC: number;
    totalFCTS: number;
    totalVendaAA: number;
    totalFctsForDesvio: number;
  };

  const countrySummaries = useMemo((): CountrySummary[] => {
    if (!isExport) return [];
    const map = new Map<string, CountrySummary>();
    for (const item of items) {
      if (!item.paisIso3) continue;
      const key = item.paisIso3;
      const existing = map.get(key) ?? {
        iso3: item.paisIso3,
        nome: countryName(item.paisIso3, item.pais?.nome),
        skuWithFCTS: 0, totalSku: 0,
        totalORC: 0, totalFCTS: 0,
        totalVendaAA: 0, totalFctsForDesvio: 0,
      };
      existing.totalSku++;
      existing.totalORC  += item.volumeORC ?? 0;
      existing.totalFCTS += item.overrides[0]?.volumeFCTS ?? 0;
      existing.totalVendaAA       += item.vendaAA ?? 0;
      existing.totalFctsForDesvio += item.fctsForDesvio ?? 0;
      if ((item.overrides[0]?.volumeFCTS ?? 0) > 0) existing.skuWithFCTS++;
      map.set(key, existing);
    }
    return [...map.values()].sort((a, b) => b.totalORC - a.totalORC);
  }, [items, isExport, countryName]);

  // ── Alertas ───────────────────────────────────────────────────────────────

  const alertsSemFCTS = useMemo(() =>
    isExport ? [] : items.filter(i => (i.overrides[0]?.volumeFCTS ?? 0) === 0),
  [items, isExport]);

  const alertsPaisesSemFCTS = useMemo((): { iso3: string; nome: string }[] => {
    if (!isExport) return [];
    const totais = new Map<string, { iso3: string; nome: string; total: number }>(
      paises.map(p => [p.iso3, { iso3: p.iso3, nome: countryName(p.iso3, p.nome), total: 0 }])
    );
    for (const item of items) {
      if (!item.paisIso3) continue;
      const entry = totais.get(item.paisIso3) ?? {
        iso3: item.paisIso3,
        nome: countryName(item.paisIso3, item.pais?.nome),
        total: 0,
      };
      entry.total += item.overrides[0]?.volumeFCTS ?? 0;
      totais.set(item.paisIso3, entry);
    }
    return [...totais.values()].filter(c => c.total === 0);
  }, [items, isExport, paises, countryName]);

  const alertsPaisesParcias = useMemo((): { iso3: string; nome: string; skuWithFCTS: number; totalSku: number }[] => {
    if (!isExport) return [];
    return countrySummaries.filter(c => c.skuWithFCTS > 0 && c.skuWithFCTS < c.totalSku);
  }, [countrySummaries, isExport]);

  const alertsProdutosSemCobertura = useMemo((): { codigo: string; descricao: string; familia: string }[] => {
    if (!isExport) return [];
    const prodFCTS = new Map<string, number>();
    const prodInfo = new Map<string, { codigo: string; descricao: string; familia: string }>();
    for (const item of items) {
      if (!item.paisIso3) continue;
      const codigo = item.produto.codigo;
      prodFCTS.set(codigo, (prodFCTS.get(codigo) ?? 0) + (item.overrides[0]?.volumeFCTS ?? 0));
      if (!prodInfo.has(codigo)) {
        prodInfo.set(codigo, { codigo, descricao: item.produto.descricao ?? '', familia: getFamilia(item) });
      }
    }
    return [...prodFCTS.entries()]
      .filter(([, total]) => total === 0)
      .map(([codigo]) => prodInfo.get(codigo)!);
  }, [items, isExport]);

  const alertsDesvioAlto = useMemo(() => {
    // Item entra no alerta se o desvio FCTS vs Venda A.A. (filtro simétrico) ultrapassa o threshold.
    // Itens sem A.A. válida em nenhum mês são ignorados (sem base de comparação).
    return items.filter(i => {
      const fcts = i.fctsForDesvio ?? 0;
      const ref  = i.vendaAA ?? 0;
      if (ref === 0 || fcts === 0) return false;
      return Math.abs(fcts / ref - 1) * 100 > DESVIO_THRESHOLD;
    });
  }, [items]);

  // ── Alerta: novo mês da janela sem revisão ───────────────────────────────

  const alertsHorizon = useMemo(() => {
    if (!annualProducts.length) return { horizonMonth: '', familias: [] as string[] };
    // O novo mês da janela é o mês máximo presente nos dados
    let horizonMonth = '';
    for (const prod of annualProducts) {
      for (const m of prod.months) {
        if (m.month > horizonMonth) horizonMonth = m.month;
      }
    }
    // Famílias com ao menos 1 produto sem FCTS definido nesse mês
    const famSet = new Set<string>();
    for (const prod of annualProducts) {
      if (prod.gestorExcluido) continue;
      const fam = prod.familia?.trim() || 'Outros';
      const horizonEntry = prod.months.find(m => m.month === horizonMonth);
      if (!horizonEntry) continue;
      const fcts = horizonEntry.override?.volumeFCTS ?? 0;
      if (fcts <= 0) famSet.add(fam);
    }
    return { horizonMonth, familias: Array.from(famSet).sort() };
  }, [annualProducts]);

  const hasAlerts = alertsSemFCTS.length > 0 || alertsDesvioAlto.length > 0
    || alertsPaisesSemFCTS.length > 0 || alertsPaisesParcias.length > 0
    || alertsProdutosSemCobertura.length > 0 || alertsHorizon.familias.length > 0;

  // ── Estados de colapso ────────────────────────────────────────────────────

  const [familiesOpen, setFamiliesOpen] = useState(true);
  const [countriesOpen, setCountriesOpen] = useState(true);
  const [alertsOpen,   setAlertsOpen]   = useState(true);

  // ── Checklist de alterações ───────────────────────────────────────────────

  const [alteredOpen,    setAlteredOpen]    = useState(true);
  const [unreviewedOpen, setUnreviewedOpen] = useState(false);

  const itensAlterados = useMemo((): AlteredEntry[] => {
    const result: AlteredEntry[] = [];
    for (const prod of annualProducts) {
      if (prod.gestorExcluido) continue;
      const familia = prod.familia?.trim() || 'Outros';
      for (const m of prod.months) {
        if (!m.override) continue;
        if (m.override.volumeFCTS === (m.prevFCTS ?? 0)) continue;
        result.push({
          id:               m.itemId,
          produtoCodigo:    prod.codigo,
          produtoDescricao: prod.descricao,
          classe:           prod.classe,
          familia,
          month:            m.month,
          prevFCTS:         m.prevFCTS,
          fcts:             m.override.volumeFCTS,
        });
      }
    }
    return result;
  }, [annualProducts]);

  const alteredByFamily = useMemo(() => {
    const map = new Map<string, AlteredEntry[]>();
    for (const entry of itensAlterados) {
      const list = map.get(entry.familia) ?? [];
      list.push(entry);
      map.set(entry.familia, list);
    }
    return Array.from(map.entries())
      .map(([familia, entries]) => ({ familia, entries }))
      .sort((a, b) => a.familia.localeCompare(b.familia));
  }, [itensAlterados]);

  const familiasNaoRevisadas = useMemo(() => {
    const reviewed = new Set<string>();
    const all      = new Set<string>();
    for (const prod of annualProducts) {
      if (prod.gestorExcluido) continue;
      const fam = prod.familia?.trim() || 'Outros';
      all.add(fam);
      if (prod.months.some(m => m.override != null)) reviewed.add(fam);
    }
    return Array.from(all).filter(f => !reviewed.has(f)).sort();
  }, [annualProducts]);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">

        {/* Cabeçalho */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-200 shrink-0">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-slate-900">{t('reviewModal.title')}</h2>
              {isExport && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-full text-[10px] font-bold uppercase">
                  <Globe className="w-3 h-3" /> Export
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              <span className="font-semibold text-slate-700">{unidade.codigo}</span>
              {' — '}{unidade.descricao}
              {' · '}{t('reviewModal.cycleLabel', { cycle: monthLabel(cycleDate) })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Conteúdo com scroll */}
        <div className="overflow-y-auto flex-1 space-y-5 px-6 py-5">

          {/* KPIs Globais */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label={t('reviewModal.kpi.totalOrc')}  value={fmt(totalORC)} />
            <KpiCard label={t('reviewModal.kpi.totalFcts')} value={fmt(totalFCTS)} />
            <KpiCard
              label={t('reviewModal.kpi.desvioLabel')}
              value={globalDesvio !== null ? `${globalDesvio > 0 ? '+' : ''}${globalDesvio.toFixed(1)}%` : '—'}
              valueClass={desvioColor(globalDesvio)}
            />
            <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">{t('reviewModal.kpi.skusLabel')}</p>
              <p className="text-sm font-bold text-slate-700">
                <span className="text-emerald-600">{skuFilled}</span>
                <span className="text-slate-300 mx-1">/</span>
                <span>{items.length}</span>
              </p>
              {skuEmpty > 0 && (
                <p className="text-[10px] text-red-500 font-semibold mt-0.5">{skuEmpty} {t('reviewModal.kpi.semFcts')}</p>
              )}
            </div>
          </div>

          {/* Tabela por família */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setFamiliesOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100/60 transition-colors"
            >
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                {t('reviewModal.families')}
              </span>
              <ChevronDown className={cn('w-3.5 h-3.5 text-slate-400 transition-transform', familiesOpen && 'rotate-180')} />
            </button>
            {familiesOpen && <div className="border-t border-slate-200">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200">
                    <th className="px-4 py-2.5">{t('reviewModal.tableHeaders.family')}</th>
                    <th className="px-4 py-2.5 text-center">{t('reviewModal.tableHeaders.class')}</th>
                    <th className="px-4 py-2.5 text-center">{t('reviewModal.tableHeaders.skus')}</th>
                    <th className="px-4 py-2.5 text-right">{t('reviewModal.tableHeaders.orc')}</th>
                    <th className="px-4 py-2.5 text-right">{t('reviewModal.tableHeaders.fcts')}</th>
                    <th className="px-4 py-2.5 text-right">
                      <span className="inline-flex items-center gap-1 justify-end">
                        {t('reviewModal.tableHeaders.deviation')}
                        <InfoTooltip
                          text={t('reviewModal.tableHeaders.deviationHint')}
                          position="bottom"
                          width="w-72"
                          textSize="text-[10px]"
                        />
                      </span>
                    </th>
                    {isExport && (
                      <th className="px-4 py-2.5 text-center">{t('reviewModal.tableHeaders.countriesWithFcts')}</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {familySummaries.map(fam => {
                    const desvio = desvioGlobal(fam.totalFctsForDesvio, fam.totalVendaAA);
                    const hasEmpty = isExport ? fam.totalFCTS === 0 : fam.filled < fam.total;
                    const hasHighDesvio = desvio !== null && Math.abs(desvio) > DESVIO_THRESHOLD;
                    return (
                      <tr
                        key={fam.familia}
                        className={cn(
                          "transition-colors",
                          hasEmpty ? "bg-red-50/40" : "hover:bg-slate-50/60"
                        )}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-800 font-medium text-xs">{fam.familia}</span>
                            {(hasEmpty || hasHighDesvio) && (
                              <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {fam.classe ? (
                            <span className={cn(
                              "inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold border",
                              CLASSE_BADGE_COLORS[fam.classe] ?? 'bg-slate-100 text-slate-500 border-slate-200'
                            )}>
                              {fam.classe}
                            </span>
                          ) : <span className="text-slate-200">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs">
                          <span className={cn("font-semibold", hasEmpty ? "text-red-600" : "text-emerald-600")}>
                            {fam.filled}
                          </span>
                          <span className="text-slate-300 mx-0.5">/</span>
                          <span className="text-slate-500">{fam.total}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmt(fam.totalORC)}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-semibold text-slate-700 tabular-nums">{fmt(fam.totalFCTS)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={cn("text-xs font-bold", desvioColor(desvio))}>
                            {desvio !== null ? `${desvio > 0 ? '+' : ''}${desvio.toFixed(1)}%` : '—'}
                          </span>
                        </td>
                        {isExport && (
                          <td className="px-4 py-2.5 text-center text-xs">
                            <span className={cn("font-semibold", fam.countriesWithFCTS < fam.totalCountries ? "text-amber-600" : "text-emerald-600")}>
                              {fam.countriesWithFCTS}
                            </span>
                            <span className="text-slate-300 mx-0.5">/</span>
                            <span className="text-slate-500">{fam.totalCountries}</span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>}
          </div>

          {/* Tabela por país (export) */}
          {isExport && countrySummaries.length > 0 && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setCountriesOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100/60 transition-colors"
              >
                <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                  {t('reviewModal.countries')}
                </span>
                <ChevronDown className={cn('w-3.5 h-3.5 text-slate-400 transition-transform', countriesOpen && 'rotate-180')} />
              </button>
              {countriesOpen && <div className="border-t border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200">
                      <th className="px-4 py-2.5">{t('reviewModal.tableHeaders.country')}</th>
                      <th className="px-4 py-2.5 text-center">{t('reviewModal.tableHeaders.skusWithFcts')}</th>
                      <th className="px-4 py-2.5 text-right">{t('reviewModal.tableHeaders.orc')}</th>
                      <th className="px-4 py-2.5 text-right">{t('reviewModal.tableHeaders.fcts')}</th>
                      <th className="px-4 py-2.5 text-right">{t('reviewModal.tableHeaders.deviation')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {countrySummaries.map(c => {
                      const desvio = desvioGlobal(c.totalFctsForDesvio, c.totalVendaAA);
                      const hasEmpty = c.totalFCTS === 0;
                      const hasHighDesvio = desvio !== null && Math.abs(desvio) > DESVIO_THRESHOLD;
                      return (
                        <tr
                          key={c.iso3}
                          className={cn(
                            "transition-colors",
                            hasEmpty ? "bg-red-50/40" : "hover:bg-slate-50/60"
                          )}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[10px] text-slate-400 shrink-0">{c.iso3}</span>
                              <span className="text-xs text-slate-700 font-medium truncate">{c.nome}</span>
                              {(hasEmpty || hasHighDesvio) && (
                                <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-center text-xs">
                            <span className={cn("font-semibold", hasEmpty ? "text-red-600" : "text-emerald-600")}>
                              {c.skuWithFCTS}
                            </span>
                            <span className="text-slate-300 mx-0.5">/</span>
                            <span className="text-slate-500">{c.totalSku}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmt(c.totalORC)}</td>
                          <td className="px-4 py-2.5 text-right text-xs font-semibold text-slate-700 tabular-nums">{fmt(c.totalFCTS)}</td>
                          <td className="px-4 py-2.5 text-right">
                            <span className={cn("text-xs font-bold", desvioColor(desvio))}>
                              {desvio !== null ? `${desvio > 0 ? '+' : ''}${desvio.toFixed(1)}%` : '—'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>}
            </div>
          )}

          {/* Revisão de alterações */}
          {(itensAlterados.length > 0 || familiasNaoRevisadas.length > 0) && (
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                {t('reviewModal.changes.title')}
              </h3>

              {/* Alterados */}
              {itensAlterados.length > 0 && (
                <div className="rounded-xl border border-blue-200 overflow-hidden mb-3">
                  <button
                    type="button"
                    onClick={() => setAlteredOpen(o => !o)}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-blue-50 hover:bg-blue-100/50 transition-colors"
                  >
                    <span className="text-xs font-semibold text-blue-700">
                      {t('reviewModal.changes.altered', { count: itensAlterados.length })}
                    </span>
                    <ChevronDown className={cn('w-3.5 h-3.5 text-blue-400 transition-transform', alteredOpen && 'rotate-180')} />
                  </button>
                  {alteredOpen && (
                    <div className="overflow-x-auto max-h-60 overflow-y-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="sticky top-0">
                          <tr className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-t border-slate-200">
                            <th className="px-4 py-2">{t('reviewModal.tableHeaders.code')}</th>
                            <th className="px-4 py-2">{t('reviewModal.tableHeaders.product')}</th>
                            <th className="px-4 py-2 text-center">{t('reviewModal.tableHeaders.class')}</th>
                            <th className="px-4 py-2 text-center">{t('reviewModal.tableHeaders.month')}</th>
                            <th className="px-4 py-2 text-right">{t('reviewModal.changes.prevFcts')}</th>
                            <th className="px-4 py-2 text-right">{t('reviewModal.tableHeaders.fcts')}</th>
                            <th className="px-4 py-2 text-right">Δ%</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {alteredByFamily.map(({ familia, entries }) => (
                            <React.Fragment key={familia}>
                              <tr className="bg-slate-50/80">
                                <td colSpan={7} className="px-4 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                  {familia}
                                </td>
                              </tr>
                              {entries.map(entry => {
                                const prev  = entry.prevFCTS ?? 0;
                                const delta = prev > 0 ? (entry.fcts / prev - 1) * 100 : null;
                                return (
                                  <tr key={entry.id} className="hover:bg-slate-50/60">
                                    <td className="px-4 py-2 font-mono text-[10px] text-slate-400 shrink-0">{entry.produtoCodigo}</td>
                                    <td className="px-4 py-2 text-xs text-slate-700 max-w-[180px] truncate">{entry.produtoDescricao}</td>
                                    <td className="px-4 py-2 text-center">
                                      {entry.classe ? (
                                        <span className={cn(
                                          'inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold border',
                                          CLASSE_BADGE_COLORS[entry.classe] ?? 'bg-slate-100 text-slate-500 border-slate-200',
                                        )}>
                                          {entry.classe}
                                        </span>
                                      ) : <span className="text-slate-200">—</span>}
                                    </td>
                                    <td className="px-4 py-2 text-center text-[10px] text-slate-500 tabular-nums whitespace-nowrap">
                                      {monthLabel(entry.month)}
                                    </td>
                                    <td className="px-4 py-2 text-right text-xs text-slate-400 tabular-nums">{prev > 0 ? fmt(prev) : '—'}</td>
                                    <td className="px-4 py-2 text-right text-xs font-semibold text-slate-700 tabular-nums">{fmt(entry.fcts)}</td>
                                    <td className="px-4 py-2 text-right">
                                      <span className={cn('text-xs font-bold', desvioColor(delta))}>
                                        {delta !== null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%` : t('reviewModal.changes.new')}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Famílias não revisadas */}
              {familiasNaoRevisadas.length > 0 && (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setUnreviewedOpen(o => !o)}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100/50 transition-colors"
                  >
                    <span className="text-xs font-semibold text-slate-500">
                      {t('reviewModal.changes.unreviewed', { count: familiasNaoRevisadas.length })}
                    </span>
                    <ChevronDown className={cn('w-3.5 h-3.5 text-slate-400 transition-transform', unreviewedOpen && 'rotate-180')} />
                  </button>
                  {unreviewedOpen && (
                    <div className="px-4 py-3 flex flex-wrap gap-1.5 border-t border-slate-100 bg-white">
                      {familiasNaoRevisadas.map(fam => (
                        <span key={fam} className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-[11px] font-medium">
                          {fam}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Painel de alertas */}
          {hasAlerts ? (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setAlertsOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100/60 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                    {t('reviewModal.alerts.title')}
                  </span>
                </div>
                <ChevronDown className={cn('w-3.5 h-3.5 text-slate-400 transition-transform', alertsOpen && 'rotate-180')} />
              </button>
              {alertsOpen && (
                <div className="border-t border-slate-200 p-3 space-y-3">
                  {alertsSemFCTS.length > 0 && (
                    <AlertGroup
                      title={t('reviewModal.alerts.noFcts', { count: alertsSemFCTS.length })}
                      color="red"
                    >
                      {alertsSemFCTS.map(item => (
                        <AlertRow key={item.id}>
                          <span className="font-mono text-[10px] text-slate-400 w-20 shrink-0">{item.produto.codigo}</span>
                          <span className="text-xs text-slate-600 truncate flex-1">{item.produto.descricao}</span>
                          <span className="text-[10px] text-slate-400 shrink-0">{getFamilia(item)}</span>
                        </AlertRow>
                      ))}
                    </AlertGroup>
                  )}

                  {alertsPaisesSemFCTS.length > 0 && (
                    <AlertGroup
                      title={t('reviewModal.alerts.noSaleCountry', { count: alertsPaisesSemFCTS.length })}
                      color="red"
                    >
                      {alertsPaisesSemFCTS.map(c => (
                        <AlertRow key={c.iso3}>
                          <span className="font-mono text-[10px] text-slate-400 w-14 shrink-0">{c.iso3}</span>
                          <span className="text-xs text-slate-600 truncate flex-1">{c.nome}</span>
                        </AlertRow>
                      ))}
                    </AlertGroup>
                  )}

                  {alertsProdutosSemCobertura.length > 0 && (
                    <AlertGroup
                      title={t('reviewModal.alerts.noSaleProduct', { count: alertsProdutosSemCobertura.length })}
                      color="red"
                    >
                      {alertsProdutosSemCobertura.map(p => (
                        <AlertRow key={p.codigo}>
                          <span className="font-mono text-[10px] text-slate-400 w-20 shrink-0">{p.codigo}</span>
                          <span className="text-xs text-slate-600 truncate flex-1">{p.descricao}</span>
                          <span className="text-[10px] text-slate-400 shrink-0">{p.familia}</span>
                        </AlertRow>
                      ))}
                    </AlertGroup>
                  )}

                  {alertsPaisesParcias.length > 0 && (
                    <AlertGroup
                      title={t('reviewModal.alerts.partialCountry', { count: alertsPaisesParcias.length })}
                      color="amber"
                    >
                      {alertsPaisesParcias.map(c => (
                        <AlertRow key={c.iso3}>
                          <span className="font-mono text-[10px] text-slate-400 w-14 shrink-0">{c.iso3}</span>
                          <span className="text-xs text-slate-600 truncate flex-1">{c.nome}</span>
                          <span className="text-[10px] tabular-nums text-slate-400 shrink-0">
                            {c.skuWithFCTS}/{c.totalSku} SKUs
                          </span>
                        </AlertRow>
                      ))}
                    </AlertGroup>
                  )}

                  {alertsDesvioAlto.length > 0 && (
                    <AlertGroup
                      title={t('reviewModal.alerts.highDeviation', { count: alertsDesvioAlto.length, threshold: DESVIO_THRESHOLD })}
                      color="amber"
                    >
                      {alertsDesvioAlto.map(item => {
                        const fcts = item.fctsForDesvio ?? 0;
                        const ref  = item.vendaAA ?? 0;
                        const d = desvioGlobal(fcts, ref);
                        return (
                          <AlertRow key={item.id}>
                            <span className="font-mono text-[10px] text-slate-400 w-20 shrink-0">{item.produto.codigo}</span>
                            <span className="text-xs text-slate-600 truncate flex-1">{item.produto.descricao}</span>
                            <span className="text-[10px] tabular-nums text-slate-400 shrink-0">
                              {t('columns.yoy')} {fmt(ref)} → {t('columns.fcts')} {fmt(fcts)}
                            </span>
                            <span className={cn("text-xs font-bold shrink-0 w-14 text-right", desvioColor(d))}>
                              {d !== null ? `${d > 0 ? '+' : ''}${d.toFixed(1)}%` : '—'}
                            </span>
                          </AlertRow>
                        );
                      })}
                    </AlertGroup>
                  )}

                  {alertsHorizon.familias.length > 0 && (
                    <AlertGroup
                      title={t('reviewModal.alerts.horizonNotReviewed', {
                        count: alertsHorizon.familias.length,
                        month: monthLabel(alertsHorizon.horizonMonth),
                      })}
                      color="amber"
                    >
                      <div className="px-4 py-2.5 flex flex-wrap gap-1.5 bg-white">
                        {alertsHorizon.familias.map(fam => (
                          <span key={fam} className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-md text-[11px] font-medium">
                            {fam}
                          </span>
                        ))}
                      </div>
                    </AlertGroup>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-700">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="text-sm font-medium">
                {t('reviewModal.allGood', { threshold: DESVIO_THRESHOLD })}
              </span>
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
          >
            {t('reviewModal.back')}
          </button>
          <div className="flex items-center gap-3">
            {hasAlerts && (
              <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {t('reviewModal.hasAlerts')}
              </span>
            )}
            <button
              onClick={onConfirm}
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-sky-600/20 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {submitting ? t('reviewModal.confirming') : t('reviewModal.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── sub-componentes ───────────────────────────────────────────────────────────

const KpiCard: React.FC<{ label: string; value: string; valueClass?: string }> = ({
  label, value, valueClass,
}) => (
  <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">{label}</p>
    <p className={cn("text-sm font-bold tabular-nums", valueClass ?? "text-slate-700")}>{value}</p>
  </div>
);

const AlertGroup: React.FC<{
  title: string;
  color: 'red' | 'amber';
  children: React.ReactNode;
}> = ({ title, color, children }) => (
  <div className={cn(
    "rounded-xl border overflow-hidden",
    color === 'red' ? "border-red-200" : "border-amber-200"
  )}>
    <div className={cn(
      "flex items-center gap-2 px-4 py-2",
      color === 'red' ? "bg-red-50" : "bg-amber-50"
    )}>
      <AlertTriangle className={cn("w-3.5 h-3.5 shrink-0", color === 'red' ? "text-red-500" : "text-amber-500")} />
      <span className={cn("text-xs font-semibold", color === 'red' ? "text-red-700" : "text-amber-700")}>
        {title}
      </span>
    </div>
    <div className="divide-y divide-slate-100 max-h-36 overflow-y-auto">
      {children}
    </div>
  </div>
);

const AlertRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center gap-3 px-4 py-2 bg-white hover:bg-slate-50 transition-colors">
    {children}
  </div>
);
