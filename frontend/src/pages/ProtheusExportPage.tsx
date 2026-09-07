import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FileDown,
  Lock,
  RefreshCw,
  Send,
  XCircle,
  RotateCcw,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type ExportStatus  = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
type MonthStatus   = 'SUCCESS' | 'FAILED' | 'PENDING';
type SubStatus     = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

interface MonthDetail {
  month:     string; // "YYYYMM"
  status:    MonthStatus;
  itemCount: number;
  attempt:   number;
  error?:    string;
}

interface UnitDetail {
  unidadeVendaId: string;
  totalMeses?:    number;
  deleteStatus:   'SUCCESS' | 'FAILED' | 'PENDING';
  overallStatus:  'SUCCESS' | 'PARTIAL' | 'FAILED' | 'PENDING';
  meses:          MonthDetail[];
  error?:         string;
}

interface LatestExport {
  id:              string;
  status:          ExportStatus;
  startedAt:       string;
  finishedAt:      string | null;
  totalUnidades:   number;
  unidadesOk:      number;
  unidadesFailed:  number;
  csvFallbackPath: string | null;
  details:         UnitDetail[] | null;
}

interface SubmissionInfo {
  unidadeVendaId: string;
  status:         SubStatus;
  unidadeVenda:   { descricao: string } | null;
}

interface ExportStatusResponse {
  refMonth:                     string;
  forecastRunExists:            boolean;
  totalUnidades:                number;
  unidadesApproved:             number;
  unidadesOpen:                 number;
  allApproved:                  boolean;
  submissions:                  SubmissionInfo[];
  isCurrentCycle:               boolean;
  forecastRunUpdatedAfterExport: boolean;
  latestExport:                 LatestExport | null;
}

interface LogEntry {
  id:              string;
  refMonth:        string;
  status:          ExportStatus;
  startedAt:       string;
  finishedAt:      string | null;
  totalUnidades:   number;
  unidadesOk:      number;
  unidadesFailed:  number;
  durationMs:      number | null;
  parentLogId:     string | null;
  csvFallbackPath: string | null;
  triggeredBy:     { nome: string; email: string };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PT_MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function monthLabel(iso: string): string {
  const d = new Date(iso);
  return `${PT_MONTHS[d.getUTCMonth()]} / ${d.getUTCFullYear()}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function monthStrToLabel(m: string): string {
  const year  = m.substring(0, 4);
  const month = parseInt(m.substring(4, 6), 10) - 1;
  return `${PT_MONTHS[month].substring(0, 3)}/${year.substring(2)}`;
}

function statusBadge(s: ExportStatus | 'PENDING' | MonthStatus | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'RUNNING') {
  const base = 'inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full';
  if (s === 'SUCCESS') return <span className={`${base} bg-green-100 text-green-700`}><CheckCircle className="w-3 h-3" />Sucesso</span>;
  if (s === 'FAILED')  return <span className={`${base} bg-red-100 text-red-700`}><XCircle className="w-3 h-3" />Falha</span>;
  if (s === 'PARTIAL') return <span className={`${base} bg-amber-100 text-amber-700`}><AlertCircle className="w-3 h-3" />Parcial</span>;
  if (s === 'RUNNING') return <span className={`${base} bg-sky-100 text-sky-700`}><RefreshCw className="w-3 h-3 animate-spin" />Enviando...</span>;
  return <span className={`${base} bg-slate-100 text-slate-500`}><Clock className="w-3 h-3" />Pendente</span>;
}

function subStatusBadge(s: SubStatus) {
  const base = 'text-[10px] font-semibold px-1.5 py-0.5 rounded';
  if (s === 'APPROVED')  return <span className={`${base} bg-green-100 text-green-700`}>Aprovada</span>;
  if (s === 'SUBMITTED') return <span className={`${base} bg-sky-100 text-sky-700`}>Submetida</span>;
  if (s === 'REJECTED')  return <span className={`${base} bg-red-100 text-red-600`}>Rejeitada</span>;
  return <span className={`${base} bg-slate-100 text-slate-500`}>Rascunho</span>;
}

function getRefMonthOptions(): string[] {
  const options: string[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push(d.toISOString().substring(0, 7));
  }
  return options;
}

// ── Step Indicator ────────────────────────────────────────────────────────────

interface StepProps {
  num: number; label: string; done: boolean; active: boolean; detail?: string;
}
const Step: React.FC<StepProps> = ({ num, label, done, active, detail }) => (
  <div className="flex items-center gap-2 min-w-0">
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border-2
      ${done ? 'bg-green-500 border-green-500 text-white'
      : active ? 'bg-white border-sky-500 text-sky-600'
               : 'bg-white border-slate-200 text-slate-400'}`}>
      {done ? <CheckCircle className="w-4 h-4" /> : num}
    </div>
    <div className="min-w-0">
      <p className={`text-xs font-semibold truncate ${done ? 'text-green-700' : active ? 'text-sky-700' : 'text-slate-400'}`}>{label}</p>
      {detail && <p className="text-[10px] text-slate-400 truncate">{detail}</p>}
    </div>
  </div>
);
const StepConnector: React.FC<{ done: boolean }> = ({ done }) => (
  <div className={`flex-1 h-0.5 mx-1 rounded ${done ? 'bg-green-400' : 'bg-slate-200'}`} />
);

