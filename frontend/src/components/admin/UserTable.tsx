import React from 'react';
import { Users, Building, Trash2, Pencil } from 'lucide-react';
import { cn } from '../shared/Common';

interface UserLink {
  id: string;
  unidadeVenda: { codigo: string; descricao: string };
}

export interface AdminUser {
  id: string;
  nome: string;
  email: string;
  perfil: string;
  unidades: UserLink[];
  lastLoginAt?: string | null;
}

// Formatação progressiva para a coluna "Último acesso".
// Escalonamento:
//   - null/inválido         → "Nunca acessou"   (cinza claro)
//   - hoje                  → "Hoje HH:MM"      (verde)
//   - ontem                 → "Ontem HH:MM"     (sky)
//   - 2-6 dias              → "Há N dias"       (sky)
//   - 7-29 dias             → "Há N semana(s)"  (sky)
//   - 30+ dias              → "dd/mm/aaaa"      (cinza)
const formatLastLogin = (iso: string | null | undefined): { label: string; tone: 'never' | 'today' | 'recent' | 'past' } => {
  if (!iso) return { label: 'Nunca acessou', tone: 'never' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { label: 'Nunca acessou', tone: 'never' };

  const now = new Date();
  // Diferença em dias calendário (zera horas para evitar saltos por horário)
  const startOfToday   = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget  = new Date(d.getFullYear(),   d.getMonth(),   d.getDate()).getTime();
  const diffDays       = Math.floor((startOfToday - startOfTarget) / 86_400_000);

  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');

  if (diffDays <= 0) return { label: `Hoje ${hh}:${mm}`,  tone: 'today'  };
  if (diffDays === 1) return { label: `Ontem ${hh}:${mm}`, tone: 'recent' };
  if (diffDays < 7)  return { label: `Há ${diffDays} dias`, tone: 'recent' };
  if (diffDays < 30) {
    const semanas = Math.floor(diffDays / 7);
    return { label: semanas === 1 ? 'Há 1 semana' : `Há ${semanas} semanas`, tone: 'recent' };
  }
  return {
    label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    tone: 'past',
  };
};

interface UserTableProps {
  users: AdminUser[];
  isLoading: boolean;
  isSubmitting: boolean;
  onDeleteUser: (userId: string) => void;
  onEditUser: (user: AdminUser) => void;
}

export const UserTable: React.FC<UserTableProps> = ({
  users, isLoading, isSubmitting, onDeleteUser, onEditUser,
}) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
    <div className="p-6 border-b border-slate-100 flex items-center gap-3">
      <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
        <Users className="w-5 h-5" />
      </div>
      <h3 className="font-bold text-slate-900">Usuários Cadastrados</h3>
      <span className="ml-auto text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
        {users.length}
      </span>
    </div>

    {isLoading ? (
      <div className="p-12 text-center text-slate-400">Carregando...</div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-[10px] font-bold uppercase tracking-wider border-b border-slate-200">
              <th className="px-6 py-4">Usuário</th>
              <th className="px-6 py-4">Papel</th>
              <th className="px-6 py-4">Unidade</th>
              <th className="px-6 py-4">Último acesso</th>
              <th className="px-6 py-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-900">{u.nome}</span>
                    <span className="text-xs text-slate-400">{u.email}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border",
                    u.perfil === 'operador_pcp'  ? "bg-purple-50  text-purple-600  border-purple-100"  :
                    u.perfil === 'admin_ti'      ? "bg-indigo-50  text-indigo-600  border-indigo-100"  :
                    u.perfil === 'consulta'      ? "bg-slate-100  text-slate-500   border-slate-200"  :
                                                   "bg-sky-50     text-sky-600     border-sky-100"
                  )}>
                    {u.perfil === 'gestor'        ? 'Gerente'
                    : u.perfil === 'operador_pcp' ? 'Operador PCP'
                    : u.perfil === 'admin_ti'     ? 'Adm. TI'
                    : u.perfil === 'consulta'     ? 'Consulta'
                    : u.perfil}
                  </span>
                </td>
                <td className="px-6 py-4">
                  {u.unidades.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {u.unidades.map((link) => (
                        <span key={link.id} className="flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded w-fit">
                          <Building className="w-3 h-3 text-slate-400" />
                          {link.unidadeVenda.codigo}
                          <span className="font-normal text-slate-400">· {link.unidadeVenda.descricao}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  {(() => {
                    const { label, tone } = formatLastLogin(u.lastLoginAt);
                    return (
                      <span className={cn(
                        "text-[11px] font-medium px-2 py-0.5 rounded-full border",
                        tone === 'never'  ? "bg-slate-50 text-slate-400 border-slate-200" :
                        tone === 'today'  ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                        tone === 'recent' ? "bg-sky-50 text-sky-700 border-sky-200" :
                                            "bg-slate-50 text-slate-600 border-slate-200",
                      )}>
                        {label}
                      </span>
                    );
                  })()}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => onEditUser(u)}
                      disabled={isSubmitting}
                      className="p-2 text-slate-300 hover:text-indigo-600 transition-colors disabled:opacity-30"
                      title="Editar usuário"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDeleteUser(u.id)}
                      disabled={isSubmitting}
                      className="p-2 text-slate-300 hover:text-red-600 transition-colors disabled:opacity-30"
                      title="Excluir usuário"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-400 text-sm">
                  Nenhum usuário cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    )}
  </div>
);
