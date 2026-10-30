/**
 * Formatação e score de risco do painel de prévia da submissão.
 */

// ── Helpers ───────────────────────────────────────────────────────────────

export const fmt = (v: number) => new Intl.NumberFormat('pt-BR').format(v);

export const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

export const monthLabel = (iso: string) => {
  const [y, m] = iso.split('-');
  const mes = MESES[parseInt(m, 10) - 1] ?? iso;
  return y ? `${mes}/${y.slice(2)}` : mes;
};

// ── Score de Risco ────────────────────────────────────────────────────────

export const calcScore = (
  desvioFctsOrc: number,
  deltaCiclo: number | null,
  topDesviosCount: number
): 'ok' | 'atencao' | 'risco' => {
  let pontos = 0;
  if (Math.abs(desvioFctsOrc) > 25) pontos += 2;
  else if (Math.abs(desvioFctsOrc) > 10) pontos += 1;

  if (deltaCiclo !== null) {
    if (Math.abs(deltaCiclo) > 25) pontos += 2;
    else if (Math.abs(deltaCiclo) > 10) pontos += 1;
  }

  if (topDesviosCount >= 4) pontos += 2;
  else if (topDesviosCount >= 2) pontos += 1;

  if (pontos >= 4) return 'risco';
  if (pontos >= 2) return 'atencao';
  return 'ok';
};

export const SCORE_CFG = {
  ok:      { label: 'Dentro do normal', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  atencao: { label: 'Atenção',          cls: 'bg-amber-50   text-amber-700   border-amber-200',   dot: 'bg-amber-500'   },
  risco:   { label: 'Risco Alto',       cls: 'bg-red-50     text-red-700     border-red-200',     dot: 'bg-red-500'     },
};
