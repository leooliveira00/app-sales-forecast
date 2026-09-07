import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  BarChart3, Calendar, Wifi,
  Save, CheckCircle, AlertCircle,
  Database, Plus, Trash2, ToggleLeft, ToggleRight, Info,
} from 'lucide-react';
import { cn } from '../components/shared/Common';

type SystemConfig = Record<string, string>;

interface Section {
  id: string;
  label: string;
  icon: React.ElementType;
  roles: string[];
}

interface RequiredDag {
  id: string;
  dagId: string;
  label: string;
  enabled: boolean;
  order: number;
}

const SECTIONS: Section[] = [
  { id: 'ciclo',       label: 'Ciclo de Forecast', icon: Calendar, roles: ['operador_pcp', 'admin_ti'] },
  { id: 'integracoes', label: 'Integrações',        icon: Wifi,     roles: ['admin_ti'] },
];

function SaveFeedback({ status }: { status: 'idle' | 'saving' | 'ok' | 'error' }) {
  if (status === 'idle')   return null;
  if (status === 'saving') return <span className="text-sm text-slate-500">Salvando…</span>;
  if (status === 'ok')     return <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle className="w-4 h-4" /> Salvo</span>;
  return <span className="flex items-center gap-1 text-sm text-red-600"><AlertCircle className="w-4 h-4" /> Erro ao salvar</span>;
}

