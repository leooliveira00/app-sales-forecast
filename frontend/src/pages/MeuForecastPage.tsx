import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useToast, ToastContainer } from '../components/shared/ToastNotification';
import { AlertCircle, CalendarRange, Globe, History, Send, Plus, ChevronLeft, ChevronRight, Trash2, TriangleAlert } from 'lucide-react';
import { cn, InfoTooltip, ConfirmModal } from '../components/shared/Common';

import { useForecastNavigation } from '../hooks/useForecastNavigation';
import { useAnnualForecastData } from '../hooks/useAnnualForecastData';
import { useForecastPagination } from '../hooks/useForecastPagination';
import type { FamilyGroup as FamilyGroupType } from '../hooks/useForecastPagination';

import { CycleSelector } from '../components/forecast/CycleSelector';
import { ForecastStatusBanner } from '../components/forecast/ForecastStatusBanner';
import { UnitKpiBar } from '../components/forecast/UnitKpiBar';
import { AnnualFamilyRows } from '../components/forecast/AnnualFamilyRows';
import { CountryDropdown, type FillStatus } from '../components/forecast/CountryDropdown';
import { AddProductModal } from '../components/forecast/AddProductModal';
import { CopyForecastModal } from '../components/forecast/CopyForecastModal';
import { ExcludedProductsModal } from '../components/forecast/ExcludedProductsModal';
import { SubmitReviewModal } from '../components/forecast/SubmitReviewModal';
import { ForecastSearchBar } from '../components/forecast/ForecastSearchBar';
import { useCountryName } from '../hooks/useCountryName';

import type { AnnualProduct, AnnualMonthEntry } from '../hooks/useAnnualForecastData';
import type { ForecastItem } from '../types/forecast';
import { generateUUID } from '../utils/uuid';

