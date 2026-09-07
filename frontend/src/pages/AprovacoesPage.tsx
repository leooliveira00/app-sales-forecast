import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/shared/ToastNotification';
import { cn } from '../components/shared/Common';
import { CheckCircle2, Clock, CalendarDays } from 'lucide-react';

import { SubmissionCard, Submission, monthLabel } from '../components/aprovacoes/SubmissionCard';

export const AprovacoesPage: React.FC = () => {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);
  const [isLoading, setIsLoading]           = useState(true);
  const [statusFilter, setStatusFilter]     = useState<string>('SUBMITTED');
  const [cycleFilter, setCycleFilter]       = useState<string>('');

  const fetchSubmissions = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/submissions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setAllSubmissions(await res.json());
    } catch {
      showToast('Erro ao carregar aprovações', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchSubmissions(); }, [fetchSubmissions]);

  // Ciclos únicos presentes nas submissões (ordenados desc)
  const availableCycles = useMemo(() => {
    const seen = new Set<string>();
    for (const s of allSubmissions) {
      seen.add(s.refMonth.substring(0, 7));
    }
    return [...seen].sort().reverse();
  }, [allSubmissions]);

  // Pré-seleciona o ciclo atual (ou o mais recente) ao carregar
  useEffect(() => {
    if (availableCycles.length === 0 || cycleFilter) return;
    const now = new Date();
    const currentYM = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2,'0')}`;
    const match = availableCycles.find(c => c === currentYM);
    setCycleFilter(match ?? availableCycles[0] ?? '');
  }, [availableCycles]);

  // Aplicação dos dois filtros (status + ciclo)
  const submissions = useMemo(() => {
    return allSubmissions.filter(s => {
      const statusOk = !statusFilter || s.status === statusFilter;
      const cycleOk  = !cycleFilter  || s.refMonth.startsWith(cycleFilter);
      return statusOk && cycleOk;
    });
  }, [allSubmissions, statusFilter, cycleFilter]);

  const pendingCount = allSubmissions.filter(s => s.status === 'SUBMITTED').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Aprovações</h2>
          <p className="text-sm text-slate-500">
            Forecasts submetidos pelos gestores aguardando revisão do PCP.
          </p>
        </div>
        {pendingCount > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl">
            <Clock className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-bold text-amber-700">
              {pendingCount} pendente{pendingCount > 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Filtros: Ciclo + Status */}
      <div data-tour="aprovacoes-filter" className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        {/* Seletor de ciclo */}
        {availableCycles.length > 0 && (
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={cycleFilter}
              onChange={(e) => setCycleFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <option value="">Todos os ciclos</option>
              {availableCycles.map((c) => (
                <option key={c} value={c}>{monthLabel(`${c}-01`)}</option>
              ))}
            </select>
          </div>
        )}

        {availableCycles.length > 0 && (
          <div className="hidden sm:block w-px h-5 bg-slate-200" />
        )}

        {/* Filtros de status */}
        <div className="flex gap-2 flex-wrap">
          {(['SUBMITTED', 'APPROVED', 'REJECTED', ''] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-xs font-bold border transition-colors",
                statusFilter === s
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              )}
            >
              {s === ''         ? 'Todos' :
               s === 'SUBMITTED' ? 'Pendentes' :
               s === 'APPROVED'  ? 'Aprovados' : 'Rejeitados'}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      <div data-tour="aprovacoes-list">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando...</div>
        ) : submissions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <CheckCircle2 className="w-12 h-12 text-slate-200 mb-3" />
            <p className="font-medium">Nenhuma submissão encontrada.</p>
            <p className="text-sm">
              {statusFilter === 'SUBMITTED'
                ? 'Não há forecasts aguardando aprovação no momento.'
                : 'Tente outro filtro.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {submissions.map((sub) => (
              <SubmissionCard
                key={sub.id}
                sub={sub}
                token={token}
                onAction={fetchSubmissions}
                showToast={showToast}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
