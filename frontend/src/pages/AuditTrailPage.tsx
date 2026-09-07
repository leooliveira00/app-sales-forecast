import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X, Download, ChevronDown, ChevronRight,
         ChevronLeft as ChevLeft, ChevronRight as ChevRight } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import type { AuditLogEntry, AuditResponse } from '../types/audit';

// ── Operation badge config ────────────────────────────────────────────────────

interface OpConfig { label: string; cls: string }

function getOpConfig(operation?: string): OpConfig | null {
  if (!operation) return null;
  if (operation === 'MANUAL_EDIT')          return { label: 'Digitação manual',         cls: 'bg-slate-100  text-slate-600  border-slate-200' };
  if (operation === 'DELETE_OVERRIDE')      return { label: 'Exclusão de FCTS',          cls: 'bg-red-100    text-red-700    border-red-200'   };
  if (operation === 'ACCEPT_IA_SUGGESTION') return { label: 'Sugestão IA',               cls: 'bg-purple-100 text-purple-700 border-purple-200' };
  if (operation === 'COPY_PREVIOUS')        return { label: 'Cópia do ciclo anterior',   cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
  if (operation === 'REVERT_CHANGES')       return { label: 'Reversão ao estado inicial', cls: 'bg-amber-100  text-amber-700  border-amber-200' };
  if (operation === 'APPLY_PERCENT')        return { label: 'Ajuste percentual',          cls: 'bg-orange-100 text-orange-700 border-orange-200' };
  if (operation === 'SET_VALUE')            return { label: 'Valor fixo',                cls: 'bg-sky-100    text-sky-700    border-sky-200'   };
  if (operation.startsWith('DISTRIBUTE_'))  return { label: 'Distribuição proporcional', cls: 'bg-blue-100   text-blue-700   border-blue-200'  };
  if (operation.startsWith('FILL_'))        return { label: 'Preenchimento automático',  cls: 'bg-amber-100  text-amber-700  border-amber-200' };
  if (operation === 'SUBMIT_CYCLE')         return { label: 'Submissão',                 cls: 'bg-sky-100    text-sky-700    border-sky-200'   };
  if (operation === 'APPROVE_SUBMISSION')   return { label: 'Aprovação',                 cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
  if (operation === 'CYCLE_APPROVED')       return { label: 'Ciclo aprovado',             cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
  if (operation === 'REJECT_SUBMISSION')    return { label: 'Rejeição',                  cls: 'bg-red-100    text-red-700    border-red-200'   };
  if (operation === 'RESTORE_PRODUCT')      return { label: 'Restauração',               cls: 'bg-teal-100   text-teal-700   border-teal-200'  };
  if (operation === 'ADD_PRODUCT_MANUAL')   return { label: 'Adição manual',             cls: 'bg-indigo-100 text-indigo-700 border-indigo-200' };
  if (operation === 'AIRFLOW_SYNC')         return { label: 'Sync Airflow',              cls: 'bg-slate-100  text-slate-500  border-slate-200' };
  return { label: operation, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
}

// ── Human-readable change summary ─────────────────────────────────────────────

function changeSummary(entry: AuditLogEntry): string {
  if (entry.entity === 'ForecastOverride') {
    const b = (entry.before as Record<string, unknown> | null)?.volumeFCTS as number | null | undefined;
    const a = (entry.after  as Record<string, unknown> | null)?.volumeFCTS as number | null | undefined;
    const fmt = (v: number) => v.toLocaleString('pt-BR');
    if (b != null && a != null) return `${fmt(b)} → ${fmt(a)} un.`;
    if (a != null)              return `Definido: ${fmt(a)} un.`;
    if (b != null)              return `Removido (era ${fmt(b)} un.)`;
  }
  if (entry.entity === 'DivisionSubmission') {
    const b = (entry.before as Record<string, unknown> | null)?.status as string | undefined;
    const a = (entry.after  as Record<string, unknown> | null)?.status as string | undefined;
    if (b && a) return `${b} → ${a}`;
  }
  return '';
}

// ── Diff view: legível em vez de JSON bruto ───────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number')  return v.toLocaleString('pt-BR');
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (typeof v === 'string' && ISO_DATE_RE.test(v))
    return new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (typeof v === 'string')  return v;
  return JSON.stringify(v);
}

const FIELD_LABELS: Record<string, string> = {
  volumeFCTS:      'Volume FCTS',
  status:          'Status',
  note:            'Observação',
  gestorExcluido:  'Excluído',
  excluidoAt:      'Excluído em',
  source:          'Fonte',
  refMonth:        'Ciclo',
  submittedAt:     'Submetido em',
  reviewedAt:      'Revisado em',
  rejectionReason: 'Motivo rejeição',
};

const DiffView: React.FC<{
  before: Record<string, unknown> | null;
  after:  Record<string, unknown> | null;
}> = ({ before, after }) => {
  const SKIP_KEYS = ['id','createdAt','updatedAt','runId','forecastItemId','unidadeVendaId','produtoId','gestorId','revisedAt','revisorId','submittedBy','autorId'];
  const allKeys = [...new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after  ?? {}),
  ])].filter(k => {
    if (SKIP_KEYS.includes(k)) return false;
    const bv = (before ?? {})[k];
    const av = (after  ?? {})[k];
    return !(bv == null && av == null);
  });

  if (allKeys.length === 0) return null;

  return (
    <table className="w-full text-[11px] border-collapse mt-2">
      <thead>
        <tr className="bg-slate-100 text-slate-500">
          <th className="text-left px-2 py-1 font-semibold rounded-tl">Campo</th>
          <th className="text-left px-2 py-1 font-semibold text-red-600">Antes</th>
          <th className="text-left px-2 py-1 font-semibold text-emerald-700 rounded-tr">Depois</th>
        </tr>
      </thead>
      <tbody>
        {allKeys.map((key) => {
          const bVal = (before ?? {})[key];
          const aVal = (after  ?? {})[key];
          const changed = JSON.stringify(bVal) !== JSON.stringify(aVal);
          return (
            <tr key={key} className={changed ? 'bg-amber-50' : ''}>
              <td className="px-2 py-1 text-slate-500 font-medium border-t border-slate-100">
                {FIELD_LABELS[key] ?? key}
              </td>
              <td className="px-2 py-1 text-red-700 border-t border-slate-100 font-mono">
                {renderValue(bVal)}
              </td>
              <td className="px-2 py-1 text-emerald-800 border-t border-slate-100 font-mono">
                {renderValue(aVal)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

// ── Metadata view ─────────────────────────────────────────────────────────────

const META_SKIP = ['correlationId', 'operation', 'affectedCount', 'totalVolume'];
const META_LABELS: Record<string, string> = {
  basis:                'Base de cálculo',
  percentageApplied:    'Percentual aplicado',
  fixedValue:           'Valor fixo',
  totalVolume:          'Total distribuído',
  affectedCount:        'Itens afetados',
  refinementPercentage: 'Refinamento (%)',
  source:               'Fonte',
};

const BASIS_LABELS: Record<string, string> = {
  HISTORICAL_SALES:     'Histórico de vendas',
  PREVIOUS_FCTS:        'FCST do ciclo anterior',
  YEAR_OVER_YEAR:       'Mesmo período ano anterior (A.A.)',
  AI_MODEL:             'Modelo de IA',
  PROPORTIONAL:         'Proporcional (média histórica)',
  PROPORTIONAL_SEASONAL:'Proporcional sazonal (A.A.)',
  BUDGET:               'Orçamento (ORC)',
  IA_OR_ORC:            'IA ou ORC',
  MANUAL:               'Manual',
};

function renderMetaValue(key: string, v: unknown): string {
  if (key === 'basis' && typeof v === 'string') return BASIS_LABELS[v] ?? v;
  if (key === 'percentageApplied' && typeof v === 'number') return `${v > 0 ? '+' : ''}${v}%`;
  if ((key === 'fixedValue' || key === 'totalVolume') && typeof v === 'number')
    return `${v.toLocaleString('pt-BR')} un.`;
  return renderValue(v);
}

const MetaView: React.FC<{ metadata: Record<string, unknown> }> = ({ metadata }) => {
  const entries = Object.entries(metadata).filter(([k]) => !META_SKIP.includes(k) && k !== 'month');
  if (entries.length === 0) return null;
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1">
          <dt className="text-slate-400 shrink-0">{META_LABELS[k] ?? k}:</dt>
          <dd className="text-slate-700 font-medium truncate">{renderMetaValue(k, v)}</dd>
        </div>
      ))}
    </dl>
  );
};

// ── Format month (YYYY-MM → Mmm/YYYY) ────────────────────────────────────────

const MESES_CURTOS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MESES_CURTOS[parseInt(m, 10) - 1]}/${y}`;
}

function monthsLabel(entries: AuditLogEntry[]): string {
  const months = entries
    .map(e => (e.metadata as Record<string, unknown> | null)?.month as string | undefined)
    .filter((m): m is string => !!m)
    .sort();
  if (months.length === 0) return '';
  const unique = [...new Set(months)];
  if (unique.length === 1) return fmtMonth(unique[0]);
  if (unique.length <= 4)  return unique.map(fmtMonth).join(', ');
  return `${fmtMonth(unique[0])} – ${fmtMonth(unique[unique.length - 1])}`;
}

// ── Format date ───────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

// ── Grouped entries ───────────────────────────────────────────────────────────

interface GroupedEntry {
  correlationId:  string | null;
  entries:        AuditLogEntry[];
  representative: AuditLogEntry;
}

function groupEntries(logs: AuditLogEntry[]): GroupedEntry[] {
  const byCid = new Map<string, AuditLogEntry[]>();
  const result: GroupedEntry[] = [];
  const addedCid = new Set<string>();

  for (const log of logs) {
    const cid = (log.metadata as Record<string, unknown> | null)?.correlationId as string | undefined;
    if (!cid) {
      result.push({ correlationId: null, entries: [log], representative: log });
    } else {
      if (!byCid.has(cid)) byCid.set(cid, []);
      byCid.get(cid)!.push(log);
      if (!addedCid.has(cid)) {
        addedCid.add(cid);
        result.push({ correlationId: cid, entries: byCid.get(cid)!, representative: log });
      }
    }
  }
  return result;
}

// ── Entry detail ──────────────────────────────────────────────────────────────

const EntryDetail: React.FC<{
  entry:       AuditLogEntry;
  produtoMap:  Record<string, { codigo: string; descricao: string; familia?: string | null }>;
  isBatch:     boolean;
}> = ({ entry, produtoMap, isBatch }) => {
  const produto = entry.produtoId ? produtoMap[entry.produtoId] : null;
  const familia = produto?.familia ?? null;
  const meta    = entry.metadata as Record<string, unknown> | null;
  const before  = entry.before  as Record<string, unknown> | null;
  const after   = entry.after   as Record<string, unknown> | null;

  const entryMonth = meta?.month as string | undefined;

  return (
    <div className="px-4 py-3 text-xs space-y-1">
      <div className="flex items-center gap-3 flex-wrap">
        {isBatch && produto && (
          <span className="font-semibold text-slate-700">
            {produto.codigo} <span className="font-normal text-slate-500">— {produto.descricao}</span>
          </span>
        )}
        {familia && (
          <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded-full">
            {familia}
          </span>
        )}
        {entryMonth && (
          <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
            {fmtMonth(entryMonth)}
          </span>
        )}
      </div>

      {(before || after) && <DiffView before={before} after={after} />}

      {meta && <MetaView metadata={meta} />}

      {!before && !after && !meta && (
        <p className="text-slate-400 italic">Sem dados de alteração registrados.</p>
      )}
    </div>
  );
};

// ── Log card ──────────────────────────────────────────────────────────────────

const LogCard: React.FC<{
  group:      GroupedEntry;
  produtoMap: Record<string, { codigo: string; descricao: string; familia?: string | null }>;
}> = ({ group, produtoMap }) => {
  const [expanded, setExpanded] = useState(false);
  const { representative: rep, entries } = group;
  const isBatch = entries.length > 1;

  const meta          = rep.metadata as Record<string, unknown> | null;
  const operation     = meta?.operation as string | undefined;
  const opCfg         = getOpConfig(operation);
  const summary       = changeSummary(rep);
  const totalVolume   = meta?.totalVolume   as number | undefined;
  const affectedCount = meta?.affectedCount as number | undefined;
  const produto       = rep.produtoId ? produtoMap[rep.produtoId] : null;
  const familia       = produto?.familia ?? null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div
        className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50/60 transition-colors select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="mt-0.5 text-slate-400 shrink-0">
          {expanded
            ? <ChevronDown size={14} />
            : <ChevronRight size={14} />
          }
        </div>

        <div className="flex-1 min-w-0">
          {/* Linha 1: timestamp · usuário · perfil · badge · itens */}
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className="text-[11px] text-slate-400 shrink-0">{fmtDate(rep.createdAt)}</span>
            <span className="text-slate-200">·</span>
            <span className="text-xs font-semibold text-slate-700">{rep.userNome ?? '—'}</span>
            {rep.userPerfil && (
              <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{rep.userPerfil}</span>
            )}
            {opCfg && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${opCfg.cls}`}>
                {opCfg.label}
              </span>
            )}
          </div>

          {/* Linha 2: família · produto · país · meses · ciclo · resumo */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
            {familia && (
              <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded-full font-medium">
                {familia}
              </span>
            )}
            {rep.paisIso3 && (
              <span className="text-[10px] bg-sky-50 text-sky-700 border border-sky-100 px-1.5 py-0.5 rounded-full font-bold">
                {rep.paisIso3}
              </span>
            )}
            {produto && (
              <span className="font-medium text-slate-700">
                {produto.codigo}
                <span className="font-normal text-slate-400 ml-1">— {produto.descricao}</span>
              </span>
            )}
            {(() => {
              const ml = monthsLabel(entries);
              return ml ? (
                <span>Meses: <strong className="text-slate-700">{ml}</strong></span>
              ) : rep.refMonth ? (
                <span>Ciclo: <strong className="text-slate-700">{rep.refMonth}</strong></span>
              ) : null;
            })()}
            {summary && (
              <span className="text-slate-600 font-medium">{summary}</span>
            )}
            {affectedCount != null && (
              <span>Itens afetados: <strong className="text-slate-700">{affectedCount}</strong></span>
            )}
            {totalVolume != null && (
              <span>Total: <strong className="text-slate-700">{totalVolume.toLocaleString('pt-BR')} un.</strong></span>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50 divide-y divide-slate-100">
          {entries.map((entry) => (
            <EntryDetail
              key={entry.id}
              entry={entry}
              produtoMap={produtoMap}
              isBatch={isBatch}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Constants ─────────────────────────────────────────────────────────────────

const OPERATIONS = [
  { value: 'MANUAL_EDIT',           label: 'Digitação manual' },
  { value: 'SET_VALUE',             label: 'Valor fixo' },
  { value: 'APPLY_PERCENT',         label: 'Ajuste percentual' },
  { value: 'COPY_PREVIOUS',         label: 'Cópia do ciclo anterior' },
  { value: 'REVERT_CHANGES',        label: 'Reversão ao estado inicial' },
  { value: 'ACCEPT_IA_SUGGESTION',  label: 'Sugestão IA' },
  { value: 'FILL_AVERAGE_TRIM',     label: 'Média 3M (Trim)' },
  { value: 'FILL_AVERAGE_SEM',      label: 'Média 6M (Sem)' },
  { value: 'FILL_AVERAGE_12M',      label: 'Média 12M' },
  { value: 'FILL_YEAR_OVER_YEAR',   label: 'Venda A.A.' },
  { value: 'DISTRIBUTE_TOTAL_ORC',  label: 'Distribuição por ORC' },
  { value: 'DISTRIBUTE_TOTAL_TRIM', label: 'Distribuição por Média 3M' },
  { value: 'DISTRIBUTE_TOTAL_SEM',  label: 'Distribuição por Média 6M' },
  { value: 'DISTRIBUTE_TOTAL_12M',  label: 'Distribuição por Média 12M' },
  { value: 'DISTRIBUTE_TOTAL_AA',   label: 'Distribuição por A.A.' },
  { value: 'DELETE_OVERRIDE',       label: 'Exclusão de FCTS' },
  { value: 'RESTORE_PRODUCT',       label: 'Restauração de produto' },
  { value: 'ADD_PRODUCT_MANUAL',    label: 'Adição manual de produto' },
  { value: 'SUBMIT_CYCLE',          label: 'Submissão do ciclo' },
  { value: 'APPROVE_SUBMISSION',    label: 'Aprovação' },
  { value: 'CYCLE_APPROVED',        label: 'Ciclo aprovado (FCTS)' },
  { value: 'REJECT_SUBMISSION',     label: 'Rejeição' },
  { value: 'AIRFLOW_SYNC',          label: 'Sync Airflow' },
];

const ENTITIES = [
  { value: 'ForecastOverride',   label: 'ForecastOverride (FCTS)' },
  { value: 'ForecastItem',       label: 'ForecastItem (produto)' },
  { value: 'DivisionSubmission', label: 'DivisionSubmission (ciclo)' },
];

// ── Product autocomplete ──────────────────────────────────────────────────────

interface ProdutoOption { id: string; codigo: string; descricao: string }

const ProductSearch: React.FC<{
  value:    string;
  label:    string;
  token:    string | null;
  onChange: (id: string, label: string) => void;
  onClear:  () => void;
}> = ({ value, label, token, onChange, onClear }) => {
  const [query,    setQuery]    = useState('');
  const [options,  setOptions]  = useState<ProdutoOption[]>([]);
  const [open,     setOpen]     = useState(false);
  const [loading,  setLoading]  = useState(false);
  const debounce   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wrapRef    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = useCallback((q: string) => {
    if (q.length < 2) { setOptions([]); setOpen(false); return; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/produtos?search=${encodeURIComponent(q)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data: ProdutoOption[] = await res.json();
          setOptions(data.slice(0, 20));
          setOpen(true);
        }
      } finally { setLoading(false); }
    }, 350);
  }, [token]);

  if (value) {
    return (
      <div className="flex items-center gap-1 text-xs border border-sky-300 bg-sky-50 rounded-lg px-2 py-1.5">
        <span className="flex-1 truncate text-sky-800 font-medium">{label}</span>
        <button onClick={onClear} className="text-sky-400 hover:text-sky-700 shrink-0">
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); search(e.target.value); }}
          placeholder="Buscar por código ou nome…"
          className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 w-full outline-none focus:ring-1 focus:ring-sky-400 focus:border-sky-300 bg-white pr-7"
        />
        {loading && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">...</span>
        )}
      </div>
      {open && options.length > 0 && (
        <ul className="absolute z-50 top-full mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-52 overflow-y-auto text-xs">
          {options.map(p => (
            <li
              key={p.id}
              onClick={() => { onChange(p.id, `${p.codigo} — ${p.descricao}`); setQuery(''); setOpen(false); }}
              className="px-3 py-2 cursor-pointer hover:bg-sky-50 border-b border-slate-50 last:border-0"
            >
              <span className="font-mono font-bold text-slate-600 mr-2">{p.codigo}</span>
              <span className="text-slate-500">{p.descricao}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ── User autocomplete ─────────────────────────────────────────────────────────

interface UserOption { id: string; nome: string; email: string }

const UserSearch: React.FC<{
  value:    string;
  label:    string;
  token:    string | null;
  onChange: (id: string, label: string) => void;
  onClear:  () => void;
}> = ({ value, label, token, onChange, onClear }) => {
  const [options,  setOptions]  = useState<UserOption[]>([]);
  const [loaded,   setLoaded]   = useState(false);
  const [open,     setOpen]     = useState(false);
  const [query,    setQuery]    = useState('');
  const wrapRef    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const load = useCallback(async () => {
    if (loaded) { setOpen(true); return; }
    const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) { setOptions(await res.json()); setLoaded(true); setOpen(true); }
  }, [loaded, token]);

  const filtered = query
    ? options.filter(u => u.nome.toLowerCase().includes(query.toLowerCase()) || u.email.toLowerCase().includes(query.toLowerCase()))
    : options;

  if (value) {
    return (
      <div className="flex items-center gap-1 text-xs border border-sky-300 bg-sky-50 rounded-lg px-2 py-1.5">
        <span className="flex-1 truncate text-sky-800 font-medium">{label}</span>
        <button onClick={onClear} className="text-sky-400 hover:text-sky-700 shrink-0"><X size={12} /></button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={query}
        onFocus={load}
        onChange={e => { setQuery(e.target.value); if (!open) setOpen(true); }}
        placeholder="Buscar usuário…"
        className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 w-full outline-none focus:ring-1 focus:ring-sky-400 focus:border-sky-300 bg-white"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 top-full mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-52 overflow-y-auto text-xs">
          {filtered.map(u => (
            <li
              key={u.id}
              onClick={() => { onChange(u.id, u.nome); setQuery(''); setOpen(false); }}
              className="px-3 py-2 cursor-pointer hover:bg-sky-50 border-b border-slate-50 last:border-0"
            >
              <span className="font-semibold text-slate-700">{u.nome}</span>
              <span className="text-slate-400 ml-2">{u.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

export const AuditTrailPage: React.FC = () => {
  const { user, token } = useAuth();

  const params = new URLSearchParams(window.location.search);

  const [refMonth,    setRefMonth]    = useState(params.get('refMonth')   ?? '');
  const [unidadeId,   setUnidadeId]   = useState(params.get('unidadeId')  ?? '');
  const [produtoId,   setProdutoId]   = useState('');
  const [produtoLabel,setProdutoLabel]= useState('');
  const [userId,      setUserId]      = useState('');
  const [userLabel,   setUserLabel]   = useState('');
  const [operation,   setOperation]   = useState('');
  const [entity,      setEntity]      = useState('');
  const [paisIso3,    setPaisIso3]    = useState('');
  const [page,        setPage]        = useState(1);

  const [result,      setResult]      = useState<AuditResponse | null>(null);
  const [loading,     setLoading]     = useState(false);

  interface Unidade { codigo: string; descricao: string }
  const [unidades, setUnidades] = useState<Unidade[]>([]);

  useEffect(() => {
    if (!token) return;
    fetch('/api/unidades', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(setUnidades);
  }, [token]);

  const buildQuery = useCallback((p: number) => {
    const q = new URLSearchParams({ page: String(p), limit: '50' });
    if (refMonth)   q.set('refMonth',   refMonth);
    if (unidadeId)  q.set('unidadeId',  unidadeId);
    if (produtoId)  q.set('produtoId',  produtoId);
    if (userId)     q.set('userId',     userId);
    if (operation)  q.set('operation',  operation);
    if (entity)     q.set('entity',     entity);
    if (paisIso3)   q.set('paisIso3',   paisIso3.toUpperCase().trim());
    return q;
  }, [refMonth, unidadeId, produtoId, userId, operation, entity]);

  const fetchLogs = useCallback(async (p: number) => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/audit?${buildQuery(p)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setResult(await res.json());
    } finally { setLoading(false); }
  }, [token, buildQuery]);

  const handleSearch = () => { setPage(1); fetchLogs(1); };

  const handleClear = () => {
    setRefMonth(''); setUnidadeId('');
    setProdutoId(''); setProdutoLabel('');
    setUserId('');   setUserLabel('');
    setOperation(''); setEntity('');
    setPaisIso3('');
    setResult(null); setPage(1);
  };

  useEffect(() => {
    if (params.get('refMonth') || params.get('unidadeId')) fetchLogs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePageChange = (newPage: number) => { setPage(newPage); fetchLogs(newPage); };

  const handleExport = useCallback(async () => {
    if (!token) return;
    const q = buildQuery(1);
    q.set('limit', '200');
    const res = await fetch(`/api/audit?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const data: AuditResponse = await res.json();

    const header = ['Data/Hora','Usuário','Perfil','Mecanismo','Ação','Entidade','Produto','Ciclo','País','Antes (FCTS)','Depois (FCTS)','Itens no Lote','Correlation ID'];
    const rows = data.logs.map(l => {
      const meta    = l.metadata as Record<string, unknown> | null;
      const op      = meta?.operation as string ?? '';
      const cid     = meta?.correlationId as string ?? '';
      const aff     = meta?.affectedCount as number ?? '';
      const produto  = l.produtoId ? data.produtoMap[l.produtoId] : null;
      const bFCTS   = (l.before as Record<string, unknown> | null)?.volumeFCTS;
      const aFCTS   = (l.after  as Record<string, unknown> | null)?.volumeFCTS;
      return [
        fmtDate(l.createdAt), l.userNome ?? '', l.userPerfil ?? '',
        op, l.action, l.entity,
        produto ? `${produto.codigo} — ${produto.descricao}` : '',
        l.refMonth ?? '',
        l.paisIso3 ?? '',
        bFCTS != null ? String(bFCTS) : '',
        aFCTS != null ? String(aFCTS) : '',
        String(aff), cid,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });

    const csv  = '\uFEFF' + [header.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `auditoria-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }, [token, buildQuery]);

  if (!['operador_pcp', 'admin_ti'].includes(user?.perfil ?? '')) {
    return (
      <div className="p-8 text-center text-slate-500 text-sm">
        Acesso restrito a Operadores PCP e Administradores TI.
      </div>
    );
  }

  const totalPages = result ? Math.ceil(result.total / result.limit) : 0;
  const groups     = result ? groupEntries(result.logs) : [];
  const produtoMap = result?.produtoMap ?? {};

  const inputCls  = 'text-xs border border-slate-200 rounded-lg px-3 py-1.5 w-full outline-none focus:ring-1 focus:ring-sky-400 focus:border-sky-300 bg-white';
  const selectCls = `${inputCls} cursor-pointer`;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Trilha de Auditoria</h1>
          <p className="text-sm text-slate-500 mt-0.5">Rastreabilidade de alterações no forecast</p>
        </div>
        {result && result.total > 0 && (
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Download size={13} /> Exportar CSV
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Ciclo</label>
            <input type="month" value={refMonth} onChange={e => setRefMonth(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Unidade</label>
            <select value={unidadeId} onChange={e => setUnidadeId(e.target.value)} className={selectCls}>
              <option value="">Todas</option>
              {unidades.map(u => (
                <option key={u.codigo} value={u.codigo}>{u.codigo} — {u.descricao}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Mecanismo</label>
            <select value={operation} onChange={e => setOperation(e.target.value)} className={selectCls}>
              <option value="">Todos</option>
              {OPERATIONS.map(op => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Produto</label>
            <ProductSearch
              value={produtoId}
              label={produtoLabel}
              token={token}
              onChange={(id, lbl) => { setProdutoId(id); setProdutoLabel(lbl); }}
              onClear={() => { setProdutoId(''); setProdutoLabel(''); }}
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Usuário</label>
            <UserSearch
              value={userId}
              label={userLabel}
              token={token}
              onChange={(id, lbl) => { setUserId(id); setUserLabel(lbl); }}
              onClear={() => { setUserId(''); setUserLabel(''); }}
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Entidade</label>
            <select value={entity} onChange={e => setEntity(e.target.value)} className={selectCls}>
              <option value="">Todas</option>
              {ENTITIES.map(e => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
              País <span className="normal-case font-normal text-slate-300">(ISO3 — somente exportação)</span>
            </label>
            <input
              type="text"
              maxLength={3}
              placeholder="Ex: BRA"
              value={paisIso3}
              onChange={e => setPaisIso3(e.target.value.toUpperCase())}
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSearch}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors"
          >
            <Search size={13} /> Buscar
          </button>
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <X size={13} /> Limpar filtros
          </button>
        </div>
      </div>

      {/* Results */}
      {loading && (
        <div className="text-center text-sm text-slate-400 py-8">Carregando...</div>
      )}

      {!loading && result && (
        <>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{result.total.toLocaleString('pt-BR')} registro(s) encontrado(s)</span>
            {totalPages > 1 && <span>Página {page} de {totalPages}</span>}
          </div>

          {groups.length === 0 ? (
            <div className="text-center text-sm text-slate-400 py-12 bg-white rounded-xl border border-slate-200">
              Nenhum registro encontrado para os filtros aplicados.
            </div>
          ) : (
            <div className="space-y-2">
              {groups.map((group, i) => (
                <LogCard
                  key={group.correlationId ?? group.representative.id ?? String(i)}
                  group={group}
                  produtoMap={produtoMap}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevLeft size={13} /> Anterior
              </button>
              <span className="text-xs text-slate-500">Página {page} de {totalPages}</span>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Próxima <ChevRight size={13} />
              </button>
            </div>
          )}
        </>
      )}

      {!loading && !result && (
        <div className="text-center text-sm text-slate-400 py-12 bg-white rounded-xl border border-slate-200">
          Aplique filtros e clique em <strong>Buscar</strong> para visualizar o histórico.
        </div>
      )}
    </div>
  );
};