// ── Normalização das mensagens de erro do Protheus ────────────────────────────
// O ERP devolve o texto cru, repetido para cada item do lote, com marcações
// internas (AJUDA:, B1_MSBLQL, \r, "|;"). Exibir isso ao usuário é ilegível e
// passa a impressão de falha geral. Aqui o texto é resumido por motivo, listando
// apenas os códigos de produto envolvidos.

type MotivoFalha = 'bloqueado' | 'naoConfirmado' | 'rejeitado' | 'outro';

interface FalhaNormalizada {
  motivos:  Record<MotivoFalha, string[]>;  // motivo → códigos de produto
  apenasBloqueio: boolean;                  // nada além de cadastro bloqueado
  texto:    string;                         // frase pronta para exibição
}

// Rótulos que a DAG usa para separar os motivos numa mesma mensagem (unidos por " | ").
const SECOES: Array<{ re: RegExp; motivo: MotivoFalha }> = [
  { re: /bloqueados? no cadastro do erp/i,                       motivo: 'bloqueado' },
  { re: /grava[çc][ãa]o n[ãa]o confirmada|confer[êe]ncia final/i, motivo: 'naoConfirmado' },
  { re: /rejeitados? pelo protheus/i,                            motivo: 'rejeitado' },
];

function normalizaErroExport(raw?: string | null): FalhaNormalizada | null {
  if (!raw?.trim()) return null;

  const motivos: Record<MotivoFalha, string[]> = {
    bloqueado: [], naoConfirmado: [], rejeitado: [], outro: [],
  };
  const semProduto: string[] = [];

  const push = (motivo: MotivoFalha, texto: string) => {
    for (const [, produto] of texto.matchAll(/(\d{4,})\s*:/g)) {
      if (!motivos[motivo].includes(produto)) motivos[motivo].push(produto);
    }
  };

  // 1) Quebra pelas seções nomeadas. Uma mensagem pode trazer mais de um motivo,
  //    e cada um precisa ser classificado separadamente — senão um desvio grave
  //    ficaria escondido atrás de um bloqueio de cadastro.
  const marcas = SECOES
    .flatMap(({ re, motivo }) => {
      const idx = raw.search(re);
      return idx >= 0 ? [{ idx, motivo }] : [];
    })
    .sort((a, b) => a.idx - b.idx);

  if (marcas.length > 0) {
    marcas.forEach((marca, i) => {
      const fim = i + 1 < marcas.length ? marcas[i + 1].idx : raw.length;
      push(marca.motivo, raw.slice(marca.idx, fim));
    });
  } else {
    // 2) Sem rótulo (mensagens de envios antigos): classifica trecho a trecho
    const trechos = raw.split(/\|\s*;|;/).map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (const trecho of trechos) {
      const m       = trecho.match(/(\d{4,})\s*:\s*(.*)$/);
      const msg     = (m?.[2] ?? trecho).toLowerCase();

      let motivo: MotivoFalha = 'outro';
      if (/registro bloqueado|b1_msblql/.test(msg))             motivo = 'bloqueado';
      else if (/n[ãa]o confirmada|no erp/.test(msg))             motivo = 'naoConfirmado';
      else if (/rejeitad|tabela sc4/.test(msg))                  motivo = 'rejeitado';

      if (m?.[1]) {
        if (!motivos[motivo].includes(m[1])) motivos[motivo].push(m[1]);
      } else {
        semProduto.push(trecho);
      }
    }
  }

  const partes: string[] = [];
  const lista = (codigos: string[]) => codigos.sort().join(', ');
  const plural = (n: number, sing: string, plur: string) => (n === 1 ? sing : plur);

  if (motivos.bloqueado.length) {
    const n = motivos.bloqueado.length;
    partes.push(
      `${n} ${plural(n, 'produto bloqueado', 'produtos bloqueados')} no cadastro do ERP ` +
      `${plural(n, 'não foi enviado', 'não foram enviados')}: ${lista(motivos.bloqueado)}`
    );
  }
  if (motivos.naoConfirmado.length) {
    const n = motivos.naoConfirmado.length;
    partes.push(
      `${n} ${plural(n, 'produto não teve', 'produtos não tiveram')} a gravação confirmada no ERP: ` +
      lista(motivos.naoConfirmado)
    );
  }
  if (motivos.rejeitado.length) {
    const n = motivos.rejeitado.length;
    partes.push(
      `${n} ${plural(n, 'produto foi recusado', 'produtos foram recusados')} pelo ERP: ` +
      lista(motivos.rejeitado)
    );
  }

  const apenasBloqueio =
    motivos.bloqueado.length > 0 &&
    motivos.naoConfirmado.length === 0 &&
    motivos.rejeitado.length === 0 &&
    motivos.outro.length === 0 &&
    semProduto.length === 0;

  // Sem nenhum padrão reconhecido, mostra o texto original limpo de ruído
  const texto = partes.length
    ? partes.join(' · ')
    : raw.replace(/AJUDA:/gi, '').replace(/\s*\|\s*;?/g, ' ').replace(/\s+/g, ' ').trim();

  return { motivos, apenasBloqueio, texto };
}

