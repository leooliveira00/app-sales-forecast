import React, { useState, useEffect } from 'react';
import { Settings, Save, Info, AlertTriangle } from 'lucide-react';
import { cn } from '../shared/Common';
import { businessDayAt, businessDateTimeParts } from '../../utils/businessDay';

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

interface CycleConfigPanelProps {
  token: string | null;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export const CycleConfigPanel: React.FC<CycleConfigPanelProps> = ({ token, showToast }) => {
  const [cycleOpenDay,  setCycleOpenDay]  = useState<number>(5);
  const [cycleOpenHour, setCycleOpenHour] = useState<number>(8);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    fetch('/api/admin/config', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.ok ? res.json() : {})
      .then((data: Record<string, string>) => {
        if (data.cycleOpenDay)  setCycleOpenDay(parseInt(data.cycleOpenDay, 10));
        if (data.cycleOpenHour) setCycleOpenHour(parseInt(data.cycleOpenHour, 10));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = [
        { key: 'cycleOpenDay',  value: String(cycleOpenDay)  },
        { key: 'cycleOpenHour', value: String(cycleOpenHour) },
      ];
      for (const u of updates) {
        const res = await fetch('/api/admin/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(u),
        });
        if (!res.ok) {
          const err = await res.json();
          showToast(err.error || 'Erro ao salvar', 'error');
          return;
        }
      }
      showToast('Configuração salva com sucesso!', 'success');
    } catch {
      showToast('Erro ao salvar configuração', 'error');
    } finally {
      setSaving(false);
    }
  };

  const previewMonths = () => {
    const today = new Date();
    return Array.from({ length: 3 }, (_, i) => {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i, 1));
      const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      const openDay = Math.min(cycleOpenDay, daysInMonth);
      // Horário de parede no fuso de negócio, como o backend grava em
      // availableFrom — `Date.UTC` aqui adiantaria a abertura em 3 horas.
      const openDate = businessDayAt(d.getUTCFullYear(), d.getUTCMonth(), openDay, cycleOpenHour);
      return {
        label: `${MESES[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`,
        openDate,
        isPast: openDate <= today,
      };
    });
  };

  if (loading) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 bg-violet-50 text-violet-600 rounded-lg">
          <Settings className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold text-slate-900">Configuração de Ciclos de Forecast</h3>
          <p className="text-xs text-slate-400">Define quando cada ciclo mensal fica disponível para os gestores</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div>
          <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">
            Dia de abertura do ciclo <span className="text-slate-300">(1–28)</span>
          </label>
          <input
            type="number" min={1} max={28}
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-400"
            value={cycleOpenDay}
            onChange={(e) => setCycleOpenDay(Math.max(1, Math.min(28, parseInt(e.target.value) || 5)))}
          />
          <p className="text-[11px] text-slate-400 mt-1">
            O ciclo de cada mês ficará disponível a partir deste dia.
          </p>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">
            Hora de abertura <span className="text-slate-300">(0–23)</span>
          </label>
          <input
            type="number" min={0} max={23}
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-400"
            value={cycleOpenHour}
            onChange={(e) => setCycleOpenHour(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))}
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Horário de Brasília em que o ciclo é liberado, no dia configurado.
          </p>
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-5">
        <div className="flex items-center gap-1.5 mb-3">
          <Info className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-[11px] font-bold text-slate-400 uppercase">Preview — próximos ciclos</span>
        </div>
        <div className="space-y-1.5">
          {previewMonths().map(({ label, openDate, isPast }) => (
            <div key={label} className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-600">Ciclo {label}</span>
              <span className={cn("font-mono", isPast ? "text-emerald-600" : "text-slate-400")}>
                disponível em {businessDateTimeParts(openDate).date} às {businessDateTimeParts(openDate).time}
                {isPast && <span className="ml-1.5 text-[10px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded font-bold">aberto</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold text-amber-700 mb-0.5">Atenção — agendamento das DAGs</p>
            <p className="text-xs text-amber-600">
              Ao alterar o dia de abertura, ajuste também o agendamento das DAGs correspondentes nas{' '}
              <strong>variáveis do Airflow</strong> (<code className="bg-amber-100 px-1 rounded">SYNC_PRODUTOS_CRON_SCHEDULE</code>,{' '}
              <code className="bg-amber-100 px-1 rounded">SYNC_VENDAS_CRON_SCHEDULE</code>,{' '}
              <code className="bg-amber-100 px-1 rounded">FORECAST_CRON_SCHEDULE</code>).
              As DAGs devem ser executadas no mesmo dia configurado aqui para que o ciclo abra corretamente.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white font-bold rounded-xl hover:bg-violet-700 transition-all text-sm disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Salvando...' : 'Salvar configuração'}
        </button>
      </div>
    </div>
  );
};
