import React, { useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { Dropdown } from '../shared/Dropdown';
import type { DropdownOption } from '../shared/Dropdown';

/** Perfis atribuíveis — mesma ordem do enum Perfil no schema. */
export const PERFIS: ReadonlyArray<DropdownOption> = [
  { valor: 'gestor',        rotulo: 'Gerente' },
  { valor: 'controladoria', rotulo: 'Controladoria' },
  { valor: 'consulta',      rotulo: 'Consulta' },
  { valor: 'operador_pcp',  rotulo: 'Operador PCP' },
  { valor: 'admin_ti',      rotulo: 'Administrador TI' },
];

interface UnidadeOption {
  codigo: string;
  descricao: string;
}

interface NovoUsuarioModalProps {
  token: string | null;
  unidades: UnidadeOption[];
  onClose: () => void;
  onCreated: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export const NovoUsuarioModal: React.FC<NovoUsuarioModalProps> = ({
  token, unidades, onClose, onCreated, showToast,
}) => {
  const [nome, setNome]                     = useState('');
  const [email, setEmail]                   = useState('');
  const [password, setPassword]             = useState('');
  const [perfil, setPerfil]                 = useState('gestor');
  const [unidadeVendaId, setUnidadeVendaId] = useState('');
  const [saving, setSaving]                 = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nome, email, password, perfil, unidadeVendaId }),
      });
      if (res.ok) {
        showToast('Usuário criado com sucesso!', 'success');
        onCreated();
        onClose();
      } else {
        const err = await res.json();
        showToast(err.error || 'Erro ao criar usuário', 'error');
      }
    } catch {
      showToast('Erro ao criar usuário', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-sky-50 text-sky-600 rounded-lg">
            <UserPlus className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-900 text-lg">Novo Usuário</h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Nome Completo</label>
            <input required type="text"
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500"
              value={nome} onChange={e => setNome(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">E-mail</label>
            <input required type="email"
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500"
              value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Senha Inicial</label>
            <input required type="password"
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500"
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Defina uma senha inicial" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Papel / Nível</label>
            <Dropdown
              aria="Papel / Nível"
              valor={perfil}
              opcoes={PERFIS}
              onChange={(v) => { setPerfil(v); setUnidadeVendaId(''); }}
            />
          </div>
          {perfil === 'gestor' && (
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Unidade de Venda</label>
              <Dropdown
                aria="Unidade de Venda"
                valor={unidadeVendaId}
                placeholder="Selecione a unidade..."
                opcoes={unidades.map(u => ({ valor: u.codigo, rotulo: `${u.codigo} — ${u.descricao}` }))}
                onChange={setUnidadeVendaId}
              />
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-all text-sm">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-sky-600 text-white font-bold rounded-xl hover:bg-sky-700 transition-all disabled:opacity-50 text-sm">
              {saving ? 'Cadastrando...' : 'Cadastrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
