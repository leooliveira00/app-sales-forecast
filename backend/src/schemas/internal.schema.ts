import { z } from "zod";

/*
 * Schemas das rotas internas chamadas pelas DAGs do Airflow (token interno).
 *
 * Princípio: validar o que o serviço precisa para não gravar lixo nem estourar 500
 * no Prisma — tipos, obrigatoriedade, datas interpretáveis, tamanho de lote — sem
 * impor formatos mais estritos que os que as DAGs já enviam em produção
 * (ex.: `startedAt` vem de `datetime.utcnow().isoformat()`, sem "Z").
 */

/** Qualquer string que `new Date()` interprete (os serviços convertem com `new Date`). */
const dateString = z
  .string()
  .trim()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), "Data inválida");

const requiredText = z.string().trim().min(1);

/** Texto opcional que pode vir `null` do Python/pandas; normaliza para `undefined`. */
const optionalText = z
  .string()
  .nullish()
  .transform((v) => v ?? undefined);

const triggeredBy = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || "airflow-scheduler");

/** As DAGs enviam lotes de 500 (CHUNK_SIZE); o teto dá folga sem aceitar payload arbitrário. */
const MAX_BATCH = 5000;
const batch = <T extends z.ZodType>(item: T, campo: string) =>
  z
    .array(item, `Campo '${campo}' deve ser um array.`)
    .min(1, `Campo '${campo}' deve ser um array não-vazio.`)
    .max(MAX_BATCH, `Campo '${campo}' excede o limite de ${MAX_BATCH} itens por lote.`);

export const runIdParams = z.object({ runId: z.uuid("runId inválido") });
export const logIdQuery = z.object({ logId: z.uuid("logId inválido") });
export type LogIdQuery = z.infer<typeof logIdQuery>;

// ── Callback de ciclo (/api/airflow/*) ───────────────────────────────────────

export const airflowCallbackBody = z.object({
  dag_id: requiredText,
  dag_run_id: requiredText,
  state: requiredText,
  refMonth: dateString,
  issued_at: optionalText,
  dataRefMonth: optionalText,
});
export type AirflowCallbackBody = z.infer<typeof airflowCallbackBody>;

export const cycleFailedBody = z.object({ refMonth: dateString });
export type CycleFailedBody = z.infer<typeof cycleFailedBody>;

// ── Motor de forecast (/api/internal/forecast/*) ─────────────────────────────

export const createForecastRunBody = z.object({
  refMonth: dateString,
  leadTimeMonths: z.coerce.number().int().min(1).max(24).default(2),
  triggeredBy,
});
export type CreateForecastRunBody = z.infer<typeof createForecastRunBody>;

export const addForecastItemsBody = z.object({
  items: batch(
    z.object({
      produtoId: requiredText,
      unidadeVendaId: requiredText,
      month: dateString,
      volumeIA: z.number().optional(),
      paisIso3: z.string().length(3).nullish(),
    }),
    "items",
  ),
});
export type AddForecastItemsBody = z.infer<typeof addForecastItemsBody>;

// ── Sync ERP (/api/internal/sync/*) ──────────────────────────────────────────

export const receiveProdutosBody = z.object({
  // looseObject: o item vem cru do Protheus; campos extras são preservados.
  itens: batch(
    z.looseObject({
      produto: requiredText,
      tipo: z.string(),
      descricao: z.string(),
      classe: z.string(),
      codigoFamiliaAGM: optionalText,
      descricaoFamiliaAGM: optionalText,
      codigoClasseValor: optionalText,
      descricaoClasseValor: optionalText,
    }),
    "itens",
  ),
  triggeredBy,
  cTipo: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || "PA"),
});
export type ReceiveProdutosBody = z.infer<typeof receiveProdutosBody>;

export const receiveVendasBody = z.object({
  itens: batch(
    z.object({
      produtoId: requiredText,
      unidadeVendaId: requiredText,
      month: dateString,
      canal: z.string(),
      paisIso3: z.string().nullable(),
      quantidade: z.number(),
      receita: z.number(),
      codigoFamilia: z.string().nullish(),
      familia: z.string().nullish(),
      divisao: z.string().nullish(),
    }),
    "itens",
  ),
  refMonth: dateString,
  cDataDe: requiredText,
  cDataAte: requiredText,
  triggeredBy,
});
export type ReceiveVendasBody = z.infer<typeof receiveVendasBody>;

// ── Export Protheus (/api/internal/protheus-export/*) ────────────────────────

const exportStatus = z.enum(["SUCCESS", "FAILED"]);

export const deleteStatusBody = z.object({
  logId: z.uuid("logId inválido"),
  unidadeVendaId: requiredText,
  status: exportStatus,
  error: optionalText,
});

export const progressBody = z.object({
  logId: z.uuid("logId inválido"),
  unidadeVendaId: requiredText,
  month: z.string().regex(/^\d{6}$/, "month deve estar no formato YYYYMM"),
  itemIds: z.array(z.uuid()).max(MAX_BATCH),
  status: exportStatus,
  error: optionalText,
});

export const finalizeExportBody = z.object({
  logId: z.uuid("logId inválido"),
  unidadesOk: z.number().int().min(0),
  unidadesFailed: z.number().int().min(0),
  // Detalhe por unidade é gravado como JSON no log; só a chave é exigida.
  details: z.array(z.looseObject({ unidadeVendaId: requiredText })),
  startedAt: dateString,
  error: optionalText,
});
