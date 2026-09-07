import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/shared/ToastNotification';
import { cn } from '../components/shared/Common';
import {
  Box, Plus, X, Trash2, Link, Pencil, Building,
  ChevronDown, ChevronRight, Search, RotateCcw,
  PowerOff, Power, ChevronLeft,
} from 'lucide-react';

const PAGE_SIZE = 10;
import { Produto, ProdutoUnidadeVenda, UnidadeVenda } from '../types';
import { CLASSE_BADGE_COLORS } from '../types/forecast';

import { NovoProdutoModal } from '../components/produtos/NovoProdutoModal';
import { VincularUnidadeModal } from '../components/produtos/VincularUnidadeModal';
import { EditFamiliaModal } from '../components/produtos/EditFamiliaModal';
import { ConfirmModal } from '../components/shared/ConfirmModal';

// Deriva a família de um produto a partir dos vínculos com unidades
function getFamiliaDoProduto(p: Produto): string {
  return (
    p.unidades[0]?.familia?.trim() ||
    p.unidades[0]?.divisao?.trim() ||
    'Sem Família'
  );
}

export const ProdutosPage: React.FC = () => {
  const { token, user } = useAuth();
  const { showToast } = useToast();

  const [produtos, setProdutos]   = useState<Produto[]>([]);
  const [unidades, setUnidades]   = useState<UnidadeVenda[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch]       = useState('');
  const [page, setPage]           = useState(1);
  const [collapsed, setCollapsed]         = useState<Set<string>>(new Set());
  const collapsedInitialized              = React.useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showNovoProduto, setShowNovoProduto]     = useState(false);
  const [vinculandoProduto, setVinculandoProduto] = useState<Produto | null>(null);
  const [editingLink, setEditingLink]             = useState<{ produto: Produto; link: ProdutoUnidadeVenda } | null>(null);
  const [pendingAction, setPendingAction]         = useState<{
    title: string; message: string; confirmLabel: string;
    variant: 'danger' | 'warning' | 'primary'; onConfirm: () => void;
  } | null>(null);

  const fetchData = async () => {
    try {
      const [prodRes, unitRes] = await Promise.all([
        fetch('/api/produtos',  { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/unidades',  { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (prodRes.ok) setProdutos(await prodRes.json());
      if (unitRes.ok) setUnidades(await unitRes.json());
    } catch {
      showToast('Erro ao carregar dados', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [token]);

  // ── Agrupamento por família ────────────────────────────────────────────────

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? produtos.filter(
          p =>
            p.codigo.toLowerCase().includes(q) ||
            p.descricao.toLowerCase().includes(q) ||
            getFamiliaDoProduto(p).toLowerCase().includes(q)
        )
      : produtos;

    const map = new Map<string, Produto[]>();
    for (const p of filtered) {
      const fam = getFamiliaDoProduto(p);
      const list = map.get(fam) ?? [];
      list.push(p);
      map.set(fam, list);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
      .map(([familia, items]) => ({ familia, items }));
  }, [produtos, search]);

  const totalPages   = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const pagedGroups  = useMemo(
    () => groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [groups, page],
  );

  // Collapse all families on first load
  useEffect(() => {
    if (!collapsedInitialized.current && groups.length > 0) {
      collapsedInitialized.current = true;
      setCollapsed(new Set(groups.map(g => g.familia)));
    }
  }, [groups]);

  // Reset to page 1 whenever search changes
  useEffect(() => { setPage(1); }, [search]);

  const allFamilies  = useMemo(() => pagedGroups.map(g => g.familia), [pagedGroups]);
  const allCollapsed = allFamilies.length > 0 && allFamilies.every(f => collapsed.has(f));

  const toggleFamily = (fam: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(fam) ? next.delete(fam) : next.add(fam);
      return next;
    });

  const toggleAll = () =>
    setCollapsed(allCollapsed ? new Set() : new Set(allFamilies));

  // ── Ações ─────────────────────────────────────────────────────────────────

  const handleSoftDelete = (id: string) => {
    setPendingAction({
      title: 'Desativar Produto',
      message: 'Deseja desativar este produto? Ele ficará oculto nos forecasts futuros.',
      confirmLabel: 'Desativar',
      variant: 'danger',
      onConfirm: async () => {
        setPendingAction(null);
        setIsSubmitting(true);
        try {
          const res = await fetch(`/api/produtos/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) { showToast('Produto desativado.', 'success'); fetchData(); }
          else { const e = await res.json(); showToast(e.error || 'Erro', 'error'); }
        } catch { showToast('Erro ao desativar produto', 'error'); }
        finally { setIsSubmitting(false); }
      },
    });
  };

  const handleReactivate = async (codigo: string) => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/produtos/${codigo}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ativo: true }),
      });
      if (res.ok) { showToast('Produto reativado.', 'success'); fetchData(); }
      else { const e = await res.json(); showToast(e.error || 'Erro', 'error'); }
    } catch { showToast('Erro ao reativar produto', 'error'); }
    finally { setIsSubmitting(false); }
  };

  const handleFamilyDeactivate = (items: Produto[]) => {
    const ativos = items.filter(p => p.ativo);
    if (ativos.length === 0) return;
    setPendingAction({
      title: 'Inativar Família',
      message: `Desativar ${ativos.length} produto(s) da família? Eles ficarão ocultos nos forecasts futuros.`,
      confirmLabel: 'Desativar',
      variant: 'danger',
      onConfirm: async () => {
        setPendingAction(null);
        setIsSubmitting(true);
        try {
          await Promise.allSettled(
            ativos.map(p =>
              fetch(`/api/produtos/${p.codigo}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              })
            )
          );
          showToast(`${ativos.length} produto(s) desativado(s).`, 'success');
          fetchData();
        } catch { showToast('Erro ao desativar família', 'error'); }
        finally { setIsSubmitting(false); }
      },
    });
  };

  const handleFamilyReactivate = (items: Produto[]) => {
    const inativos = items.filter(p => !p.ativo);
    if (inativos.length === 0) return;
    setPendingAction({
      title: 'Reativar Família',
      message: `Reativar ${inativos.length} produto(s) da família?`,
      confirmLabel: 'Reativar',
      variant: 'primary',
      onConfirm: async () => {
        setPendingAction(null);
        setIsSubmitting(true);
        try {
          await Promise.allSettled(
            inativos.map(p =>
              fetch(`/api/produtos/${p.codigo}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ ativo: true }),
              })
            )
          );
          showToast(`${inativos.length} produto(s) reativado(s).`, 'success');
          fetchData();
        } catch { showToast('Erro ao reativar família', 'error'); }
        finally { setIsSubmitting(false); }
      },
    });
  };

  const handleUnlinkUnidade = (produtoId: string, unidadeVendaId: string) => {
    setPendingAction({
      title: 'Remover Vínculo',
      message: `Remover o vínculo do produto com a unidade ${unidadeVendaId}?`,
      confirmLabel: 'Remover',
      variant: 'danger',
      onConfirm: async () => {
        setPendingAction(null);
        setIsSubmitting(true);
        try {
          const res = await fetch(`/api/produtos/${produtoId}/unidades/${unidadeVendaId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) { showToast('Vínculo removido.', 'success'); fetchData(); }
          else { const e = await res.json(); showToast(e.error || 'Erro', 'error'); }
        } catch { showToast('Erro ao remover vínculo', 'error'); }
        finally { setIsSubmitting(false); }
      },
    });
  };

  if (!['operador_pcp', 'admin_ti'].includes(user?.perfil ?? '')) {
    return <div className="p-8 text-center text-slate-500">Acesso restrito a administradores.</div>;
  }

  const totalProdutos = groups.reduce((s, g) => s + g.items.length, 0);
  const totalExibidos = pagedGroups.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="space-y-8">
      {pendingAction && (
        <ConfirmModal
          title={pendingAction.title}
          message={pendingAction.message}
          confirmLabel={pendingAction.confirmLabel}
          variant={pendingAction.variant}
          loading={isSubmitting}
          onConfirm={pendingAction.onConfirm}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {showNovoProduto && (
        <NovoProdutoModal
          token={token} onClose={() => setShowNovoProduto(false)}
          onCreated={fetchData} showToast={showToast}
        />
      )}
      {vinculandoProduto && (
        <VincularUnidadeModal
          produto={vinculandoProduto} unidades={unidades} token={token}
          onClose={() => setVinculandoProduto(null)}
          onLinked={fetchData} showToast={showToast}
        />
      )}
      {editingLink && (
        <EditFamiliaModal
          produto={editingLink.produto}
          link={editingLink.link}
          token={token}
          onClose={() => setEditingLink(null)}
          onSaved={fetchData}
          showToast={showToast}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Produtos</h2>
          <p className="text-sm text-slate-500">Cadastro de produtos e vínculos com unidades de venda</p>
        </div>
        <button
          onClick={() => setShowNovoProduto(true)}
          className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-bold hover:bg-sky-700 transition-all shadow-lg shadow-sky-600/20"
        >
          <Plus className="w-4 h-4" /> Novo Produto
        </button>
      </div>

      {/* Card principal */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

        {/* Barra superior: título + busca + colapsar tudo */}
        <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 flex-1">
            <div className="p-2 bg-sky-50 text-sky-600 rounded-lg shrink-0">
              <Box className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Produtos Cadastrados</h3>
              <p className="text-[11px] text-slate-400">
                {totalProdutos} produto{totalProdutos !== 1 ? 's' : ''} em {groups.length} famíli{groups.length !== 1 ? 'as' : 'a'}
                {search && ` · ${totalExibidos} exibidos`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Campo de busca */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar código, nome ou família..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-sky-400 w-56 bg-slate-50"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Colapsar / Expandir tudo */}
            {groups.length > 0 && (
              <button
                onClick={toggleAll}
                className="text-[11px] font-bold text-slate-400 hover:text-slate-600 border border-slate-200 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap"
              >
                {allCollapsed ? 'Expandir tudo' : 'Colapsar tudo'}
              </button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando...</div>
        ) : groups.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            {search ? 'Nenhum produto encontrado para a busca.' : 'Nenhum produto cadastrado.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-[10px] font-bold uppercase tracking-wider border-b border-slate-200">
                  <th className="px-6 py-3">Código</th>
                  <th className="px-6 py-3">Descrição</th>
                  <th className="px-6 py-3">NCM</th>
                  <th className="px-6 py-3">Unidades Vinculadas</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {pagedGroups.map(({ familia, items }) => {
                  const isCollapsed = collapsed.has(familia);
                  return (
                    <React.Fragment key={familia}>
                      {/* Linha de cabeçalho da família */}
                      <tr className="bg-slate-50 border-y border-slate-200">
                        <td colSpan={6} className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            {/* Área clicável para colapsar */}
                            <button
                              onClick={() => toggleFamily(familia)}
                              className="flex items-center gap-2 flex-1 text-left select-none"
                            >
                              {isCollapsed
                                ? <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                : <ChevronDown  className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              }
                              <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                                {familia}
                              </span>
                              <span className="text-[10px] font-semibold text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded-full">
                                {items.length}
                              </span>
                            </button>

                            {/* Ações de família */}
                            <div className="flex items-center gap-1 shrink-0">
                              {items.some(p => !p.ativo) && (
                                <button
                                  onClick={() => handleFamilyReactivate(items)}
                                  disabled={isSubmitting}
                                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-emerald-600 border border-emerald-200 rounded hover:bg-emerald-50 transition-colors disabled:opacity-30"
                                  title="Reativar produtos inativos da família"
                                >
                                  <Power className="w-3 h-3" /> Reativar família
                                </button>
                              )}
                              {items.some(p => p.ativo) && (
                                <button
                                  onClick={() => handleFamilyDeactivate(items)}
                                  disabled={isSubmitting}
                                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-slate-500 border border-slate-200 rounded hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors disabled:opacity-30"
                                  title="Desativar todos os produtos ativos da família"
                                >
                                  <PowerOff className="w-3 h-3" /> Inativar família
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>

                      {/* Linhas de produto da família */}
                      {!isCollapsed && items.map(p => (
                        <tr key={p.codigo} className="hover:bg-slate-50/60 transition-colors border-b border-slate-100 last:border-0">
                          <td className="px-6 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-sm font-bold text-slate-700">{p.codigo}</span>
                              {p.classe && (
                                <span className={cn(
                                  "inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold border",
                                  CLASSE_BADGE_COLORS[p.classe] ?? 'bg-slate-100 text-slate-500 border-slate-200'
                                )}>
                                  {p.classe}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-3">
                            <span className="text-sm text-slate-900">{p.descricao}</span>
                          </td>
                          <td className="px-6 py-3">
                            <span className="text-xs font-mono text-slate-400">{p.ncm ?? '—'}</span>
                          </td>
                          <td className="px-6 py-3">
                            <div className="flex flex-wrap gap-1.5 items-center">
                              {p.unidades.map((link) => (
                                <span
                                  key={link.unidadeVendaId}
                                  className="group flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded"
                                >
                                  <Building className="w-3 h-3 text-slate-400" />
                                  {link.unidade.codigo}
                                  {link.familia && (
                                    <span className="text-slate-400 font-normal">· {link.familia}</span>
                                  )}
                                  <button
                                    onClick={() => setEditingLink({ produto: p, link })}
                                    className="ml-0.5 text-slate-300 hover:text-violet-500 transition-colors"
                                    title="Editar família / classe"
                                  >
                                    <Pencil className="w-2.5 h-2.5" />
                                  </button>
                                  <button
                                    onClick={() => handleUnlinkUnidade(p.codigo, link.unidadeVendaId)}
                                    disabled={isSubmitting}
                                    className="ml-0.5 text-slate-300 hover:text-red-500 transition-colors"
                                    title="Remover vínculo"
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </span>
                              ))}
                              <button
                                onClick={() => setVinculandoProduto(p)}
                                className="flex items-center gap-1 text-[10px] font-bold text-sky-500 hover:text-sky-700 border border-dashed border-sky-200 px-2 py-0.5 rounded transition-colors"
                                title="Vincular unidade"
                              >
                                <Link className="w-3 h-3" /> Vincular
                              </button>
                            </div>
                          </td>
                          <td className="px-6 py-3">
                            <span className={cn(
                              "px-2 py-0.5 rounded-full text-[10px] font-bold border",
                              p.ativo
                                ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                : "bg-slate-100 text-slate-400 border-slate-200"
                            )}>
                              {p.ativo ? 'Ativo' : 'Inativo'}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-right">
                            {p.ativo ? (
                              <button
                                onClick={() => handleSoftDelete(p.codigo)}
                                disabled={isSubmitting}
                                className="p-2 text-slate-300 hover:text-red-600 transition-colors disabled:opacity-30"
                                title="Desativar produto"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleReactivate(p.codigo)}
                                disabled={isSubmitting}
                                className="p-2 text-slate-300 hover:text-emerald-600 transition-colors disabled:opacity-30"
                                title="Reativar produto"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Página {page} de {totalPages} · {groups.length} famílias
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
                .reduce<(number | '…')[]>((acc, n, i, arr) => {
                  if (i > 0 && (n as number) - (arr[i - 1] as number) > 1) acc.push('…');
                  acc.push(n);
                  return acc;
                }, [])
                .map((n, i) =>
                  n === '…' ? (
                    <span key={`ellipsis-${i}`} className="px-1 text-slate-300 text-xs">…</span>
                  ) : (
                    <button
                      key={n}
                      onClick={() => setPage(n as number)}
                      className={cn(
                        'w-7 h-7 rounded-lg text-xs font-medium transition-colors',
                        page === n
                          ? 'bg-sky-500 text-white'
                          : 'text-slate-500 hover:bg-slate-100'
                      )}
                    >
                      {n}
                    </button>
                  )
                )}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProdutosPage;
