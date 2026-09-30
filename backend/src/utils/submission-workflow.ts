/**
 * Máquina de estados do workflow de submissão (DivisionSubmission).
 *
 *   DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED
 *     ▲                   │
 *     │                   └──reject───▶ REJECTED ──submit──▶ SUBMITTED
 *
 * Só cobre as ações de usuário (gestor submete, PCP decide). Transições de sistema —
 * auto-submit no fim do prazo e reversão SUBMITTED→DRAFT no reprocessamento de
 * ciclo — são gravadas diretamente pelos serviços de ciclo.
 */
import { Prisma, type SubmissionStatus } from "@prisma/client";
import { HttpError } from "./http-error.js";

export type SubmissionAction = "submit" | "approve" | "reject";

const ALLOWED_FROM: Record<SubmissionAction, readonly SubmissionStatus[]> = {
  submit: ["DRAFT", "REJECTED"],
  approve: ["SUBMITTED"],
  reject: ["SUBMITTED"],
};

/** Status a partir dos quais a ação é permitida (usado também como guarda no UPDATE). */
export const allowedFrom = (action: SubmissionAction): SubmissionStatus[] => [...ALLOWED_FROM[action]];

export const canTransition = (from: SubmissionStatus, action: SubmissionAction): boolean =>
  ALLOWED_FROM[action].includes(from);

const blockedMessage = (from: SubmissionStatus, action: SubmissionAction): string => {
  if (action === "submit") {
    return from === "APPROVED"
      ? "Submissão já está aprovada."
      : "Forecast já submetido e aguardando aprovação.";
  }
  const verbo = action === "approve" ? "aprovar" : "rejeitar";
  return `Só é possível ${verbo} submissões pendentes (status atual: ${from}).`;
};

/** Lança HttpError 404 (inexistente) ou 409 (transição inválida). */
export function assertTransition(from: SubmissionStatus | null | undefined, action: SubmissionAction): void {
  if (!from) throw new HttpError(404, "Submissão não encontrada.");
  if (!canTransition(from, action)) throw new HttpError(409, blockedMessage(from, action));
}

/**
 * O UPDATE filtra por `status in allowedFrom(action)`; se outra requisição mudou o
 * status entre a leitura e a escrita, o Prisma lança P2025 — convertido aqui em 409.
 */
export function rethrowIfStale(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    throw new HttpError(409, "A submissão foi alterada por outra ação. Recarregue a página e tente novamente.");
  }
  throw err;
}
