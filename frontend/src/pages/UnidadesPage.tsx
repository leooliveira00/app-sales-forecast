import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Building, Globe, ChevronDown, ChevronRight, Plus, Pencil } from 'lucide-react';
import { useToast } from '../components/shared/ToastNotification';
import { cn } from '../components/shared/Common';
import { UnidadeVenda } from '../types';

import { NovaUnidadeModal } from '../components/admin/NovaUnidadeModal';
import { EditarUnidadeModal } from '../components/admin/EditarUnidadeModal';
import { PaisesModal } from '../components/admin/PaisesModal';

export const UnidadesPage: React.FC = () => {
  const { token, user: currentUser } = useAuth();
  const { showToast } = useToast();

  const [unidades, setUnidades]                 = useState<UnidadeVenda[]>([]);
  const [isLoading, setIsLoading]               = useState(true);
  const [showNovaModal, setShowNovaModal]        = useState(false);
  const [paisesUnidade, setPaisesUnidade]       = useState<UnidadeVenda | null>(null);
  const [editandoUnidade, setEditandoUnidade]   = useState<UnidadeVenda | null>(null);
  const [expandedUnidades, setExpandedUnidades] = useState<Set<string>>(new Set());

  const fetchUnidades = async () => {
    try {
      const res = await fetch('/api/unidades', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setUnidades(await res.json());
    } catch {
      showToast('Erro ao carregar unidades', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchUnidades(); }, [token]);

  const toggleExpand = (id: string) => {
    setExpandedUnidades(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (!['operador_pcp', 'admin_ti'].includes(currentUser?.perfil ?? '')) {
    return <div className="p-8 text-center text-slate-500">Acesso restrito a administradores.</div>;
  }

  return (
    <div className="space-y-6">
      {showNovaModal && (
        <NovaUnidadeModal
          token={token}
          onClose={() => setShowNovaModal(false)}
          onCreated={fetchUnidades}
          showToast={showToast}
        />
      )}

      {paisesUnidade && (
        <PaisesModal
          unidade={paisesUnidade}
          token={token}
          onClose={() => setPaisesUnidade(null)}
          onUpdated={fetchUnidades}
          showToast={showToast}
        />
      )}

      {editandoUnidade && (
        <EditarUnidadeModal
          unidade={editandoUnidade}
          token={token}
          onClose={() => setEditandoUnidade(null)}
          onUpdated={fetchUnidades}
          showToast={showToast}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Unidades de Venda</h2>
          <p className="text-sm text-slate-500">Cadastro e configuração de unidades</p>
        </div>
        <button
          onClick={() => setShowNovaModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50 transition-all"
        >
          <Plus className="w-4 h-4" /> Nova Unidade
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-400 py-8 text-center">Carregando...</div>
      ) : unidades.length === 0 ? (
        <div className="text-sm text-slate-400 py-8 text-center">Nenhuma unidade cadastrada.</div>
      ) : (
        <div className="space-y-2">
          {unidades.map((u) => {
            const isExport = u.tipo === 'EXPORT';
            const isOpen   = expandedUnidades.has(u.codigo);
            return (
              <div key={u.codigo} className={cn(
                'bg-white border rounded-xl overflow-hidden',
                isExport ? 'border-indigo-200' : 'border-slate-200'
              )}>
                <div className="flex items-center gap-2 px-4 py-3">
                  {isExport ? (
                    <Globe className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  ) : (
                    <Building className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}
                  <span className={cn(
                    'text-xs font-bold',
                    isExport ? 'text-indigo-700' : 'text-slate-700'
                  )}>
                    {u.codigo}
                  </span>
                  {isExport && (
                    <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-500 text-[9px] font-bold rounded border border-indigo-100 uppercase">
                      Export
                    </span>
                  )}
                  <span className="text-xs text-slate-400 font-normal">{u.descricao}</span>
                  <div className="ml-auto flex items-center gap-2">
                    {isExport && (
                      <>
                        <span className="text-[10px] text-indigo-400">
                          {(u.paises ?? []).length} país(es)
                        </span>
                        <button
                          onClick={() => setPaisesUnidade(u)}
                          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-lg hover:bg-indigo-100 transition-all"
                        >
                          <Globe className="w-3 h-3" /> Gerir Países
                        </button>
                        {(u.paises ?? []).length > 0 && (
                          <button
                            onClick={() => toggleExpand(u.codigo)}
                            className="p-1 text-indigo-400 hover:text-indigo-600 transition-colors"
                          >
                            {isOpen
                              ? <ChevronDown className="w-3.5 h-3.5" />
                              : <ChevronRight className="w-3.5 h-3.5" />
                            }
                          </button>
                        )}
                      </>
                    )}
                    <button
                      onClick={() => setEditandoUnidade(u)}
                      className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-all"
                    >
                      <Pencil className="w-3 h-3" /> Editar
                    </button>
                  </div>
                </div>

                {isExport && isOpen && (u.paises ?? []).length > 0 && (
                  <div className="px-4 pb-3 pt-0 flex flex-wrap gap-1.5 border-t border-indigo-50">
                    {(u.paises ?? []).map(p => (
                      <span key={p.iso3} className="flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded text-[10px] font-bold">
                        <span className="font-mono">{p.iso3}</span>
                        <span className="font-normal text-indigo-400">{p.nome}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
