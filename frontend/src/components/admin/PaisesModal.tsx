import React, { useState } from 'react';
import { Globe, Trash2, Plus, X } from 'lucide-react';
import type { UnidadeVenda, Pais } from '../../types';
import { ConfirmModal } from '../shared/ConfirmModal';

interface PaisesModalProps {
  unidade: UnidadeVenda;
  token: string | null;
  onClose: () => void;
  onUpdated: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export const PaisesModal: React.FC<PaisesModalProps> = ({ unidade, token, onClose, onUpdated, showToast }) => {
  const [paises, setPaises]   = useState<Pais[]>(unidade.paises ?? []);
  const [newIso3, setNewIso3] = useState('');
  const [newNome, setNewNome] = useState('');
  const [saving, setSaving]               = useState(false);
  const [removingIso3, setRemovingIso3]   = useState<string | null>(null);

  const handleAddPais = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIso3 || !newNome) return;
    setSaving(true);
    try {
      const res = await fetch('/api/paises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ iso3: newIso3.toUpperCase(), nome: newNome, unidadeVendaId: unidade.codigo }),
      });
      if (res.ok) {
        const novo: Pais = await res.json();
        setPaises(prev => [...prev, novo]);
        setNewIso3(''); setNewNome('');
        showToast('País adicionado!', 'success');
        onUpdated();
      } else {
        const err = await res.json();
        showToast(err.error || 'Erro ao adicionar país', 'error');
      }
    } catch {
      showToast('Erro ao adicionar país', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePais = (iso3: string) => {
    setRemovingIso3(iso3);
  };

  const confirmRemovePais = async () => {
    if (!removingIso3) return;
    const iso3 = removingIso3;
    setRemovingIso3(null);
    try {
      const res = await fetch(`/api/paises/${iso3}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setPaises(prev => prev.filter(p => p.iso3 !== iso3));
        showToast('País removido!', 'success');
        onUpdated();
      }
    } catch {
      showToast('Erro ao remover país', 'error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      {removingIso3 && (
        <ConfirmModal
          title="Remover País"
          message={`Remover o país ${removingIso3} desta unidade de exportação?`}
          confirmLabel="Remover"
          variant="danger"
          onConfirm={confirmRemovePais}
          onCancel={() => setRemovingIso3(null)}
        />
      )}
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-lg relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-lg">Países — {unidade.codigo}</h3>
            <p className="text-xs text-slate-400">{unidade.descricao}</p>
          </div>
        </div>

        <div className="space-y-2 mb-6">
          {paises.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">Nenhum país cadastrado.</p>
          ) : paises.map(p => (
            <div key={p.iso3} className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-indigo-600 w-10">{p.iso3}</span>
                <span className="text-sm text-slate-700">{p.nome}</span>
              </div>
              <button
                onClick={() => handleRemovePais(p.iso3)}
                className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"
                title="Remover país"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={handleAddPais} className="border-t border-slate-100 pt-4 space-y-3">
          <p className="text-xs font-bold text-slate-400 uppercase">Adicionar País</p>
          <div className="flex gap-2">
            <input
              required type="text" maxLength={3}
              placeholder="ISO3 (ex.: JPN)"
              className="w-24 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-400 uppercase font-mono"
              value={newIso3}
              onChange={(e) => setNewIso3(e.target.value.toUpperCase())}
            />
            <input
              required type="text"
              placeholder="Nome do país"
              className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-400"
              value={newNome}
              onChange={(e) => setNewNome(e.target.value)}
            />
            <button
              type="submit" disabled={saving}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 transition-all disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
