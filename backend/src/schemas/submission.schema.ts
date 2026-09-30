import { z } from "zod";
import { SubmissionStatus } from "@prisma/client";
import { refMonthSchema, unidadeCodigoSchema } from "./common.schema.js";

export const listSubmissionsQuery = z.object({
  status: z.enum(SubmissionStatus).optional(),
  unidadeVendaId: unidadeCodigoSchema.optional(),
});
export type ListSubmissionsQuery = z.infer<typeof listSubmissionsQuery>;

export const submissionByUnitQuery = z.object({
  unidadeVendaId: unidadeCodigoSchema,
  month: refMonthSchema,
});
export type SubmissionByUnitQuery = z.infer<typeof submissionByUnitQuery>;

export const submitBody = z.object({
  unidadeVendaId: unidadeCodigoSchema,
  refMonth: refMonthSchema,
});
export type SubmitBody = z.infer<typeof submitBody>;

export const rejectBody = z.object({
  reason: z
    .string("Motivo da rejeição é obrigatório")
    .trim()
    .min(1, "Motivo da rejeição é obrigatório")
    .max(2000, "Motivo da rejeição deve ter no máximo 2000 caracteres"),
});
export type RejectBody = z.infer<typeof rejectBody>;
