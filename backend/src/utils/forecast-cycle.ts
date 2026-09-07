/**
 * Seleção de ciclo vencedor para montagem do consolidado.
 *
 * Contexto: o consolidado é uma visão por período (calendário). Para cada mês, o
 * forecast deve refletir a ÚLTIMA REVISÃO que cobre aquele mês — não a soma/colcha
 * de várias revisões.
 *
 * Critério antigo (catraca): "último run que TINHA o produto×mês". Como a ausência
 * de um produto numa revisão nova não competia com a presença numa antiga, um produto
 * descontinuado nunca saía do consolidado.
 *
 * Critério novo (aqui): para cada (unidade, mês), vence o ciclo aprovado daquela
 * unidade cuja janela [windowStart, windowEnd] COBRE o mês, com maior refMonth
 * (desempate: executedAt mais recente). O FCTS sai APENAS desse ciclo; um produto
 * ausente do ciclo vencedor simplesmente não é contabilizado — sem apagar histórico
 * (os ciclos antigos continuam intactos para consulta por ciclo, ex.: Meu Forecast).
 *
 * É agnóstico de fonte (backfill ou Airflow): depende só da janela do run, que ambos
 * preenchem.
 */

export interface ForecastRunMeta {
  id:          string;
  refMonth:    Date;
  executedAt:  Date;
  windowStart: Date | null;
  windowEnd:   Date | null;
}

/**
 * @param runsByUnit   unidade → Set<runId> dos ciclos aprovados daquela unidade.
 * @param runMetaById  runId → metadados do run (refMonth, executedAt, janela).
 * @returns Map "unidadeVendaId|YYYY-MM" → runId vencedor. Runs sem janela são ignorados.
 */
export function winningRunByUnitMonth(
  runsByUnit:  Map<string, Set<string>>,
  runMetaById: Map<string, ForecastRunMeta>,
): Map<string, string> {
  const winner = new Map<string, ForecastRunMeta>();

  for (const [unidade, runIds] of runsByUnit) {
    for (const runId of runIds) {
      const r = runMetaById.get(runId);
      if (!r?.windowStart || !r?.windowEnd) continue;

      let m = new Date(Date.UTC(r.windowStart.getUTCFullYear(), r.windowStart.getUTCMonth(), 1));
      const end = r.windowEnd;
      while (m <= end) {
        const key = `${unidade}|${m.toISOString().substring(0, 7)}`;
        const cur = winner.get(key);
        if (
          !cur ||
          r.refMonth.getTime() > cur.refMonth.getTime() ||
          (r.refMonth.getTime() === cur.refMonth.getTime() && r.executedAt.getTime() > cur.executedAt.getTime())
        ) {
          winner.set(key, r);
        }
        m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
      }
    }
  }

  const out = new Map<string, string>();
  for (const [k, v] of winner) out.set(k, v.id);
  return out;
}
