// ── Cache em memória compartilhado ────────────────────────────────────────────
// Único Map para analytics (forecast) e consolidado — garante que invalidações
// em qualquer ponto de escrita limpem todos os dados derivados sem sincronismo
// manual entre módulos.

const _cache = new Map<string, { data: unknown; expiresAt: number }>();

export const appCache = {
  get(key: string) {
    return _cache.get(key);
  },

  set(key: string, data: unknown, ttlMs: number) {
    _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  },

  /** Limpa todo o cache (analytics + consolidado). Usado em operações que
   *  invalidam runs, overrides e ForecastItems. */
  invalidateAnalytics(): void {
    _cache.clear();
  },

  /** Limpa apenas entradas do consolidado (prefixo "consolidado|").
   *  Usado em operações que afetam ORC, DivisionSubmission ou ForecastItems
   *  mas não invalidam os analytics de acurácia/tendência. */
  invalidateConsolidado(): void {
    for (const key of _cache.keys()) {
      if (key.startsWith("consolidado|")) _cache.delete(key);
    }
  },
};
