import prisma from "../config/prisma.js";
import * as ForecastService from "./forecast.service.js";

// ── getSalesData ───────────────────────────────────────────────────────────

/**
 * Retorna dados de VendaMensal dos últimos `months` meses, filtrando apenas
 * pares (produto, unidade) com venda nos últimos `activeMonths` meses.
 *
 * Inclui o campo `canal` para que a DAG possa agregar VENDA DIRETA +
 * DISTRIBUIDOR antes de treinar os modelos.
 *
 * O formato de retorno usa os mesmos nomes de coluna esperados pelo motor
 * de previsão da DAG (espelho do formato histórico do previsao.py).
 */
export const getSalesData = async (months = 36, activeMonths = 12) => {
  const now      = new Date();
  const corteAtivo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - activeMonths, 1)
  );
  const corteHistorico = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1)
  );

  // 1. Descobre pares (produto, unidade) com venda nos últimos `activeMonths` meses
  const pairesAtivos = await prisma.vendaMensal.findMany({
    where:  { month: { gte: corteAtivo } },
    select: { produtoId: true, unidadeVendaId: true },
    distinct: ["produtoId", "unidadeVendaId"],
  });

  if (pairesAtivos.length === 0) return [];

  // 2. Indexa por unidade para enriquecer com metadados
  const unidadeIds = [...new Set(pairesAtivos.map((p) => p.unidadeVendaId))];
  const unidades = await prisma.unidadeVenda.findMany({
    where:  { codigo: { in: unidadeIds } },
    select: { codigo: true, descricao: true },
  });
  const unidadeMap = new Map(unidades.map((u) => [u.codigo, u.descricao]));

  // 3. Busca histórico dos últimos `months` meses para os pares ativos
  const vendas = await prisma.vendaMensal.findMany({
    where: {
      month:          { gte: corteHistorico },
      OR: pairesAtivos.map((p) => ({
        produtoId:      p.produtoId,
        unidadeVendaId: p.unidadeVendaId,
      })),
    },
    select: {
      produtoId:      true,
      unidadeVendaId: true,
      month:          true,
      quantidade:     true,
      canal:          true,
      paisIso3:       true,
    },
    orderBy: { month: "asc" },
  });

  // 4. Formata para o motor de previsão da DAG
  return vendas.map((v) => ({
    "Codigo ClasseValor": v.unidadeVendaId,
    "Classe Valor":       unidadeMap.get(v.unidadeVendaId) ?? v.unidadeVendaId,
    "Codigo Produto":     v.produtoId,
    "canal":              v.canal,
    "paisIso3":           v.paisIso3 ?? null,
    "Data":               `${String(v.month.getUTCMonth() + 1).padStart(2, "0")}/${v.month.getUTCFullYear()}`,
    "Quantidade":         v.quantidade,
  }));
};

// ── getSalesDataByCycle ────────────────────────────────────────────────────

/**
 * Retorna dados de VendaMensal dos últimos `months` meses filtrando apenas
 * pares (produto, unidade, paisIso3) presentes no ForecastRun do ciclo
 * `prevRefMonth` com gestorExcluido = false.
 *
 * Retorna `null` quando não há ForecastRun com status SUCCESS para esse mês,
 * sinalizando ao controller que deve usar o fallback `getSalesData`.
 */
