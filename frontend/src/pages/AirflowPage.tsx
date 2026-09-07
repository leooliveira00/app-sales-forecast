import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  RefreshCw, Play, CheckCircle, XCircle,
  Clock, Pause, AlertCircle, ChevronDown, ChevronRight,
  X, RotateCcw, CircleStop, Eye, EyeOff, Plus, Trash2, Pencil,
  Terminal, List, SkipForward, SlidersHorizontal, Workflow, Search,
} from 'lucide-react';
import { AirflowIcon } from '../components/shared/AirflowIcon';

// ── Types ────────────────────────────────────────────────────────────────────

interface AirflowDag {
  dag_id: string;
  description: string | null;
  is_paused: boolean;
  is_active: boolean;
}

interface DagRun {
  dag_run_id: string;
  state: 'success' | 'failed' | 'running' | 'queued';
  execution_date: string;
  start_date: string | null;
  end_date: string | null;
}

interface ConnectionStatus {
  ok: boolean;
  version?: string;
  baseUrl?: string;
  error?: string;
  loading: boolean;
}

interface TaskInstance {
  task_id:    string;
  state:      'success' | 'failed' | 'running' | 'queued' | 'skipped' | 'upstream_failed' | null;
  start_date: string | null;
  end_date:   string | null;
  duration:   number | null;
  try_number: number;
  operator:   string | null;
}

