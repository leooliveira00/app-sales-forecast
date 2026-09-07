import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Activity, Lock, RotateCcw, CheckCircle2, XCircle, Clock,
  Pause, AlertTriangle, ChevronDown, ChevronUp, RefreshCw,
  Calendar, Database, Users, Zap, Circle, Archive, Unlock,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../components/shared/Common';
import { useToast, ToastContainer } from '../components/shared/ToastNotification';
import { format, formatDistanceToNow, isPast } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { businessDay } from '../utils/businessDay';

// ── Types ─────────────────────────────────────────────────────────────────────

type CycleGate =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'PARTIAL'
  | 'READY'
  | 'AWAITING_PREV_CLOSE'
  | 'REPROCESSING'
  | 'BLOCKED'
  | 'FAILED'
  | 'CLOSED';

interface RequiredDag {
  id: string;
  dagId: string;
  label: string;
  enabled: boolean;
  order: number;
  nextScheduledAt: string | null;
}

interface ForecastRunSummary {
  id: string;
  itemCount: number;
  availableFrom: string | null;
  availableUntil: string | null;
  executedAt: string;
}

interface SubmissionsSummary {
  total: number;
  draft: number;
  submitted: number;
  approved: number;
  rejected: number;
}

interface CycleSlot {
  refMonth: string;
  isCurrent: boolean;
  isPast: boolean;
  isFuture: boolean;
  scheduledDagDate: string | null;
  closeDate: string;
  gate: CycleGate;
  stepsCompleted: Record<string, string>;
  blockedAt: string | null;
  blockedReason: string | null;
  blockedBy: { nome: string; email: string } | null;
  retryCount: number;
  logUpdatedAt: string | null;
  dags: RequiredDag[];
  forecastRun: ForecastRunSummary | null;
  submissions: SubmissionsSummary | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const GATE_CONFIG: Record<CycleGate, { label: string; color: string; dot: string; ring: string }> = {
  NOT_STARTED:        { label: 'Aguardando',        color: 'text-slate-400 bg-slate-100 border-slate-200',       dot: 'bg-slate-300',               ring: 'border-slate-200' },
  PENDING:            { label: 'Pendente',           color: 'text-slate-500 bg-slate-100 border-slate-200',       dot: 'bg-slate-400',               ring: 'border-slate-200' },
  PARTIAL:            { label: 'Em andamento',       color: 'text-amber-600 bg-amber-50 border-amber-200',        dot: 'bg-amber-500',               ring: 'border-amber-300' },
  READY:              { label: 'Aberto',             color: 'text-emerald-600 bg-emerald-50 border-emerald-200',  dot: 'bg-emerald-500',             ring: 'border-emerald-300' },
  AWAITING_PREV_CLOSE:{ label: 'Aguard. fechamento', color: 'text-indigo-600 bg-indigo-50 border-indigo-200',    dot: 'bg-indigo-500',              ring: 'border-indigo-300' },
  REPROCESSING:       { label: 'Reprocessando',      color: 'text-violet-600 bg-violet-50 border-violet-200',    dot: 'bg-violet-500 animate-pulse', ring: 'border-violet-200' },
  BLOCKED:            { label: 'Bloqueado',          color: 'text-red-600 bg-red-50 border-red-200',              dot: 'bg-red-500',                 ring: 'border-red-200' },
  FAILED:             { label: 'Falhou',             color: 'text-red-600 bg-red-50 border-red-200',              dot: 'bg-red-500',                 ring: 'border-red-200' },
  CLOSED:             { label: 'Encerrado',          color: 'text-slate-400 bg-slate-50 border-slate-200',        dot: 'bg-slate-300',               ring: 'border-slate-100' },
};

const EXPECTED_DAGS = ['protheus_produtos_sync', 'protheus_vendas_sync', 'protheus_forecast_run'];

/**
 * Interpreta uma data ISO como UTC, retornando um Date local com os mesmos
 * componentes de dia/mês/ano — evita o deslocamento de fuso (ex: UTC-3 tornando
 * "2026-04-01T00:00:00Z" em 31/03 local).
 * Usar apenas para campos que representam datas puras à meia-noite UTC (refMonth,
 * scheduledDagDate, availableFrom). Timestamps de ação (blockedAt, logUpdatedAt)
 * devem continuar usando new Date() para exibir o horário local correto.
 * Para o fechamento do ciclo (closeDate, availableUntil) use `businessDay`: ele é
 * gravado como fim do dia no horário de Brasília, então em UTC cai no dia seguinte.
 */
function utcDay(isoString: string): Date {
  const d = new Date(isoString);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Combina a data do slot (dia/mês correto) com o horário real do Airflow (nextScheduledAt).
 * Resolve o problema de nextScheduledAt apontar para a próxima execução global
 * em vez do mês do slot (ex: maio deve mostrar 10/05 01:00, não 10/03 01:00).
 */
function slotScheduledAt(scheduledDagDate: string | null, nextScheduledAt: string): Date | null {
  if (!scheduledDagDate) return null;
  const dateRef  = new Date(scheduledDagDate);
  const timeRef  = new Date(nextScheduledAt);
  return new Date(Date.UTC(
    dateRef.getUTCFullYear(), dateRef.getUTCMonth(), dateRef.getUTCDate(),
    timeRef.getUTCHours(), timeRef.getUTCMinutes(),
  ));
}

function monthLabel(d: string) {
  return format(utcDay(d), 'MMMM yyyy', { locale: ptBR });
}

function shortDate(d: string) {
  return format(new Date(d), 'dd/MM HH:mm');
}

function isWindowOpen(slot: CycleSlot): boolean {
  if (!slot.forecastRun?.availableFrom) return false;
  const now = new Date();
  const from = new Date(slot.forecastRun.availableFrom);
  const until = slot.forecastRun.availableUntil ? new Date(slot.forecastRun.availableUntil) : null;
  return from <= now && (!until || until >= now);
}

function isWindowClosed(slot: CycleSlot): boolean {
  if (!slot.forecastRun?.availableUntil) return false;
  return isPast(new Date(slot.forecastRun.availableUntil));
}

// ── Gate Badge ────────────────────────────────────────────────────────────────

const GateBadge: React.FC<{ gate: CycleGate; labelOverride?: string }> = ({ gate, labelOverride }) => {
  const cfg = GATE_CONFIG[gate];
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border', cfg.color)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
      {labelOverride ?? cfg.label}
    </span>
  );
};

// ── Summary Stats ─────────────────────────────────────────────────────────────

const SummaryBar: React.FC<{ slots: CycleSlot[] }> = ({ slots }) => {
  const counts = slots.reduce((acc, s) => {
    acc[s.gate] = (acc[s.gate] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const items = [
    { gate: 'READY'        as CycleGate, label: 'Abertos'          },
    { gate: 'REPROCESSING' as CycleGate, label: 'Reprocessando'    },
    { gate: 'PARTIAL'      as CycleGate, label: 'Em andamento'     },
    { gate: 'PENDING'      as CycleGate, label: 'Pendentes'        },
    { gate: 'BLOCKED'      as CycleGate, label: 'Bloqueados'       },
    { gate: 'FAILED'       as CycleGate, label: 'Com falha'        },
    { gate: 'AWAITING_PREV_CLOSE' as CycleGate, label: 'Aguard. fechamento' },
    { gate: 'CLOSED'       as CycleGate, label: 'Encerrados'       },
  ].filter(i => counts[i.gate]);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {items.map(({ gate, label }) => (
        <div key={gate} className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-medium',
          GATE_CONFIG[gate].color
        )}>
          <span className={cn('w-2 h-2 rounded-full', GATE_CONFIG[gate].dot)} />
          <span>{counts[gate]}× {label}</span>
        </div>
      ))}
    </div>
  );
};

// ── Pipeline Panel ────────────────────────────────────────────────────────────

const PipelinePanel: React.FC<{ slot: CycleSlot }> = ({ slot }) => {
  const enabledDags = slot.dags.filter(d => d.enabled);

  if (slot.gate === 'NOT_STARTED') {
    const earliestNext = enabledDags
      .filter(d => d.nextScheduledAt)
      .sort((a, b) => a.nextScheduledAt!.localeCompare(b.nextScheduledAt!))[0]?.nextScheduledAt ?? null;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
          <Zap className="w-3.5 h-3.5" /> Pipeline
        </div>
        <p className="text-xs text-slate-400">
          {slot.scheduledDagDate
            ? (earliestNext
                ? `Agendado para ${format(slotScheduledAt(slot.scheduledDagDate, earliestNext)!, "dd/MM 'às' HH:mm", { locale: ptBR })}`
                : `Agendado para ${format(utcDay(slot.scheduledDagDate), 'dd/MM', { locale: ptBR })}`)
            : earliestNext
              ? `Agendado para ${format(new Date(earliestNext), "dd/MM 'às' HH:mm", { locale: ptBR })}`
              : 'Aguardando agendamento'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        <Zap className="w-3.5 h-3.5" /> Pipeline
      </div>
      {enabledDags.map(dag => {
        const completedAt = slot.stepsCompleted[dag.dagId];
        const isReprocessing = slot.gate === 'REPROCESSING' && !completedAt;
        return (
          <div key={dag.dagId} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {completedAt
                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                : slot.gate === 'FAILED'
                  ? <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  : isReprocessing
                    ? <RotateCcw className="w-3.5 h-3.5 text-violet-400 shrink-0 animate-spin" />
                    : <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0 animate-pulse" />
              }
              <span className="text-xs text-slate-600 truncate">{dag.label}</span>
            </div>
            <span className="text-[11px] text-slate-400 shrink-0">
              {completedAt
                ? format(new Date(completedAt), 'dd/MM HH:mm')
                : dag.nextScheduledAt
                  ? format(slotScheduledAt(slot.scheduledDagDate, dag.nextScheduledAt) ?? new Date(dag.nextScheduledAt), "dd/MM HH:mm")
                  : '—'}
            </span>
          </div>
        );
      })}
      {slot.dags.filter(d => !d.enabled).map(dag => (
        <div key={dag.dagId} className="flex items-center gap-1.5">
          <Pause className="w-3.5 h-3.5 text-slate-300 shrink-0" />
          <span className="text-xs text-slate-300">{dag.label}</span>
          <span className="text-[10px] text-slate-300 font-medium">inativa</span>
        </div>
      ))}
    </div>
  );
};

// ── Forecast Panel ────────────────────────────────────────────────────────────

const ForecastPanel: React.FC<{ slot: CycleSlot }> = ({ slot }) => {
  const run = slot.forecastRun;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        <Database className="w-3.5 h-3.5" /> Forecast
      </div>

      {!run ? (
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Circle className="w-3 h-3" />
          {slot.isFuture ? 'Ainda não gerado' : 'Sem ForecastRun'}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span className="font-medium">{run.itemCount.toLocaleString('pt-BR')}</span>
            <span className="text-slate-400">itens gerados</span>
          </div>
          <div className="text-[11px] text-slate-400">
            Gerado em {shortDate(run.executedAt)}
          </div>
          {run.availableFrom && (
            <div className="mt-1 space-y-0.5">
              <div className={cn(
                'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full',
                isWindowOpen(slot)
                  ? 'bg-emerald-50 text-emerald-600'
                  : isWindowClosed(slot)
                    ? 'bg-slate-100 text-slate-400'
                    : 'bg-sky-50 text-sky-600'
              )}>
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  isWindowOpen(slot) ? 'bg-emerald-500' : isWindowClosed(slot) ? 'bg-slate-300' : 'bg-sky-500'
                )} />
                {isWindowOpen(slot) ? 'Janela aberta' : isWindowClosed(slot) ? 'Janela encerrada' : 'Janela futura'}
              </div>
              <div className="text-[11px] text-slate-400">
                {format(utcDay(run.availableFrom), 'dd/MM', { locale: ptBR })}
                {run.availableUntil && ` → ${format(businessDay(run.availableUntil), 'dd/MM', { locale: ptBR })}`}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ── Submissions Panel ─────────────────────────────────────────────────────────

const SubmissionsPanel: React.FC<{ slot: CycleSlot }> = ({ slot }) => {
  const subs = slot.submissions;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        <Users className="w-3.5 h-3.5" /> Submissões
      </div>

      {!subs ? (
        <div className="text-xs text-slate-400">Nenhuma submissão</div>
      ) : (
        <>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
            {subs.approved  > 0 && <div className="bg-emerald-400 transition-all" style={{ width: `${subs.approved  / subs.total * 100}%` }} />}
            {subs.submitted > 0 && <div className="bg-sky-400 transition-all"     style={{ width: `${subs.submitted / subs.total * 100}%` }} />}
            {subs.rejected  > 0 && <div className="bg-red-300 transition-all"     style={{ width: `${subs.rejected  / subs.total * 100}%` }} />}
            {subs.draft     > 0 && <div className="bg-slate-300 transition-all"   style={{ width: `${subs.draft     / subs.total * 100}%` }} />}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] mt-1">
            {subs.approved  > 0 && <span className="text-emerald-600 font-medium">{subs.approved} aprovadas</span>}
            {subs.submitted > 0 && <span className="text-sky-600 font-medium">{subs.submitted} em análise</span>}
            {subs.rejected  > 0 && <span className="text-red-500 font-medium">{subs.rejected} rejeitadas</span>}
            {subs.draft     > 0 && <span className="text-slate-400">{subs.draft} rascunho</span>}
          </div>
          <div className="text-[11px] text-slate-400">{subs.total} unidade{subs.total !== 1 ? 's' : ''} no total</div>
        </>
      )}
    </div>
  );
};

// ── Modals ────────────────────────────────────────────────────────────────────

const BlockModal: React.FC<{
  refMonth: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}> = ({ refMonth, onConfirm, onClose }) => {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const handle = async () => {
    if (!reason.trim()) return;
    setLoading(true);
    await onConfirm(reason.trim());
    setLoading(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Bloquear Ciclo — {monthLabel(refMonth)}</h3>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
          <p className="text-sm text-amber-800 font-medium">Isso irá:</p>
          <ul className="text-sm text-amber-700 list-disc list-inside space-y-0.5">
            <li>Ocultar o ciclo imediatamente dos gestores</li>
            <li>Reverter submissões enviadas para rascunho</li>
            <li>Notificar todos os gestores</li>
          </ul>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">Motivo (obrigatório)</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
            placeholder="Descreva o problema encontrado…"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-300" />
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-xl">Cancelar</button>
          <button onClick={handle} disabled={!reason.trim() || loading}
            className="px-4 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-xl flex items-center gap-2">
            <Lock className="w-4 h-4" />
            {loading ? 'Bloqueando…' : 'Confirmar bloqueio'}
          </button>
        </div>
      </div>
    </div>
  );
};

const UnblockModal: React.FC<{
  slot: CycleSlot;
  onConfirm: (note: string) => Promise<void>;
  onClose: () => void;
}> = ({ slot, onConfirm, onClose }) => {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const handle = async () => {
    setLoading(true);
    await onConfirm(note.trim());
    setLoading(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Desbloquear Ciclo — {monthLabel(slot.refMonth)}</h3>
        {slot.blockedReason && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-1">Motivo do bloqueio</p>
            <p className="text-sm text-slate-600 italic">"{slot.blockedReason}"</p>
          </div>
        )}
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
          <p className="text-sm text-emerald-700">O ciclo voltará para PENDENTE e aguardará novos callbacks das DAGs.</p>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">Nota de desbloqueio (opcional)</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="Descreva a correção aplicada…"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-300" />
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-xl">Cancelar</button>
          <button onClick={handle} disabled={loading}
            className="px-4 py-2 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 rounded-xl flex items-center gap-2">
            <Unlock className="w-4 h-4" />
            {loading ? 'Desbloqueando…' : 'Confirmar desbloqueio'}
          </button>
        </div>
      </div>
    </div>
  );
};

const RerunModal: React.FC<{
  refMonth: string;
  dags: RequiredDag[];
  onConfirm: (dags: string[], reason: string) => Promise<void>;
  onClose: () => void;
}> = ({ refMonth, dags, onConfirm, onClose }) => {
  const enabledDags = dags.filter(d => d.enabled);
  const [selected, setSelected] = useState<Set<string>>(new Set(enabledDags.map(d => d.dagId)));
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const toggle = (dagId: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(dagId) ? s.delete(dagId) : s.add(dagId); return s; });
  const handle = async () => {
    if (selected.size === 0 || !reason.trim()) return;
    setLoading(true);
    await onConfirm([...selected], reason.trim());
    setLoading(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Reprocessar DAGs — {monthLabel(refMonth)}</h3>
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Selecione as DAGs a re-executar:</p>
          {dags.map(dag => (
            <label key={dag.dagId} className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors',
              dag.enabled
                ? selected.has(dag.dagId) ? 'border-sky-300 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'
                : 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed'
            )}>
              <input type="checkbox" checked={selected.has(dag.dagId)} disabled={!dag.enabled}
                onChange={() => dag.enabled && toggle(dag.dagId)} className="accent-sky-500" />
              <div>
                <p className="text-sm font-medium text-slate-700">{dag.label}</p>
                <p className="text-[11px] text-slate-400">{dag.dagId}</p>
              </div>
              {!dag.enabled && <span className="ml-auto text-[10px] text-slate-400 font-medium">desabilitada</span>}
            </label>
          ))}
        </div>
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 space-y-1">
          <p className="text-sm text-violet-800 font-medium">Isso irá:</p>
          <ul className="text-sm text-violet-700 list-disc list-inside space-y-0.5">
            <li>Bloquear o ciclo para gestores durante o reprocessamento</li>
            <li>Reverter submissões enviadas para rascunho</li>
            <li>Invalidar o ForecastRun atual</li>
            <li>Reabrir automaticamente ao término das DAGs</li>
          </ul>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">Motivo (obrigatório)</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
            placeholder="Descreva a correção aplicada nos dados…"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-xl">Cancelar</button>
          <button onClick={handle} disabled={selected.size === 0 || !reason.trim() || loading}
            className="px-4 py-2 text-sm font-semibold text-white bg-violet-500 hover:bg-violet-600 disabled:opacity-50 rounded-xl flex items-center gap-2">
            <RotateCcw className="w-4 h-4" />
            {loading ? 'Iniciando…' : 'Confirmar reprocessamento'}
          </button>
        </div>
      </div>
    </div>
  );
};

const CloseModal: React.FC<{
  refMonth: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}> = ({ refMonth, onConfirm, onClose }) => {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const handle = async () => {
    if (!reason.trim() || !confirmed) return;
    setLoading(true);
    await onConfirm(reason.trim());
    setLoading(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Encerrar Ciclo — {monthLabel(refMonth)}</h3>
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-sm text-red-700 font-medium">⚠ Esta ação é irreversível.</p>
          <p className="text-sm text-red-600 mt-1">O ciclo será encerrado definitivamente e removido da visão dos gestores.</p>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">Motivo (obrigatório)</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
            placeholder="Ex: prazo encerrado, dados finalizados…"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-300" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="accent-red-500" />
          Confirmo que desejo encerrar este ciclo permanentemente
        </label>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-xl">Cancelar</button>
          <button onClick={handle} disabled={!reason.trim() || !confirmed || loading}
            className="px-4 py-2 text-sm font-semibold text-white bg-slate-700 hover:bg-slate-800 disabled:opacity-50 rounded-xl flex items-center gap-2">
            <Archive className="w-4 h-4" />
            {loading ? 'Encerrando…' : 'Encerrar ciclo'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Cycle Card ────────────────────────────────────────────────────────────────

const CycleCard: React.FC<{
  slot: CycleSlot;
  defaultExpanded: boolean;
  canBlock: boolean;
  canRerun: boolean;
  onBlock:   (refMonth: string) => void;
  onUnblock: (refMonth: string) => void;
  onRerun:   (refMonth: string) => void;
  onClose:   (refMonth: string) => void;
}> = ({ slot, defaultExpanded, canBlock, canRerun, onBlock, onUnblock, onRerun, onClose }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const cfg = GATE_CONFIG[slot.gate];

  const isStuck = ['PENDING', 'PARTIAL', 'REPROCESSING'].includes(slot.gate)
    && slot.logUpdatedAt
    && Date.now() - new Date(slot.logUpdatedAt).getTime() > 24 * 3_600_000;

  const isClosed = slot.gate === 'CLOSED';

  const firstScheduledTime = slot.dags
    .filter(d => d.enabled && d.nextScheduledAt)
    .sort((a, b) => a.nextScheduledAt!.localeCompare(b.nextScheduledAt!))[0]?.nextScheduledAt ?? null;

  return (
    <div className={cn(
      'bg-white rounded-2xl border shadow-sm overflow-hidden transition-all',
      slot.isCurrent  ? 'border-l-4 border-l-sky-400 border-t border-r border-b border-slate-200 shadow-md' : cfg.ring,
      slot.gate === 'BLOCKED'       && 'border-l-4 border-l-red-400 border-t border-r border-b border-red-200',
      slot.gate === 'FAILED'        && 'border-l-4 border-l-red-400 border-t border-r border-b border-red-200',
      slot.gate === 'REPROCESSING'  && 'border-l-4 border-l-violet-400 border-t border-r border-b border-violet-200',
      isClosed && 'opacity-70',
    )}>
      {/* Header */}
      <div className={cn(
        'flex items-center justify-between px-5 py-3.5 cursor-pointer transition-colors',
        slot.isCurrent ? 'bg-sky-50/60 hover:bg-sky-50' : 'hover:bg-slate-50'
      )} onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn('font-semibold capitalize', slot.isCurrent ? 'text-sky-700' : isClosed ? 'text-slate-400' : 'text-slate-700')}>
                {monthLabel(slot.refMonth)}
              </span>
              {slot.isCurrent && (
                <span className="text-[10px] font-bold text-sky-600 bg-sky-100 px-1.5 py-0.5 rounded-full">MÊS ATUAL</span>
              )}
              {slot.isFuture && (
                <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">FUTURO</span>
              )}
              {isStuck && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" aria-label="Sem progresso há mais de 24h" />}
              {slot.retryCount > 0 && (
                <span className="text-[10px] font-bold text-violet-500 bg-violet-50 px-1.5 py-0.5 rounded-full border border-violet-200">
                  reprocessamento #{slot.retryCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                DAG: {slot.scheduledDagDate
                  ? (firstScheduledTime
                      ? `${format(utcDay(slot.scheduledDagDate), 'dd/MM', { locale: ptBR })} · ${format(slotScheduledAt(slot.scheduledDagDate, firstScheduledTime)!, 'HH:mm')}`
                      : format(utcDay(slot.scheduledDagDate), 'dd/MM', { locale: ptBR }))
                  : '—'}
              </span>
              {slot.forecastRun?.availableUntil && (
                <span>Encerra: {format(businessDay(slot.closeDate), 'dd/MM', { locale: ptBR })}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <GateBadge
            gate={slot.gate}
            labelOverride={
              slot.gate === 'READY' && slot.forecastRun?.availableFrom && new Date(slot.forecastRun.availableFrom) > new Date()
                ? 'Libera em ' + format(utcDay(slot.forecastRun.availableFrom), 'dd/MM', { locale: ptBR })
                : undefined
            }
          />
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="border-t border-slate-100">
          {/* 3-column panels */}
          <div className="grid grid-cols-3 divide-x divide-slate-100 px-1">
            <div className="px-4 py-4"><PipelinePanel slot={slot} /></div>
            <div className="px-4 py-4"><ForecastPanel slot={slot} /></div>
            <div className="px-4 py-4"><SubmissionsPanel slot={slot} /></div>
          </div>

          {/* State banners */}
          {slot.gate === 'REPROCESSING' && (
            <div className="mx-4 mb-3 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 space-y-1">
              <p className="text-sm font-semibold text-violet-700 flex items-center gap-2">
                <RotateCcw className="w-4 h-4 animate-spin" />
                Reprocessamento em andamento (tentativa {slot.retryCount})
              </p>
              {slot.blockedReason && <p className="text-sm text-violet-600 italic">"{slot.blockedReason}"</p>}
              <p className="text-xs text-violet-500">O ciclo será reaberto automaticamente ao término das DAGs.</p>
            </div>
          )}

          {slot.gate === 'BLOCKED' && slot.blockedAt && (
            <div className="mx-4 mb-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 space-y-1">
              <p className="text-sm font-semibold text-red-700 flex items-center gap-2">
                <Lock className="w-4 h-4" />
                Bloqueado em {shortDate(slot.blockedAt)}
                {slot.blockedBy && ` por ${slot.blockedBy.email}`}
              </p>
              {slot.blockedReason && <p className="text-sm text-red-600 italic">"{slot.blockedReason}"</p>}
            </div>
          )}

          {slot.gate === 'AWAITING_PREV_CLOSE' && (
            <div className="mx-4 mb-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
              <p className="text-sm text-indigo-700 font-medium">
                Aguardando encerramento do ciclo anterior para liberar este ciclo aos gestores.
              </p>
            </div>
          )}

          {slot.gate === 'READY' && slot.forecastRun?.availableFrom && new Date(slot.forecastRun.availableFrom) > new Date() && (
            <div className="mx-4 mb-3 bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 space-y-0.5">
              <p className="text-sm text-sky-700 font-medium flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Aguardando liberação — abre em {format(utcDay(slot.forecastRun.availableFrom), 'dd/MM', { locale: ptBR })} às {format(new Date(slot.forecastRun.availableFrom), 'HH:mm')}
              </p>
              <p className="text-xs text-sky-500">Pipeline concluído. O ciclo ficará visível aos gestores nesta data.</p>
            </div>
          )}

          {slot.gate === 'CLOSED' && (
            <div className="mx-4 mb-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
              <p className="text-sm text-slate-500 flex items-center gap-2">
                <Archive className="w-4 h-4" />
                Ciclo encerrado definitivamente.
                {slot.blockedReason && <span className="italic"> "{slot.blockedReason}"</span>}
              </p>
            </div>
          )}

          {isStuck && (
            <div className="mx-4 mb-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-sm text-amber-700 font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Sem progresso há {formatDistanceToNow(new Date(slot.logUpdatedAt!), { locale: ptBR })}.
                Verifique as DAGs no Airflow.
              </p>
            </div>
          )}

          {/* Audit trail */}
          {(slot.retryCount > 0 || slot.blockedAt) && (
            <div className="mx-4 mb-3 border border-slate-100 rounded-xl px-4 py-3 space-y-1.5 bg-slate-50/50">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Histórico</p>
              {slot.retryCount > 0 && (
                <p className="text-xs text-slate-500">
                  🔁 {slot.retryCount} reprocessamento{slot.retryCount > 1 ? 's' : ''} realizados
                  {slot.blockedBy && ` · último por ${slot.blockedBy.email}`}
                </p>
              )}
              {slot.blockedAt && (
                <p className="text-xs text-slate-500">
                  🔒 Bloqueado em {shortDate(slot.blockedAt)}
                  {slot.blockedBy && ` por ${slot.blockedBy.email}`}
                  {slot.blockedReason && ` · "${slot.blockedReason}"`}
                </p>
              )}
            </div>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50/50">
            <p className="text-xs text-slate-400">
              {slot.logUpdatedAt
                ? `Atualizado ${formatDistanceToNow(new Date(slot.logUpdatedAt), { locale: ptBR, addSuffix: true })}`
                : 'Sem registro ainda'}
            </p>
            {!isClosed && (
              <div className="flex items-center gap-2">
                {/* Bloquear */}
                {canBlock && ['PARTIAL', 'READY', 'AWAITING_PREV_CLOSE'].includes(slot.gate) && (
                  <button onClick={() => onBlock(slot.refMonth)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded-lg transition-colors">
                    <Lock className="w-3.5 h-3.5" /> Bloquear
                  </button>
                )}
                {/* Desbloquear */}
                {canBlock && slot.gate === 'BLOCKED' && (
                  <button onClick={() => onUnblock(slot.refMonth)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-600 border border-emerald-200 hover:bg-emerald-50 rounded-lg transition-colors">
                    <Unlock className="w-3.5 h-3.5" /> Desbloquear
                  </button>
                )}
                {/* Reprocessar */}
                {canRerun && ['BLOCKED', 'FAILED', 'READY', 'REPROCESSING', 'PARTIAL'].includes(slot.gate) && (
                  <button onClick={() => onRerun(slot.refMonth)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-violet-600 border border-violet-200 hover:bg-violet-50 rounded-lg transition-colors">
                    <RotateCcw className="w-3.5 h-3.5" /> Reprocessar
                  </button>
                )}
                {/* Encerrar */}
                {canRerun && slot.gate === 'READY' && slot.isPast && (
                  <button onClick={() => onClose(slot.refMonth)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors">
                    <Archive className="w-3.5 h-3.5" /> Encerrar
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 60_000;

export const CycleReadinessPage: React.FC = () => {
  const { user, token } = useAuth();
  const perfil   = user?.perfil ?? '';
  const canBlock = perfil === 'operador_pcp' || perfil === 'admin_ti';
  const canRerun = perfil === 'admin_ti';

  const { toasts, showToast, removeToast } = useToast();

  const [slots, setSlots]             = useState<CycleSlot[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [blockTarget, setBlockTarget] = useState<string | null>(null);
  const [unblockTarget, setUnblockTarget] = useState<string | null>(null);
  const [rerunTarget, setRerunTarget] = useState<string | null>(null);
  const [closeTarget, setCloseTarget] = useState<string | null>(null);
  const [expandedYears, setExpandedYears] = useState<Set<number>>(
    () => new Set([new Date().getUTCFullYear()])
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (showLoading = false) => {
    if (!token) return;
    if (showLoading) setIsLoading(true);
    try {
      const res = await fetch('/api/cycle-readiness/overview', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setSlots(await res.json());
        setLastRefresh(new Date());
      }
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load(true);
    timerRef.current = setInterval(() => load(false), REFRESH_INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [load]);

  const apiCall = async (url: string, body: object): Promise<boolean> => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? 'Erro ao executar ação. Tente novamente.', 'error');
        return false;
      }
      await load(false);
      return true;
    } catch {
      showToast('Erro de conexão. Verifique sua rede.', 'error');
      return false;
    }
  };

  const handleBlock   = async (reason: string)                => { if (!blockTarget)   return; const ok = await apiCall(`/api/cycle-readiness/${encodeURIComponent(blockTarget)}/block`,     { reason });       if (ok) setBlockTarget(null); };
  const handleUnblock = async (note: string)                   => { if (!unblockTarget) return; const ok = await apiCall(`/api/cycle-readiness/${encodeURIComponent(unblockTarget)}/unblock`, { note });         if (ok) setUnblockTarget(null); };
  const handleRerun   = async (dags: string[], reason: string) => { if (!rerunTarget)   return; const ok = await apiCall(`/api/cycle-readiness/${encodeURIComponent(rerunTarget)}/rerun`,     { dags, reason }); if (ok) setRerunTarget(null); };
  const handleClose   = async (reason: string)                => { if (!closeTarget)   return; const ok = await apiCall(`/api/cycle-readiness/${encodeURIComponent(closeTarget)}/close`,     { reason });       if (ok) setCloseTarget(null); };

  const rerunSlot   = slots.find(s => s.refMonth === rerunTarget);
  const unblockSlot = slots.find(s => s.refMonth === unblockTarget);

  const missingDags = EXPECTED_DAGS.filter(id => !slots[0]?.dags.some(d => d.dagId === id && d.enabled));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Activity className="w-6 h-6 text-sky-500" />
            Central de Ciclos
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Monitoramento e controle da pipeline de forecast.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {lastRefresh && (
            <span className="text-xs text-slate-400">
              Atualizado {formatDistanceToNow(lastRefresh, { locale: ptBR, addSuffix: true })}
            </span>
          )}
          <button onClick={() => load(true)}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 px-3 py-2 rounded-xl transition-colors">
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
            Atualizar
          </button>
        </div>
      </div>

      {/* DAG health banner */}
      {missingDags.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          DAGs não registradas ou desabilitadas: {missingDags.join(', ')}. Verifique Configurações → DAGs do Ciclo.
        </div>
      )}

      {/* Summary stats */}
      {slots.length > 0 && <SummaryBar slots={slots} />}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 border-l-4 border-sky-400 inline-block" /> Mês atual</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" /> Aberto</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-violet-500 inline-block" /> Reprocessando</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" /> Em andamento</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" /> Aguard. fechamento anterior</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" /> Bloqueado / Com falha</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-300 inline-block" /> Encerrado / Não iniciado</span>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
          Carregando…
        </div>
      ) : slots.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <XCircle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">Nenhum ciclo encontrado.</p>
        </div>
      ) : (() => {
        const slotsByYear = slots.reduce<Record<number, CycleSlot[]>>((acc, slot) => {
          const year = new Date(slot.refMonth).getUTCFullYear();
          (acc[year] ??= []).push(slot);
          return acc;
        }, {});
        const years = Object.keys(slotsByYear).map(Number).sort((a, b) => b - a);

        return (
          <div className="space-y-4">
            {years.map(year => {
              const yearSlots  = slotsByYear[year];
              const isExpanded = expandedYears.has(year);
              const toggleYear = () => setExpandedYears(prev => {
                const next = new Set(prev);
                next.has(year) ? next.delete(year) : next.add(year);
                return next;
              });

              const activeCount = yearSlots.filter(s =>
                !['CLOSED', 'NOT_STARTED'].includes(s.gate)
              ).length;
              const closedCount = yearSlots.filter(s => s.gate === 'CLOSED').length;

              return (
                <div key={year}>
                  <button
                    onClick={toggleYear}
                    className="w-full flex items-center gap-3 mb-3 group"
                  >
                    <span className="text-sm font-bold text-slate-500 group-hover:text-slate-700 transition-colors">
                      {year}
                    </span>
                    <div className="flex items-center gap-2">
                      {activeCount > 0 && (
                        <span className="text-[10px] font-semibold text-sky-600 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded-full">
                          {activeCount} ativo{activeCount > 1 ? 's' : ''}
                        </span>
                      )}
                      {closedCount > 0 && (
                        <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
                          {closedCount} encerrado{closedCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 h-px bg-slate-200 group-hover:bg-slate-300 transition-colors" />
                    {isExpanded
                      ? <ChevronUp className="w-4 h-4 text-slate-400" />
                      : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </button>

                  {isExpanded && (
                    <div className="space-y-3">
                      {yearSlots.map((slot, idx) => (
                        <CycleCard
                          key={slot.refMonth}
                          slot={slot}
                          defaultExpanded={slot.isCurrent || (!slot.gate.match(/^(CLOSED|NOT_STARTED)$/) && idx < 3)}
                          canBlock={canBlock}
                          canRerun={canRerun}
                          onBlock={setBlockTarget}
                          onUnblock={setUnblockTarget}
                          onRerun={setRerunTarget}
                          onClose={setCloseTarget}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Modals */}
      {blockTarget && (
        <BlockModal refMonth={blockTarget} onConfirm={handleBlock} onClose={() => setBlockTarget(null)} />
      )}
      {unblockTarget && unblockSlot && (
        <UnblockModal slot={unblockSlot} onConfirm={handleUnblock} onClose={() => setUnblockTarget(null)} />
      )}
      {rerunTarget && rerunSlot && (
        <RerunModal refMonth={rerunTarget} dags={rerunSlot.dags} onConfirm={handleRerun} onClose={() => setRerunTarget(null)} />
      )}
      {closeTarget && (
        <CloseModal refMonth={closeTarget} onConfirm={handleClose} onClose={() => setCloseTarget(null)} />
      )}

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
};
