/**
 * Extração personalizada de dados de forecast (CSV).
 *
 * Fonte única: `ConsolidadoProdutoMesSnapshot`. A escolha não é por desempenho —
 * é por CORREÇÃO. O snapshot já resolve as duas regras difíceis do domínio:
 *
 *   1. FCTS só entra de ciclo APROVADO (DivisionSubmission APPROVED);
 *   2. quando dois ciclos aprovados cobrem o mesmo mês, vale o ciclo vencedor
 *      por (unidade, mês) — ver `winningRunByUnitMonth` em utils/forecast-cycle.
 *
 * Reimplementar isso aqui produziria números diferentes do Consolidado para os
 * mesmos filtros. Portanto: se a extração parecer defasada, o caminho é
 * recalcular o snapshot (`snapshot.service.ts` / `refresh-snapshots.ts`), nunca
 * ler ForecastItem direto por aqui.
 *
 * Limite conhecido: o snapshot não guarda `volumeIA` — a extração cobre
 * ORC / FCTS / Vendas e os desvios derivados. Volume IA exigiria unir
 * ForecastItem reaplicando as duas regras acima.
 */

import prisma from "../config/prisma.js";
import { ROLES } from "../constants/roles.js";

// ── Domínio da extração ───────────────────────────────────────────────────────

export const METRICAS = ["orc", "fcts", "vendas", "desvioFctsOrc", "desvioVendasFcts"] as const;
export type Metrica = (typeof METRICAS)[number];

export const NIVEIS = ["produto", "familia"] as const;
export type Nivel = (typeof NIVEIS)[number];

/**
 * Rótulo de cada métrica no cabeçalho do CSV.
 *
 * Na extração o forecast confirmado sai como **FCST** (e não FCTS, usado no
 * restante do sistema e nos nomes de campo como `volumeFCTS`) — foi a grafia
 * pedida para o material exportado. As chaves internas seguem inalteradas.
 */
const METRICA_LABEL: Record<Metrica, string> = {
  orc:              "ORC",
  fcts:             "FCST",
  vendas:           "Vendas",
  desvioFctsOrc:    "Desvio FCST-ORC",
  desvioVendasFcts: "Desvio Vendas-FCST",
};

/**
 * Rótulo usado para produtos sem família AGM cadastrada (`familia = null` no
 * snapshot). Também é aceito como valor de filtro — selecionar "Outros" traz
 * justamente as linhas sem família.
 */
export const SEM_FAMILIA = "Outros";

/**
 * Teto de linhas por extração. O CSV é montado em memória antes de responder;
 * 100 mil linhas ≈ 10 MB, o que ainda cabe com folga. Acima disso o pedido é
 * recusado com orientação de estreitar o filtro, em vez de derrubar o processo.
 */
export const MAX_LINHAS = 100_000;

export type ExtracaoParams = {
  readonly startMonth: string;              // "YYYY-MM"
  readonly endMonth:   string;              // "YYYY-MM"
  readonly unidades:   ReadonlyArray<string>; // já autorizadas pelo controller
  readonly familias?:  ReadonlyArray<string>;
  readonly produtos?:  ReadonlyArray<string>;
  readonly metricas:   ReadonlyArray<Metrica>;
  readonly nivel:      Nivel;
};

export type LinhaExtracao = {
  unidadeVendaId:   string;
  unidadeDescricao: string;
  familia:          string;
  produtoCodigo:    string;   // vazio no nível família
  produtoDescricao: string;   // vazio no nível família
  classe:           string;   // vazio no nível família
  mes:              string;   // "YYYY-MM"
  orc:              number;
  fcts:             number;
  vendas:           number;
};

/** Pedido excede `MAX_LINHAS` — o controller traduz em HTTP 413. */
export class ExtracaoMuitoGrandeError extends Error {
  readonly total: number;

  constructor(total: number) {
    super(
      `A extração resultaria em ${total.toLocaleString("pt-BR")} linhas, acima do limite ` +
      `de ${MAX_LINHAS.toLocaleString("pt-BR")}. Reduza o período ou filtre por família/produto.`
    );
    this.name  = "ExtracaoMuitoGrandeError";
    this.total = total;
  }
}

// ── Type guards (validação de query string sem `as`) ───────────────────────────

export const isMetrica = (value: string): value is Metrica =>
  METRICAS.some((m) => m === value);

export const isNivel = (value: string): value is Nivel =>
  NIVEIS.some((n) => n === value);

export const isMonth = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

// ── Helpers de mês ────────────────────────────────────────────────────────────

/** "YYYY-MM" → primeiro dia do mês em UTC (mesma convenção de `refMonth`). */
const inicioDoMes = (month: string): Date => new Date(`${month}-01T00:00:00.000Z`);

/** "YYYY-MM" → primeiro dia do mês SEGUINTE (limite exclusivo da consulta). */
const inicioDoMesSeguinte = (month: string): Date => {
  const ano = Number(month.substring(0, 4));
  const mes = Number(month.substring(5, 7));
  return mes === 12 ? new Date(Date.UTC(ano + 1, 0, 1)) : new Date(Date.UTC(ano, mes, 1));
};

