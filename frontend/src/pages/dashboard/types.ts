/**
 * Tipos das respostas da API usadas pelo Dashboard, formato do cache da página
 * e auxiliares de apresentação (parâmetro de mês, cores por status de submissão).
 */

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface DashSummary {
  run: { id: string; executedAt: string } | null;
  totalORC: number;
  totalFCTS: number;
  totalItems: number;
  filledItems: number;
  totalUnidadesAtivas: number;
}

export interface Submission {
  id: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  unidadeVenda: { codigo: string; descricao: string };
  autor: { nome: string };
  refMonth: string;
  submittedAt: string | null;
  rejectionReason?: string | null;
}

export interface TendenciaPoint {
  month: string;
  orc: number;
  fcts: number;
  vendas: number;
}

interface DesvioSku {
  codigo: string;
  descricao: string;
  volumeFCTS: number;
  volumeVendaAA: number;
  desvio: number;
}

export interface DesviosCriticos {
  skusComDesvio: number;
  familias: string[];
  threshold: number;
  detalhe: { familia: string; skus: DesvioSku[] }[];
}

export interface ProdutoCronico {
  unidadeVendaId: string;
  produtoCodigo: string;
  produtoDescricao: string;
  classe: string | null;
  familia: string | null;
  direcao: 'alta' | 'baixa';
  desvioMedio: number;
}

export interface AcuraciaUnidade {
  codigo: string;
  descricao: string;
  acuracia: number;
  bias: number;
  ciclosValidos: number;
  totalVendas: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export const toMonthParam = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

export const STATUS_CLS: Record<string, { cls: string; dot: string }> = {
  APPROVED:  { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  SUBMITTED: { cls: 'bg-amber-50   text-amber-700  border-amber-200',   dot: 'bg-amber-500'   },
  REJECTED:  { cls: 'bg-red-50     text-red-700    border-red-200',     dot: 'bg-red-500'     },
  DRAFT:     { cls: 'bg-slate-100  text-slate-500  border-slate-200',   dot: 'bg-slate-400'   },
};

export type DashCacheShape = {
  summary:             DashSummary | null;
  submissions:         Submission[];
  tendencia:           TendenciaPoint[];
  desvios:             DesviosCriticos | null;
  cronicos:            ProdutoCronico[];
  acuraciaUnidades:    AcuraciaUnidade[];
  acuraciaGestorSnap:  AcuraciaUnidade | null;
};
