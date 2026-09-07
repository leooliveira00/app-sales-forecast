import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, Search, Tag, XCircle, ChevronDown, ChevronRight, Layers, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../shared/Common';

interface Produto {
  codigo: string;
  descricao: string;
  unidades: Array<{
    familia: string | null;
    divisao: string | null;
  }>;
}

interface FamilyGroup {
  familia: string;
  produtos: Produto[];
}

interface AddProductModalProps {
  token: string;
  unidadeVendaId: string;
  presentIds: Set<string>;
  onAdd: (produtoId: string) => Promise<void>;
  onAddBatch?: (produtoIds: string[]) => Promise<void>;
  onClose: () => void;
}

const getFamiliaDoProduto = (p: Produto): string =>
  p.unidades[0]?.familia?.trim() || p.unidades[0]?.divisao?.trim() || 'Outros';

export const AddProductModal: React.FC<AddProductModalProps> = ({
  token,
  unidadeVendaId,
  presentIds,
  onAdd,
  onAddBatch,
  onClose,
}) => {
  const { t } = useTranslation('forecast');

  const [allProdutos, setAllProdutos] = useState<Produto[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [collapsed, setCollapsed]     = useState<Set<string>>(new Set());
  const [adding, setAdding]           = useState<Set<string>>(new Set());
  const [addingFamily, setAddingFamily] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    const load = async () => {
      setLoading(true);
      try {
        const res  = await fetch(
          `/api/produtos?unidadeVendaId=${encodeURIComponent(unidadeVendaId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = res.ok ? await res.json() : [];
        const produtos: Produto[] = Array.isArray(data) ? data : (data.produtos ?? []);
        setAllProdutos(produtos);
        setCollapsed(new Set(produtos.map((p) => getFamiliaDoProduto(p))));
      } catch {
        setAllProdutos([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, unidadeVendaId]);

  const familyGroups = useMemo<FamilyGroup[]>(() => {
    const lower    = search.toLowerCase();
    const filtered = allProdutos.filter(
      (p) =>
        !lower ||
        p.codigo.toLowerCase().includes(lower) ||
        p.descricao.toLowerCase().includes(lower)
    );
    const map = new Map<string, Produto[]>();
    for (const p of filtered) {
      const fam = getFamiliaDoProduto(p);
      if (!map.has(fam)) map.set(fam, []);
      map.get(fam)!.push(p);
    }
    return [...map.entries()]
      .map(([familia, produtos]) => ({ familia, produtos }))
      .sort((a, b) => a.familia.localeCompare(b.familia, 'pt-BR'));
  }, [allProdutos, search]);

  const totalProducts = allProdutos.length;
  const presentCount  = allProdutos.filter((p) => presentIds.has(p.codigo)).length;

  const toggleCollapse = (familia: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(familia) ? next.delete(familia) : next.add(familia);
      return next;
    });
  };

  const handleAddProduct = async (codigo: string) => {
    setAdding((prev) => new Set(prev).add(codigo));
    await onAdd(codigo);
    setAdding((prev) => {
      const next = new Set(prev);
      next.delete(codigo);
      return next;
    });
  };

  const handleAddFamily = async (group: FamilyGroup) => {
    const toAdd = group.produtos.filter((p) => !presentIds.has(p.codigo));
    if (!toAdd.length) return;

    setAddingFamily(group.familia);
    const ids = toAdd.map((p) => p.codigo);

    if (onAddBatch) {
      ids.forEach((id) => setAdding((prev) => new Set(prev).add(id)));
      await onAddBatch(ids);
      setAdding(new Set());
    } else {
      for (const p of toAdd) {
        setAdding((prev) => new Set(prev).add(p.codigo));
        await onAdd(p.codigo);
        setAdding((prev) => {
          const next = new Set(prev);
          next.delete(p.codigo);
          return next;
        });
      }
    }

    setAddingFamily(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-sky-50 rounded-lg">
              <Plus className="w-4 h-4 text-sky-600" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">{t('addProductModal.title')}</h3>
              {!loading && (
                <p className="text-xs text-slate-400">
                  {t(`addProductModal.subtitle_${totalProducts !== 1 ? 'other' : 'one'}`, {
                    total: totalProducts,
                    present: presentCount,
                  })}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4 pb-3 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              ref={searchRef}
              type="text"
              placeholder={t('addProductModal.searchPlaceholder')}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-sky-400"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2">
          {loading && (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('addProductModal.loading')}
            </div>
          )}

          {!loading && familyGroups.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-slate-400 text-sm">
              <Search className="w-6 h-6 mb-2 opacity-40" />
              {t('addProductModal.noResults')}
            </div>
          )}

          {!loading && familyGroups.map((group) => {
            const isCollapsed    = collapsed.has(group.familia);
            const allPresent     = group.produtos.every((p) => presentIds.has(p.codigo));
            const presentInGroup = group.produtos.filter((p) => presentIds.has(p.codigo)).length;
            const isFamilyAdding = addingFamily === group.familia;

            return (
              <div key={group.familia} className="border border-slate-200 rounded-xl overflow-hidden">
                {/* Family header */}
                <div
                  className={cn(
                    "flex items-center justify-between px-4 py-3 cursor-pointer select-none transition-colors",
                    allPresent ? "bg-slate-50" : "bg-white hover:bg-slate-50/80"
                  )}
                  onClick={() => toggleCollapse(group.familia)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isCollapsed
                      ? <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                      : <ChevronDown  className="w-4 h-4 text-slate-400 shrink-0" />}
                    <Layers className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span className="font-semibold text-sm text-slate-800 truncate">{group.familia}</span>
                    <span className="text-xs text-slate-400 shrink-0">
                      {group.produtos.length} SKU{group.produtos.length !== 1 ? 's' : ''}
                    </span>
                    {presentInGroup > 0 && (
                      <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-md shrink-0">
                        {t('addProductModal.inCycleCount', { count: presentInGroup })}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); handleAddFamily(group); }}
                    disabled={allPresent || isFamilyAdding}
                    className={cn(
                      "ml-3 shrink-0 flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition-colors",
                      allPresent
                        ? "bg-slate-100 text-slate-400 cursor-default"
                        : isFamilyAdding
                          ? "bg-sky-100 text-sky-400 cursor-wait"
                          : "bg-sky-600 text-white hover:bg-sky-700"
                    )}
                  >
                    {isFamilyAdding ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> {t('addProductModal.adding')}</>
                    ) : allPresent ? (
                      t('addProductModal.allInCycle')
                    ) : (
                      <><Plus className="w-3 h-3" /> {t('addProductModal.addFamily')}</>
                    )}
                  </button>
                </div>

                {/* Product rows */}
                {!isCollapsed && (
                  <div className="border-t border-slate-100 divide-y divide-slate-50">
                    {group.produtos.map((p) => {
                      const alreadyPresent = presentIds.has(p.codigo);
                      const isAdding       = adding.has(p.codigo);
                      return (
                        <div
                          key={p.codigo}
                          className={cn(
                            "flex items-center justify-between px-4 py-2.5",
                            alreadyPresent ? "opacity-50 bg-slate-50/50" : "hover:bg-slate-50"
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Tag className="w-3 h-3 text-slate-300 shrink-0" />
                            <span className="font-mono text-xs font-bold text-slate-400 shrink-0">{p.codigo}</span>
                            <span className="text-sm text-slate-700 truncate">{p.descricao}</span>
                          </div>
                          <button
                            onClick={() => !alreadyPresent && !isAdding && handleAddProduct(p.codigo)}
                            disabled={alreadyPresent || isAdding}
                            className={cn(
                              "ml-3 shrink-0 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors",
                              alreadyPresent
                                ? "bg-slate-100 text-slate-400 cursor-default"
                                : isAdding
                                  ? "bg-sky-100 text-sky-400 cursor-wait"
                                  : "bg-sky-50 text-sky-700 hover:bg-sky-600 hover:text-white"
                            )}
                          >
                            {alreadyPresent ? t('addProductModal.inCycle') : isAdding ? '...' : '+ Add'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 shrink-0">
          <p className="text-[10px] text-slate-400">
            {t('addProductModal.footerHint')}
          </p>
        </div>
      </div>
    </div>
  );
};
