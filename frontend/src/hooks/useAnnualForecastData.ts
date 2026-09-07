import { useState, useEffect, useRef, useCallback } from 'react';
import { useConsolidadoCache } from '../context/ConsolidadoCacheContext';
import type { ForecastRun } from '../types/forecast';
import type { AuditContext } from '../types/audit';
import { generateUUID } from '../utils/uuid';
import i18n from '../i18n';

const ft = (key: string, opts?: Record<string, unknown>) => i18n.t(`toasts.${key}`, { ns: 'forecast', ...opts });

// ── Tipos do endpoint annual ─────────────────────────────────────────────────

export interface AnnualMonthEntry {
  month:          string;   // "YYYY-MM"
  itemId:         string;
  volumeORC:      number;
  volumeIA:       number | null;
  prevFCTS:       number | null;
  vendaAA:        number | null;
  override:       { id: string; volumeFCTS: number } | null;
  gestorExcluido: boolean;
  paisIso3:       string | null;
}

export interface AnnualProduct {
  produtoId:      string;
  codigo:         string;
  descricao:      string;
  classe:         string | null;
  familia:        string | null;
  gestorExcluido: boolean;
  source:         string;
  avgTrim:        number | null;
  avgSem:         number | null;
  avg12m:         number | null;
  salesHistory:   { month: string; qty: number }[];
  orcHistory:     { month: string; volumeORC: number }[];
  fctsHistory:    { month: string; fcts: number }[];
  months:         AnnualMonthEntry[];
}

export type DistributeCriterion = 'trim' | 'sem' | '12m' | 'orc' | 'aa';

interface AnnualResponse {
  run:      { windowStart: string | null; windowEnd: string | null; leadTimeMonths: number } | null;
  products: AnnualProduct[];
}

import type { Submission } from '../types/forecast';

interface UseAnnualForecastDataOptions {
  unidadeCodigo:   string | undefined;
  cycleParam:      string | null;
  activeRun:       ForecastRun | null;
  token:           string | null;
  selectedCountry?: string | null;
  onSuccess:       (msg: string) => void;
  onError:         (msg: string) => void;
}

