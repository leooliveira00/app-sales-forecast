// ── Tipos do módulo de Forecast ───────────────────────────────────────────────

// ── Entidades de domínio ──────────────────────────────────────────────────────

export interface Pais {
  iso3: string;
  nome: string;
  ativo?: boolean;
  unidadeVendaId?: string;
}

export interface UnidadeVenda {
  codigo: string;
  descricao: string;
  ativo: boolean;
  tipo?: string;
  paises?: Array<{ iso3: string; nome: string }>;
}

export interface ProdutoUnidadeVenda {
  id: string;
  unidadeVendaId: string;
  ativo: boolean;
  familia: string | null;
  divisao: string | null;   // nome descritivo da divisão (ex: "Divisão Cardiologia")
  unidade: UnidadeVenda;
}

export interface Produto {
  codigo: string;
  descricao: string;
  ativo: boolean;
  classe:  string | null;   // classificação ABC do SKU (ex: F, E, D, C, B, A)
  ncm?: string | null;
  unidades: ProdutoUnidadeVenda[];
}

export interface Override {
  id: string;
  volumeFCTS: number;
  note?: string | null;
}

export interface ForecastItem {
  id: string;
  runId: string;
  month: string;
  // Para unidades EXPORT: código ISO3 do país; null para NACIONAL
  paisIso3?: string | null;
  pais?: { iso3: string; nome: string } | null;
  volumeORC: number | null;
  volumeIA: number | null;
  prevFCTS: number | null;   // FCTS do mesmo mês-alvo no ciclo anterior (N-1)
  avgTrim:  number | null;   // média de vendas dos últimos 3 meses fechados
  avgSem:   number | null;   // média de vendas dos últimos 6 meses fechados
  avg12m:   number | null;   // média de vendas dos últimos 12 meses fechados
  salesHistory: Array<{ month: string; qty: number }>;  // histórico mensal para o gráfico
  orcHistory:   Array<{ month: string; volumeORC: number }>;  // ORC mês a mês para linha de referência
  // Soma da venda A.A. dos meses com base válida (vendaAA > 0). Usado como
  // referência do desvio na prévia de submissão. Para EXPORT, considera apenas
  // o país do item.
  vendaAA?:        number | null;
  // Soma do FCTS dos MESMOS meses contemplados em vendaAA — simetria do desvio.
  fctsForDesvio?:  number | null;
  source: string;            // "AIRFLOW" | "MANUAL"
  isDefaultPortfolio: boolean;
  gestorExcluido: boolean;
  produto: Pick<Produto, 'codigo' | 'descricao' | 'classe'> & {
    unidades: Array<Pick<ProdutoUnidadeVenda, 'familia' | 'divisao'>>;
  };
  overrides: Override[];
}

export interface ForecastRun {
  id: string;
  refMonth: string;
  status: string;
  executedAt: string;
  windowStart: string | null;
  windowEnd: string | null;
  leadTimeMonths: number;
  availableFrom: string | null;
  availableUntil: string | null;
}

export interface Submission {
  id: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  autor: { nome: string };
}

// ── Helpers de formatação ─────────────────────────────────────────────────────

export const fmt = (v: number | null | undefined): string =>
  v != null ? new Intl.NumberFormat('pt-BR').format(v) : '—';

export const toMonthParam = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;

export const monthLabel = (d: Date | string, locale = 'pt-BR'): string => {
  const date = typeof d === 'string' ? new Date(`${d}-01T00:00:00Z`) : d;
  const m = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date);
  return `${m} / ${date.getUTCFullYear()}`;
};

export const getFamilia = (item: ForecastItem): string =>
  item.produto.unidades[0]?.familia?.trim() || item.produto.unidades[0]?.divisao?.trim() || 'Outros';

export const CLASSE_ORDER = ['F', 'E', 'D', 'C', 'B', 'A'] as const;

export const getClasse = (item: ForecastItem): string =>
  item.produto.classe?.trim() || '';

export const getFamilyClasse = (itens: ForecastItem[]): string => {
  for (const c of CLASSE_ORDER) {
    if (itens.some(i => getClasse(i) === c)) return c;
  }
  return '';
};

// ── Paleta de cores para badges de Classe ─────────────────────────────────────
// Inativo: cinza neutro | Ativo: sky

export const CLASSE_BADGE_COLORS: Record<string, string> = {
  F: 'bg-slate-100 text-slate-500 border-slate-200',
  E: 'bg-slate-100 text-slate-500 border-slate-200',
  D: 'bg-slate-100 text-slate-500 border-slate-200',
  C: 'bg-slate-100 text-slate-500 border-slate-200',
  B: 'bg-slate-100 text-slate-500 border-slate-200',
  A: 'bg-slate-100 text-slate-500 border-slate-200',
};

export const CLASSE_BADGE_ACTIVE: Record<string, string> = {
  F: 'bg-sky-500 text-white border-sky-500',
  E: 'bg-sky-500 text-white border-sky-500',
  D: 'bg-sky-500 text-white border-sky-500',
  C: 'bg-sky-500 text-white border-sky-500',
  B: 'bg-sky-500 text-white border-sky-500',
  A: 'bg-sky-500 text-white border-sky-500',
};
