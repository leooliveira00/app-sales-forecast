import React, { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import type { Produto, ProdutoUnidadeVenda } from '../../types';

interface EditFamiliaModalProps {
  produto: Produto;
  link: ProdutoUnidadeVenda;
  token: string | null;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export const EditFamiliaModal: React.FC<EditFamiliaModalProps> = ({
  produto, link, token, onClose, onSaved, showToast,
}) => {
  const [familia, setFamilia] = useState(link.familia ?? '');
  const [classe, setClasse]   = useState(produto.classe ?? '');
  const [saving, setSaving]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Atualiza familia no vínculo produto × unidade
      const linkRes = await fetch(`/api/produtos/${produto.codigo}/unidades/${link.unidadeVendaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ familia: familia || null }),
      });
      // Atualiza classe no produto (campo pertence ao SKU, não ao vínculo)
      const prodRes = await fetch(`/api/produtos/${produto.codigo}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ classe: classe || null }),
      });
      if (linkRes.ok && prodRes.ok) {
        showToast('Classificação atualizada!', 'success');
        onSaved();
        onClose();
      } else {
        const err = linkRes.ok ? await prodRes.json() : await linkRes.json();
        showToast(err.error || 'Erro ao atualizar', 'error');
      }
    } catch {
      showToast('Erro ao atualizar classificação', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-violet-50 text-violet-600 rounded-lg"><Pencil className="w-5 h-5" /></div>
          <h3 className="font-bold text-slate-900 text-lg">Editar Classificação</h3>
        </div>
        <p className="text-xs text-slate-400 mb-6 pl-1">
          <span className="font-bold text-slate-600">{produto.codigo}</span>
          {' '} · {link.unidade.codigo}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Família</label>
            <input
              type="text"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500"
              value={familia}
              onChange={(e) => setFamilia(e.target.value)}
              placeholder="ex.: Stents Coronários"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Classe</label>
            <select
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500"
              value={classe}
              onChange={(e) => setClasse(e.target.value)}
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
          <button
            type="submit" disabled={saving}
            className="w-full py-3 bg-violet-600 text-white font-bold rounded-xl hover:bg-violet-700 transition-all mt-2 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </form>
      </div>
    </div>
  );
};
