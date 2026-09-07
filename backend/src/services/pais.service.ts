import prisma from "../config/prisma.js";

export const listByUnidade = async (unidadeVendaId: string) =>
  prisma.pais.findMany({
    where: { unidadeVendaId, ativo: true },
    orderBy: { nome: "asc" },
  });

export const listAll = async () =>
  prisma.pais.findMany({
    where: { ativo: true },
    include: {
      unidadeVenda: { select: { codigo: true, descricao: true } },
    },
    orderBy: [{ unidadeVenda: { codigo: "asc" } }, { nome: "asc" }],
  });

export const findByIso3 = async (iso3: string) =>
  prisma.pais.findUnique({
    where: { iso3 },
    include: { unidadeVenda: { select: { codigo: true } } },
  });

export const create = async (data: {
  iso3: string;
  nome: string;
  unidadeVendaId: string;
}) => {
  const unidade = await prisma.unidadeVenda.findUnique({
    where: { codigo: data.unidadeVendaId },
  });
  if (!unidade) throw new Error("Unidade não encontrada");
  if (unidade.tipo !== "EXPORT")
    throw new Error("Somente unidades de exportação podem ter países associados");

  return prisma.pais.create({
    data: {
      iso3:           data.iso3.toUpperCase().trim(),
      nome:           data.nome.trim(),
      unidadeVendaId: data.unidadeVendaId,
    },
    include: { unidadeVenda: { select: { codigo: true } } },
  });
};

export const update = async (
  iso3: string,
  data: { nome?: string; ativo?: boolean }
) =>
  prisma.pais.update({
    where: { iso3 },
    data,
    include: { unidadeVenda: { select: { codigo: true } } },
  });

export const remove = async (iso3: string) =>
  prisma.pais.update({ where: { iso3 }, data: { ativo: false } });
