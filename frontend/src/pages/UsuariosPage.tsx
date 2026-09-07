import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { UserPlus } from 'lucide-react';
import { useToast } from '../components/shared/ToastNotification';
import { ConfirmModal } from '../components/shared/ConfirmModal';
import { UnidadeVenda } from '../types';

import { NovoUsuarioModal } from '../components/admin/NovoUsuarioModal';
import { EditarUsuarioModal } from '../components/admin/EditarUsuarioModal';
import { UserTable, AdminUser } from '../components/admin/UserTable';

export const UsuariosPage: React.FC = () => {
  const { token, user: currentUser } = useAuth();
  const { showToast } = useToast();

  const [users, setUsers]               = useState<AdminUser[]>([]);
  const [unidades, setUnidades]         = useState<UnidadeVenda[]>([]);
  const [isLoading, setIsLoading]       = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNovoModal, setShowNovoModal]   = useState(false);
  const [editandoUser, setEditandoUser]     = useState<AdminUser | null>(null);
  const [userToDelete, setUserToDelete]     = useState<string | null>(null);

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

  if (!['operador_pcp', 'admin_ti'].includes(currentUser?.perfil ?? '')) {
    return <div className="p-8 text-center text-slate-500">Acesso restrito a administradores.</div>;
  }

  return (
    <div className="space-y-6">
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

      {showNovoModal && (
        <NovoUsuarioModal
          token={token}
          unidades={unidades}
          onClose={() => setShowNovoModal(false)}
          onCreated={fetchData}
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

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Usuários</h2>
          <p className="text-sm text-slate-500">Gerenciamento de contas e permissões</p>
        </div>
        <button
          onClick={() => setShowNovoModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-bold hover:bg-sky-700 transition-all shadow-sm"
        >
          <UserPlus className="w-4 h-4" /> Novo Usuário
        </button>
      </div>

      <UserTable
        users={users}
        isLoading={isLoading}
        isSubmitting={isSubmitting}
        onDeleteUser={setUserToDelete}
        onEditUser={setEditandoUser}
      />
    </div>
  );
};
