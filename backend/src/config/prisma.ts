import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "production"
      ? [{ level: "warn", emit: "event" }, { level: "error", emit: "event" }]
      : ["warn", "error"],
});

if (process.env.NODE_ENV === "production") {
  // Loga queries que demoram mais de 2 segundos em produção para facilitar diagnóstico
  // O tipo de $on depende do `log` literal; com a config condicional acima o TS perde o evento "warn".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.$on as any)("warn", (e: { message: string }) => {
    console.warn("[Prisma warn]", e.message);
  });
}

export default prisma;
