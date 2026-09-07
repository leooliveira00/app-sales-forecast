import React, { createContext, useCallback, useContext, useRef } from 'react';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

interface ConsolidadoCacheContextValue {
  getCached: (key: string) => unknown | null;
  setCached: (key: string, data: unknown) => void;
  invalidate: () => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const ConsolidadoCacheContext = createContext<ConsolidadoCacheContextValue | null>(null);

const TTL_MS = 5 * 60 * 1000; // 5 minutos

// ── Provider ──────────────────────────────────────────────────────────────────

export const ConsolidadoCacheProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // useRef garante que o Map sobrevive à navegação entre páginas sem causar
  // re-renders. O estado das páginas que usam o cache é gerenciado por elas.
  const cache = useRef(new Map<string, CacheEntry>());

  const getCached = useCallback((key: string): unknown | null => {
    const entry = cache.current.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      cache.current.delete(key);
      return null;
    }
    return entry.data;
  }, []);

  const setCached = useCallback((key: string, data: unknown) => {
    cache.current.set(key, { data, expiresAt: Date.now() + TTL_MS });
  }, []);

  /** Limpa todo o cache do consolidado. Deve ser chamado após submit,
   *  approve e reject para que o usuário veja dados atualizados imediatamente. */
  const invalidate = useCallback(() => {
    cache.current.clear();
  }, []);

  return (
    <ConsolidadoCacheContext.Provider value={{ getCached, setCached, invalidate }}>
      {children}
    </ConsolidadoCacheContext.Provider>
  );
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useConsolidadoCache(): ConsolidadoCacheContextValue {
  const ctx = useContext(ConsolidadoCacheContext);
  if (!ctx) throw new Error('useConsolidadoCache deve ser usado dentro de ConsolidadoCacheProvider');
  return ctx;
}