export const getSalesDataByCycle = async (prevRefMonth: string, months = 36) => {
  const refDate = new Date(prevRefMonth);
  if (isNaN(refDate.getTime())) return null;

  const run = await prisma.forecastRun.findFirst({
    where:   { refMonth: refDate, status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
  });

  if (!run) return null;

  const pares = await prisma.forecastItem.findMany({
    where:    { runId: run.id, gestorExcluido: false },
    select:   { produtoId: true, unidadeVendaId: true, paisIso3: true },
    distinct: ["produtoId", "unidadeVendaId", "paisIso3"],
  });

  if (pares.length === 0) return [];

  const now = new Date();
  const corteHistorico = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1)
  );

  const unidadeIds = [...new Set(pares.map((p) => p.unidadeVendaId))];
  const unidades = await prisma.unidadeVenda.findMany({
    where:  { codigo: { in: unidadeIds } },
    select: { codigo: true, descricao: true },
  });
  const unidadeMap = new Map(unidades.map((u) => [u.codigo, u.descricao]));

  const vendas = await prisma.vendaMensal.findMany({
    where: {
      month: { gte: corteHistorico },
      OR: pares.map((p) => ({
        produtoId:      p.produtoId,
        unidadeVendaId: p.unidadeVendaId,
      })),
    },
    select: {
      produtoId:      true,
      unidadeVendaId: true,
      month:          true,
      quantidade:     true,
      canal:          true,
      paisIso3:       true,
    },
    orderBy: { month: "asc" },
  });

  return vendas.map((v) => ({
    "Codigo ClasseValor": v.unidadeVendaId,
    "Classe Valor":       unidadeMap.get(v.unidadeVendaId) ?? v.unidadeVendaId,
    "Codigo Produto":     v.produtoId,
    "canal":              v.canal,
    "paisIso3":           v.paisIso3 ?? null,
    "Data":               `${String(v.month.getUTCMonth() + 1).padStart(2, "0")}/${v.month.getUTCFullYear()}`,
    "Quantidade":         v.quantidade,
  }));
};

// ── createForecastRun ──────────────────────────────────────────────────────

/**
 * Cria um novo ForecastRun para o mês de referência.
 *
 * Guard de idempotência: se já existe um run SUCCESS para o mesmo refMonth
 * e o ciclo NÃO está em REPROCESSING, a execução é considerada duplicada.
 * Nesse caso o run existente é retornado sem criar um novo registro,
 * evitando sobreposição de dados e duplicação de ForecastItems.
 *
 * Execuções duplicadas só são permitidas quando `rerunCycle()` foi chamado
 * previamente — ele marca o gate como REPROCESSING e invalida o run antigo
 * (status → FAILED), sinalizando que um novo run é esperado.
 */
export const createForecastRun = async (
  refMonth:       string,
  leadTimeMonths: number,
  triggeredBy:    string
) => {
  const refDate = new Date(refMonth);

  // Verificar se já existe run SUCCESS para este mês
  const existingRun = await prisma.forecastRun.findFirst({
    where:   { refMonth: refDate, status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
  });

  if (existingRun) {
    // Verificar se o ciclo está em REPROCESSING (execução intencional)
    const log = await prisma.cycleReadinessLog.findUnique({
      where:  { refMonth: refDate },
      select: { gate: true },
    });

    if (log?.gate !== "REPROCESSING") {
      // Execução duplicada não intencional — bloquear silenciosamente
      console.warn(
        `[airflow] Run duplicado ignorado para ${refMonth} ` +
        `(gate=${log?.gate ?? "N/A"}, triggeredBy=${triggeredBy}). ` +
        `Retornando run existente ${existingRun.id}.`
      );
      return existingRun;
    }

    // gate = REPROCESSING: rerunCycle() já invalidou o run antigo (FAILED),
    // prosseguir com a criação do novo run normalmente.
    console.log(
      `[airflow] Reprocessamento intencional para ${refMonth} ` +
      `(triggeredBy=${triggeredBy}). Criando novo run.`
    );
  }

  const run = await ForecastService.createRun({
    refMonth,
    status:        "PROCESSING",
    leadTimeMonths,
    sourceKey:     `airflow:${triggeredBy}:${refMonth}`,
  });
  return run;
};

// ── finalizeRun ───────────────────────────────────────────────────────────

export const finalizeRun = async (runId: string) =>
  ForecastService.finalizeRun(runId);

// ── addForecastItems ───────────────────────────────────────────────────────

export const addForecastItems = async (
  runId: string,
  items: Array<{
    produtoId:      string;
    unidadeVendaId: string;
    month:          string;
    volumeIA?:      number;
    paisIso3?:      string | null;
  }>
) => {
  return ForecastService.createItems(runId, items);
};
