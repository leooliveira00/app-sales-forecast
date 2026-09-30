import { z } from "zod";

/**
 * refMonth na URL das ações de ciclo: a tela de ciclos envia o ISO completo do
 * primeiro dia do mês (`2026-11-01T00:00:00.000Z`); `YYYY-MM-01` também é aceito.
 */
export const cycleRefMonthParams = z.object({
  refMonth: z
    .string()
    .regex(
      /^\d{4}-(0[1-9]|1[0-2])-01(T00:00:00(\.000)?Z)?$/,
      "Mês de referência deve ser o primeiro dia do mês (YYYY-MM-01)",
    ),
});

const motivo = (obrigatorio: string) =>
  z.string(obrigatorio).trim().min(1, obrigatorio).max(2000, "Motivo deve ter no máximo 2000 caracteres");

export const blockCycleBody = z.object({ reason: motivo("O motivo do bloqueio é obrigatório.") });
export type BlockCycleBody = z.infer<typeof blockCycleBody>;

export const closeCycleBody = z.object({ reason: motivo("O motivo do encerramento é obrigatório.") });
export type CloseCycleBody = z.infer<typeof closeCycleBody>;

export const unblockCycleBody = z.object({
  note: z.string().trim().max(2000, "Observação deve ter no máximo 2000 caracteres").optional(),
});
export type UnblockCycleBody = z.infer<typeof unblockCycleBody>;

export const rerunCycleBody = z.object({
  dags: z
    .array(z.string().trim().min(1), "Selecione ao menos uma DAG para re-executar.")
    .min(1, "Selecione ao menos uma DAG para re-executar."),
  reason: motivo("O motivo da re-execução é obrigatório."),
});
export type RerunCycleBody = z.infer<typeof rerunCycleBody>;

// ── DAGs obrigatórias do ciclo (CycleRequiredDag) ────────────────────────────

export const createRequiredDagBody = z.object({
  dagId: z.string("dagId é obrigatório.").trim().min(1, "dagId é obrigatório."),
  label: z.string("label é obrigatório.").trim().min(1, "label é obrigatório."),
  enabled: z.boolean().default(true),
  order: z.number().int().min(0).default(0),
});
export type CreateRequiredDagBody = z.infer<typeof createRequiredDagBody>;

export const updateRequiredDagBody = z.object({
  label: z.string().trim().min(1, "label não pode ser vazio.").optional(),
  enabled: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
});
export type UpdateRequiredDagBody = z.infer<typeof updateRequiredDagBody>;
