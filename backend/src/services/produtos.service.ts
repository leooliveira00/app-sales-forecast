import prisma from "../config/prisma.js";

const includeUnidades = {
  unidades: {
    where: { ativo: true },
    include: { unidade: true },
    orderBy: { unidade: { codigo: "asc" as const } },
  },
};

export const findAll = async (search?: string) => {
  return prisma.produto.findMany({
    where: search
      ? {
          OR: [
            { codigo:    { contains: search, mode: "insensitive" } },
            { descricao: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    include: includeUnidades,
    orderBy: { descricao: "asc" },
    take: search ? 20 : undefined,
  });
};

export const findByUnidade = async (
  unidadeVendaId: string,
  search?: string,
  limit?: number
) => {
  return prisma.produto.findMany({
    where: {
      ativo: true,
      unidades: { some: { unidadeVendaId, ativo: true } },
      ...(search
        ? {
            OR: [
              { codigo:    { contains: search, mode: "insensitive" } },
              { descricao: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: includeUnidades,
    orderBy: { descricao: "asc" },
    take: limit ?? undefined,
  });
};

export const findByCodigo = async (codigo: string) => {
  return prisma.produto.findUnique({ where: { codigo }, include: includeUnidades });
};

export const create = async (data: {
  codigo: string;
  descricao: string;
  ncm?: string;
}) => {
  return prisma.produto.create({
    data: {
      codigo: data.codigo.trim().toUpperCase(),
      descricao: data.descricao.trim(),
      ncm: data.ncm?.trim() ?? null,
    },
    include: includeUnidades,
  });
};

export const update = async (
  codigo: string,
  data: { descricao?: string; ativo?: boolean; ncm?: string; classe?: string | null }
) => {
  return prisma.produto.update({ where: { codigo }, data, include: includeUnidades });
};

export const linkUnidade = async (
  produtoId: string,
  unidadeVendaId: string,
  opts?: { familia?: string; divisao?: string }
) => {
  return prisma.produtoUnidadeVenda.upsert({
    where: { produtoId_unidadeVendaId: { produtoId, unidadeVendaId } },
    create: {
      produtoId,
      unidadeVendaId,
      familia: opts?.familia ?? null,
      divisao: opts?.divisao  ?? null,
    },
    update: {
      ativo:   true,
      familia: opts?.familia,
      divisao: opts?.divisao,
    },
    include: { unidade: true },
  });
};

export const updateLink = async (
  produtoId: string,
  unidadeVendaId: string,
  data: { familia?: string | null; divisao?: string | null }
) => {
  return prisma.produtoUnidadeVenda.update({
    where: { produtoId_unidadeVendaId: { produtoId, unidadeVendaId } },
    data: {
      familia: data.familia,
      divisao: data.divisao,
    },
    include: { unidade: true },
  });
};

export const unlinkUnidade = async (produtoId: string, unidadeVendaId: string) => {
  return prisma.produtoUnidadeVenda.updateMany({
    where: { produtoId, unidadeVendaId },
    data: { ativo: false },
  });
};

export const softDelete = async (codigo: string) => {
  return prisma.produto.update({ where: { codigo }, data: { ativo: false } });
};
