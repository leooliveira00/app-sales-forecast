import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { errorHandler, notFoundHandler } from "./error.middleware.js";
import { HttpError } from "../utils/http-error.js";

const mockRes = (headersSent = false) => {
  const res = { headersSent, status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};
const req = { method: "POST", originalUrl: "/api/x" } as Request;

const handle = (err: unknown, headersSent = false) => {
  const res = mockRes(headersSent);
  const next = vi.fn();
  errorHandler(err, req, res as unknown as Response, next as NextFunction);
  return { res, next };
};

describe("errorHandler", () => {
  it("HttpError responde com o status e a mensagem do erro", () => {
    const { res } = handle(new HttpError(409, "Conflito"));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Conflito" });
  });

  it("arquivo acima do limite do multer vira 413", () => {
    const { res } = handle(new multer.MulterError("LIMIT_FILE_SIZE"));
    expect(res.status).toHaveBeenCalledWith(413);
  });

  it("demais erros do multer viram 400", () => {
    const { res } = handle(new multer.MulterError("LIMIT_UNEXPECTED_FILE"));
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("erro 4xx do body-parser (JSON malformado) vira 400 genérico", () => {
    const { res } = handle(Object.assign(new SyntaxError("Unexpected token"), { status: 400 }));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Requisição inválida." });
  });

  it("erro inesperado vira 500 sem expor a mensagem interna", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { res } = handle(new Error("connection refused at 10.0.0.5:5432"));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Erro interno do servidor." });
  });

  it("com a resposta já iniciada, delega ao handler padrão do Express", () => {
    const err = new Error("stream quebrado");
    const { res, next } = handle(err, true);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("notFoundHandler", () => {
  it("responde 404 em JSON com método e rota", () => {
    const res = mockRes();
    notFoundHandler({ method: "GET", originalUrl: "/api/nao-existe" } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Rota não encontrada: GET /api/nao-existe" });
  });
});