// Em modo "Todos os países" (visão consolidada), colapsa os meses de todos os
// países em uma única linha por mês, somando os valores. O FCTS exibido é o
// forecast efetivo (override ?? prevFCTS ?? ORC) — mesma base do pré-preenchimento
// dos inputs e dos KPIs, garantindo consistência entre a visão consolidada e a
// edição por país. paisIso3 é zerado (null) para suprimir o badge de país.
function aggregateConsolidatedMonths(prod: AnnualProduct): AnnualMonthEntry[] {
  const sumNullable = (a: number | null, b: number | null): number | null =>
    a == null && b == null ? null : (a ?? 0) + (b ?? 0);
  const byMonth = new Map<string, AnnualMonthEntry>();
  for (const m of prod.months) {
    const effective = m.override?.volumeFCTS ?? m.prevFCTS ?? m.volumeORC ?? 0;
    const acc = byMonth.get(m.month);
    if (!acc) {
      byMonth.set(m.month, {
        month:          m.month,
        itemId:         `agg|${prod.produtoId}|${m.month}`,
        volumeORC:      m.volumeORC ?? 0,
        volumeIA:       m.volumeIA,
        prevFCTS:       m.prevFCTS,
        vendaAA:        m.vendaAA,
        override:       { id: '', volumeFCTS: effective },
        gestorExcluido: m.gestorExcluido,
        paisIso3:       null,
      });
    } else {
      acc.volumeORC     += m.volumeORC ?? 0;
      acc.volumeIA       = sumNullable(acc.volumeIA, m.volumeIA);
      acc.prevFCTS       = sumNullable(acc.prevFCTS, m.prevFCTS);
      acc.vendaAA        = sumNullable(acc.vendaAA, m.vendaAA);
      acc.override       = { id: '', volumeFCTS: (acc.override?.volumeFCTS ?? 0) + effective };
      acc.gestorExcluido = acc.gestorExcluido && m.gestorExcluido;
    }
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// Adapts AnnualProduct to a slim ForecastItem for pagination/modal compatibility.
// Only fills fields actually used by useForecastPagination, ExcludedProductsModal
// and SubmitReviewModal (NACIONAL path).
function adaptProduct(prod: AnnualProduct): ForecastItem {
  const totalORC      = prod.months.reduce((s, m) => s + (m.volumeORC ?? 0), 0);
  const totalFCTS     = prod.months.reduce((s, m) => s + (m.override?.volumeFCTS ?? m.prevFCTS ?? 0), 0);
  const totalPrevFCTS = prod.months.reduce((s, m) => s + (m.prevFCTS ?? 0), 0);
  // Filtro simétrico: soma vendaAA + FCTS dos MESMOS meses com A.A. válido.
  // Meses sem venda no ano anterior são ignorados em ambos para não inflar o desvio.
  const monthsWithAA  = prod.months.filter(m => m.vendaAA != null && m.vendaAA > 0);
  const totalVendaAA  = monthsWithAA.reduce((s, m) => s + (m.vendaAA ?? 0), 0);
  const fctsForDesvio = monthsWithAA.reduce((s, m) => s + (m.override?.volumeFCTS ?? m.prevFCTS ?? 0), 0);
  return {
    id:           prod.produtoId,
    runId:        '',
    month:        prod.months[0]?.month ?? '',
    volumeORC:    totalORC,
    volumeIA:     null,
    prevFCTS:     totalPrevFCTS > 0 ? totalPrevFCTS : null,
    avgTrim:      prod.avgTrim,
    avgSem:       prod.avgSem,
    avg12m:       prod.avg12m,
    salesHistory: prod.salesHistory,
    orcHistory:   prod.orcHistory,
    vendaAA:        totalVendaAA > 0 ? totalVendaAA : null,
    fctsForDesvio:  totalVendaAA > 0 ? fctsForDesvio : null,
    source:       prod.source,
    isDefaultPortfolio: true,
    gestorExcluido: prod.gestorExcluido,
    produto: {
      codigo:    prod.codigo,
      descricao: prod.descricao,
      classe:    prod.classe,
      unidades:  [{ familia: prod.familia ?? '', divisao: '' }],
    },
    overrides: totalFCTS > 0 ? [{ id: '', volumeFCTS: totalFCTS }] : [],
  } as unknown as ForecastItem;
}

// Para EXPORT: gera um ForecastItem por (produto × país), com paisIso3 preenchido.
// O SubmitReviewModal usa paisIso3 para montar resumos e alertas por país.
function adaptProductExport(
  prod: AnnualProduct,
  paisNomes: Map<string, string>,
): ForecastItem[] {
  type Acc = { orc: number; fcts: number; vendaAA: number; fctsForDesvio: number };
  const byCountry = new Map<string, Acc>();
  for (const m of prod.months) {
    if (!m.paisIso3) continue;
    const entry = byCountry.get(m.paisIso3) ?? { orc: 0, fcts: 0, vendaAA: 0, fctsForDesvio: 0 };
    entry.orc  += m.volumeORC ?? 0;
    entry.fcts += m.override?.volumeFCTS ?? m.prevFCTS ?? 0;
    // Filtro simétrico por país: vendaAA + FCTS só dos meses com A.A. válido daquele país.
    if (m.vendaAA != null && m.vendaAA > 0) {
      entry.vendaAA       += m.vendaAA;
      entry.fctsForDesvio += m.override?.volumeFCTS ?? m.prevFCTS ?? 0;
    }
    byCountry.set(m.paisIso3, entry);
  }
  return [...byCountry.entries()].map(([paisIso3, { orc, fcts, vendaAA, fctsForDesvio }]) => ({
    id:           `${prod.produtoId}|${paisIso3}`,
    runId:        '',
    month:        prod.months[0]?.month ?? '',
    paisIso3,
    pais:         { iso3: paisIso3, nome: paisNomes.get(paisIso3) ?? paisIso3 },
    volumeORC:    orc,
    volumeIA:     null,
    prevFCTS:     null,
    avgTrim:      prod.avgTrim,
    avgSem:       prod.avgSem,
    avg12m:       prod.avg12m,
    salesHistory: prod.salesHistory,
    orcHistory:   prod.orcHistory,
    vendaAA:        vendaAA > 0 ? vendaAA : null,
    fctsForDesvio:  vendaAA > 0 ? fctsForDesvio : null,
    source:       prod.source,
    isDefaultPortfolio: true,
    gestorExcluido: prod.gestorExcluido,
    produto: {
      codigo:    prod.codigo,
      descricao: prod.descricao,
      classe:    prod.classe,
      unidades:  [{ familia: prod.familia ?? '', divisao: '' }],
    },
    overrides: fcts > 0 ? [{ id: '', volumeFCTS: fcts }] : [],
  } as unknown as ForecastItem));
}

export const MeuForecastPage: React.FC = () => {
  const { token, activeUnidade } = useAuth();
  const { showToast, toasts, removeToast } = useToast();
  const { t } = useTranslation('forecast');

  const countryName = useCountryName();

  const handleError   = useCallback((msg: string) => showToast(msg, 'error'),   [showToast]);
  const handleSuccess = useCallback((msg: string) => showToast(msg, 'success'), [showToast]);

  const unidade = activeUnidade;
  const isExport = (unidade?.unidadeVenda.paises?.length ?? 0) > 0;

  // ── Navegação de ciclo ────────────────────────────────────────────────────

  const {
    cycleDate, availableRuns,
    cycleParam,
    activeRun, isHistorical, cycleIsClosed,
    pendingReleaseDate,
    canPrevCycle, canNextCycle,
    setCycleByKey, navigateCycle,
  } = useForecastNavigation(token);

  // ── Estado do filtro por país (EXPORT) — declarado antes do hook que o consome
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  // ── Dados anuais ──────────────────────────────────────────────────────────

  const {
    products, fcts, setFcts,
    isLoading, submission,
    savingId, submitting,
    showAddModal, setShowAddModal,
    isDirty, cycleWindowLabel,
    saveFCTS, saveFCTSBulk,
    handleProductAcceptIA,
    handleExcludeProduct, handleRestoreProduct,
    handleAddProduct, handleAddBatch, handleSubmit,
  } = useAnnualForecastData({
    unidadeCodigo: unidade?.unidadeVenda.codigo,
    cycleParam,
    activeRun,
    token,
    selectedCountry: isExport ? selectedCountry : null,
    onSuccess: handleSuccess,
    onError:   handleError,
  });

  // ── Lookup de AnnualProduct por produtoId ─────────────────────────────────

  const productById = useMemo(
    () => new Map(products.map(p => [p.produtoId, p])),
    [products]
  );

  // Ciclo antigo: todos os itens têm paisIso3 = null (backfill sem proporcionalização por país).
  // Nesses ciclos o seletor de país é travado e o badge de aviso é exibido.
  // Avaliado apenas em modo "Todos os países": quando um país específico está selecionado,
  // a API retorna itens paisIso3=null por design (cláusula OR), causando falso-positivo
  // que revertia o seletor ao disparar setSelectedCountry(null) no efeito abaixo.
  const isUndistributedCycle = useMemo(
    () => isExport && selectedCountry === null && products.length > 0 &&
      !products.some(p => p.months.some(m => m.paisIso3 !== null)),
    [isExport, selectedCountry, products]
  );

  const hasGlobalData = isUndistributedCycle;

  // Visão consolidada: EXPORT em "Todos os países" com distribuição por país.
  // É somente leitura — toda edição/mutação acontece com um país selecionado.
  const isConsolidatedView =
    isExport && selectedCountry === null && !isUndistributedCycle && products.length > 0;

  // Força deselect quando o ciclo não tem distribuição por país.
  useEffect(() => {
    if (isUndistributedCycle) setSelectedCountry(null);
  }, [isUndistributedCycle]);

  // Default: ao abrir uma unidade EXPORT com distribuição por país, seleciona
  // automaticamente o primeiro país (em vez de cair na visão consolidada "Todos").
  // Aplicado uma vez por ciclo — após isso, o usuário pode voltar a "Todos"
  // manualmente sem ser reposicionado.
  const didDefaultCountry = useRef(false);
  useEffect(() => { didDefaultCountry.current = false; }, [cycleParam]);
  useEffect(() => {
    if (!isExport || didDefaultCountry.current) return;
    if (isUndistributedCycle || selectedCountry !== null) return;
    const paises = unidade?.unidadeVenda.paises ?? [];
    const hasDistribution = products.some(p => p.months.some(m => m.paisIso3 !== null));
    if (hasDistribution && paises.length > 0) {
      didDefaultCountry.current = true;
      setSelectedCountry(paises[0].iso3);
    }
  }, [isExport, isUndistributedCycle, selectedCountry, products, unidade]);

  // ── Filtro por país para EXPORT ───────────────────────────────────────────
  // Quando um país está selecionado, restringe os meses ao país exato.
  // Itens com paisIso3 = null (sem distribuição por país) são ocultados para evitar
  // que o gestor edite o mesmo override acreditando estar preenchendo países distintos.
  const filteredProducts = useMemo(() => {
    if (!isExport) return products;
    if (selectedCountry !== null) {
      return products
        .map(p => ({ ...p, months: p.months.filter(m => m.paisIso3 === selectedCountry) }))
        .filter(p => p.months.length > 0);
    }
    // selectedCountry === null (Todos os países)
    // Ciclo legado sem distribuição por país: edição normal (uma linha por mês).
    if (isUndistributedCycle) return products;
    // Visão consolidada: 1 linha por mês somando os países (somente leitura).
    return products.map(p => ({ ...p, months: aggregateConsolidatedMonths(p) }));
  }, [products, isExport, selectedCountry, isUndistributedCycle]);

  // ── Status de preenchimento por país (EXPORT) ────────────────────────────
  const countryFillStatus = useMemo((): Record<string, FillStatus> => {
    if (!isExport) return {};
    const result: Record<string, FillStatus> = {};
    const paises = unidade?.unidadeVenda.paises ?? [];
    for (const pais of paises) {
      const countryMonths = products.flatMap(p =>
        p.months.filter(m => m.paisIso3 === pais.iso3)
      );
      if (countryMonths.length === 0) continue;
      const withOverride = countryMonths.filter(m => m.override != null).length;
      if (withOverride === 0) result[pais.iso3] = 'empty';
      else if (withOverride === countryMonths.length) result[pais.iso3] = 'filled';
      else result[pais.iso3] = 'partial';
    }
    return result;
  }, [isExport, products, unidade]);

  // ── Grupos por família ────────────────────────────────────────────────────

  const groupedProducts = useMemo(() => {
    const map = new Map<string, AnnualProduct[]>();
    for (const prod of filteredProducts) {
      const fam = prod.familia?.trim() || t('others');
      if (!map.has(fam)) map.set(fam, []);
      map.get(fam)!.push(prod);
    }
    return [...map.entries()].map(([familia, prods]) => ({ familia, prods }));
  }, [filteredProducts]);

  // ── Adaptar para useForecastPagination (que usa ForecastItem[]) ───────────

  const adaptedGroups = useMemo((): FamilyGroupType[] =>
    groupedProducts.map(({ familia, prods }) => ({
      familia,
      itens: prods.map(adaptProduct),
    })),
  [groupedProducts]);

  // ── Produtos com desvio sistemático (crônicos) vs vendas reais ─────────────
  // Janela-independente: backend ancora nos últimos 3 meses com dados de vendas.
  const [divergentProductCodes, setDivergentProductCodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!token || !unidade?.unidadeVenda.codigo) {
      setDivergentProductCodes(new Set());
      return;
    }
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/forecast/produtos-cronicos?unidadeVendaId=${encodeURIComponent(unidade.unidadeVenda.codigo)}`,
          { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal },
        );
        if (!res.ok) { setDivergentProductCodes(new Set()); return; }
        const data: Array<{ produtoCodigo: string }> = await res.json();
        setDivergentProductCodes(new Set(data.map(d => d.produtoCodigo)));
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setDivergentProductCodes(new Set());
      }
    })();
    return () => ctrl.abort();
  }, [token, unidade?.unidadeVenda.codigo]);

  // ── Paginação e busca ─────────────────────────────────────────────────────

  const [selectedClasses, setSelectedClasses] = useState<Set<string>>(new Set());

  const handleClassToggle = useCallback((classe: string) => {
    setSelectedClasses(prev => {
      const next = new Set(prev);
      next.has(classe) ? next.delete(classe) : next.add(classe);
      return next;
    });
  }, []);

  const PAGE_SIZE_OPTIONS = [5, 8, 15, 20, 50] as const;
  const [pageSize, setPageSize] = useState<number>(8);

  const {
    searchQuery, setSearchQuery,
    currentPage, setCurrentPage,
    paginatedGroups,
    totalPages,
    filteredTotal,
    resetPage,
    onlyDivergentes, setOnlyDivergentes,
    divergentesCount,
    excludedItems,
  } = useForecastPagination({ groupedItems: adaptedGroups, divergentProductCodes, selectedClasses, pageSize });

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  }, [setCurrentPage]);

  // Reset pagination when cycle changes
  useEffect(() => { resetPage(); }, [cycleParam, resetPage]);

  const [collapsedFamilies,  setCollapsedFamilies]  = useState<Set<string>>(new Set());
  const [showExcludedModal,  setShowExcludedModal]  = useState(false);
  const [showReviewModal,    setShowReviewModal]    = useState(false);
  const [dismissedBanners,   setDismissedBanners]   = useState<Set<string>>(new Set());
  // Cópia de forecast: produto de origem aberto no modal; e origem aguardando
  // o prompt de exclusão após a cópia ser aplicada.
  const [copySource,         setCopySource]         = useState<AnnualProduct | null>(null);
  const [excludeAfterCopy,   setExcludeAfterCopy]   = useState<AnnualProduct | null>(null);

  // Reseta o filtro de país ao trocar de ciclo
  useEffect(() => { setSelectedCountry(null); }, [cycleParam]);

  const handleDismissBanner = useCallback((key: string) =>
    setDismissedBanners(prev => new Set([...prev, key])),
  []);

  // ── Cópia de forecast ─────────────────────────────────────────────────────
  // Alvos elegíveis: produtos do contexto carregado (mesmo país, em EXPORT),
  // excluindo a própria origem e produtos já excluídos.
  const copyCandidates = useMemo(
    () => copySource
      ? filteredProducts.filter(p => !p.gestorExcluido && p.produtoId !== copySource.produtoId)
      : [],
    [filteredProducts, copySource],
  );

  const handleCopyApply = useCallback(async (updates: Record<string, number>) => {
    if (Object.keys(updates).length === 0) return true;
    return saveFCTSBulk(updates, {
      operation:     'COPY_FROM_PRODUCT',
      basis:         copySource?.codigo,
      correlationId: generateUUID(),
      affectedCount: Object.keys(updates).length,
    });
  }, [saveFCTSBulk, copySource]);

  // Após copiar com sucesso: fecha o modal e oferece excluir a origem.
  // Em EXPORT com país selecionado, exclui só aquele país (mesmo contexto da cópia).
  const handleCopyApplied = useCallback(() => {
    setExcludeAfterCopy(copySource);
    setCopySource(null);
  }, [copySource]);

  // Reset banners e filtros de classe ao trocar de ciclo
  useEffect(() => {
    setDismissedBanners(new Set());
    setSelectedClasses(new Set());
  }, [cycleParam]);

  const toggleFamily = useCallback((familia: string) => {
    setCollapsedFamilies(prev => {
      const next = new Set(prev);
      if (next.has(familia)) next.delete(familia);
      else next.add(familia);
      return next;
    });
  }, []);

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const activeProducts = useMemo(
    () => filteredProducts.filter(p => !p.gestorExcluido),
    [filteredProducts]
  );

  const totalORC = useMemo(
    () => activeProducts.reduce(
      (s, p) => s + p.months.reduce((ms, m) => ms + (m.volumeORC ?? 0), 0), 0
    ),
    [activeProducts]
  );

  const totalFCTS = useMemo(
    () => activeProducts.reduce((s, p) => {
      const prodFcts = p.months.reduce((ms, m) => {
        if (m.override) return ms + m.override.volumeFCTS;
        if (m.prevFCTS != null) return ms + m.prevFCTS;
        return ms + (m.volumeORC ?? 0);
      }, 0);
      return s + prodFcts;
    }, 0),
    [activeProducts]
  );

  // "filled" = product has at least 1 month with a saved override OR a previous-cycle FCTS value
  const filledCount = useMemo(
    () => activeProducts.filter(p => p.months.some(m => m.override != null || m.prevFCTS != null)).length,
    [activeProducts]
  );

  const isReadOnly = isHistorical
    || cycleIsClosed
    || submission?.status === 'SUBMITTED'
    || submission?.status === 'APPROVED';

  const countryCount    = unidade?.unidadeVenda.paises?.length ?? 0;
  const selectedCountryNome = useMemo(
    () => {
      if (!selectedCountry) return null;
      const dbNome = (unidade?.unidadeVenda.paises ?? []).find(p => p.iso3 === selectedCountry)?.nome;
      return countryName(selectedCountry, dbNome);
    },
    [unidade, selectedCountry, countryName],
  );
  // For Export with a country selected, only products present in that country are "in cycle"
  const presentProdutoIds = new Set(
    filteredProducts.filter(p => !p.gestorExcluido).map(p => p.codigo)
  );

  // ── Guard: sem unidade ────────────────────────────────────────────────────

  if (!unidade) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400">
        <AlertCircle className="w-10 h-10 mb-3" />
        <p className="font-medium">{t('noUnit.message')}</p>
        <p className="text-sm">{t('noUnit.hint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      {showAddModal && (
        <AddProductModal
          token={token!}
          unidadeVendaId={unidade.unidadeVenda.codigo}
          presentIds={presentProdutoIds}
          onAdd={handleAddProduct}
          onAddBatch={handleAddBatch}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {showExcludedModal && (
        <ExcludedProductsModal
          items={excludedItems}
          isReadOnly={isReadOnly}
          onRestore={(item) => {
            const prod = productById.get(item.id);
            if (prod) handleRestoreProduct(prod);
          }}
          onRestoreFamily={(items) => {
            items.forEach(item => {
              const prod = productById.get(item.id);
              if (prod) handleRestoreProduct(prod);
            });
          }}
          onRestoreAll={() => {
            products.filter(p => p.gestorExcluido).forEach(p => handleRestoreProduct(p));
          }}
          onClose={() => setShowExcludedModal(false)}
        />
      )}

      {showReviewModal && cycleDate && (
        <SubmitReviewModal
          items={(() => {
            const active = products.filter(p => !p.gestorExcluido);
            if (!isExport) return active.map(adaptProduct);
            const paisNomes = new Map((unidade.unidadeVenda.paises ?? []).map(p => [p.iso3, p.nome]));
            return active.flatMap(p => adaptProductExport(p, paisNomes));
          })()}
          annualProducts={products.filter(p => !p.gestorExcluido)}
          cycleDate={cycleDate}
          isExport={isExport}
          unidade={unidade.unidadeVenda}
          paises={unidade.unidadeVenda.paises ?? []}
          submitting={submitting}
          onConfirm={async () => { try { await handleSubmit(); } finally { setShowReviewModal(false); } }}
          onClose={() => setShowReviewModal(false)}
        />
      )}

      {copySource && (
        <CopyForecastModal
          source={copySource}
          candidates={copyCandidates}
          fcts={fcts}
          onApply={handleCopyApply}
          onApplied={handleCopyApplied}
          onClose={() => setCopySource(null)}
        />
      )}

      <ConfirmModal
        isOpen={!!excludeAfterCopy}
        title={t('copyModal.excludeTitle')}
        message={t('copyModal.excludeBody', { codigo: excludeAfterCopy?.codigo ?? '' })}
        confirmText={t('copyModal.excludeConfirm')}
        cancelText={t('copyModal.excludeCancel')}
        isDanger
        onConfirm={() => {
          if (excludeAfterCopy) {
            handleExcludeProduct(excludeAfterCopy, isExport && selectedCountry ? 'country' : 'all');
          }
          setExcludeAfterCopy(null);
        }}
        onCancel={() => setExcludeAfterCopy(null)}
      />

      {/* Header: título + badges */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-2xl font-bold text-slate-900">{t('title')}</h2>
          {isExport && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-full text-[10px] font-bold uppercase">
              <Globe className="w-3 h-3" /> Export
            </span>
          )}
          {(isHistorical || cycleIsClosed) && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-600 border border-amber-100 rounded-full text-[10px] font-bold uppercase">
              <History className="w-3 h-3" /> {t('badges.history')}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500 mt-0.5">
          {t('unitLabel')} <span className="font-bold text-slate-700">{unidade.unidadeVenda.descricao}</span>
          {' — '}{unidade.unidadeVenda.codigo}
          {isExport && countryCount > 0 && (
            <span className="ml-2 text-indigo-500 font-medium">{t('countriesCount', { count: countryCount })}</span>
          )}
        </p>
      </div>

      {/* Banners de status e avisos */}
      <ForecastStatusBanner
        submission={submission}
        cycleDate={cycleDate}
        isHistorical={isHistorical || cycleIsClosed}
        pendingReleaseDate={pendingReleaseDate}
        availableUntil={activeRun?.availableUntil ?? null}
        isLoading={isLoading}
        dismissed={dismissedBanners}
        onDismiss={handleDismissBanner}
      />

      {/* KPI bar */}
      {products.length > 0 && (
        <div data-tour="forecast-kpi-bar">
        <UnitKpiBar
          totalFCTS={totalFCTS}
          totalORC={totalORC}
          familyCount={groupedProducts.length}
          skuCount={activeProducts.length}
          filledCount={filledCount}
          classeTopPct={null}
          isExport={isExport}
          unidadeVendaId={unidade.unidadeVenda.codigo}
          token={token ?? ''}
          selectedCountry={undefined}
        />
        </div>
      )}

      {/* Grupos por família */}
      <div data-tour="forecast-products" className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Cabeçalho: título + ações */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-100">
          {/* Toolbar: CycleSelector + janela badge + ações */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div data-tour="forecast-cycle" className="flex items-center gap-2 flex-wrap">
              <CycleSelector
                availableRuns={availableRuns}
                cycleParam={cycleParam}
                isHistorical={isHistorical}
                onCycleChange={setCycleByKey}
                canPrevCycle={canPrevCycle}
                canNextCycle={canNextCycle}
                onCyclePrev={() => navigateCycle('prev')}
                onCycleNext={() => navigateCycle('next')}
              />
              {cycleWindowLabel && (
                <div className="flex items-center bg-slate-100 rounded-xl p-1">
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white shadow-sm select-none">
                    <CalendarRange className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-sm font-semibold text-slate-800">{cycleWindowLabel}</span>
                    <InfoTooltip
                      text={t('cycleWindowTooltip')}
                      position="bottom"
                      width="w-60"
                    />
                  </div>
                </div>
              )}
              {isExport && !isLoading && (unidade.unidadeVenda.paises?.length ?? 0) > 0 && (
                <CountryDropdown
                  paises={unidade.unidadeVenda.paises ?? []}
                  selected={selectedCountry}
                  onSelect={setSelectedCountry}
                  fillStatus={countryFillStatus}
                  disabled={isUndistributedCycle}
                />
              )}
              {hasGlobalData && (
                <span className="flex items-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded-full text-[11px] font-semibold">
                  <TriangleAlert className="w-3 h-3 shrink-0" />
                  {t('globalDataWarning')}
                  <InfoTooltip
                    text={t('globalDataWarningTooltip')}
                    position="bottom"
                    width="w-72"
                  />
                </span>
              )}
              {isConsolidatedView && (
                <span className="flex items-center gap-1 px-2 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-full text-[11px] font-semibold">
                  <Globe className="w-3 h-3 shrink-0" />
                  {t('consolidatedView.badge')}
                  <InfoTooltip
                    text={t('consolidatedView.tooltip')}
                    position="bottom"
                    width="w-72"
                  />
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {excludedItems.length > 0 && !isConsolidatedView && (
                <button
                  onClick={() => setShowExcludedModal(true)}
                  title={t('excludedProducts.title')}
                  className="relative flex items-center gap-1.5 px-3 py-2 text-slate-500 text-sm font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1">
                    {excludedItems.length}
                  </span>
                </button>
              )}
              {!isReadOnly && !isConsolidatedView && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-sky-700 text-sm font-bold rounded-xl border border-sky-200 bg-sky-50 hover:bg-sky-100 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  {t('addProduct')}
                </button>
              )}
              {!isReadOnly && !isConsolidatedView && products.length > 0 && (
                <button
                  data-tour="forecast-submit"
                  onClick={() => setShowReviewModal(true)}
                  disabled={submitting}
                  className={cn(
                    "flex items-center gap-2 px-5 py-2 text-white text-sm font-bold rounded-xl transition-all shadow-lg disabled:opacity-50",
                    isExport
                      ? "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20"
                      : "bg-sky-600 hover:bg-sky-700 shadow-sky-600/20"
                  )}
                >
                  <Send className="w-4 h-4" />
                  {submitting
                    ? t('submitting')
                    : submission?.status === 'REJECTED'
                      ? t('resubmitButton')
                      : t('submitButton')
                  }
                </button>
              )}
            </div>
          </div>
          {/* Título da seção + collapse */}
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-slate-100">
            <h3 className="font-bold text-slate-900">
              {isExport ? t('productsByCountry') : t('products')}
            </h3>
            {groupedProducts.length > 0 && (
              <button
                onClick={() => {
                  const allCollapsed = groupedProducts.every(g => collapsedFamilies.has(g.familia));
                  if (allCollapsed) setCollapsedFamilies(new Set());
                  else setCollapsedFamilies(new Set(groupedProducts.map(g => g.familia)));
                }}
                className="text-[10px] font-bold text-slate-400 hover:text-slate-600 border border-slate-200 px-2 py-0.5 rounded transition-colors"
              >
                {groupedProducts.every(g => collapsedFamilies.has(g.familia)) ? t('expandAll') : t('collapseAll')}
              </button>
            )}
          </div>

          {/* Barra de busca e filtros */}
          {products.length > 0 && (
            <div className="mt-3">
              <ForecastSearchBar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                selectedClasses={selectedClasses}
                onClassToggle={handleClassToggle}
                filteredTotal={filteredTotal}
                totalFamilies={groupedProducts.length}
                onlyDivergentes={onlyDivergentes}
                onToggleDivergentes={setOnlyDivergentes}
                divergentesCount={divergentesCount}
              />
            </div>
          )}
        </div>


        {isLoading ? (
          <div className="p-12 text-center text-slate-400">{t('loading')}</div>
        ) : products.length === 0 ? (
          <div className="p-12 text-center">
            <AlertCircle className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">{t('empty.message')}</p>
            <p className="text-xs text-slate-300 mt-1">{t('empty.hint')}</p>
          </div>
        ) : filteredProducts.length === 0 && selectedCountry !== null ? (
          <div className="p-12 text-center">
            <AlertCircle className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">{t('noCountryDistribution.message')}</p>
            <p className="text-xs text-slate-300 mt-1">{t('noCountryDistribution.hint')}</p>
          </div>
        ) : (
          <>
            {paginatedGroups.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-slate-400 text-sm">
                  {t('noFamilyFound', { query: searchQuery })}
                </p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-2 text-xs text-violet-500 hover:underline"
                >
                  {t('clearFilter')}
                </button>
              </div>
            ) : (
              <div className="p-4 space-y-1">
                {paginatedGroups.map(({ familia }) => {
                  const famProds = (groupedProducts.find(g => g.familia === familia)?.prods ?? [])
                    .filter(p => !p.gestorExcluido)
                    .filter(p => !onlyDivergentes || divergentProductCodes.has(p.codigo));
                  return (
                    <AnnualFamilyRows
                      key={familia}
                      familia={familia}
                      products={famProds}
                      collapsed={collapsedFamilies.has(familia)}
                      onToggle={() => toggleFamily(familia)}
                      fcts={fcts}
                      setFcts={setFcts}
                      isDirty={isDirty}
                      saveFCTS={saveFCTS}
                      savingId={savingId}
                      isReadOnly={isReadOnly}
                      isExport={isExport}
                      consolidated={isConsolidatedView}
                      selectedCountry={isExport ? selectedCountry : null}
                      selectedCountryNome={isExport ? selectedCountryNome : null}
                      onSaveBulk={saveFCTSBulk}
                      onProductAcceptIA={handleProductAcceptIA}
                      onExclude={handleExcludeProduct}
                      onRestore={handleRestoreProduct}
                      onCopyForecast={setCopySource}
                      onError={handleError}
                    />
                  );
                })}
              </div>
            )}

            {/* Controles de paginação */}
            <div className={cn(
              "px-6 py-3 border-t border-slate-100 flex items-center gap-4",
              totalPages > 1 ? "justify-between" : "justify-end"
            )}>
              {/* Zona esquerda — navegação entre páginas */}
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    {t('actions.previous', { ns: 'common' })}
                  </button>

                  <div className="flex items-center gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p)}
                        className={cn(
                          "w-8 h-8 text-sm font-bold rounded-lg transition-colors",
                          p === currentPage
                            ? isExport ? "bg-indigo-600 text-white" : "bg-sky-600 text-white"
                            : "text-slate-500 hover:bg-slate-100"
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('actions.next', { ns: 'common' })}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Zona direita — seletor de famílias por página */}
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <span className="whitespace-nowrap">{t('familiesPerPage')}</span>
                <div className="flex items-center gap-1">
                  {PAGE_SIZE_OPTIONS.map(size => (
                    <button
                      key={size}
                      onClick={() => handlePageSizeChange(size)}
                      className={cn(
                        "w-8 h-8 text-xs font-bold rounded-lg transition-colors",
                        size === pageSize
                          ? isExport ? "bg-indigo-600 text-white" : "bg-sky-600 text-white"
                          : "text-slate-500 hover:bg-slate-100 border border-slate-200"
                      )}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