interface AirflowVariable {
  key:         string;
  value:       string;
  description: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function runStateIcon(state: DagRun['state']) {
  if (state === 'success') return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (state === 'failed')  return <XCircle     className="w-4 h-4 text-red-500" />;
  if (state === 'running') return <RefreshCw   className="w-4 h-4 text-sky-500 animate-spin" />;
  return <Clock className="w-4 h-4 text-amber-400" />;
}

function runStateBadge(state: DagRun['state']) {
  const base = "text-xs font-medium px-2 py-0.5 rounded-full";
  if (state === 'success') return <span className={`${base} bg-green-100 text-green-700`}>success</span>;
  if (state === 'failed')  return <span className={`${base} bg-red-100 text-red-700`}>failed</span>;
  if (state === 'running') return <span className={`${base} bg-sky-100 text-sky-700`}>running</span>;
  return <span className={`${base} bg-amber-100 text-amber-700`}>queued</span>;
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function calcDuration(start: string | null, end: string | null): string {
  if (!start) return '—';
  const endTs = end ? new Date(end).getTime() : Date.now();
  const diff = (endTs - new Date(start).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s`;
  return `${Math.floor(diff / 60)}m ${Math.round(diff % 60)}s`;
}

function taskStateBadge(state: TaskInstance['state']) {
  const base = "text-xs font-medium px-2 py-0.5 rounded-full";
  if (state === 'success')         return <span className={`${base} bg-green-100 text-green-700`}>success</span>;
  if (state === 'failed')          return <span className={`${base} bg-red-100 text-red-700`}>failed</span>;
  if (state === 'running')         return <span className={`${base} bg-sky-100 text-sky-700`}>running</span>;
  if (state === 'queued')          return <span className={`${base} bg-amber-100 text-amber-700`}>queued</span>;
  if (state === 'skipped')         return <span className={`${base} bg-slate-100 text-slate-500`}>skipped</span>;
  if (state === 'upstream_failed') return <span className={`${base} bg-orange-100 text-orange-700`}>upstream failed</span>;
  return <span className={`${base} bg-slate-100 text-slate-400`}>no status</span>;
}

function taskStateIcon(state: TaskInstance['state']) {
  if (state === 'success')         return <CheckCircle className="w-3.5 h-3.5 text-green-500" />;
  if (state === 'failed')          return <XCircle     className="w-3.5 h-3.5 text-red-500" />;
  if (state === 'running')         return <RefreshCw   className="w-3.5 h-3.5 text-sky-500 animate-spin" />;
  if (state === 'queued')          return <Clock       className="w-3.5 h-3.5 text-amber-400" />;
  if (state === 'skipped')         return <SkipForward className="w-3.5 h-3.5 text-slate-400" />;
  if (state === 'upstream_failed') return <AlertCircle className="w-3.5 h-3.5 text-orange-500" />;
  return <Clock className="w-3.5 h-3.5 text-slate-300" />;
}

// ── Modal de log de task ─────────────────────────────────────────────────────

interface LogModalProps {
  dagId:     string;
  runId:     string;
  taskId:    string;
  tryNumber: number;
  token:     string;
  onClose:   () => void;
}

const LogModal: React.FC<LogModalProps> = ({ dagId, runId, taskId, tryNumber, token, onClose }) => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    let cancelled = false;
    async function fetchLog() {
      try {
        const r = await fetch(
          `/api/airflow/dags/${encodeURIComponent(dagId)}/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/logs/${tryNumber}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!r.ok) {
          const d = await r.json().catch(() => null) as { message?: string } | null;
          throw new Error(d?.message ?? `HTTP ${r.status}`);
        }
        const d = await r.json() as { content: string };
        if (!cancelled) setContent(d.content ?? '(log vazio)');
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchLog();
    return () => { cancelled = true; };
  }, [dagId, runId, taskId, tryNumber, token]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-slate-500" />
            <div>
              <h3 className="font-semibold text-slate-800">Log da Task</h3>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                {taskId} · tentativa {tryNumber}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-slate-950 rounded-b-2xl">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-slate-400 gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" /> Carregando log…
            </div>
          ) : error ? (
            <div className="p-6 text-red-400 text-sm font-mono">{error}</div>
          ) : (
            <pre className="p-6 text-xs text-slate-200 font-mono whitespace-pre-wrap leading-relaxed break-all">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Modal de execução ────────────────────────────────────────────────────────

interface TriggerModalProps {
  dag: AirflowDag;
  onClose: () => void;
  onConfirm: (conf: Record<string, unknown>) => Promise<void>;
}

const TriggerModal: React.FC<TriggerModalProps> = ({ dag, onClose, onConfirm }) => {
  const [confText, setConfText] = useState('{}');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleConfirm() {
    let conf: Record<string, unknown> = {};
    try { conf = JSON.parse(confText); }
    catch { setError('JSON inválido. Verifique a sintaxe.'); return; }
    setLoading(true);
    try { await onConfirm(conf); onClose(); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-slate-800">Executar DAG</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{dag.dag_id}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Configuração (JSON)
              <span className="text-slate-400 font-normal ml-2 text-xs">opcional</span>
            </label>
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 h-28 resize-none"
              value={confText}
              onChange={e => { setConfText(e.target.value); setError(''); }}
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-slate-100">
          <button onClick={onClose} className="text-sm text-slate-600 hover:text-slate-800 px-4 py-2 rounded-lg hover:bg-slate-50">
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            <Play className="w-4 h-4" />
            {loading ? 'Disparando…' : 'Confirmar execução'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── DAG Row ──────────────────────────────────────────────────────────────────

interface DagRowProps {
  dag: AirflowDag;
  token: string;
  onTrigger?: (dag: AirflowDag) => void;
  onRefresh: () => void;
}

const DagRow: React.FC<DagRowProps> = ({ dag, token, onTrigger, onRefresh }) => {
  const [expanded, setExpanded]         = useState(false);
  const [runs, setRuns]                 = useState<DagRun[]>([]);
  const [runsLoading, setRunsLoading]   = useState(false);
  const [isPaused, setIsPaused]         = useState(dag.is_paused);
  const [pauseLoading, setPauseLoading] = useState(false);
  const [runAction, setRunAction]       = useState<Record<string, boolean>>({});

  // Tasks expansion
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [tasksByRun, setTasksByRun]       = useState<Record<string, TaskInstance[]>>({});
  const [tasksLoading, setTasksLoading]   = useState<Record<string, boolean>>({});

  // Log modal
  const [logTarget, setLogTarget] = useState<{
    runId: string; taskId: string; tryNumber: number;
  } | null>(null);

  useEffect(() => { setIsPaused(dag.is_paused); }, [dag.is_paused]);

  async function loadRuns() {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (runs.length > 0) return;
    await fetchRuns();
  }

  async function fetchRuns() {
    setRunsLoading(true);
    try {
      const r = await fetch(`/api/airflow/dags/${encodeURIComponent(dag.dag_id)}/runs?limit=5`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json() as { dag_runs: DagRun[] };
      setRuns(d.dag_runs ?? []);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }

  async function togglePause() {
    setPauseLoading(true);
    const newPaused = !isPaused;
    try {
      const r = await fetch(`/api/airflow/dags/${encodeURIComponent(dag.dag_id)}/pause`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ is_paused: newPaused }),
      });
      if (r.ok) { setIsPaused(newPaused); onRefresh(); }
    } catch { /* silent */ }
    finally { setPauseLoading(false); }
  }

  async function cancelRun(runId: string) {
    setRunAction(p => ({ ...p, [runId]: true }));
    try {
      await fetch(`/api/airflow/dags/${encodeURIComponent(dag.dag_id)}/runs/${encodeURIComponent(runId)}/cancel`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchRuns();
    } catch { /* silent */ }
    finally { setRunAction(p => ({ ...p, [runId]: false })); }
  }

  async function clearRun(runId: string) {
    setRunAction(p => ({ ...p, [runId]: true }));
    try {
      await fetch(`/api/airflow/dags/${encodeURIComponent(dag.dag_id)}/runs/${encodeURIComponent(runId)}/clear`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchRuns();
    } catch { /* silent */ }
    finally { setRunAction(p => ({ ...p, [runId]: false })); }
  }

  async function loadTasks(runId: string) {
    if (selectedRunId === runId) { setSelectedRunId(null); return; }
    setSelectedRunId(runId);
    if (tasksByRun[runId] !== undefined) return; // já carregado
    setTasksLoading(p => ({ ...p, [runId]: true }));
    try {
      const r = await fetch(
        `/api/airflow/dags/${encodeURIComponent(dag.dag_id)}/runs/${encodeURIComponent(runId)}/tasks`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const d = await r.json() as { task_instances: TaskInstance[] };
      setTasksByRun(p => ({ ...p, [runId]: d.task_instances ?? [] }));
    } catch {
      setTasksByRun(p => ({ ...p, [runId]: [] }));
    } finally {
      setTasksLoading(p => ({ ...p, [runId]: false }));
    }
  }

  return (
    <>
      <tr className="hover:bg-slate-50/70 transition-colors">
        {/* Expand toggle */}
        <td className="px-4 py-3.5 w-8">
          <button onClick={loadRuns} className="text-slate-400 hover:text-slate-600 transition-colors">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </td>

        {/* DAG ID + Descrição */}
        <td className="px-4 py-3.5" colSpan={2}>
          <p className="font-mono text-sm text-slate-800 font-medium">{dag.dag_id}</p>
          {dag.description && (
            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{dag.description}</p>
          )}
        </td>

        {/* Toggle ativo/pausado */}
        <td className="px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <button
              onClick={togglePause}
              disabled={pauseLoading}
              title={isPaused ? 'DAG pausada — clique para ativar' : 'DAG ativa — clique para pausar'}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-40 ${
                isPaused ? 'bg-slate-300' : 'bg-green-500'
              }`}
            >
              {pauseLoading ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  <RefreshCw className="w-2.5 h-2.5 text-white animate-spin" />
                </span>
              ) : (
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
                    isPaused ? 'translate-x-0' : 'translate-x-4'
                  }`}
                />
              )}
            </button>
            <span className={`text-xs font-medium ${isPaused ? 'text-slate-400' : 'text-green-600'}`}>
              {isPaused ? 'Pausada' : 'Ativa'}
            </span>
          </div>
        </td>

        {/* Ações */}
        <td className="px-4 py-3.5 text-right">
          {onTrigger && (
            <button
              onClick={() => onTrigger(dag)}
              className="flex items-center gap-1.5 ml-auto text-xs font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Play className="w-3.5 h-3.5" /> Executar
            </button>
          )}
        </td>
      </tr>

      {/* Log modal */}
      {logTarget && (
        <LogModal
          dagId={dag.dag_id}
          runId={logTarget.runId}
          taskId={logTarget.taskId}
          tryNumber={logTarget.tryNumber}
          token={token}
          onClose={() => setLogTarget(null)}
        />
      )}

      {/* Runs expandidos */}
      {expanded && (
        <tr>
          <td colSpan={5} className="bg-slate-50 px-8 py-3 border-t border-slate-100">
            {runsLoading ? (
              <p className="text-sm text-slate-400 py-2 flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Carregando execuções…
              </p>
            ) : runs.length === 0 ? (
              <p className="text-sm text-slate-400 py-2">Nenhuma execução registrada.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-left pb-2 font-semibold pr-4">Estado</th>
                    <th className="text-left pb-2 font-semibold pr-4">Run ID</th>
                    <th className="text-left pb-2 font-semibold pr-4">Início</th>
                    <th className="text-left pb-2 font-semibold pr-4">Fim</th>
                    <th className="text-left pb-2 font-semibold pr-4">Duração</th>
                    <th className="text-left pb-2 font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map(run => (
                    <React.Fragment key={run.dag_run_id}>
                      <tr className="border-t border-slate-100">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-1.5">
                            {runStateIcon(run.state)}{runStateBadge(run.state)}
                          </div>
                        </td>
                        <td className="py-2 pr-4 font-mono text-slate-600 max-w-[200px] truncate" title={run.dag_run_id}>
                          {run.dag_run_id}
                        </td>
                        <td className="py-2 pr-4 text-slate-500">{formatDate(run.start_date)}</td>
                        <td className="py-2 pr-4 text-slate-500">{formatDate(run.end_date)}</td>
                        <td className="py-2 pr-4 text-slate-500">{calcDuration(run.start_date, run.end_date)}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              onClick={() => loadTasks(run.dag_run_id)}
                              className={`flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs transition-colors ${
                                selectedRunId === run.dag_run_id
                                  ? 'text-sky-700 bg-sky-100 border-sky-300'
                                  : 'text-slate-600 bg-slate-50 hover:bg-slate-100 border-slate-200'
                              }`}
                            >
                              {tasksLoading[run.dag_run_id]
                                ? <RefreshCw className="w-3 h-3 animate-spin" />
                                : <List className="w-3 h-3" />
                              }
                              Tasks
                            </button>
                            {run.state === 'running' && (
                              <button
                                onClick={() => cancelRun(run.dag_run_id)}
                                disabled={runAction[run.dag_run_id]}
                                className="flex items-center gap-1 text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-2 py-0.5 rounded-md transition-colors disabled:opacity-50"
                              >
                                {runAction[run.dag_run_id]
                                  ? <RefreshCw className="w-3 h-3 animate-spin" />
                                  : <CircleStop className="w-3 h-3" />
                                }
                                Cancelar
                              </button>
                            )}
                            {run.state === 'failed' && (
                              <button
                                onClick={() => clearRun(run.dag_run_id)}
                                disabled={runAction[run.dag_run_id]}
                                className="flex items-center gap-1 text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-md transition-colors disabled:opacity-50"
                              >
                                {runAction[run.dag_run_id]
                                  ? <RefreshCw className="w-3 h-3 animate-spin" />
                                  : <RotateCcw className="w-3 h-3" />
                                }
                                Re-executar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Tasks sub-section */}
                      {selectedRunId === run.dag_run_id && (
                        <tr>
                          <td colSpan={6} className="bg-slate-900/5 px-4 pb-3 pt-1">
                            {tasksLoading[run.dag_run_id] ? (
                              <p className="text-xs text-slate-400 flex items-center gap-1.5 py-2">
                                <RefreshCw className="w-3 h-3 animate-spin" /> Carregando tasks…
                              </p>
                            ) : !tasksByRun[run.dag_run_id] || tasksByRun[run.dag_run_id].length === 0 ? (
                              <p className="text-xs text-slate-400 py-2">Nenhuma task encontrada.</p>
                            ) : (
                              <table className="w-full text-xs mt-1">
                                <thead>
                                  <tr className="text-slate-400 border-b border-slate-200">
                                    <th className="text-left pb-1.5 font-medium pr-4">Task</th>
                                    <th className="text-left pb-1.5 font-medium pr-4">Estado</th>
                                    <th className="text-left pb-1.5 font-medium pr-4">Operador</th>
                                    <th className="text-left pb-1.5 font-medium pr-4">Duração</th>
                                    <th className="text-left pb-1.5 font-medium pr-4">Tentativa</th>
                                    <th className="text-left pb-1.5 font-medium">Log</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {tasksByRun[run.dag_run_id].map(task => (
                                    <tr key={task.task_id} className="border-t border-slate-100">
                                      <td className="py-1.5 pr-4 font-mono text-slate-700">{task.task_id}</td>
                                      <td className="py-1.5 pr-4">
                                        <div className="flex items-center gap-1">
                                          {taskStateIcon(task.state)}{taskStateBadge(task.state)}
                                        </div>
                                      </td>
                                      <td className="py-1.5 pr-4 text-slate-400 font-mono">{task.operator ?? '—'}</td>
                                      <td className="py-1.5 pr-4 text-slate-500">
                                        {task.duration != null ? `${task.duration.toFixed(1)}s` : calcDuration(task.start_date, task.end_date)}
                                      </td>
                                      <td className="py-1.5 pr-4 text-slate-500">#{task.try_number}</td>
                                      <td className="py-1.5">
                                        <button
                                          onClick={() => setLogTarget({ runId: run.dag_run_id, taskId: task.task_id, tryNumber: task.try_number })}
                                          className="flex items-center gap-1 text-sky-600 hover:text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-2 py-0.5 rounded-md transition-colors"
                                        >
                                           Ver log
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
};

// ── Modal de variável (criar / editar) ───────────────────────────────────────

interface VariableModalProps {
  initial?: AirflowVariable;
  onClose:  () => void;
  onSave:   (key: string, value: string, description: string) => Promise<void>;
}

const VariableModal: React.FC<VariableModalProps> = ({ initial, onClose, onSave }) => {
  const isEdit = !!initial;
  const [key,   setKey]   = useState(initial?.key         ?? '');
  const [value, setValue] = useState(initial?.value       ?? '');
  const [desc,  setDesc]  = useState(initial?.description ?? '');
  const [showValue, setShowValue] = useState(false);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    if (!key.trim())        { setError('A chave é obrigatória.'); return; }
    if (value === undefined) { setError('O valor é obrigatório.'); return; }
    setLoading(true);
    try {
      await onSave(key.trim(), value, desc);
      onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-slate-800">{isEdit ? 'Editar variável' : 'Nova variável'}</h3>
            {isEdit && <p className="text-xs text-slate-500 font-mono mt-0.5">{initial!.key}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Chave</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:bg-slate-50 disabled:text-slate-400"
              value={key}
              onChange={e => { setKey(e.target.value); setError(''); }}
              disabled={isEdit}
              placeholder="PROTHEUS_BASE_URL"
              autoFocus={!isEdit}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Valor</label>
            <div className="relative">
              <input
                type={showValue ? 'text' : 'password'}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 pr-10 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                value={value}
                onChange={e => { setValue(e.target.value); setError(''); }}
                placeholder="••••••"
                autoFocus={isEdit}
              />
              <button
                type="button"
                onClick={() => setShowValue(p => !p)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Descrição <span className="text-slate-400 font-normal text-xs">opcional</span>
            </label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Descrição da variável…"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-slate-100">
          <button onClick={onClose} className="text-sm text-slate-600 hover:text-slate-800 px-4 py-2 rounded-lg hover:bg-slate-50">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            {loading ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Linha de variável ────────────────────────────────────────────────────────

interface VariableRowProps {
  variable:  AirflowVariable;
  onEdit:    (v: AirflowVariable) => void;
  onDelete:  (key: string) => Promise<void>;
}

const VariableRow: React.FC<VariableRowProps> = ({ variable, onEdit, onDelete }) => {
  const [showValue,   setShowValue]   = useState(false);
  const [confirming,  setConfirming]  = useState(false);
  const [deleting,    setDeleting]    = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try { await onDelete(variable.key); }
    finally { setDeleting(false); setConfirming(false); }
  }

  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-4 py-3 font-mono text-sm text-slate-700 max-w-[180px] truncate" title={variable.key}>
        {variable.key}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-slate-600 max-w-[200px] truncate">
            {showValue ? variable.value : '••••••••••••'}
          </span>
          <button
            onClick={() => setShowValue(p => !p)}
            className="text-slate-400 hover:text-slate-600 shrink-0"
            title={showValue ? 'Ocultar valor' : 'Exibir valor'}
          >
            {showValue ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-slate-400 max-w-[200px] truncate" title={variable.description ?? ''}>
        {variable.description || '—'}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          {confirming ? (
            <>
              <span className="text-xs text-red-600 font-medium">Confirmar exclusão?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1 rounded-lg disabled:opacity-50"
              >
                {deleting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                Excluir
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="text-xs text-slate-500 hover:text-slate-700 px-2.5 py-1 rounded-lg hover:bg-slate-100"
              >
                Cancelar
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onEdit(variable)}
                className="flex items-center gap-1 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg transition-colors"
              >
                <Pencil className="w-3 h-3" /> Editar
              </button>
              <button
                onClick={() => setConfirming(true)}
                className="flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1 rounded-lg transition-colors"
              >
                <Trash2 className="w-3 h-3" /> Excluir
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
};

// ── Página principal ─────────────────────────────────────────────────────────

export const AirflowPage: React.FC = () => {
  const { token, user } = useAuth();
  const isReadOnly = user?.perfil === 'operador_pcp'; // PCP: leitura apenas

  const [connection, setConnection]     = useState<ConnectionStatus>({ ok: false, loading: true });
  const [dags, setDags]                 = useState<AirflowDag[]>([]);
  const [dagsLoading, setDagsLoading]   = useState(false);
  const [dagsError, setDagsError]       = useState('');
  const [triggerDag, setTriggerDag]     = useState<AirflowDag | null>(null);
  const [feedback, setFeedback]         = useState<{ msg: string; ok: boolean } | null>(null);
  const [search, setSearch]             = useState('');

  // Seções colapsáveis
  const [varsCollapsed, setVarsCollapsed] = useState(false);
  const [dagsCollapsed, setDagsCollapsed] = useState(false);

  // Variables
  const [variables, setVariables]         = useState<AirflowVariable[]>([]);
  const [varsLoading, setVarsLoading]     = useState(false);
  const [varsError, setVarsError]         = useState('');
  const [editingVar, setEditingVar]       = useState<AirflowVariable | null>(null);
  const [showNewVar, setShowNewVar]       = useState(false);

  const showFeedback = (msg: string, ok = true) => {
    setFeedback({ msg, ok });
    setTimeout(() => setFeedback(null), 4000);
  };

  const checkConnection = useCallback(async () => {
    setConnection(p => ({ ...p, loading: true }));
    try {
      const r = await fetch('/api/airflow/status', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json() as { ok: boolean; version?: string; baseUrl?: string; error?: string };
      setConnection({ ...d, loading: false });
    } catch (e) {
      setConnection({ ok: false, error: (e as Error).message, loading: false });
    }
  }, [token]);

  const fetchDags = useCallback(async () => {
    setDagsLoading(true);
    setDagsError('');
    try {
      const r = await fetch('/api/airflow/dags', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        const body = await r.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${r.status}`);
      }
      const d = await r.json() as { dags: AirflowDag[] };
      setDags(d.dags ?? []);
    } catch (e) {
      setDagsError((e as Error).message);
    } finally {
      setDagsLoading(false);
    }
  }, [token]);

  const fetchVariables = useCallback(async () => {
    setVarsLoading(true);
    setVarsError('');
    try {
      const r = await fetch('/api/airflow/variables', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        const body = await r.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${r.status}`);
      }
      const d = await r.json() as { variables: AirflowVariable[] };
      setVariables(d.variables ?? []);
    } catch (e) {
      setVarsError((e as Error).message);
    } finally {
      setVarsLoading(false);
    }
  }, [token]);

  async function handleSaveVariable(key: string, value: string, description: string) {
    const isEdit = variables.some(v => v.key === key);
    const method  = isEdit ? 'PATCH' : 'POST';
    const url     = isEdit ? `/api/airflow/variables/${encodeURIComponent(key)}` : '/api/airflow/variables';
    const body    = isEdit ? { value, description } : { key, value, description };
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => null) as { message?: string } | null;
      throw new Error(d?.message ?? `HTTP ${r.status}`);
    }
    showFeedback(`Variável "${key}" ${isEdit ? 'atualizada' : 'criada'} com sucesso.`);
    fetchVariables();
  }

  async function handleDeleteVariable(key: string) {
    const r = await fetch(`/api/airflow/variables/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok && r.status !== 204) {
      const d = await r.json().catch(() => null) as { message?: string } | null;
      throw new Error(d?.message ?? `HTTP ${r.status}`);
    }
    showFeedback(`Variável "${key}" removida.`);
    fetchVariables();
  }

  useEffect(() => {
    checkConnection();
    fetchDags();
    fetchVariables();
  }, [checkConnection, fetchDags, fetchVariables]);

  async function handleTrigger(conf: Record<string, unknown>) {
    if (!triggerDag) return;
    const r = await fetch(`/api/airflow/dags/${encodeURIComponent(triggerDag.dag_id)}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conf }),
    });
    if (!r.ok) {
      const d = await r.json() as { message?: string };
      throw new Error(d.message ?? `HTTP ${r.status}`);
    }
    showFeedback(`DAG "${triggerDag.dag_id}" disparada com sucesso.`);
    fetchDags();
  }

  const filtered = dags.filter(d =>
    d.dag_id.toLowerCase().includes(search.toLowerCase()) ||
    (d.description ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const activeDags  = dags.filter(d => !d.is_paused).length;
  const pausedDags  = dags.filter(d => d.is_paused).length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* ── Modo visualização banner (admin PCP) ────────────────────────────── */}
      {isReadOnly && (
        <div className="flex items-start gap-3 bg-sky-50 border border-sky-200 rounded-xl px-4 py-3">
          <Eye className="w-5 h-5 text-sky-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-sky-700">Modo visualização</p>
            <p className="text-sm text-sky-600">Você tem acesso de leitura. Para executar ações, contate a equipe de TI.</p>
          </div>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-100 rounded-xl">
            <AirflowIcon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 leading-tight">Administração Airflow</h1>
            {connection.baseUrl && (
              <p className="text-xs text-slate-400 font-mono mt-0.5">{connection.baseUrl}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {/* Status de conexão */}
          {connection.loading ? (
            <span className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-full">
              <RefreshCw className="w-3 h-3 animate-spin" /> Verificando…
            </span>
          ) : connection.ok ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Conectado · v{connection.version}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-3 py-1.5 rounded-full">
              <AlertCircle className="w-3.5 h-3.5" />
              {connection.error ?? 'Sem conexão'}
            </span>
          )}

          <button
            onClick={() => { checkConnection(); fetchDags(); fetchVariables(); }}
            className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${dagsLoading || varsLoading ? 'animate-spin' : ''}`} />
            Atualizar tudo
          </button>
        </div>
      </div>

      {/* ── Feedback toast ──────────────────────────────────────────────────── */}
      {feedback && (
        <div className={`flex items-center gap-2.5 text-sm rounded-xl px-4 py-3 border shadow-sm ${
          feedback.ok
            ? 'text-green-700 bg-green-50 border-green-200'
            : 'text-red-700 bg-red-50 border-red-200'
        }`}>
          {feedback.ok
            ? <CheckCircle className="w-4 h-4 shrink-0" />
            : <AlertCircle className="w-4 h-4 shrink-0" />}
          {feedback.msg}
        </div>
      )}

      {/* ── Métricas rápidas ────────────────────────────────────────────────── */}
      {!dagsLoading && dags.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3 shadow-sm">
            <div className="p-2 bg-slate-100 rounded-lg">
              <Workflow className="w-4 h-4 text-slate-600" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Total DAGs</p>
              <p className="text-lg font-bold text-slate-800">{dags.length}</p>
            </div>
          </div>
          <div className="bg-white border border-green-200 rounded-xl px-4 py-3 flex items-center gap-3 shadow-sm">
            <div className="p-2 bg-green-50 rounded-lg">
              <CheckCircle className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Ativas</p>
              <p className="text-lg font-bold text-green-700">{activeDags}</p>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3 shadow-sm">
            <div className="p-2 bg-amber-50 rounded-lg">
              <Pause className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Pausadas</p>
              <p className="text-lg font-bold text-amber-600">{pausedDags}</p>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SEÇÃO 1 — VARIÁVEIS (oculta para admin PCP, somente admin_ti)
      ══════════════════════════════════════════════════════════════════════ */}
      {!isReadOnly && <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

        {/* Header da seção */}
        <button
          onClick={() => setVarsCollapsed(p => !p)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-sky-50 rounded-lg">
              <SlidersHorizontal className="w-4 h-4 text-sky-600" />
            </div>
            <div className="text-left">
              <h2 className="text-sm font-semibold text-slate-800">Variáveis</h2>
              <p className="text-xs text-slate-400 mt-0.5">Configurações de chave-valor gerenciadas no Airflow</p>
            </div>
            {variables.length > 0 && (
              <span className="ml-1 text-xs font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                {variables.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!varsCollapsed && (
              <>
                <button
                  onClick={e => { e.stopPropagation(); fetchVariables(); }}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-md transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${varsLoading ? 'animate-spin' : ''}`} />
                  Atualizar
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setEditingVar(null); setShowNewVar(true); }}
                  className="flex items-center gap-1 text-xs text-white bg-sky-500 hover:bg-sky-600 px-2.5 py-1 rounded-md transition-colors font-medium"
                >
                  <Plus className="w-3 h-3" /> Nova
                </button>
              </>
            )}
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${varsCollapsed ? '-rotate-90' : ''}`} />
          </div>
        </button>

        {!varsCollapsed && (
          <>
            {varsError && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-5 py-3 border-y border-red-100">
                <AlertCircle className="w-4 h-4 shrink-0" /> {varsError}
              </div>
            )}
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-100">
                    <th className="px-5 py-2.5 text-left">Chave</th>
                    <th className="px-5 py-2.5 text-left">Valor</th>
                    <th className="px-5 py-2.5 text-left">Descrição</th>
                    <th className="px-5 py-2.5 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {varsLoading ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                        Carregando variáveis…
                      </td>
                    </tr>
                  ) : variables.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">
                        Nenhuma variável configurada.
                      </td>
                    </tr>
                  ) : (
                    variables.map(v => (
                      <VariableRow
                        key={v.key}
                        variable={v}
                        onEdit={variable => { setEditingVar(variable); setShowNewVar(true); }}
                        onDelete={handleDeleteVariable}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 text-xs text-slate-400">
              {variables.length} variável{variables.length !== 1 ? 'is' : ''}
            </div>
          </>
        )}
      </div>}

      {/* ══════════════════════════════════════════════════════════════════════
          SEÇÃO 2 — DAGs
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

        {/* Header da seção */}
        <button
          onClick={() => setDagsCollapsed(p => !p)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-indigo-50 rounded-lg">
              <Workflow className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="text-left">
              <h2 className="text-sm font-semibold text-slate-800">DAGs</h2>
              <p className="text-xs text-slate-400 mt-0.5">Monitoramento e execução de pipelines</p>
            </div>
            {dags.length > 0 && (
              <span className="ml-1 text-xs font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                {dags.length}
              </span>
            )}
          </div>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${dagsCollapsed ? '-rotate-90' : ''}`} />
        </button>

        {!dagsCollapsed && (
          <>
            {/* Barra de pesquisa dentro da seção */}
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="Pesquisar DAGs…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>

            {dagsError && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-5 py-3 border-y border-red-100">
                <AlertCircle className="w-4 h-4 shrink-0" /> {dagsError}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-t border-b border-slate-100">
                  <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    <th className="w-8 px-4 py-2.5" />
                    <th className="px-4 py-2.5 text-left" colSpan={2}>DAG</th>
                    <th className="px-4 py-2.5 text-left">Ativo</th>
                    <th className="px-4 py-2.5 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dagsLoading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                        Carregando DAGs…
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">
                        {dags.length === 0 ? 'Nenhuma DAG encontrada.' : 'Nenhuma DAG corresponde à pesquisa.'}
                      </td>
                    </tr>
                  ) : (
                    filtered.map(dag => (
                      <DagRow
                        key={dag.dag_id}
                        dag={dag}
                        token={token ?? ''}
                        onTrigger={isReadOnly ? undefined : setTriggerDag}
                        onRefresh={fetchDags}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 text-xs text-slate-400">
              {filtered.length} DAG{filtered.length !== 1 ? 's' : ''}
              {dags.length !== filtered.length && ` (de ${dags.length})`}
              {activeDags > 0 && ` · ${activeDags} ativa${activeDags !== 1 ? 's' : ''}`}
              {pausedDags > 0 && ` · ${pausedDags} pausada${pausedDags !== 1 ? 's' : ''}`}
            </div>
          </>
        )}
      </div>

      {/* ── Modais ─────────────────────────────────────────────────────────── */}
      {triggerDag && (
        <TriggerModal
          dag={triggerDag}
          onClose={() => setTriggerDag(null)}
          onConfirm={handleTrigger}
        />
      )}

      {showNewVar && (
        <VariableModal
          initial={editingVar ?? undefined}
          onClose={() => { setShowNewVar(false); setEditingVar(null); }}
          onSave={handleSaveVariable}
        />
      )}
    </div>
  );
};
