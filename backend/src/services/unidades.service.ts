import { UnidadeTipo, Prisma } from "@prisma/client";
import prisma from "../config/prisma.js";

export const findAll = async () => {
  return prisma.unidadeVenda.findMany({
    where: { ativo: true },
    include: {
      paises: {
        where: { ativo: true },
        orderBy: { nome: "asc" },
      },
    },
    orderBy: [{ tipo: "asc" }, { descricao: "asc" }],
  });
};

export const findByCodigo = async (codigo: string) => {
  return prisma.unidadeVenda.findUnique({
    where: { codigo },
    include: {
      paises: { where: { ativo: true }, orderBy: { nome: "asc" } },
    },
  });
};

export const create = async (data: {
  codigo: string;
  descricao: string;
  tipo?: UnidadeTipo;
  config?: Record<string, unknown>;
}) => {
  return prisma.unidadeVenda.create({
    data: {
      codigo:    data.codigo.toUpperCase().trim(),
      descricao: data.descricao.trim(),
      tipo:      data.tipo ?? "NACIONAL",
      config:    (data.config ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    include: { paises: true },
  });
};

export const update = async (
  codigo: string,
  data: {
    descricao?: string;
    ativo?: boolean;
    tipo?: UnidadeTipo;
    config?: Record<string, unknown>;
  }
) => {
  return prisma.unidadeVenda.update({
    where: { codigo },
    data: {
      ...data,
      config: (data.config ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    include: { paises: true },
  });
};
