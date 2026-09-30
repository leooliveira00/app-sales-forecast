import { describe, expect, it } from "vitest";
import { Prisma, type SubmissionStatus } from "@prisma/client";
import { assertTransition, canTransition, rethrowIfStale, type SubmissionAction } from "./submission-workflow.js";
import { HttpError } from "./http-error.js";

const STATUSES: SubmissionStatus[] = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"];

// Tabela completa: toda combinação status × ação, não só os caminhos felizes.
const EXPECTED: Record<SubmissionAction, Record<SubmissionStatus, boolean>> = {
  submit: { DRAFT: true, SUBMITTED: false, APPROVED: false, REJECTED: true },
  approve: { DRAFT: false, SUBMITTED: true, APPROVED: false, REJECTED: false },
  reject: { DRAFT: false, SUBMITTED: true, APPROVED: false, REJECTED: false },
};

describe("canTransition", () => {
  const cases = (Object.keys(EXPECTED) as SubmissionAction[]).flatMap((action) =>
    STATUSES.map((from) => [action, from, EXPECTED[action][from]] as const),
  );

  it.each(cases)("%s a partir de %s → %s", (action, from, expected) => {
    expect(canTransition(from, action)).toBe(expected);
  });
});

describe("assertTransition", () => {
  const thrown = (fn: () => void): HttpError => {
    try {
      fn();
    } catch (err) {
      return err as HttpError;
    }
    throw new Error("esperava que lançasse");
  };

  it("não lança em transição válida", () => {
    expect(() => assertTransition("SUBMITTED", "approve")).not.toThrow();
  });

  it("submissão inexistente → 404", () => {
    const err = thrown(() => assertTransition(null, "approve"));
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
  });

  it("aprovar um rascunho nunca submetido → 409", () => {
    const err = thrown(() => assertTransition("DRAFT", "approve"));
    expect(err.status).toBe(409);
    expect(err.message).toBe("Só é possível aprovar submissões pendentes (status atual: DRAFT).");
  });

  it("rejeitar algo já aprovado → 409", () => {
    expect(thrown(() => assertTransition("APPROVED", "reject")).message).toBe(
      "Só é possível rejeitar submissões pendentes (status atual: APPROVED).",
    );
  });

  it("reenviar submissão aprovada ou pendente → 409 com mensagem específica", () => {
    expect(thrown(() => assertTransition("APPROVED", "submit")).message).toBe("Submissão já está aprovada.");
    expect(thrown(() => assertTransition("SUBMITTED", "submit")).message).toBe(
      "Forecast já submetido e aguardando aprovação.",
    );
  });
});

describe("rethrowIfStale", () => {
  it("converte P2025 (status mudou entre leitura e escrita) em 409", () => {
    const p2025 = new Prisma.PrismaClientKnownRequestError("No record found", { code: "P2025", clientVersion: "x" });
    expect(() => rethrowIfStale(p2025)).toThrow(HttpError);
    try {
      rethrowIfStale(p2025);
    } catch (err) {
      expect((err as HttpError).status).toBe(409);
    }
  });

  it("repassa qualquer outro erro sem alterar", () => {
    const outro = new Error("timeout");
    expect(() => rethrowIfStale(outro)).toThrow(outro);
  });
});
