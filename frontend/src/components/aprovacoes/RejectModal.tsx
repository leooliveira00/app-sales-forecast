import React, { useState } from 'react';
import { XCircle, X } from 'lucide-react';
import { useConsolidadoCache } from '../../context/ConsolidadoCacheContext';

export interface RejectModalProps {
  submissionId: string;
  unidade: string;
  month: string;
  token: string | null;
  onClose: () => void;
  onRejected: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export const RejectModal: React.FC<RejectModalProps> = ({
  submissionId, unidade, month, token, onClose, onRejected, showToast,
}) => {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const { invalidate } = useConsolidadoCache();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        invalidate();
        showToast('Forecast rejeitado.', 'success');
        onRejected();
        onClose();
      } else {
        const err = await res.json();
        showToast(err.error || 'Erro ao rejeitar', 'error');
      }
    } catch {
      showToast('Erro ao rejeitar', 'error');
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
          <div className="p-2 bg-red-50 text-red-600 rounded-lg"><XCircle className="w-5 h-5" /></div>
          <h3 className="font-bold text-slate-900 text-lg">Rejeitar Forecast</h3>
        </div>
        <p className="text-xs text-slate-400 mb-6">
          {unidade} — {month}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">
              Motivo da rejeição <span className="text-red-400">*</span>
            </label>
            <textarea
              required
              rows={4}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-400 resize-none"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva o motivo para o gestor revisar o forecast..."
            />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-all text-sm"
            >
              Cancelar
            </button>
            <button type="submit" disabled={saving || !reason.trim()}
              className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all disabled:opacity-50 text-sm"
            >
              {saving ? 'Rejeitando...' : 'Confirmar Rejeição'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
