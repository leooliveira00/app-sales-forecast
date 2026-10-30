/**
 * Tipos da resposta de GET /api/submissions/:id/preview e da tendência da unidade,
 * usados pelo painel de prévia da submissão.
 */

// ── Tipos ─────────────────────────────────────────────────────────────────

interface MonthSummary {
  targetMonth: string;
  totalORC: number;
  totalFCTS: number;
  prevFcts: number;
  desvio: number;
}

interface TopDesvio {
  codigo: string;
  descricao: string;
  familia: string;
  targetMonth: string;
  volumeORC: number;
  volumeFCTS: number;
  desvio: number;
}

interface ClasseAcuracia {
  classe: string;
  acuracia3M: number;
  skuCount: number;
}

interface ProdutoMes {
  month: string;
  orc: number;
  fcts: number;
  prevFcts: number;
}

interface ProdutoDetalhe {
  codigo: string;
  descricao: string;
  classe: string | null;
  familia: string;
  orcTotal: number;
  fctsTotal: number;
  prevFctsTotal: number;
  meses: ProdutoMes[];
}

interface FamiliaDetalhe {
  familia: string;
  orcTotal: number;
  fctsTotal: number;
  prevFctsTotal: number;
  desvioORC: number;
  deltaVsAnt: number | null;
  produtos: ProdutoDetalhe[];
}

interface ProdutoExcluido {
  codigo: string;
  descricao: string;
  classe: string | null;
  familia: string;
  orcTotal: number;
  prevFctsTotal: number;
}

interface FamiliaPaisDetalhe {
  familia: string;
  orcTotal: number;
  fctsTotal: number;
  prevFctsTotal: number;
  desvioORC: number;
  deltaVsAnt: number | null;
  produtos: ProdutoDetalhe[];
}

interface PaisDetalhe {
  paisIso3: string;
  paisNome: string;
  orcTotal: number;
  fctsTotal: number;
  prevFctsTotal: number;
  desvioORC: number;
  deltaVsAnt: number | null;
  semFcts: boolean;
  familias: FamiliaPaisDetalhe[];
}

export interface PreviewData {
  months: MonthSummary[];
  topDesvios: TopDesvio[];
  resumo: { totalORC: number; totalFCTS: number; desvio: number };
  prevFctsTotal: number;
  classeAcuracia: ClasseAcuracia[];
  familiaDetalhe: FamiliaDetalhe[];
  produtosExcluidos: ProdutoExcluido[];
  paisDetalhe?: PaisDetalhe[];
  isExport?: boolean;
}

export interface TendenciaPoint {
  month: string;
  label: string;
  orc: number;
  fcts: number;
  vendas: number;
}
