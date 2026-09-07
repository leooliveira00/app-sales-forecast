import { useState, useMemo, useCallback } from 'react';
import { CLASSE_ORDER, getFamilyClasse } from '../types/forecast';
import type { ForecastItem } from '../types/forecast';

export interface FamilyGroup {
  familia: string;
  itens: ForecastItem[];
}

interface UseForecastPaginationOptions {
  groupedItems: FamilyGroup[];
  pageSize?: number;
  /** Códigos de produtos com desvio sistemático vs vendas (vindo de /api/forecast/produtos-cronicos) */
  divergentProductCodes: Set<string>;
  /** Classes selecionadas para filtro multi-select (independente do searchQuery) */
  selectedClasses?: Set<string>;
}

interface UseForecastPaginationResult {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  currentPage: number;
  setCurrentPage: (p: number) => void;
  paginatedGroups: FamilyGroup[];
  totalPages: number;
  filteredTotal: number;
  resetPage: () => void;
  onlyDivergentes: boolean;
  setOnlyDivergentes: (v: boolean) => void;
  divergentesCount: number;
  excludedItems: ForecastItem[];
}

export function useForecastPagination({
  groupedItems,
  pageSize = 8,
  divergentProductCodes,
  selectedClasses,
}: UseForecastPaginationOptions): UseForecastPaginationResult {
  const [searchQuery, setSearchQueryRaw] = useState('');
  const [currentPage, setCurrentPageRaw] = useState(1);
  const [onlyDivergentes, setOnlyDivergentesRaw] = useState(false);

  const setSearchQuery = useCallback((q: string) => {
    setSearchQueryRaw(q);
    setCurrentPageRaw(1);
  }, []);

  const setCurrentPage = useCallback((p: number) => {
    setCurrentPageRaw(p);
  }, []);

  const resetPage = useCallback(() => {
    setCurrentPageRaw(1);
    setSearchQueryRaw('');
  }, []);

  const setOnlyDivergentes = useCallback((v: boolean) => {
    setOnlyDivergentesRaw(v);
    setCurrentPageRaw(1);
  }, []);

  // Itens excluídos do ciclo — alimentam o modal de lixeira
  const excludedItems = useMemo(() =>
    groupedItems.flatMap(g => g.itens.filter(i => i.gestorExcluido)),
  [groupedItems]);

  // Remove itens excluídos dos grupos antes de exibir na lista principal
  const visibleGroups = useMemo(() =>
    groupedItems
      .map(g => ({ ...g, itens: g.itens.filter(i => !i.gestorExcluido) }))
      .filter(g => g.itens.length > 0),
  [groupedItems]);

  // Ordena por classe (F→A), depois alfabético; "Outros" sempre por último
  const sortedGroups = useMemo(() => {
    return [...visibleGroups].sort((a, b) => {
      if (a.familia === 'Outros') return 1;
      if (b.familia === 'Outros') return -1;
      const idx = (c: string) => {
        const i = CLASSE_ORDER.indexOf(c as typeof CLASSE_ORDER[number]);
        return i === -1 ? 99 : i;
      };
      const diff = idx(getFamilyClasse(a.itens)) - idx(getFamilyClasse(b.itens));
      return diff !== 0 ? diff : a.familia.localeCompare(b.familia, 'pt-BR');
    });
  }, [groupedItems]);

  // Filtra por classe (multi-select) e texto (família, código ou descrição de produto)
  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const hasClassFilter = selectedClasses && selectedClasses.size > 0;
    const hasTextFilter = q.length > 0;

    if (!hasClassFilter && !hasTextFilter) return sortedGroups;

    return sortedGroups.filter(({ familia, itens }) => {
      if (hasClassFilter && !selectedClasses!.has(getFamilyClasse(itens))) return false;
      if (hasTextFilter) {
        const matchesFamily = familia.toLowerCase().includes(q);
        const matchesProduct = itens.some(item =>
          item.produto.codigo?.toLowerCase().includes(q) ||
          (item.produto as { descricao?: string }).descricao?.toLowerCase().includes(q)
        );
        if (!matchesFamily && !matchesProduct) return false;
      }
      return true;
    });
  }, [sortedGroups, searchQuery, selectedClasses]);

  /** Item é divergente quando seu produto consta na lista de crônicos (desvio sistemático vs vendas) */
  const isDivergente = useCallback((item: ForecastItem): boolean => {
    if (item.gestorExcluido) return false;
    const codigo = item.produto?.codigo;
    return !!codigo && divergentProductCodes.has(codigo);
  }, [divergentProductCodes]);

  // Quando o filtro está ativo, mantém apenas itens divergentes (e remove famílias vazias)
  const activeGroups = useMemo(() => {
    if (!onlyDivergentes) return filteredGroups;

    return filteredGroups
      .map(({ familia, itens }) => ({
        familia,
        itens: itens.filter(isDivergente),
      }))
      .filter(g => g.itens.length > 0);
  }, [filteredGroups, onlyDivergentes, isDivergente]);

  // Conta total de produtos divergentes no conjunto completo (não paginado)
  const divergentesCount = useMemo(() =>
    visibleGroups.reduce(
      (sum, g) => sum + g.itens.filter(isDivergente).length,
      0
    ),
  [groupedItems, isDivergente]);

  const totalPages = Math.max(1, Math.ceil(activeGroups.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedGroups = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return activeGroups.slice(start, start + pageSize);
  }, [activeGroups, safePage, pageSize]);

  return {
    searchQuery,
    setSearchQuery,
    currentPage: safePage,
    setCurrentPage,
    paginatedGroups,
    totalPages,
    filteredTotal: activeGroups.length,
    resetPage,
    onlyDivergentes,
    setOnlyDivergentes,
    divergentesCount,
    excludedItems,
  };
}