/**
 * Tom visual do mês. Bloqueio de cadastro é situação conhecida e não impede o
 * envio do restante — fica em âmbar. Vermelho só quando o mês realmente não foi
 * enviado (envio interrompido, falha de transporte, gravação não confirmada).
 */
function tomDoMes(m: MonthDetail): 'success' | 'partial' | 'failed' | 'pending' {
  if (m.status === 'SUCCESS') return 'success';
  if (m.status !== 'FAILED')  return 'pending';
  return normalizaErroExport(m.error)?.apenasBloqueio ? 'partial' : 'failed';
}

// ── Unit Export Row (detalhe meses) ───────────────────────────────────────────

const UnitExportRow: React.FC<{ unit: UnitDetail; unitName?: string }> = ({ unit, unitName }) => {
  const [expanded, setExpanded] = useState(false);
  const canExpand  = unit.meses.length > 0;
  const totalMeses = unit.totalMeses ?? unit.meses.length;
  // Mês com produto bloqueado teve o restante enviado — conta como enviado,
  // senão a unidade aparenta não ter enviado nada.
  const tons       = unit.meses.map(tomDoMes);
  const okCount    = tons.filter(t => t === 'success' || t === 'partial').length;
  const erroUnidade = normalizaErroExport(unit.error);

  return (
    <div className="border border-slate-100 rounded-lg overflow-hidden">
      <div
        className={`flex items-center justify-between px-4 py-2.5 ${canExpand ? 'cursor-pointer hover:bg-slate-50' : ''}`}
        onClick={() => canExpand && setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {canExpand
            ? expanded ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
            : <div className="w-4" />}
          <div className="min-w-0">
            <span className="text-sm font-semibold text-slate-700 truncate block">
              {unitName ?? unit.unidadeVendaId}
            </span>
            {unitName && <span className="text-[10px] text-slate-400 font-mono">{unit.unidadeVendaId}</span>}
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {totalMeses > 0 && unit.overallStatus !== 'PENDING' && (
            <span className="text-xs text-slate-500">{okCount}/{totalMeses} meses</span>
          )}
          {unit.deleteStatus === 'FAILED' && <span className="text-xs text-red-500">DELETE falhou</span>}
          {statusBadge(unit.overallStatus)}
        </div>
      </div>
      {erroUnidade && (
        <div className={`px-10 pb-2 text-xs ${erroUnidade.apenasBloqueio ? 'text-amber-600' : 'text-red-500'}`}>
          {erroUnidade.texto}
        </div>
      )}
      {expanded && unit.meses.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50 px-10 py-2">
          <div className="flex flex-wrap gap-1.5">
            {unit.meses.map((m, idx) => {
              const tom = tons[idx];
              return (
                <div key={m.month} title={normalizaErroExport(m.error)?.texto ?? undefined}
                  className={`px-2 py-1 rounded text-[11px] font-medium border
                    ${tom === 'success' ? 'bg-green-50 border-green-200 text-green-700'
                    : tom === 'partial' ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : tom === 'failed'  ? 'bg-red-50 border-red-200 text-red-700'
                                        : 'bg-slate-100 border-slate-200 text-slate-500'}`}>
                  {monthStrToLabel(m.month)}
                  {tom === 'success' && <CheckCircle className="inline ml-1 w-2.5 h-2.5" />}
                  {tom === 'partial' && <AlertCircle className="inline ml-1 w-2.5 h-2.5" />}
                  {tom === 'failed'  && <XCircle     className="inline ml-1 w-2.5 h-2.5" />}
                </div>
              );
            })}
          </div>
          {(() => {
            // Uma linha por motivo: os meses repetem a mesma mensagem do lote.
            const primeiroGrave   = unit.meses.find((m, i) => tons[i] === 'failed'  && m.error);
            const primeiroParcial = unit.meses.find((m, i) => tons[i] === 'partial' && m.error);
            return (
              <>
                {primeiroGrave && (
                  <p className="mt-1.5 text-xs text-red-500">
                    {normalizaErroExport(primeiroGrave.error)?.texto}
                  </p>
                )}
                {primeiroParcial && (
                  <p className="mt-1.5 text-xs text-amber-600">
                    {normalizaErroExport(primeiroParcial.error)?.texto}
                  </p>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
};

// ── Unit Selection Row ────────────────────────────────────────────────────────

interface UnitSelectionRowProps {
  sub:        SubmissionInfo;
  detail:     UnitDetail | null;
  checked:    boolean;
  disabled:   boolean;
  onChange:   (id: string, checked: boolean) => void;
}

const UnitSelectionRow: React.FC<UnitSelectionRowProps> = ({ sub, detail, checked, disabled, onChange }) => (
  <label className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-colors
    ${!disabled ? 'cursor-pointer hover:bg-slate-50 border-slate-100'
                : 'cursor-default border-slate-50 opacity-60'}`}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={e => onChange(sub.unidadeVendaId, e.target.checked)}
      className="w-4 h-4 accent-sky-600 shrink-0"
    />
    <div className="flex-1 min-w-0">
      <p className="text-sm font-semibold text-slate-700 truncate">
        {sub.unidadeVenda?.descricao ?? sub.unidadeVendaId}
      </p>
      <p className="text-[10px] text-slate-400 font-mono">{sub.unidadeVendaId}</p>
    </div>
    {subStatusBadge(sub.status)}
    {detail && (
      <span className="shrink-0">
        {statusBadge(detail.overallStatus)}
      </span>
    )}
    {!detail && sub.status === 'APPROVED' && (
      <span className="text-[10px] text-slate-400 shrink-0">Não enviada</span>
    )}
  </label>
);

// ── CSV Download Button ───────────────────────────────────────────────────────

interface CsvDownloadButtonProps {
  refMonth: string;
  unitIds:  string[];
  token:    string;
}

const CsvDownloadButton: React.FC<CsvDownloadButtonProps> = ({ refMonth, unitIds, token }) => {
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  const handleDownload = async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({
        refMonth,
        unidadeVendaIds: unitIds.join(','),
      });
      const res = await fetch(`/api/admin/protheus/export/csv?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error ?? 'Erro ao gerar CSV');
      }
      const blob     = await res.blob();
      const filename = res.headers.get('Content-Disposition')
        ?.match(/filename="(.+)"/)?.[1] ?? `protheus_forecast_${refMonth}.csv`;
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href     = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        disabled={loading}
        onClick={handleDownload}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
      >
        {loading
          ? <RefreshCw className="w-4 h-4 animate-spin" />
          : <FileDown className="w-4 h-4" />}
        Baixar CSV ({unitIds.length} unidade{unitIds.length !== 1 ? 's' : ''})
      </button>
      {err && <p className="text-xs text-red-500 w-full mt-1">{err}</p>}
    </>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

export const ProtheusExportPage: React.FC = () => {
  const { token, user } = useAuth();
  const perfil = user?.perfil ?? '';

  const [refMonthOptions] = useState(getRefMonthOptions);
  const [selectedRefMonth, setSelectedRefMonth] = useState(refMonthOptions[0]);
  const [statusData, setStatusData]     = useState<ExportStatusResponse | null>(null);
  const [logs, setLogs]                 = useState<LogEntry[]>([]);
  const [loading, setLoading]           = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set());
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [logDetailsMap, setLogDetailsMap] = useState<Map<string, UnitDetail[]>>(new Map());

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRunning    = statusData?.latestExport?.status === 'RUNNING';
  const latestExport = statusData?.latestExport;

  // ── Fetch ───────────────────────────────────────────────────────────────────

  const fetchStatus = useCallback(async (month: string, silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/protheus/export/status/${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data: ExportStatusResponse = await res.json();
      setStatusData(data);
      // Auto-seleciona unidades aprovadas na primeira carga do mês
      if (!silent) {
        const approved = new Set(
          data.submissions.filter(s => s.status === 'APPROVED').map(s => s.unidadeVendaId)
        );
        setSelectedUnits(approved);
      }
    } catch (e: unknown) {
      if (!silent) setError((e as Error).message ?? 'Erro ao carregar status');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token]);

  const fetchLogs = useCallback(async (month: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/protheus/export/logs?refMonth=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      setLogs(await res.json());
    } catch {}
  }, [token]);

  // ── Polling ─────────────────────────────────────────────────────────────────

  // Envio em andamento → acompanhamento de perto (3s). Fora dele, uma sondagem
  // leve (20s) mantém a tela em dia sem F5: descobre envio disparado por outra
  // pessoa, mudança de status pela conferência final e log travado encerrado
  // pelo watchdog. Pausa com a aba em segundo plano e refaz a busca ao voltar.
  useEffect(() => {
    const tick = () => {
      fetchStatus(selectedRefMonth, true);
      fetchLogs(selectedRefMonth);
    };

    const start = () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = setInterval(tick, isRunning ? 3_000 : 20_000);
    };

    const stop = () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;
    };

    if (document.visibilityState === 'visible') start();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        tick();     // atualiza na hora ao voltar para a aba
        start();
      } else {
        stop();     // aba em segundo plano não precisa sondar
      }
    };
    window.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);

    return () => {
      stop();
      window.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [isRunning, selectedRefMonth, fetchStatus, fetchLogs]);

  // ── Load on month change ────────────────────────────────────────────────────

  useEffect(() => {
    fetchStatus(selectedRefMonth);
    fetchLogs(selectedRefMonth);
  }, [selectedRefMonth, fetchStatus, fetchLogs]);

  // ── Seed details do latestExport e auto-expande ─────────────────────────────

  useEffect(() => {
    if (!latestExport?.id) return;
    const details = latestExport.details;
    if (details && details.length > 0) {
      setLogDetailsMap(prev => {
        const next = new Map(prev);
        next.set(latestExport.id, details);
        return next;
      });
    }
    setExpandedLogId(latestExport.id);
  }, [latestExport?.id, latestExport?.details?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle expansão de log no histórico ────────────────────────────────────

  const toggleLogDetail = async (logId: string) => {
    if (expandedLogId === logId) { setExpandedLogId(null); return; }
    setExpandedLogId(logId);
    if (logDetailsMap.has(logId)) return;
    try {
      const res = await fetch(`/api/admin/protheus/export/logs/${logId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLogDetailsMap(prev => {
          const next = new Map(prev);
          next.set(logId, (data.details as UnitDetail[]) ?? []);
          return next;
        });
      }
    } catch {}
  };

  // ── Unit selection helpers ──────────────────────────────────────────────────

  const approvedUnits = (statusData?.submissions ?? []).filter(s => s.status === 'APPROVED');

  const toggleUnit = (id: string, checked: boolean) => {
    setSelectedUnits(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  };

  const selectAll  = () => setSelectedUnits(new Set(approvedUnits.map(s => s.unidadeVendaId)));
  const clearAll   = () => setSelectedUnits(new Set());
  const allSelected = approvedUnits.length > 0 && approvedUnits.every(s => selectedUnits.has(s.unidadeVendaId));

  // ── Actions ─────────────────────────────────────────────────────────────────

  const doExport = async (opts: { retryLogId?: string; unitIds?: string[] } = {}) => {
    if (!token) return;
    setActionLoading(true);
    setError(null);
    try {
      const url = opts.retryLogId
        ? `/api/admin/protheus/export/${opts.retryLogId}/retry-failed`
        : '/api/admin/protheus/export';
      const body: Record<string, unknown> = { refMonth: selectedRefMonth };
      if (opts.unitIds?.length) body.unidadeVendaIds = opts.unitIds;

      const res = await fetch(url, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errData.error ?? errData.message ?? 'Erro ao disparar envio');
      }
      await fetchStatus(selectedRefMonth);
      await fetchLogs(selectedRefMonth);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao disparar envio');
    } finally {
      setActionLoading(false);
    }
  };

  // ── Derived state ───────────────────────────────────────────────────────────

  const sd = statusData;

  const step1done = !!sd?.forecastRunExists;
  const step2done = (sd?.unidadesOpen ?? 1) === 0;
  const step3done = !!sd?.allApproved;
  const step4done = latestExport?.status === 'SUCCESS';

  const isCycleLocked = sd ? !sd.isCurrentCycle : false;
  const canSendAdmin  = (perfil === 'admin_ti' || perfil === 'operador_pcp') && step1done && !isRunning && !actionLoading && !isCycleLocked;
  const selectedApproved = [...selectedUnits].filter(u => approvedUnits.some(a => a.unidadeVendaId === u));
  const canSendSelected  = canSendAdmin && selectedApproved.length > 0;
  const canRetry         = canSendAdmin && (latestExport?.status === 'PARTIAL' || latestExport?.status === 'FAILED');

  const progressPct = latestExport && latestExport.totalUnidades > 0
    ? Math.round(((latestExport.unidadesOk + latestExport.unidadesFailed) / latestExport.totalUnidades) * 100)
    : 0;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Envio ao Protheus</h1>
          <p className="text-sm text-slate-500 mt-0.5">Envio de forecast aprovado para geração de demanda de compra</p>
        </div>
        <button
          onClick={() => { fetchStatus(selectedRefMonth); fetchLogs(selectedRefMonth); }}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Cycle selector */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
        <span className="text-sm font-medium text-slate-600 shrink-0">Ciclo:</span>
        <select
          value={selectedRefMonth}
          onChange={e => setSelectedRefMonth(e.target.value)}
          className="text-sm font-semibold text-slate-800 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
        >
          {refMonthOptions.map(m => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-start gap-2">
          <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="w-6 h-6 text-slate-300 animate-spin" />
        </div>
      ) : sd && (
        <>
          {/* Banner: ciclo encerrado — envio bloqueado */}
          {isCycleLocked && (
            <div className="bg-slate-100 border border-slate-300 rounded-xl px-4 py-3 flex items-start gap-3">
              <Lock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-slate-700">Ciclo encerrado — envio bloqueado</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Este ciclo não é o ciclo atual. O envio ao Protheus está desabilitado para evitar
                  sobrescrita acidental de dados. Selecione o ciclo atual para enviar.
                </p>
              </div>
            </div>
          )}

          {/* Alerta: ForecastRun mais recente que o último envio */}
          {sd.forecastRunUpdatedAfterExport && latestExport && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Forecast atualizado após o último envio</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Um novo ciclo de IA foi gerado depois do último envio ao Protheus
                  ({formatDateTime(latestExport.startedAt)}). Os valores enviados podem estar
                  desatualizados — considere reenviar ao Protheus.
                </p>
              </div>
            </div>
          )}

          {/* Pipeline stepper */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-1">
              <Step num={1} label="Forecast Gerado"      done={step1done} active={!step1done} />
              <StepConnector done={step1done} />
              <Step num={2} label="Submissões Completas" done={step2done} active={step1done && !step2done}
                    detail={step2done ? undefined : `${sd.unidadesOpen} em aberto`} />
              <StepConnector done={step2done} />
              <Step num={3} label="Aprovação Completa"   done={step3done} active={step2done && !step3done}
                    detail={step3done ? undefined : `${sd.unidadesApproved}/${sd.totalUnidades} aprovadas`} />
              <StepConnector done={step3done} />
              <Step num={4} label="Enviado ao Protheus"  done={step4done} active={step3done && !step4done}
                    detail={latestExport?.status && !step4done ? latestExport.status : undefined} />
            </div>
          </div>

          {/* Progress bar durante RUNNING */}
          {isRunning && latestExport && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-2">
              <div className="flex justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-500" />
                  Enviando ao Protheus...
                </span>
                <span>{latestExport.unidadesOk + latestExport.unidadesFailed} / {latestExport.totalUnidades} unidades</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div
                  className="bg-sky-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {(perfil === 'admin_ti' || perfil === 'operador_pcp') && (
                <div className="flex justify-end pt-1">
                  <button
                    disabled={actionLoading}
                    onClick={async () => {
                      if (!token || !latestExport) return;
                      setActionLoading(true);
                      setError(null);
                      try {
                        const res = await fetch(`/api/admin/protheus/export/${latestExport.id}/cancel`, {
                          method: 'POST',
                          headers: { Authorization: `Bearer ${token}` },
                        });
                        if (!res.ok) {
                          const d = await res.json().catch(() => ({ error: res.statusText }));
                          throw new Error(d.error ?? 'Erro ao cancelar');
                        }
                        await fetchStatus(selectedRefMonth);
                        await fetchLogs(selectedRefMonth);
                      } catch (e: unknown) {
                        setError((e as Error).message);
                      } finally {
                        setActionLoading(false);
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Cancelar envio
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Último envio — resumo e botões */}
          {latestExport && !isRunning && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {statusBadge(latestExport.status)}
                  <span className="text-sm text-slate-500">
                    {formatDateTime(latestExport.startedAt)}
                    {latestExport.finishedAt && ` · ${formatDuration(
                      new Date(latestExport.finishedAt).getTime() - new Date(latestExport.startedAt).getTime()
                    )}`}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-green-600 font-medium">{latestExport.unidadesOk} ok</span>
                  {latestExport.unidadesFailed > 0 && (
                    <span className="text-red-600 font-medium">{latestExport.unidadesFailed} falharam</span>
                  )}
                </div>
              </div>

              {/* Botões de retry */}
              {(perfil === 'admin_ti' || perfil === 'operador_pcp') && (canRetry || latestExport.csvFallbackPath) && (
                <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
                  {canRetry && (
                    <button
                      disabled={actionLoading}
                      onClick={() => doExport({ retryLogId: latestExport.id })}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-50"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Retentar Falhas
                    </button>
                  )}
                  {latestExport.csvFallbackPath && (
                    <a
                      href={latestExport.csvFallbackPath}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      CSV Fallback
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Seleção de unidades + botão de envio */}
          {(perfil === 'admin_ti' || perfil === 'operador_pcp') && sd.submissions.length > 0 && step1done && !isRunning && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">
                  Unidades do Ciclo
                  {approvedUnits.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {approvedUnits.length} aprovada(s) de {sd.submissions.length}
                    </span>
                  )}
                </h2>
                {approvedUnits.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={allSelected ? clearAll : selectAll}
                      className="text-xs text-sky-600 hover:text-sky-700 underline"
                    >
                      {allSelected ? 'Limpar seleção' : 'Selecionar todas aprovadas'}
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                {sd.submissions.map(sub => {
                  const latestDetails = latestExport ? (logDetailsMap.get(latestExport.id) ?? []) : [];
                  const exportDetail  = latestDetails.find((d: UnitDetail) => d.unidadeVendaId === sub.unidadeVendaId) ?? null;
                  const isApproved   = sub.status === 'APPROVED';
                  return (
                    <UnitSelectionRow
                      key={sub.unidadeVendaId}
                      sub={sub}
                      detail={exportDetail}
                      checked={selectedUnits.has(sub.unidadeVendaId)}
                      disabled={!isApproved || actionLoading}
                      onChange={toggleUnit}
                    />
                  );
                })}
              </div>

              {/* Botões de ação */}
              <div className="pt-2 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    disabled={!canSendSelected}
                    onClick={() => doExport({ unitIds: selectedApproved })}
                    className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors
                      ${canSendSelected
                        ? 'bg-sky-600 hover:bg-sky-700 text-white'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                  >
                    {actionLoading
                      ? <RefreshCw className="w-4 h-4 animate-spin" />
                      : <Send className="w-4 h-4" />}
                    Enviar Selecionadas ({selectedApproved.length})
                  </button>

                  {selectedApproved.length < approvedUnits.length && approvedUnits.length > 0 && (
                    <button
                      disabled={!canSendAdmin}
                      onClick={() => doExport({ unitIds: approvedUnits.map(u => u.unidadeVendaId) })}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors
                        ${canSendAdmin
                          ? 'border-slate-300 text-slate-600 hover:bg-slate-50'
                          : 'border-slate-100 text-slate-300 cursor-not-allowed'}`}
                    >
                      <Send className="w-4 h-4" />
                      Enviar Todas Aprovadas ({approvedUnits.length})
                    </button>
                  )}

                  {selectedApproved.length > 0 && (
                    <>
                      <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block" />
                      <CsvDownloadButton
                        refMonth={selectedRefMonth}
                        unitIds={selectedApproved}
                        token={token ?? ''}
                      />
                    </>
                  )}
                </div>

                {!step1done && (
                  <p className="text-xs text-slate-400 mt-2">Aguardando geração do forecast pela IA</p>
                )}
                {step1done && approvedUnits.length === 0 && (
                  <p className="text-xs text-slate-400 mt-2">Nenhuma unidade aprovada neste ciclo</p>
                )}
              </div>
            </div>
          )}

        </>
      )}

      {/* Histórico de Envios (com detalhe expansível por log) */}
      {logs.length > 0 && (() => {
        const unitNameMap = new Map(
          (statusData?.submissions ?? []).map(s => [s.unidadeVendaId, s.unidadeVenda?.descricao ?? s.unidadeVendaId])
        );
        return (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">Histórico de Envios</h2>
            <div className="space-y-1">
              {logs.map(log => {
                const isExpanded   = expandedLogId === log.id;
                const unitDetails  = logDetailsMap.get(log.id) ?? [];
                const hasDetails   = log.totalUnidades > 0;

                return (
                  <div key={log.id} className="border border-slate-100 rounded-lg overflow-hidden">
                    {/* Linha principal */}
                    <div
                      className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 ${hasDetails ? 'cursor-pointer hover:bg-slate-50' : ''} transition-colors`}
                      onClick={() => hasDetails && toggleLogDetail(log.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {hasDetails
                          ? isExpanded
                            ? <ChevronDown  className="w-4 h-4 text-slate-400 shrink-0" />
                            : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                          : <div className="w-4 shrink-0" />}
                        <span className="text-xs text-slate-500 shrink-0">{formatDateTime(log.startedAt)}</span>
                        {log.finishedAt && (
                          <span className="text-xs text-slate-400 shrink-0">· {formatDuration(log.durationMs)}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 ml-auto shrink-0 flex-wrap">
                        {statusBadge(log.status)}
                        {log.totalUnidades > 0 && (
                          <span className="text-xs text-slate-500">
                            <span className="text-green-600 font-medium">{log.unidadesOk}</span>
                            {' / '}
                            {log.unidadesFailed > 0
                              ? <span className="text-red-600 font-medium">{log.unidadesFailed} falhou</span>
                              : <span className="text-slate-400">0 falhou</span>}
                          </span>
                        )}
                        <span className="text-xs text-slate-400">{log.triggeredBy.nome}</span>
                        {log.csvFallbackPath && (
                          <a href={log.csvFallbackPath} target="_blank" rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-xs text-sky-600 hover:text-sky-700 flex items-center gap-1">
                            <Download className="w-3 h-3" />CSV
                          </a>
                        )}
                        {/* Botões retry/cancel inline */}
                        {!isRunning && log.id === latestExport?.id && canRetry && (
                          <button
                            disabled={actionLoading}
                            onClick={e => { e.stopPropagation(); doExport({ retryLogId: log.id }); }}
                            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-amber-600 border border-amber-200 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <RotateCcw className="w-3 h-3" />Retentar
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Detalhe por unidade */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 space-y-1.5">
                        {!logDetailsMap.has(log.id) ? (
                          <div className="flex justify-center py-3">
                            <RefreshCw className="w-4 h-4 text-slate-300 animate-spin" />
                          </div>
                        ) : unitDetails.length === 0 ? (
                          <p className="text-xs text-slate-400 text-center py-1">Nenhum detalhe disponível</p>
                        ) : (
                          unitDetails.map(unit => (
                            <UnitExportRow
                              key={unit.unidadeVendaId}
                              unit={unit}
                              unitName={unitNameMap.get(unit.unidadeVendaId)}
                            />
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
