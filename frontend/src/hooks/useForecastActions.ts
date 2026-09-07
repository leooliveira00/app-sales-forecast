import { useState, useCallback } from 'react';
import type { ForecastItem, ForecastRun } from '../types/forecast';
import { toMonthParam } from '../types/forecast';
import { useConsolidadoCache } from '../context/ConsolidadoCacheContext';
import type { AuditContext } from '../types/audit';
import { generateUUID } from '../utils/uuid';
import i18n from '../i18n';

const ft = (key: string, opts?: Record<string, unknown>) => i18n.t(`toasts.${key}`, { ns: 'forecast', ...opts });

interface UserUnidade {
  unidadeVenda: { codigo: string };
}

interface UseForecastActionsOptions {
  unidade: UserUnidade | undefined;
  cycleDate: Date | null;
  targetDate: Date | null;
  activeRun: ForecastRun | null;
  availableRuns: ForecastRun[];
  cycleParam: string | null;
  windowMonths: Date[];
  targetIdx: number;
  token: string | null;
  isExport: boolean;
  fcts: Record<string, string>;
  setFcts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  initialFcts: React.MutableRefObject<Record<string, string>>;
  items: ForecastItem[];
  setItems: React.Dispatch<React.SetStateAction<ForecastItem[]>>;
  cacheKey: string | null;
  itemCache: React.MutableRefObject<Map<string, ForecastItem[]>>;
  subCache: React.MutableRefObject<Map<string, Submission | null>>;
  fetchData: (bustCache?: boolean) => Promise<void>;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

interface Submission {
  id: string;
  status: string;
}

interface UseForecastActionsResult {
  savingId: string | null;
  submitting: boolean;
  showAddModal: boolean;
  setShowAddModal: React.Dispatch<React.SetStateAction<boolean>>;
  saveFCTS: (itemId: string) => Promise<void>;
  saveFCTSBulk: (updates: Record<string, number>) => Promise<void>;
  handleBulkApplyPercent: (familiaItems: ForecastItem[], pct: number) => Promise<void>;
  handleBulkSetValue: (familiaItems: ForecastItem[], value: number) => Promise<void>;
  handleBulkCopyPrevious: (familiaItems: ForecastItem[]) => Promise<void>;
  handleExcludeProduct: (item: ForecastItem) => Promise<void>;
  handleExcludeFamilyBatch: (items: ForecastItem[]) => Promise<void>;
  handleRestoreProduct: (item: ForecastItem) => Promise<void>;
  handleRestoreFamilyBatch: (items: ForecastItem[]) => Promise<void>;
  handleAddProduct: (produtoId: string) => Promise<void>;
  handleAddProductBatch: (produtoIds: string[]) => Promise<void>;
  handleSubmit: () => Promise<void>;
}

const fmt = (v: number | null | undefined): string =>
  v != null ? new Intl.NumberFormat('pt-BR').format(v) : '—';

export function useForecastActions({
  unidade, cycleDate, activeRun, availableRuns, cycleParam,
  windowMonths, targetIdx, token, isExport,
  fcts, setFcts,
  initialFcts,
  items, setItems, cacheKey, itemCache, subCache,
  fetchData, onSuccess, onError,
}: UseForecastActionsOptions): UseForecastActionsResult {
  const [savingId, setSavingId]         = useState<string | null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const { invalidate: invalidateConsolidado } = useConsolidadoCache();

  // ── Salvar FCTS single ────────────────────────────────────────────────────

  const saveFCTS = useCallback(async (itemId: string) => {
    if (!cacheKey) return;
    const val = fcts[itemId];
    const num = Number(val);
    if (!val || isNaN(num) || num < 0) return;
    if (val === initialFcts.current[itemId]) return;

    setSavingId(itemId);
    try {
      const res = await fetch('/api/forecast/overrides', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ forecastItemId: itemId, volumeFCTS: num, auditContext: { operation: 'MANUAL_EDIT' } }),
      });
      if (res.ok) {
        itemCache.current.delete(cacheKey);
        initialFcts.current[itemId] = val;
        setItems(prev => prev.map(i =>
          i.id === itemId ? { ...i, overrides: [{ id: '', volumeFCTS: num }] } : i
        ));
      } else {
        onError(ft('errorSave'));
      }
    } catch {
      onError(ft('errorSave'));
    } finally {
      setSavingId(null);
    }
  }, [fcts, token, cacheKey, initialFcts, itemCache, setItems, onError]);

  // ── Salvar FCTS bulk ──────────────────────────────────────────────────────

  const saveFCTSBulk = useCallback(async (updates: Record<string, number>, auditContext?: AuditContext) => {
    if (!cacheKey) return;
    const itemsPayload = Object.entries(updates).map(([forecastItemId, volumeFCTS]) => ({
      forecastItemId, volumeFCTS,
    }));
    if (itemsPayload.length === 0) return;

    try {
      const res = await fetch('/api/forecast/overrides/bulk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items: itemsPayload, auditContext }),
      });
      if (res.ok) {
        itemCache.current.delete(cacheKey);
        for (const [id, v] of Object.entries(updates)) {
          initialFcts.current[id] = v.toString();
        }
        setFcts(prev => {
          const next = { ...prev };
          for (const [id, v] of Object.entries(updates)) next[id] = v.toString();
          return next;
        });
        setItems(prev => prev.map(i =>
          updates[i.id] !== undefined
            ? { ...i, overrides: [{ id: '', volumeFCTS: updates[i.id] }] }
            : i
        ));
        // Conta produtos distintos afetados (não células produto×mês)
        const affectedProducts = new Set(
          items.filter(i => updates[i.id] !== undefined).map(i => i.produto.codigo)
        ).size;
        onSuccess(ft('bulkUpdated', { count: affectedProducts }));
      } else {
        onError(ft('errorBulkSave'));
      }
    } catch {
      onError(ft('errorBulkSave'));
    }
  }, [token, cacheKey, initialFcts, itemCache, items, setFcts, setItems, onSuccess, onError]);

  // ── Bulk: aplicar % ───────────────────────────────────────────────────────
  // Funciona igual para NACIONAL e EXPORT (cada ForecastItem tem seu próprio override)

  const handleBulkApplyPercent = useCallback(async (familiaItems: ForecastItem[], pct: number) => {
    if (!cacheKey) return;
    const updates: Record<string, number> = {};
    for (const item of familiaItems) {
      const base = item.volumeIA ?? item.volumeORC ?? 0;
      updates[item.id] = Math.max(0, Math.round(base * (1 + pct / 100)));
    }
    setFcts(prev => {
      const next = { ...prev };
      for (const [id, v] of Object.entries(updates)) next[id] = v.toString();
      return next;
    });
    const correlationId = generateUUID();
    await saveFCTSBulk(updates, { operation: 'APPLY_PERCENT', basis: 'IA_OR_ORC', percentageApplied: pct, correlationId, affectedCount: familiaItems.length });
    onSuccess(`${pct > 0 ? '+' : ''}${pct}% aplicado a ${familiaItems.length} item(s)`);
  }, [cacheKey, setFcts, saveFCTSBulk, onSuccess]);

  // ── Bulk: definir valor ───────────────────────────────────────────────────

  const handleBulkSetValue = useCallback(async (familiaItems: ForecastItem[], value: number) => {
    if (!cacheKey) return;
    const updates: Record<string, number> = {};
    for (const item of familiaItems) updates[item.id] = value;
    setFcts(prev => {
      const next = { ...prev };
      for (const [id, v] of Object.entries(updates)) next[id] = v.toString();
      return next;
    });
    const correlationId = generateUUID();
    await saveFCTSBulk(updates, { operation: 'SET_VALUE', fixedValue: value, correlationId, affectedCount: familiaItems.length });
    onSuccess(`Valor ${fmt(value)} aplicado a ${familiaItems.length} item(s)`);
  }, [cacheKey, setFcts, saveFCTSBulk, onSuccess]);

  // ── Bulk: copiar mês anterior ─────────────────────────────────────────────

  const handleBulkCopyPrevious = useCallback(async (familiaItems: ForecastItem[]) => {
    if (targetIdx <= 0 || !cycleDate || !windowMonths[targetIdx - 1] || !unidade) return;
    const prevTargetDate = windowMonths[targetIdx - 1];
    const cp     = toMonthParam(cycleDate);
    const prevTp = toMonthParam(prevTargetDate);
    const prevCk = `${cp}_${prevTp}`;

    let prevItems = itemCache.current.get(prevCk);
    if (!prevItems) {
      try {
        const res = await fetch(
          `/api/forecast/items?unidadeVendaId=${unidade.unidadeVenda.codigo}&refMonth=${cp}&targetMonth=${prevTp}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const result = res.ok ? await res.json() : { items: [] };
        prevItems = Array.isArray(result) ? result : (result.items ?? []);
        if (prevItems) itemCache.current.set(prevCk, prevItems);
      } catch {
        onError(ft('errorFetchPrevMonth'));
        return;
      }
    }

    if (!cacheKey) return;

    const updates: Record<string, number> = {};
    for (const item of familiaItems) {
      // Para EXPORT: combina produtoId + paisIso3; para NACIONAL: só produtoId
      const prevItem = prevItems!.find(p =>
        p.produto.codigo === item.produto.codigo &&
        p.paisIso3 === item.paisIso3
      );
      const prevFCTS = prevItem?.overrides[0]?.volumeFCTS;
      if (prevFCTS != null) updates[item.id] = prevFCTS;
    }
    if (Object.keys(updates).length === 0) {
      onError(ft('noFctsPrevMonth'));
      return;
    }
    setFcts(prev => {
      const next = { ...prev };
      for (const [id, v] of Object.entries(updates)) next[id] = v.toString();
      return next;
    });
    const correlationId = generateUUID();
    await saveFCTSBulk(updates, { operation: 'COPY_PREVIOUS', basis: 'PREVIOUS_FCTS', correlationId, affectedCount: Object.keys(updates).length });
    onSuccess(ft('fctsCopiadoMes'));
  }, [targetIdx, cycleDate, windowMonths, unidade, token, cacheKey, itemCache, setFcts, saveFCTSBulk, onSuccess, onError]);

  // ── Excluir produto do ciclo ──────────────────────────────────────────────

  const handleExcludeProduct = useCallback(async (item: ForecastItem) => {
    if (!unidade || !cacheKey) return;
    if (!confirm(`Remover "${item.produto.descricao}" deste ciclo? O produto ficará oculto mas os dados são preservados.`)) return;

    try {
      const res = await fetch(`/api/forecast/runs/${item.runId}/products/${item.produto.codigo}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unidadeVendaId: unidade.unidadeVenda.codigo }),
      });
      if (res.ok) {
        itemCache.current.delete(cacheKey);
        setItems(prev => prev.map(i =>
          i.produto.codigo === item.produto.codigo ? { ...i, gestorExcluido: true } : i
        ));
        onSuccess(ft('productRemoved', { name: item.produto.descricao }));
      } else {
        onError(ft('errorRemoveProduct'));
      }
    } catch {
      onError(ft('errorRemoveProduct'));
    }
  }, [unidade, token, cacheKey, itemCache, setItems, onSuccess, onError]);

  // ── Excluir família inteira do ciclo ─────────────────────────────────────

  const handleExcludeFamilyBatch = useCallback(async (familiaItems: ForecastItem[]) => {
    if (!unidade || !cacheKey) return;
    const active = familiaItems.filter(i => !i.gestorExcluido);
    if (active.length === 0) return;
    const familyName = active[0].produto.descricao;
    if (!confirm(`Remover a família (${active.length} produto${active.length > 1 ? 's' : ''}) deste ciclo?`)) return;

    await Promise.allSettled(
      active.map(item =>
        fetch(`/api/forecast/runs/${item.runId}/products/${item.produto.codigo}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ unidadeVendaId: unidade.unidadeVenda.codigo }),
        })
      )
    );

    const codigosRemovidos = new Set(active.map(i => i.produto.codigo));
    itemCache.current.delete(cacheKey);
    setItems(prev => prev.map(i =>
      codigosRemovidos.has(i.produto.codigo) ? { ...i, gestorExcluido: true } : i
    ));
    onSuccess(`Família removida do ciclo (${active.length} produto${active.length > 1 ? 's' : ''})`);
  }, [unidade, token, cacheKey, itemCache, setItems, onSuccess]);

  // ── Restaurar produto no ciclo ────────────────────────────────────────────

  const handleRestoreProduct = useCallback(async (item: ForecastItem) => {
    if (!unidade || !cacheKey) return;
    try {
      const res = await fetch(`/api/forecast/runs/${item.runId}/products/${item.produto.codigo}/restore`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unidadeVendaId: unidade.unidadeVenda.codigo }),
      });
      if (res.ok) {
        itemCache.current.delete(cacheKey);
        setItems(prev => prev.map(i =>
          i.produto.codigo === item.produto.codigo ? { ...i, gestorExcluido: false } : i
        ));
        onSuccess(ft('productRestored', { name: item.produto.descricao }));
      } else {
        onError(ft('errorRestoreProduct'));
      }
    } catch {
      onError(ft('errorRestoreProduct'));
    }
  }, [unidade, token, cacheKey, itemCache, setItems, onSuccess, onError]);

  // ── Restaurar família inteira no ciclo ───────────────────────────────────

  const handleRestoreFamilyBatch = useCallback(async (familiaItems: ForecastItem[]) => {
    if (!unidade || !cacheKey) return;

    await Promise.allSettled(
      familiaItems.map(item =>
        fetch(`/api/forecast/runs/${item.runId}/products/${item.produto.codigo}/restore`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ unidadeVendaId: unidade.unidadeVenda.codigo }),
        })
      )
    );

    const codigos = new Set(familiaItems.map(i => i.produto.codigo));
    itemCache.current.delete(cacheKey);
    setItems(prev => prev.map(i =>
      codigos.has(i.produto.codigo) ? { ...i, gestorExcluido: false } : i
    ));
    onSuccess(`Família restaurada (${familiaItems.length} produto${familiaItems.length > 1 ? 's' : ''})`);
  }, [unidade, token, cacheKey, itemCache, setItems, onSuccess]);

  // ── Adicionar produto manual ──────────────────────────────────────────────

  const handleAddProduct = useCallback(async (produtoId: string) => {
    if (!unidade || !cacheKey || !activeRun) return;

    try {
      const res = await fetch(`/api/forecast/runs/${activeRun.id}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ produtoId, unidadeVendaId: unidade.unidadeVenda.codigo }),
      });
      if (res.ok) {
        itemCache.current.delete(cacheKey);
        await fetchData(true);
        onSuccess(ft('productAdded', { count: 1 }));
      } else {
        const err = await res.json();
        onError(err.error || ft('errorAddProduct'));
      }
    } catch {
      onError(ft('errorAddProduct'));
    }
  }, [unidade, token, cacheKey, activeRun, itemCache, fetchData, onSuccess, onError]);

  // ── Adicionar lote de produtos ────────────────────────────────────────────

  const handleAddProductBatch = useCallback(async (produtoIds: string[]) => {
    if (!unidade || !cacheKey || !activeRun || produtoIds.length === 0) return;

    const runUrl     = `/api/forecast/runs/${activeRun.id}/products`;
    const headers    = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const unitCodigo = unidade.unidadeVenda.codigo;

    const results = await Promise.allSettled(
      produtoIds.map((produtoId) =>
        fetch(runUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ produtoId, unidadeVendaId: unitCodigo }),
        })
      )
    );

    const failed = results.filter((r) => r.status === 'rejected').length;

    itemCache.current.delete(cacheKey);
    await fetchData(true);

    if (failed === 0) {
      onSuccess(ft('productAdded', { count: produtoIds.length }));
    } else {
      onError(ft('partialAddError', { count: failed }));
    }
  }, [unidade, token, cacheKey, activeRun, itemCache, fetchData, onSuccess, onError]);

  // ── Submeter ciclo ────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!unidade || !cycleDate) return;
    const cp = toMonthParam(cycleDate);

    const filled = items.filter(i => {
      const v = fcts[i.id];
      return v && !isNaN(Number(v)) && Number(v) >= 0;
    });
    if (filled.length === 0) {
      onError(ft('fillBeforeSubmit'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unidadeVendaId: unidade.unidadeVenda.codigo, refMonth: cp }),
      });
      if (res.ok) {
        invalidateConsolidado();
        onSuccess(ft('submitted'));
        subCache.current.delete(cp);
        fetchData(true);
      } else {
        const err = await res.json();
        onError(err.error || ft('errorSubmit'));
      }
    } catch {
      onError(ft('errorSubmit'));
    } finally {
      setSubmitting(false);
    }
  }, [unidade, cycleDate, fcts, items, token, subCache, fetchData, onSuccess, onError]);

  return {
    savingId, submitting,
    showAddModal, setShowAddModal,
    saveFCTS, saveFCTSBulk,
    handleBulkApplyPercent, handleBulkSetValue, handleBulkCopyPrevious,
    handleExcludeProduct, handleExcludeFamilyBatch,
    handleRestoreProduct, handleRestoreFamilyBatch,
    handleAddProduct, handleAddProductBatch,
    handleSubmit,
  };
}