export const SistemaConfigPage: React.FC = () => {
  const { user, token } = useAuth();
  const perfil = user?.perfil ?? '';

  const visibleSections = SECTIONS.filter(s => s.roles.includes(perfil));
  const [active, setActive] = useState(visibleSections[0]?.id ?? 'ciclo');

  const [config, setConfig]             = useState<SystemConfig>({});
  const [configStatus, setConfigStatus] = useState<Record<string, 'idle' | 'saving' | 'ok' | 'error'>>({});

  const [dags, setDags]               = useState<RequiredDag[]>([]);
  const [newDagId, setNewDagId]       = useState('');
  const [newDagLabel, setNewDagLabel] = useState('');
  const [dagSaving, setDagSaving]     = useState(false);
  const [dagError, setDagError]       = useState('');

  const [afStatus, setAfStatus] = useState<{ ok?: boolean; version?: string; baseUrl?: string; error?: string; loading: boolean }>({ loading: false });

  useEffect(() => {
    if (!token || !['operador_pcp', 'admin_ti'].includes(perfil)) return;
    fetch('/api/admin/config', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : {})
      .then((d: SystemConfig) => setConfig(d))
      .catch(() => {});
  }, [token, perfil]);

  const loadDags = useCallback(async () => {
    if (!token || !['operador_pcp', 'admin_ti'].includes(perfil)) return;
    const res = await fetch('/api/cycle-required-dags', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setDags(await res.json());
  }, [token, perfil]);

  useEffect(() => { loadDags(); }, [loadDags]);

  async function saveConfig(key: string, value: string) {
    setConfigStatus(p => ({ ...p, [key]: 'saving' }));
    try {
      const r = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key, value }),
      });
      setConfigStatus(p => ({ ...p, [key]: r.ok ? 'ok' : 'error' }));
      setTimeout(() => setConfigStatus(p => ({ ...p, [key]: 'idle' })), 2500);
    } catch {
      setConfigStatus(p => ({ ...p, [key]: 'error' }));
    }
  }

  async function toggleDag(dag: RequiredDag) {
    if (!token) return;
    await fetch(`/api/cycle-required-dags/${dag.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled: !dag.enabled }),
    });
    await loadDags();
  }

  async function removeDag(dag: RequiredDag) {
    if (!token) return;
    await fetch(`/api/cycle-required-dags/${dag.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    await loadDags();
  }

  async function addDag() {
    if (!newDagId.trim() || !newDagLabel.trim()) {
      setDagError('Preencha o ID e a descrição da DAG.');
      return;
    }
    setDagSaving(true);
    setDagError('');
    try {
      const r = await fetch('/api/cycle-required-dags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dagId: newDagId.trim(), label: newDagLabel.trim(), enabled: true, order: dags.length + 1 }),
      });
      if (!r.ok) {
        const d = await r.json();
        setDagError(d.error ?? 'Erro ao adicionar DAG.');
      } else {
        setNewDagId('');
        setNewDagLabel('');
        await loadDags();
      }
    } catch {
      setDagError('Erro ao adicionar DAG.');
    }
    setDagSaving(false);
  }

  async function testAirflow() {
    setAfStatus({ loading: true });
    try {
      const r = await fetch('/api/airflow/status', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json() as { ok: boolean; version?: string; baseUrl?: string; error?: string };
      setAfStatus({ ...d, loading: false });
    } catch (e) {
      setAfStatus({ ok: false, error: (e as Error).message, loading: false });
    }
  }

  const labelCls = 'block text-sm font-medium text-slate-600 mb-1';

  if (!['operador_pcp', 'admin_ti'].includes(perfil)) {
    return <div className="p-8 text-center text-slate-500">Acesso restrito a administradores.</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Configurações do Sistema</h1>

      <div className="flex gap-6">
        <nav className="w-52 shrink-0 space-y-1">
          {visibleSections.map(s => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors',
                active === s.id ? 'bg-sky-500 text-white shadow' : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              <s.icon className="w-4 h-4" />
              {s.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 bg-white rounded-2xl border border-slate-200 p-6 space-y-6">

          {/* ── CICLO DE FORECAST ── */}
          {active === 'ciclo' && (
            <>
              <h2 className="text-lg font-semibold text-slate-700 flex items-center gap-2"><Calendar className="w-5 h-5" /> Ciclo de Forecast</h2>

              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Abertura do Ciclo</p>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 flex items-start gap-2">
                  <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-blue-700">
                    O ciclo só abre após <strong>todas as DAGs obrigatórias</strong> concluírem com sucesso
                    <strong> e</strong> a data mínima configurada ser atingida.
                  </p>
                </div>

                {[
                  { key: 'cycleOpenDay',  label: 'Dia mínimo de abertura (1–28)', type: 'number', min: 1, max: 28, hint: 'O ciclo não será aberto antes deste dia, mesmo com todas as DAGs concluídas.' },
                  { key: 'cycleCloseDay', label: 'Dia de fechamento (1–28)',      type: 'number', min: 1, max: 28, hint: 'O ciclo fecha automaticamente neste dia do mês de referência. Deve ser maior que o dia de abertura.' },
                ].map(field => (
                  <div key={field.key} className="mb-4">
                    <label className={labelCls}>{field.label}</label>
                    <p className="text-xs text-slate-400 mb-1">{field.hint}</p>
                    <div className="flex items-center gap-3">
                      <input
                        className="w-32 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                        type={field.type} min={field.min} max={field.max}
                        value={config[field.key] ?? ''}
                        onChange={e => setConfig(p => ({ ...p, [field.key]: e.target.value }))}
                      />
                      <button onClick={() => saveConfig(field.key, config[field.key] ?? '')}
                        className="flex items-center gap-1 bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        <Save className="w-3.5 h-3.5" /> Salvar
                      </button>
                      <SaveFeedback status={configStatus[field.key] ?? 'idle'} />
                    </div>
                  </div>
                ))}
              </div>

              {perfil === 'admin_ti' && (
                <>
                  <hr className="border-slate-100" />
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">DAGs Obrigatórias</p>
                    <p className="text-sm text-slate-500 mb-4">
                      Define quais DAGs precisam concluir com sucesso antes de o ciclo abrir para os gestores.
                    </p>

                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-amber-700">
                        Ativar uma DAG afeta os próximos ciclos imediatamente. Certifique-se de que ela está funcional no Airflow.
                      </p>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden mb-4">
                      {dags.length === 0 ? (
                        <p className="text-sm text-slate-400 p-4">Nenhuma DAG cadastrada.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-400 uppercase">
                              <th className="text-left px-4 py-2">#</th>
                              <th className="text-left px-4 py-2">ID da DAG</th>
                              <th className="text-left px-4 py-2">Descrição</th>
                              <th className="text-center px-4 py-2">Status</th>
                              <th className="px-4 py-2" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {dags.map((dag, idx) => (
                              <tr key={dag.id} className="hover:bg-slate-50">
                                <td className="px-4 py-3 text-slate-400">{idx + 1}</td>
                                <td className="px-4 py-3 font-mono text-xs text-slate-700">{dag.dagId}</td>
                                <td className="px-4 py-3 text-slate-700">{dag.label}</td>
                                <td className="px-4 py-3 text-center">
                                  {dag.enabled ? (
                                    <span className="text-emerald-600 text-xs font-semibold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">Ativa</span>
                                  ) : (
                                    <span className="text-slate-400 text-xs font-semibold bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">Inativa</span>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center justify-end gap-2">
                                    <button onClick={() => toggleDag(dag)}
                                      className="text-slate-400 hover:text-sky-500 transition-colors"
                                      title={dag.enabled ? 'Desativar' : 'Ativar'}>
                                      {dag.enabled
                                        ? <ToggleRight className="w-5 h-5 text-sky-500" />
                                        : <ToggleLeft  className="w-5 h-5" />
                                      }
                                    </button>
                                    <button onClick={() => removeDag(dag)}
                                      className="text-slate-300 hover:text-red-500 transition-colors"
                                      title="Remover DAG">
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                        <Plus className="w-3.5 h-3.5" /> Nova DAG
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-slate-500 mb-1 block">ID da DAG (exato no Airflow)</label>
                          <input
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-400"
                            placeholder="ex: protheus_produtos_sync"
                            value={newDagId}
                            onChange={e => setNewDagId(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500 mb-1 block">Descrição legível</label>
                          <input
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                            placeholder="ex: Sincronização de Produtos"
                            value={newDagLabel}
                            onChange={e => setNewDagLabel(e.target.value)}
                          />
                        </div>
                      </div>
                      {dagError && <p className="text-xs text-red-500">{dagError}</p>}
                      <button onClick={addDag} disabled={dagSaving}
                        className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                        <Database className="w-4 h-4" />
                        {dagSaving ? 'Adicionando…' : 'Adicionar DAG'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── INTEGRAÇÕES ── */}
          {active === 'integracoes' && (
            <>
              <h2 className="text-lg font-semibold text-slate-700 flex items-center gap-2"><Wifi className="w-5 h-5" /> Integrações</h2>
              <p className="text-sm text-slate-500">Verifica a conectividade com sistemas externos configurados no ambiente.</p>

              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Conexão Airflow</p>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-700">Servidor Airflow</p>
                      {afStatus.baseUrl && (
                        <p className="text-xs text-slate-400 font-mono">{afStatus.baseUrl}</p>
                      )}
                    </div>
                    {afStatus.ok === true && (
                      <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Conectado · v{afStatus.version}
                      </span>
                    )}
                    {afStatus.ok === false && (
                      <span className="flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
                        <span className="w-2 h-2 rounded-full bg-red-500" /> Falha
                      </span>
                    )}
                  </div>
                  {afStatus.error && <p className="text-xs text-red-500 font-mono">{afStatus.error}</p>}
                  <button onClick={testAirflow} disabled={afStatus.loading}
                    className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                    <BarChart3 className="w-4 h-4" />
                    {afStatus.loading ? 'Testando…' : 'Testar conexão'}
                  </button>
                </div>

                <div className="mt-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                  Para alterar URL ou credenciais do Airflow, edite as variáveis de ambiente{' '}
                  <span className="font-mono">AIRFLOW_BASE_URL</span>, <span className="font-mono">AIRFLOW_USER</span> e{' '}
                  <span className="font-mono">AIRFLOW_PASSWORD</span> no servidor e reinicie o serviço.
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
};
