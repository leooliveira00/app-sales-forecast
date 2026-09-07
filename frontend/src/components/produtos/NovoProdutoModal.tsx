import React, { useState } from 'react';
import { Box, X } from 'lucide-react';

interface NovoProdutoModalProps {
  token: string | null;
  onClose: () => void;
  onCreated: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export const NovoProdutoModal: React.FC<NovoProdutoModalProps> = ({ token, onClose, onCreated, showToast }) => {
  const [codigo, setCodigo]     = useState('');
  const [descricao, setDescricao] = useState('');
  const [ncm, setNcm]           = useState('');
  const [saving, setSaving]     = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/produtos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ codigo, descricao, ncm: ncm || undefined }),
      });
      if (res.ok) {
        showToast('Produto criado com sucesso!', 'success');
        onCreated();
        onClose();
      } else {
        const err = await res.json();
        showToast(err.error || 'Erro ao criar produto', 'error');
      }
    } catch {
      showToast('Erro ao criar produto', 'error');
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
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-sky-50 text-sky-600 rounded-lg"><Box className="w-5 h-5" /></div>
          <h3 className="font-bold text-slate-900 text-lg">Novo Produto</h3>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">
              Código <span className="text-slate-300">(ex.: CAR10001)</span>
            </label>
            <input
              required type="text"
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500 font-mono uppercase"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              placeholder="CAR10001"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Descrição</label>
            <input
              required type="text"
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Cateter Balão 5FR"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">
              NCM <span className="text-slate-300">(opcional)</span>
            </label>
            <input
              type="text"
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500 font-mono"
              value={ncm}
              onChange={(e) => setNcm(e.target.value)}
              placeholder="9018.39.99"
            />
          </div>
          <button
            type="submit" disabled={saving}
            className="w-full py-3 bg-sky-600 text-white font-bold rounded-xl hover:bg-sky-700 transition-all mt-2 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Criar Produto'}
          </button>
        </form>
      </div>
    </div>
  );
};
