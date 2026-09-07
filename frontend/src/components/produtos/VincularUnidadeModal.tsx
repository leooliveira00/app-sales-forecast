import React, { useState } from 'react';
import { Link, X } from 'lucide-react';
import type { Produto, UnidadeVenda } from '../../types';

interface VincularUnidadeModalProps {
  produto: Produto;
  unidades: UnidadeVenda[];
  token: string | null;
  onClose: () => void;
  onLinked: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export const VincularUnidadeModal: React.FC<VincularUnidadeModalProps> = ({
  produto, unidades, token, onClose, onLinked, showToast,
}) => {
  const [unidadeVendaId, setUnidadeVendaId] = useState('');
  const [familia, setFamilia]               = useState('');
  const [classe, setClasse]                 = useState('');
  const [saving, setSaving]                 = useState(false);

  const vinculadas   = produto.unidades.map(u => u.unidadeVendaId);
  const disponiveis  = unidades.filter(u => !vinculadas.includes(u.codigo));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const linkRes = await fetch(`/api/produtos/${produto.codigo}/unidades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unidadeVendaId, familia: familia || undefined }),
      });
      if (!linkRes.ok) {
        const err = await linkRes.json();
        showToast(err.error || 'Erro ao vincular', 'error');
        return;
      }
      // Se informada, atualiza a classe diretamente no produto
      if (classe) {
        await fetch(`/api/produtos/${produto.codigo}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ classe }),
        });
      }
      showToast('Unidade vinculada!', 'success');
      onLinked();
      onClose();
    } catch {
      showToast('Erro ao vincular unidade', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><Link className="w-5 h-5" /></div>
          <h3 className="font-bold text-slate-900 text-lg">Vincular Unidade</h3>
        </div>
        <p className="text-xs text-slate-400 mb-6 pl-1">
          Produto: <span className="font-bold text-slate-600">{produto.codigo}</span> — {produto.descricao}
        </p>
        {disponiveis.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">Produto já vinculado a todas as unidades.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Unidade de Venda</label>
              <select
                required
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500"
                value={unidadeVendaId}
                onChange={(e) => setUnidadeVendaId(e.target.value)}
              >
                <option value="">Selecione...</option>
                {disponiveis.map(u => (
                  <option key={u.codigo} value={u.codigo}>{u.codigo} — {u.descricao}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Família</label>
                <input type="text"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500"
                  value={familia} onChange={(e) => setFamilia(e.target.value)} placeholder="Intervenção" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Classe</label>
                <select
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500"
                  value={classe} onChange={(e) => setClasse(e.target.value)}
                >
                  <option value="">—</option>
                  <option value="F">F — Mais rentável</option>
                  <option value="E">E</option>
                  <option value="D">D</option>
                  <option value="C">C</option>
                  <option value="B">B</option>
                  <option value="A">A — Menos rentável</option>
                </select>
              </div>
            </div>
            <button
              type="submit" disabled={saving}
              className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all mt-2 disabled:opacity-50"
            >
              {saving ? 'Vinculando...' : 'Vincular'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
