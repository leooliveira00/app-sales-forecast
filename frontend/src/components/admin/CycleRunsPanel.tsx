import React, { useState, useEffect, useCallback } from 'react';
import { CalendarClock, Unlock, Globe, Calendar } from 'lucide-react';
import { cn } from '../shared/Common';
import { businessDateTimeParts } from '../../utils/businessDay';

const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

interface ForecastRunAdmin {
  id: string;
  refMonth: string;
  status: string;
  availableFrom: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  leadTimeMonths: number;
  _count: { items: number };
}

interface CycleRunsPanelProps {
  token: string | null;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

function fmtMonth(iso: string): string {
  const d = new Date(iso);
  return `${MESES_PT[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
}

/**
 * Data/hora no fuso de negócio (não no do navegador): é o horário em que o
 * ciclo efetivamente abre para os gestores — 08h de Brasília por padrão.
 */
function fmtDatetime(iso: string | null): string {
  if (!iso) return '—';
  const { date, time } = businessDateTimeParts(iso);
  return `${date} ${time}`;
}

export const CycleRunsPanel: React.FC<CycleRunsPanelProps> = ({ token, showToast }) => {
  const [runs, setRuns]           = useState<ForecastRunAdmin[]>([]);
  const [loading, setLoading]     = useState(true);
  const [updating, setUpdating]   = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dateInput, setDateInput] = useState('');

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/forecast/runs/all', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setRuns(await res.json());
    } catch {
      showToast('Erro ao carregar ciclos', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, showToast]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  const updateAvailability = async (runId: string, availableFrom: string | null) => {
    setUpdating(runId);
    try {
      const res = await fetch(`/api/forecast/runs/${runId}/availability`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ availableFrom }),
      });
      if (res.ok) {
        showToast('Ciclo atualizado com sucesso!', 'success');
        await fetchRuns();
      } else {
        const err = await res.json();
        showToast(err.error || 'Erro ao atualizar ciclo', 'error');
      }
    } catch {
      showToast('Erro ao atualizar ciclo', 'error');
    } finally {
      setUpdating(null);
      setEditingId(null);
    }
  };

  const handleReleaseNow = (runId: string) => {
    updateAvailability(runId, new Date().toISOString());
  };

  const handleUseGlobalRule = (runId: string) => {
    updateAvailability(runId, null);
  };

  const handleSetDate = (runId: string) => {
    if (!dateInput) return;
    updateAvailability(runId, new Date(dateInput).toISOString());
  };

  const isOpen = (run: ForecastRunAdmin): boolean => {
    if (!run.availableFrom) return false;
    return new Date(run.availableFrom) <= new Date();
  };

  if (loading) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
          <CalendarClock className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold text-slate-900">Gestão de Ciclos de Forecast</h3>
          <p className="text-xs text-slate-400">
            Controle a data de abertura de cada ciclo. Runs sem data explícita usam a regra global.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="pb-2 text-left text-[10px] font-bold text-slate-400 uppercase">Ciclo</th>
              <th className="pb-2 text-left text-[10px] font-bold text-slate-400 uppercase">Janela</th>
              <th className="pb-2 text-left text-[10px] font-bold text-slate-400 uppercase">Abertura (override)</th>
              <th className="pb-2 text-center text-[10px] font-bold text-slate-400 uppercase">Status</th>
              <th className="pb-2 text-right text-[10px] font-bold text-slate-400 uppercase">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {runs.map((run) => {
              const open = isOpen(run);
              const isUpdating = updating === run.id;
              const isEditing = editingId === run.id;
              const windowLabel = run.windowStart && run.windowEnd
                ? `${fmtMonth(run.windowStart)} → ${fmtMonth(run.windowEnd)}`
                : '—';

              return (
                <tr key={run.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 font-bold text-slate-700">{fmtMonth(run.refMonth)}</td>
                  <td className="py-3 text-xs text-slate-500 font-mono">{windowLabel}</td>
                  <td className="py-3 text-xs">
                    {run.availableFrom ? (
                      <span className="font-mono text-slate-600">{fmtDatetime(run.availableFrom)}</span>
                    ) : (
                      <span className="flex items-center gap-1 text-slate-400 italic">
                        <Globe className="w-3 h-3" /> Regra global
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-center">
                    <span className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold',
                      open
                        ? 'bg-emerald-100 text-emerald-700'
                        : run.availableFrom
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-500'
                    )}>
                      {open ? 'Aberto' : run.availableFrom ? 'Agendado' : 'Regra global'}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-2">
                        <input
                          type="datetime-local"
                          className="px-2 py-1 border border-slate-200 rounded text-xs bg-slate-50 focus:outline-none focus:ring-1 focus:ring-violet-400"
                          value={dateInput}
                          onChange={(e) => setDateInput(e.target.value)}
                        />
                        <button
                          onClick={() => handleSetDate(run.id)}
                          disabled={isUpdating || !dateInput}
                          className="px-2.5 py-1 bg-violet-600 text-white text-[10px] font-bold rounded hover:bg-violet-700 disabled:opacity-50 transition-all"
                        >
                          {isUpdating ? '...' : 'Confirmar'}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-2.5 py-1 text-slate-500 text-[10px] font-bold rounded hover:text-slate-700"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        {!open && (
                          <button
                            onClick={() => handleReleaseNow(run.id)}
                            disabled={isUpdating}
                            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold rounded-lg hover:bg-emerald-100 transition-all disabled:opacity-50"
                          >
                            <Unlock className="w-3 h-3" />
                            {isUpdating ? '...' : 'Liberar Agora'}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEditingId(run.id);
                            const d = run.availableFrom ? new Date(run.availableFrom) : new Date();
                            setDateInput(d.toISOString().slice(0, 16));
                          }}
                          disabled={isUpdating}
                          className="flex items-center gap-1 px-2.5 py-1 bg-violet-50 text-violet-700 border border-violet-200 text-[10px] font-bold rounded-lg hover:bg-violet-100 transition-all disabled:opacity-50"
                        >
                          <Calendar className="w-3 h-3" />
                          Definir Data
                        </button>
                        {run.availableFrom && (
                          <button
                            onClick={() => handleUseGlobalRule(run.id)}
                            disabled={isUpdating}
                            className="flex items-center gap-1 px-2.5 py-1 bg-slate-50 text-slate-600 border border-slate-200 text-[10px] font-bold rounded-lg hover:bg-slate-100 transition-all disabled:opacity-50"
                          >
                            <Globe className="w-3 h-3" />
                            Regra Global
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {runs.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-8">Nenhum ciclo encontrado.</p>
        )}
      </div>
    </div>
  );
};
