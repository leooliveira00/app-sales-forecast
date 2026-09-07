import React, { useState } from 'react';
import { Building, X } from 'lucide-react';
import { cn } from '../shared/Common';

interface NovaUnidadeModalProps {
  token: string | null;
  onClose: () => void;
  onCreated: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export const NovaUnidadeModal: React.FC<NovaUnidadeModalProps> = ({ token, onClose, onCreated, showToast }) => {
  const [codigo, setCodigo]     = useState('');
  const [descricao, setDescricao] = useState('');
  const [tipo, setTipo]         = useState<'NACIONAL' | 'EXPORT'>('NACIONAL');
  const [saving, setSaving]     = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/unidades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ codigo, descricao, tipo }),
      });
      if (res.ok) {
        showToast('Unidade criada com sucesso!', 'success');
        onCreated();
        onClose();
      } else {
        const err = await res.json();
        showToast(err.error || 'Erro ao criar unidade', 'error');
      }
    } catch {
      showToast('Erro ao criar unidade', 'error');
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
          <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
            <Building className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-900 text-lg">Nova Unidade de Venda</h3>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">
              Código <span className="text-slate-300">(código ERP, ex.: 3201456)</span>
            </label>
            <input
              required type="text"
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500 uppercase"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              placeholder="3201456"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Descrição</label>
            <input
              required type="text"
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Divisão Cardiologia"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Tipo</label>
            <div className="flex gap-3">
              {(['NACIONAL', 'EXPORT'] as const).map(t => (
                <button
                  key={t} type="button"
                  onClick={() => setTipo(t)}
                  className={cn(
                    "flex-1 py-2 text-sm font-bold rounded-lg border transition-all",
                    tipo === t
                      ? t === 'EXPORT'
                        ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-slate-50 text-slate-400 border-slate-200"
                  )}
                >
                  {t === 'EXPORT' ? '🌍 Export' : '🏢 Nacional'}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit" disabled={saving}
            className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all mt-2 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Criar Unidade'}
          </button>
        </form>
      </div>
    </div>
  );
};