const mesDeDate = (d: Date): string => d.toISOString().substring(0, 7);

// ── Escopo de unidades ────────────────────────────────────────────────────────

/**
 * Unidades que este usuário pode extrair.
 *
 * O gestor fica restrito às unidades vinculadas a ele (`unidadeCodigos` do JWT);
 * controladoria e administração alcançam todas as ativas. Uma unidade pedida
 * fora do escopo é descartada silenciosamente — o filtro nunca amplia o acesso.
 */
export const resolverUnidadesAutorizadas = async (
  perfil:          string,
  unidadesDoToken: ReadonlyArray<string>,
  pedidas?:        ReadonlyArray<string>
): Promise<string[]> => {
  const escopo = perfil === ROLES.GESTOR
    ? [...unidadesDoToken]
    : (
        await prisma.unidadeVenda.findMany({
          where:  { ativo: true },
          select: { codigo: true },
        })
      ).map((u) => u.codigo);

  if (!pedidas || pedidas.length === 0) return escopo;

  const permitidas = new Set(escopo);
  return pedidas.filter((u) => permitidas.has(u));
};

// ── Consulta ──────────────────────────────────────────────────────────────────

/**
 * Filtro de família. "Outros" representa `familia = null`, por isso pode virar
 * um OR — selecionar "Outros" junto de famílias nomeadas traz os dois casos.
 */
const whereFamilia = (familias: ReadonlyArray<string> | undefined) => {
  if (!familias || familias.length === 0) return {};

  const nomeadas       = familias.filter((f) => f !== SEM_FAMILIA);
  const incluiSemNome  = nomeadas.length !== familias.length;

  if (incluiSemNome && nomeadas.length > 0) {
    return { OR: [{ familia: { in: [...nomeadas] } }, { familia: null }] };
  }
  if (incluiSemNome) return { familia: null };
  return { familia: { in: [...nomeadas] } };
};

export const buscarLinhas = async (params: ExtracaoParams): Promise<LinhaExtracao[]> => {
  const where = {
    unidadeVendaId: { in: [...params.unidades] },
    refMonth: {
      gte: inicioDoMes(params.startMonth),
      lt:  inicioDoMesSeguinte(params.endMonth),
    },
    ...whereFamilia(params.familias),
    ...(params.produtos && params.produtos.length > 0
      ? { produtoId: { in: [...params.produtos] } }
      : {}),
  };

  // Conta antes de materializar: recusar cedo é melhor que estourar memória.
  const total = await prisma.consolidadoProdutoMesSnapshot.count({ where });
  if (total > MAX_LINHAS) throw new ExtracaoMuitoGrandeError(total);

  const [rows, unidades] = await Promise.all([
    prisma.consolidadoProdutoMesSnapshot.findMany({
      where,
      select: {
        unidadeVendaId:   true,
        produtoCodigo:    true,
        produtoDescricao: true,
        familia:          true,
        classe:           true,
        refMonth:         true,
        orc:              true,
        fcts:             true,
        vendas:           true,
      },
    }),
    prisma.unidadeVenda.findMany({
      where:  { codigo: { in: [...params.unidades] } },
      select: { codigo: true, descricao: true },
    }),
  ]);

  const descricaoPorUnidade = new Map(unidades.map((u) => [u.codigo, u.descricao]));

  // Nível família agrega produtos; nível produto mantém o grão do snapshot.
  const agregado = new Map<string, LinhaExtracao>();

  for (const row of rows) {
    const mes     = mesDeDate(row.refMonth);
    const familia = row.familia?.trim() || SEM_FAMILIA;
    const chave   = params.nivel === "familia"
      ? `${row.unidadeVendaId}|${familia}|${mes}`
      : `${row.unidadeVendaId}|${row.produtoCodigo}|${mes}`;

    const atual = agregado.get(chave);
    if (atual) {
      atual.orc    += row.orc;
      atual.fcts   += row.fcts;
      atual.vendas += row.vendas;
      continue;
    }

    agregado.set(chave, {
      unidadeVendaId:   row.unidadeVendaId,
      unidadeDescricao: descricaoPorUnidade.get(row.unidadeVendaId) ?? "",
      familia,
      produtoCodigo:    params.nivel === "familia" ? "" : row.produtoCodigo,
      produtoDescricao: params.nivel === "familia" ? "" : row.produtoDescricao,
      classe:           params.nivel === "familia" ? "" : (row.classe ?? ""),
      mes,
      orc:              row.orc,
      fcts:             row.fcts,
      vendas:           row.vendas,
    });
  }

  return [...agregado.values()].sort(
    (a, b) =>
      a.unidadeVendaId.localeCompare(b.unidadeVendaId, "pt-BR") ||
      a.familia.localeCompare(b.familia, "pt-BR") ||
      a.produtoCodigo.localeCompare(b.produtoCodigo, "pt-BR") ||
      a.mes.localeCompare(b.mes)
  );
};

// ── Geração do CSV ────────────────────────────────────────────────────────────

