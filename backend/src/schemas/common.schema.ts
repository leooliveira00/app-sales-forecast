import { z } from "zod";

/** Mês de referência de ciclo: sempre o primeiro dia do mês, `YYYY-MM-01`. */
export const refMonthSchema = z
  .string("Mês de referência é obrigatório")
  .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Mês de referência deve estar no formato YYYY-MM-01");

/** Código de negócio de UnidadeVenda (chave natural vinda do ERP). */
export const unidadeCodigoSchema = z.string("Código da unidade é obrigatório").trim().min(1, "Código da unidade é obrigatório");

export const idParamsSchema = z.object({ id: z.uuid("ID inválido") });