export function useAnnualForecastData({
  unidadeCodigo, cycleParam, activeRun, token, selectedCountry, onSuccess, onError,
}: UseAnnualForecastDataOptions) {
  const [products,    setProducts]    = useState<AnnualProduct[]>([]);
  const [fcts,        setFcts]        = useState<Record<string, string>>({});
  const [isLoading,   setIsLoading]   = useState(false);
  const [submission,  setSubmission]  = useState<Submission | null>(null);
  const [savingId,    setSavingId]    = useState<string | null>(null);
  const [submitting,  setSubmitting]  = useState(false);
  const [showAddModal,setShowAddModal]= useState(false);

  const initialFcts = useRef<Record<string, string>>({});
  const dataCache   = useRef<Map<string, AnnualProduct[]>>(new Map());
  const subCache    = useRef<Map<string, Submission | null>>(new Map());

  const { invalidate: invalidateConsolidado } = useConsolidadoCache();

  // ── Inicializa fcts a partir dos produtos ─────────────────────────────────
  const initFcts = useCallback((prods: AnnualProduct[]) => {
    const next: Record<string, string> = {};
    for (const prod of prods) {
      for (const m of prod.months) {
        const val = m.override?.volumeFCTS ?? m.prevFCTS ?? m.volumeORC ?? null;
        next[m.itemId] = val != null ? val.toString() : '';
      }
    }
    initialFcts.current = { ...next };
    setFcts(next);
  }, []);

  // ── Busca dados do ciclo ──────────────────────────────────────────────────
  const fetchData = useCallback(async (bustCache = false) => {
    if (!unidadeCodigo || !cycleParam || !token) return;
    // Chave composta garante isolamento por unidade — evita cache stale ao trocar unidade
    const dataCacheKey = `${unidadeCodigo}|${cycleParam}|${selectedCountry ?? ""}`;
    const subCacheKey  = `${unidadeCodigo}|${cycleParam}`;

    if (!bustCache && dataCache.current.has(dataCacheKey)) {
      const cached = dataCache.current.get(dataCacheKey)!;
      setProducts(cached);
      initFcts(cached);
      return;
    }

    setIsLoading(true);
    try {
      const [dataRes, subRes] = await Promise.all([
        fetch(`/api/forecast/items-annual?unidadeVendaId=${unidadeCodigo}&refMonth=${cycleParam}${selectedCountry ? `&paisIso3=${selectedCountry}` : ''}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        subCache.current.has(subCacheKey)
          ? Promise.resolve(null)
          : fetch(`/api/submissions/by-unit?unidadeVendaId=${unidadeCodigo}&month=${cycleParam}`, {
              headers: { Authorization: `Bearer ${token}` },
            }),
      ]);

      const result: AnnualResponse = dataRes.ok ? await dataRes.json() : { run: null, products: [] };
      const prods = result.products ?? [];
      dataCache.current.set(dataCacheKey, prods);
      setProducts(prods);
      initFcts(prods);

      if (subRes !== null) {
        const sub: Submission | null = subRes.ok ? await subRes.json() : null;
        subCache.current.set(subCacheKey, sub);
        setSubmission(sub);
      } else {
        setSubmission(subCache.current.get(subCacheKey) ?? null);
      }
    } catch {
      onError(ft('errorLoad'));
    } finally {
      setIsLoading(false);
    }
  }, [unidadeCodigo, cycleParam, token, selectedCountry, initFcts, onError]);

  useEffect(() => {
    if (!cycleParam) return;
    dataCache.current.delete(`${unidadeCodigo}|${cycleParam}|${selectedCountry ?? ""}`);
    fetchData();
  }, [cycleParam, unidadeCodigo, selectedCountry]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save individual ───────────────────────────────────────────────────────
  const saveFCTS = useCallback(async (itemId: string) => {
    const val = fcts[itemId];
    const num = Number(val);
    if (!val || isNaN(num) || num < 0) return;
    if (val === initialFcts.current[itemId]) return;

    setSavingId(itemId);
    try {
      const res = await fetch('/api/forecast/overrides', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ forecastItemId: itemId, volumeFCTS: num, auditContext: { operation: 'MANUAL_EDIT' } }),
      });
      if (res.ok) {
        initialFcts.current[itemId] = val;
        if (unidadeCodigo && cycleParam) dataCache.current.delete(`${unidadeCodigo}|${cycleParam}`);
        setProducts(prev => prev.map(p => ({
          ...p,
          months: p.months.map(m =>
            m.itemId === itemId ? { ...m, override: { id: '', volumeFCTS: num } } : m
          ),
        })));
      } else {
        onError(ft('errorSave'));
      }
    } catch {
      onError(ft('errorSave'));
    } finally {
      setSavingId(null);
    }
  }, [fcts, token, cycleParam, onError]);

  // ── Save bulk ─────────────────────────────────────────────────────────────
  // silent=true suprime toasts (usado no auto-save antes da submissão).
  // Retorna true em caso de sucesso, false em caso de falha.
  const saveFCTSBulk = useCallback(async (
    updates: Record<string, number>,
    auditContext?: AuditContext,
    options?: { silent?: boolean },
  ): Promise<boolean> => {
    const itemsPayload = Object.entries(updates).map(([forecastItemId, volumeFCTS]) => ({
      forecastItemId, volumeFCTS,
    }));
    if (itemsPayload.length === 0) return true;

    try {
      const res = await fetch('/api/forecast/overrides/bulk', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ items: itemsPayload, auditContext }),
      });
      if (res.ok) {
        if (unidadeCodigo && cycleParam) dataCache.current.delete(`${unidadeCodigo}|${cycleParam}`);
        for (const [id, v] of Object.entries(updates)) initialFcts.current[id] = v.toString();
        setFcts(prev => {
          const next = { ...prev };
          for (const [id, v] of Object.entries(updates)) next[id] = v.toString();
          return next;
        });
        setProducts(prev => prev.map(p => ({
          ...p,
          months: p.months.map(m =>
            updates[m.itemId] !== undefined
              ? { ...m, override: { id: '', volumeFCTS: updates[m.itemId] } }
              : m
          ),
        })));
        if (!options?.silent) {
          // Conta produtos distintos afetados (não células produto×mês), para
          // uma mensagem com significado de negócio.
          const affectedProducts = new Set(
            products.filter(p => p.months.some(m => updates[m.itemId] !== undefined)).map(p => p.produtoId)
          ).size;
          onSuccess(ft('bulkUpdated', { count: affectedProducts }));
        }
        return true;
      } else {
        if (!options?.silent) onError(ft('errorBulkSave'));
        return false;
      }
    } catch {
      if (!options?.silent) onError(ft('errorBulkSave'));
      return false;
    }
  }, [token, cycleParam, products, onSuccess, onError]);

  // ── Bulk: aplicar % a todos os meses dos produtos da família ──────────────
  const handleBulkApplyPercent = useCallback(async (familyProducts: AnnualProduct[], pct: number) => {
    const updates: Record<string, number> = {};
    for (const prod of familyProducts) {
      for (const m of prod.months) {
        if (m.gestorExcluido) continue;
        const base = m.volumeIA ?? m.volumeORC ?? 0;
        updates[m.itemId] = Math.max(0, Math.round(base * (1 + pct / 100)));
      }
    }
    setFcts(prev => {
      const next = { ...prev };
      for (const [id, v] of Object.entries(updates)) next[id] = v.toString();
      return next;
    });
    const correlationId = generateUUID();
    await saveFCTSBulk(updates, { operation: 'APPLY_PERCENT', basis: 'IA_OR_ORC', percentageApplied: pct, correlationId, affectedCount: Object.keys(updates).length });
    onSuccess(`${pct > 0 ? '+' : ''}${pct}% aplicado`);
  }, [saveFCTSBulk, onSuccess]);

  // ── Bulk: definir valor fixo para todos os meses da família ───────────────
  const handleBulkSetValue = useCallback(async (familyProducts: AnnualProduct[], value: number) => {
    const updates: Record<string, number> = {};
    for (const prod of familyProducts) {
      for (const m of prod.months) {
        if (m.gestorExcluido) continue;
        updates[m.itemId] = value;
      }
    }
    setFcts(prev => {
      const next = { ...prev };
      for (const [id, v] of Object.entries(updates)) next[id] = v.toString();
      return next;
    });
    const correlationId = generateUUID();
    await saveFCTSBulk(updates, { operation: 'SET_VALUE', fixedValue: value, correlationId, affectedCount: Object.keys(updates).length });
  }, [saveFCTSBulk]);

  // ── Bulk: aceitar sugestão IA para todos os produtos da família ───────────
  const handleBulkAcceptIA = useCallback(async (familyProducts: AnnualProduct[]) => {
    const updates: Record<string, number> = {};
    for (const prod of familyProducts) {
      if (prod.gestorExcluido) continue;
      for (const m of prod.months) {
        if (m.gestorExcluido || m.volumeIA == null) continue;
        updates[m.itemId] = m.volumeIA;
      }
    }
    if (Object.keys(updates).length === 0) {
      onError(ft('noAiSuggestionFamily'));
      return;
    }
    setFcts(prev => {
      const next = { ...prev };
      for (const [id, v] of Object.entries(updates)) next[id] = v.toString();
      return next;
    });
    const correlationId = generateUUID();
    await saveFCTSBulk(updates, { operation: 'ACCEPT_IA_SUGGESTION', basis: 'AI_MODEL', correlationId, affectedCount: Object.keys(updates).length });
  }, [saveFCTSBulk, onError]);

  // ── Aceitar sugestão IA para um único produto ─────────────────────────────
  const handleProductAcceptIA = useCallback(async (product: AnnualProduct) => {
    if (product.gestorExcluido) return;
    const updates: Record<string, number> = {};
    for (const m of product.months) {
      if (m.gestorExcluido || m.volumeIA == null) continue;
      updates[m.itemId] = m.volumeIA;
    }
    if (Object.keys(updates).length === 0) {
      onError(ft('noAiSuggestionProduct'));
      return;
    }
    setFcts(prev => {
      const next = { ...prev };
      for (const [id, v] of Object.entries(updates)) next[id] = v.toString();
      return next;
    });
    const correlationId = generateUUID();
    await saveFCTSBulk(updates, { operation: 'ACCEPT_IA_SUGGESTION', basis: 'AI_MODEL', correlationId, affectedCount: Object.keys(updates).length });
  }, [saveFCTSBulk, onError]);

  // ── Bulk: preencher com média histórica (trim/sem/12m) ou venda A.A. ──────
  const handleBulkFillAverage = useCallback(async (
    familyProducts: AnnualProduct[],
    criterion: 'trim' | 'sem' | '12m' | 'aa',
  ) => {
    const updates: Record<string, number> = {};
    for (const prod of familyProducts) {
      if (prod.gestorExcluido) continue;
      if (criterion === 'aa') {
        // Cada mês recebe sua própria venda A.A. (preserva sazonalidade)
        for (const m of prod.months) {
          if (m.gestorExcluido || m.vendaAA == null) continue;
          updates[m.itemId] = Math.max(0, Math.round(m.vendaAA));
        }
      } else {
        const avg = criterion === 'trim' ? prod.avgTrim
                  : criterion === 'sem'  ? prod.avgSem
                  :                        prod.avg12m;
        if (avg == null) continue;
        const value = Math.max(0, Math.round(avg));
        for (const m of prod.months) {
          if (m.gestorExcluido) continue;
          updates[m.itemId] = value;
        }
      }
    }
    if (Object.keys(updates).length === 0) {
      onError(ft('noDataForCriterion'));
      return;
    }
    setFcts(prev => {
      const next = { ...prev };
      for (const [id, v] of Object.entries(updates)) next[id] = v.toString();
      return next;
    });
    const correlationId = generateUUID();
    const operation = criterion === 'aa' ? 'FILL_YEAR_OVER_YEAR'
                    : criterion === 'trim' ? 'FILL_AVERAGE_TRIM'
                    : criterion === 'sem'  ? 'FILL_AVERAGE_SEM'
                    : 'FILL_AVERAGE_12M';
    await saveFCTSBulk(updates, { operation, basis: 'HISTORICAL_SALES', correlationId, affectedCount: Object.keys(updates).length });
  }, [saveFCTSBulk, onError]);

  // ── Bulk: distribuir total da família proporcionalmente ───────────────────
  const handleBulkDistributeTotal = useCallback(async (
    familyProducts: AnnualProduct[],
    total: number,
    criterion: DistributeCriterion,
  ) => {
    const activeProds = familyProducts.filter(p => !p.gestorExcluido);

    const getWeight = (prod: AnnualProduct): number => {
      if (criterion === 'orc')
        return prod.months.filter(m => !m.gestorExcluido).reduce((s, m) => s + (m.volumeORC ?? 0), 0);
      if (criterion === 'aa')
        return prod.months.filter(m => !m.gestorExcluido).reduce((s, m) => s + (m.vendaAA ?? 0), 0);
      return (criterion === 'trim' ? prod.avgTrim : criterion === 'sem' ? prod.avgSem : prod.avg12m) ?? 0;
    };

    const updates: Record<string, number> = {};

    if (criterion === 'aa') {
      // Distribui respeitando sazonalidade: peso por produto × mês
      const totalVendaAA = activeProds.reduce((s, p) =>
        s + p.months.filter(m => !m.gestorExcluido).reduce((ms, m) => ms + (m.vendaAA ?? 0), 0), 0,
      );
      if (totalVendaAA === 0) {
        onError(ft('insufficientSalesData'));
        return;
      }
      for (const prod of activeProds) {
        for (const m of prod.months.filter(m => !m.gestorExcluido)) {
          // Cada célula recebe sua fatia proporcional do total
          updates[m.itemId] = Math.max(0, Math.round(((m.vendaAA ?? 0) / totalVendaAA) * total));
        }
      }
    } else {
      // Distribui por produto (peso escalar), uniformemente entre meses
      const sumWeights = activeProds.reduce((s, p) => s + getWeight(p), 0);
      if (sumWeights === 0) {
        onError(ft('insufficientDataCriteria'));
        return;
      }
      for (const prod of activeProds) {
        const share       = (getWeight(prod) / sumWeights) * total;
        const activeMonths = prod.months.filter(m => !m.gestorExcluido);
        if (activeMonths.length === 0) continue;
        // Distribuição uniforme entre meses; arredondamento inteiro é aceitável
        const perMonth = Math.max(0, Math.round(share / activeMonths.length));
        for (const m of activeMonths) updates[m.itemId] = perMonth;
      }
    }

    if (Object.keys(updates).length === 0) {
      onError(ft('noMonthsForDistribution'));
      return;
    }
    setFcts(prev => {
      const next = { ...prev };
      for (const [id, v] of Object.entries(updates)) next[id] = v.toString();
      return next;
    });
    const correlationId = generateUUID();
    const distOperation = criterion === 'orc'  ? 'DISTRIBUTE_TOTAL_ORC'
                        : criterion === 'trim' ? 'DISTRIBUTE_TOTAL_TRIM'
                        : criterion === 'sem'  ? 'DISTRIBUTE_TOTAL_SEM'
                        : criterion === '12m'  ? 'DISTRIBUTE_TOTAL_12M'
                        : 'DISTRIBUTE_TOTAL_AA';
    const distBasis = criterion === 'orc'  ? 'BUDGET'
                    : criterion === 'aa'   ? 'PROPORTIONAL_SEASONAL'
                    : 'PROPORTIONAL';
    await saveFCTSBulk(updates, { operation: distOperation, basis: distBasis, totalVolume: total, correlationId, affectedCount: Object.keys(updates).length });
  }, [saveFCTSBulk, onError]);

  // ── Bulk: alinhar produtos divergentes ao ORC ─────────────────────────────
  const handleBulkAlignToORC = useCallback(async (divergentProducts: AnnualProduct[]) => {
    const updates: Record<string, number> = {};
    for (const prod of divergentProducts) {
      if (prod.gestorExcluido) continue;
      for (const m of prod.months) {
        if (m.gestorExcluido) continue;
        updates[m.itemId] = m.volumeORC ?? 0;
      }
    }
    if (Object.keys(updates).length === 0) return;
    setFcts(prev => {
      const next = { ...prev };
      for (const [id, v] of Object.entries(updates)) next[id] = v.toString();
      return next;
    });
    const correlationId = generateUUID();
    await saveFCTSBulk(updates, { operation: 'DISTRIBUTE_TOTAL_ORC', basis: 'BUDGET', correlationId, affectedCount: Object.keys(updates).length });
  }, [saveFCTSBulk]);

  // ── Excluir produto ───────────────────────────────────────────────────────
  // scope: 'country' = apenas o país selecionado (Export); 'all' = todos os países
  const handleExcludeProduct = useCallback(async (
    product: AnnualProduct,
    scope: 'country' | 'all' = 'all',
  ) => {
    if (!unidadeCodigo || !activeRun) return;

    const runId    = activeRun.id;
    const paisIso3 = scope === 'country' ? (selectedCountry ?? null) : null;
    try {
      const res = await fetch(`/api/forecast/runs/${runId}/products/${product.codigo}`, {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          unidadeVendaId: unidadeCodigo,
          ...(scope === 'country' && paisIso3 ? { paisIso3 } : {}),
        }),
      });
      if (res.ok) {
        if (unidadeCodigo && cycleParam) dataCache.current.delete(`${unidadeCodigo}|${cycleParam}`);
        setProducts(prev => prev.map(p =>
          p.produtoId === product.produtoId
            ? { ...p, gestorExcluido: true, months: p.months.map(m => ({ ...m, gestorExcluido: true })) }
            : p
        ));
        onSuccess(ft('productRemoved', { name: product.descricao }));
      } else {
        onError(ft('errorRemoveProduct'));
      }
    } catch {
      onError(ft('errorRemoveProduct'));
    }
  }, [unidadeCodigo, activeRun, token, cycleParam, selectedCountry, onSuccess, onError]);

  // ── Restaurar produto ─────────────────────────────────────────────────────
  const handleRestoreProduct = useCallback(async (product: AnnualProduct) => {
    if (!unidadeCodigo || !activeRun) return;
    try {
      const res = await fetch(`/api/forecast/runs/${activeRun.id}/products/${product.codigo}/restore`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          unidadeVendaId: unidadeCodigo,
          ...(selectedCountry ? { paisIso3: selectedCountry } : {}),
        }),
      });
      if (res.ok) {
        if (unidadeCodigo && cycleParam) dataCache.current.delete(`${unidadeCodigo}|${cycleParam}`);
        setProducts(prev => prev.map(p =>
          p.produtoId === product.produtoId
            ? { ...p, gestorExcluido: false, months: p.months.map(m => ({ ...m, gestorExcluido: false })) }
            : p
        ));
        onSuccess(ft('productRestored', { name: product.descricao }));
      } else {
        onError(ft('errorRestoreProduct'));
      }
    } catch {
      onError(ft('errorRestoreProduct'));
    }
  }, [unidadeCodigo, activeRun, token, cycleParam, selectedCountry, onSuccess, onError]);

  // ── Adicionar produto manual ──────────────────────────────────────────────
  const handleAddProduct = useCallback(async (produtoId: string) => {
    if (!unidadeCodigo || !activeRun) {
      onError(ft('cycleNotFound'));
      return;
    }
    try {
      const res = await fetch(`/api/forecast/runs/${activeRun.id}/products`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          produtoId,
          unidadeVendaId: unidadeCodigo,
          ...(selectedCountry ? { paisIso3: selectedCountry } : {}),
        }),
      });
      if (res.ok) {
        await fetchData(true);
        onSuccess(ft('productAdded', { count: 1 }));
      } else {
        const err = await res.json();
        onError(err.error || ft('errorAddProduct'));
      }
    } catch {
      onError(ft('errorAddProduct'));
    }
  }, [unidadeCodigo, activeRun, token, fetchData, onSuccess, onError]);

  // ── Adicionar múltiplos produtos (família inteira) ────────────────────────
  const handleAddBatch = useCallback(async (produtoIds: string[]) => {
    if (!unidadeCodigo || !activeRun) {
      onError(ft('cycleNotFound'));
      return;
    }
    const results = await Promise.allSettled(
      produtoIds.map(produtoId =>
        fetch(`/api/forecast/runs/${activeRun.id}/products`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({
            produtoId,
            unidadeVendaId: unidadeCodigo,
            ...(selectedCountry ? { paisIso3: selectedCountry } : {}),
          }),
        })
      )
    );
    const failed = results.filter(r =>
      r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)
    ).length;

    await fetchData(true);

    if (failed > 0) onError(ft('partialAddError', { count: failed }));
    else onSuccess(ft('productAdded', { count: produtoIds.length }));
  }, [unidadeCodigo, activeRun, token, selectedCountry, fetchData, onSuccess, onError]);

  // ── Submeter ciclo ────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!unidadeCodigo || !cycleParam) return;

    const hasAnyFcts = products.some(p =>
      p.months.some(m => {
        if (selectedCountry && m.paisIso3 !== selectedCountry) return false;
        const v = fcts[m.itemId];
        return v && !isNaN(Number(v)) && Number(v) >= 0;
      })
    );
    if (!hasAnyFcts) {
      onError(ft('fillBeforeSubmit'));
      return;
    }

    // Antes de submeter, persiste todos os FCTS preenchidos que ainda não foram
    // salvos como ForecastOverride (campos pré-preenchidos com prevFCTS/ORC ficam
    // no estado local mas sem registro no banco até este ponto).
    // Quando um país específico está selecionado, processa apenas os itens daquele
    // país — itens paisIso3=null (backfill global) não devem ser submetidos.
    const unsaved: Record<string, number> = {};
    for (const prod of products) {
      for (const m of prod.months) {
        if (selectedCountry && m.paisIso3 !== selectedCountry) continue;
        const v = fcts[m.itemId];
        if (!v || isNaN(Number(v)) || Number(v) < 0) continue;
        const num = Number(v);
        const savedVal = m.override?.volumeFCTS;
        if (savedVal === undefined || savedVal === null || savedVal !== num) {
          unsaved[m.itemId] = num;
        }
      }
    }

    setSubmitting(true);
    try {
      if (Object.keys(unsaved).length > 0) {
        const ok = await saveFCTSBulk(unsaved, { operation: 'AUTO_SAVE_ON_SUBMIT', skipAudit: true }, { silent: true });
        if (!ok) {
          onError(ft('errorBulkSave'));
          return;
        }
      }

      const res = await fetch('/api/submissions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ unidadeVendaId: unidadeCodigo, refMonth: cycleParam }),
      });
      if (res.ok) {
        invalidateConsolidado();
        onSuccess(ft('submitted'));
        subCache.current.delete(`${unidadeCodigo}|${cycleParam}`);
        // fetchData em background — não bloqueia o fechamento do modal.
        // O backend dispara refreshConsolidadoSnapshot assíncrono que pode
        // causar contention no DB; aguardar aqui deixaria o modal travado.
        void fetchData(true).catch(console.error);
      } else {
        const err = await res.json();
        onError(err.error || ft('errorSubmit'));
      }
    } catch {
      onError(ft('errorSubmit'));
    } finally {
      setSubmitting(false);
    }
  }, [unidadeCodigo, cycleParam, products, fcts, token, saveFCTSBulk, invalidateConsolidado, fetchData, onSuccess, onError]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const isDirty = useCallback((itemId: string) =>
    fcts[itemId] !== initialFcts.current[itemId],
  [fcts]);

  const cycleWindowLabel = (() => {
    if (!products.length) return '';
    const allMonths = products.flatMap(p => p.months.map(m => m.month)).sort();
    if (!allMonths.length) return '';
    const [sy, sm] = allMonths[0].split('-').map(Number);
    const [ey, em] = allMonths[allMonths.length - 1].split('-').map(Number);
    const months = i18n.t('months', { ns: 'common', returnObjects: true }) as string[];
    return `${months[sm - 1]}/${String(sy).slice(2)} – ${months[em - 1]}/${String(ey).slice(2)}`;
  })();

  return {
    products, setProducts, fcts, setFcts,
    isLoading, submission,
    savingId, submitting, showAddModal, setShowAddModal,
    isDirty, cycleWindowLabel,
    fetchData,
    saveFCTS, saveFCTSBulk,
    handleBulkApplyPercent, handleBulkSetValue,
    handleBulkAcceptIA, handleProductAcceptIA,
    handleBulkFillAverage, handleBulkDistributeTotal, handleBulkAlignToORC,
    handleExcludeProduct, handleRestoreProduct,
    handleAddProduct, handleAddBatch, handleSubmit,
  };
}