const valorMetrica = (linha: LinhaExtracao, metrica: Metrica): number => {
  switch (metrica) {
    case "orc":              return linha.orc;
    case "fcts":             return linha.fcts;
    case "vendas":           return linha.vendas;
    case "desvioFctsOrc":    return linha.fcts - linha.orc;
    case "desvioVendasFcts": return linha.vendas - linha.fcts;
  }
};

/**
 * Escapa um campo para CSV com separador `;`.
 *
 * Descrição de produto com `;` (ou aspas, ou quebra de linha) quebraria as
 * colunas no Excel — daí o envelopamento em aspas com duplicação interna.
 */
const csvCampo = (valor: string): string =>
  /[";\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;

/**
 * Monta o CSV.
 *
 * Separador `;` e BOM UTF-8: é o par que faz o Excel em pt-BR abrir o arquivo
 * com as colunas separadas e os acentos corretos, sem passar pelo assistente de
 * importação. Volumes são inteiros, então não há conflito de vírgula decimal.
 */
export const gerarCsv = (
  linhas:   ReadonlyArray<LinhaExtracao>,
  metricas: ReadonlyArray<Metrica>,
  nivel:    Nivel
): string => {
  const colunasBase = nivel === "familia"
    ? ["Unidade", "Descrição da unidade", "Família", "Mês"]
    : ["Unidade", "Descrição da unidade", "Família", "Produto", "Descrição do produto", "Classe", "Mês"];

  const cabecalho = [...colunasBase, ...metricas.map((m) => METRICA_LABEL[m])];

  const corpo = linhas.map((linha) => {
    const base = nivel === "familia"
      ? [linha.unidadeVendaId, linha.unidadeDescricao, linha.familia, linha.mes]
      : [
          linha.unidadeVendaId,
          linha.unidadeDescricao,
          linha.familia,
          linha.produtoCodigo,
          linha.produtoDescricao,
          linha.classe,
          linha.mes,
        ];

    return [...base.map(csvCampo), ...metricas.map((m) => String(valorMetrica(linha, m)))].join(";");
  });

  const BOM = "\uFEFF";   // Excel pt-BR precisa do BOM para ler UTF-8
  return BOM + [cabecalho.map(csvCampo).join(";"), ...corpo].join("\r\n") + "\r\n";
};

export const nomeArquivo = (params: ExtracaoParams): string =>
  `forecast_${params.nivel}_${params.startMonth}_a_${params.endMonth}.csv`;

// ── Filtros disponíveis (alimenta o modal) ────────────────────────────────────

export type FiltrosDisponiveis = {
  unidades: Array<{ codigo: string; descricao: string }>;
  familias: string[];
  produtos: Array<{ codigo: string; descricao: string; familia: string }>;
  /** Intervalo com dados no snapshot; null quando não há nenhuma linha. */
  periodo:  { min: string; max: string } | null;   // "YYYY-MM"
};

/**
 * Famílias e produtos que o modal oferece.
 *
 * A fonte é o próprio snapshot, não o cadastro (`ProdutoUnidadeVenda`), por um
 * motivo prático: o cadastro tem milhares de vínculos sem nenhum dado de
 * ORC/FCTS/Vendas, e oferecê-los produziria filtros que só retornam "nenhum dado
 * encontrado". Aqui, toda opção listada tem pelo menos uma linha extraível.
 */
export const listarFiltros = async (
  unidadesAutorizadas: ReadonlyArray<string>
): Promise<FiltrosDisponiveis> => {
  const escopo = { unidadeVendaId: { in: [...unidadesAutorizadas] } };

  const [unidades, familiaRows, produtoRows, extremos] = await Promise.all([
    prisma.unidadeVenda.findMany({
      where:   { codigo: { in: [...unidadesAutorizadas] } },
      select:  { codigo: true, descricao: true },
      orderBy: { codigo: "asc" },
    }),
    prisma.consolidadoProdutoMesSnapshot.findMany({
      where:    escopo,
      select:   { familia: true },
      distinct: ["familia"],
    }),
    prisma.consolidadoProdutoMesSnapshot.findMany({
      where:    escopo,
      select:   { produtoCodigo: true, produtoDescricao: true, familia: true },
      distinct: ["produtoCodigo"],
      orderBy:  { produtoCodigo: "asc" },
    }),
    // Extremos com dados: o seletor de período do modal só oferece esses anos,
    // evitando que o usuário monte um intervalo que devolveria arquivo vazio.
    prisma.consolidadoProdutoMesSnapshot.aggregate({
      where: escopo,
      _min:  { refMonth: true },
      _max:  { refMonth: true },
    }),
  ]);

  const familias = new Set<string>();
  for (const row of familiaRows) familias.add(row.familia?.trim() || SEM_FAMILIA);

  const min = extremos._min.refMonth;
  const max = extremos._max.refMonth;

  return {
    unidades,
    familias: [...familias].sort((a, b) => a.localeCompare(b, "pt-BR")),
    produtos: produtoRows.map((p) => ({
      codigo:    p.produtoCodigo,
      descricao: p.produtoDescricao,
      familia:   p.familia?.trim() || SEM_FAMILIA,
    })),
    periodo: min && max ? { min: mesDeDate(min), max: mesDeDate(max) } : null,
  };
};
