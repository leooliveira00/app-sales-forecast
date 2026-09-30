import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { z } from "zod";
import { validate } from "./validate.middleware.js";
import { HttpError } from "../utils/http-error.js";

const run = (schemas: Parameters<typeof validate>[0], req: Partial<Request>) => {
  const next = vi.fn();
  validate(schemas)(req as Request, {} as Response, next);
  return next;
};

describe("validate", () => {
  const body = z.object({ nome: z.string().trim().min(1, "nome é obrigatório") });

  it("em caso de sucesso substitui o body pelo valor parseado e chama next()", () => {
    const req: Partial<Request> = { body: { nome: "  Ana  ", campoExtra: 1 } };

    const next = run({ body }, req);

    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ nome: "Ana" }); // trim aplicado, campo desconhecido removido
  });

  it("em caso de falha encaminha HttpError 400 com campo e mensagem", () => {
    const next = run({ body }, { body: { nome: "   " } });

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(400);
    expect(err.message).toBe("nome: nome é obrigatório");
  });

  it("junta todos os problemas encontrados numa mensagem só", () => {
    const schema = z.object({ a: z.string("a obrigatório"), b: z.string("b obrigatório") });

    const next = run({ body: schema }, { body: {} });

    expect(next.mock.calls[0][0].message).toBe("a: a obrigatório; b: b obrigatório");
  });

  it("valida params antes do body e para no primeiro que falhar", () => {
    const params = z.object({ id: z.uuid("ID inválido") });
    const req: Partial<Request> = { params: { id: "abc" }, body: { nome: "  x " } };

    const next = run({ params, body }, req);

    expect(next.mock.calls[0][0].message).toBe("id: ID inválido");
    expect(req.body).toEqual({ nome: "  x " }); // body não foi tocado
  });
});
