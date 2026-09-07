import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { UserPlus, Building, Globe, ChevronDown, ChevronRight, Plus, Pencil } from 'lucide-react';
import { useToast } from '../components/shared/ToastNotification';
import { cn } from '../components/shared/Common';
import { ConfirmModal } from '../components/shared/ConfirmModal';
import { UnidadeVenda } from '../types';

import { NovaUnidadeModal } from '../components/admin/NovaUnidadeModal';
import { EditarUnidadeModal } from '../components/admin/EditarUnidadeModal';
import { EditarUsuarioModal } from '../components/admin/EditarUsuarioModal';
import { PaisesModal } from '../components/admin/PaisesModal';
import { UserTable, AdminUser } from '../components/admin/UserTable';

export const AdminPage: React.FC = () => {
  const { token, user: currentUser } = useAuth();
  const { showToast } = useToast();
  const [users, setUsers]                         = useState<AdminUser[]>([]);
  const [unidades, setUnidades]                   = useState<UnidadeVenda[]>([]);
  const [isLoading, setIsLoading]                 = useState(true);
  const [isSubmitting, setIsSubmitting]           = useState(false);
  const [showUnidadeModal, setShowUnidadeModal]   = useState(false);
  const [paisesUnidade, setPaisesUnidade]         = useState<UnidadeVenda | null>(null);
  const [editandoUnidade, setEditandoUnidade]     = useState<UnidadeVenda | null>(null);
  const [editandoUser, setEditandoUser]           = useState<AdminUser | null>(null);
  const [expandedUnidades, setExpandedUnidades]   = useState<Set<string>>(new Set());
  const [userToDelete,     setUserToDelete]        = useState<string | null>(null);

  const [nome, setNome]                     = useState('');
  const [email, setEmail]                   = useState('');
  const [password, setPassword]             = useState('');
  const [perfil, setPerfil]                 = useState('gestor');
  const [unidadeVendaId, setUnidadeVendaId] = useState('');

  const fetchData = async () => {
    try {
      const [usersRes, unitsRes] = await Promise.all([
        fetch('/api/users',    { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/unidades', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (usersRes.ok)  setUsers(await usersRes.json());
      if (unitsRes.ok)  setUnidades(await unitsRes.json());
    } catch {
      showToast('Erro ao carregar dados', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [token]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nome, email, password, perfil, unidadeVendaId }),
      });
      if (res.ok) {
        showToast('Usuário criado com sucesso!', 'success');
        setNome(''); setEmail(''); setPassword('');
        setPerfil('gestor'); setUnidadeVendaId('');
        fetchData();
      } else {
        const err = await res.json();
        showToast(err.error, 'error');
      }
    } catch {
      showToast('Erro ao criar usuário', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    setUserToDelete(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        showToast('Usuário excluído!', 'success');
        fetchData();
      } else {
        const err = await res.json();
        showToast(err.error || 'Erro ao excluir', 'error');
      }
    } catch {
      showToast('Erro ao excluir usuário', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

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
    <div className="space-y-8">
      {userToDelete && (
        <ConfirmModal
          title="Excluir Usuário"
          message="Tem certeza que deseja excluir este usuário? Esta ação não pode ser desfeita."
          confirmLabel="Excluir"
          variant="danger"
          loading={isSubmitting}
          onConfirm={() => handleDeleteUser(userToDelete)}
          onCancel={() => setUserToDelete(null)}
        />
      )}

      {showUnidadeModal && (
        <NovaUnidadeModal
          token={token}
          onClose={() => setShowUnidadeModal(false)}
          onCreated={fetchData}
          showToast={showToast}
        />
      )}

      {paisesUnidade && (
        <PaisesModal
          unidade={paisesUnidade}
          token={token}
          onClose={() => setPaisesUnidade(null)}
          onUpdated={fetchData}
          showToast={showToast}
        />
      )}

      {editandoUnidade && (
        <EditarUnidadeModal
          unidade={editandoUnidade}
          token={token}
          onClose={() => setEditandoUnidade(null)}
          onUpdated={fetchData}
          showToast={showToast}
        />
      )}

      {editandoUser && (
        <EditarUsuarioModal
          user={editandoUser}
          token={token}
          allUnidades={unidades}
          onClose={() => setEditandoUser(null)}
          onUpdated={fetchData}
          showToast={showToast}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Administração</h2>
          <p className="text-sm text-slate-500">Gerenciamento de usuários e unidades</p>
        </div>
        <button
          onClick={() => setShowUnidadeModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50 transition-all"
        >
          <Plus className="w-4 h-4" /> Nova Unidade
        </button>
      </div>


      {/* Unidades cadastradas */}
      {unidades.length > 0 && (
        <div className="space-y-2">
          {unidades.map((u) => {
            const isExport = u.tipo === 'EXPORT';
            const isOpen   = expandedUnidades.has(u.codigo);
            return (
              <div key={u.codigo} className={cn(
                "bg-white border rounded-xl overflow-hidden",
                isExport ? "border-indigo-200" : "border-slate-200"
              )}>
                <div className="flex items-center gap-2 px-4 py-3">
                  {isExport ? (
                    <Globe className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  ) : (
                    <Building className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}
                  <span className={cn(
                    "text-xs font-bold",
                    isExport ? "text-indigo-700" : "text-slate-700"
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Formulário novo usuário */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sticky top-24">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-sky-50 text-sky-600 rounded-lg">
                <UserPlus className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900">Criar Novo Usuário</h3>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Nome Completo</label>
                <input required type="text"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500"
                  value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">E-mail</label>
                <input required type="email"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500"
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Senha Inicial</label>
                <input required type="password"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Defina uma senha inicial" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Papel / Nível</label>
                <select
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500"
                  value={perfil} onChange={(e) => { setPerfil(e.target.value); setUnidadeVendaId(''); }}
                >
                  <option value="gestor">Gerente</option>
                  <option value="operador_pcp">Operador PCP</option>
                  <option value="admin_ti">Administrador TI</option>
                </select>
              </div>
              {perfil === 'gestor' && (
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">
                    Unidade de Venda
                  </label>
                  <select
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500"
                    value={unidadeVendaId}
                    onChange={(e) => setUnidadeVendaId(e.target.value)}
                  >
                    <option value="">Selecione a unidade...</option>
                    {unidades.map((u) => (
                      <option key={u.codigo} value={u.codigo}>{u.codigo} — {u.descricao}</option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-sky-600 text-white font-bold rounded-xl hover:bg-sky-700 transition-all shadow-lg shadow-sky-600/20 mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Cadastrando...' : 'Cadastrar Usuário'}
              </button>
            </form>
          </div>
        </div>

        {/* Tabela de usuários */}
        <div className="lg:col-span-2">
          <UserTable
            users={users}
            isLoading={isLoading}
            isSubmitting={isSubmitting}
            onDeleteUser={setUserToDelete}
            onEditUser={setEditandoUser}
          />
        </div>
      </div>
    </div>
  );
};
