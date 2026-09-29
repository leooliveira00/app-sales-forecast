/**
 * Erro com status HTTP explícito. Lançado (ou passado a `next`) por middlewares e
 * controllers quando o status não é 500; o `errorHandler` usa `status` e `message`
 * na resposta. Qualquer outro erro vira 500 com mensagem genérica.
 */
export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}
