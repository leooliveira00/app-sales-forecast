/**
 * Paleta semântica para todos os gráficos da ferramenta.
 *
 * ORC    = cinza  — orçamento, dado estático de referência
 * FCTS   = azul   — forecast ativo, protagonista da tela
 * Vendas = teal   — realizado, histórico de vendas
 */
export const CHART_COLORS = {
  orc:       '#94a3b8',
  fcts:      '#3b82f6',
  vendas:    '#0d9488',
  barRecente: '#0d9488',
  barAntiga:  '#cbd5e1',
} as const;
