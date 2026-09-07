import { randomUUID } from "crypto";
import { SubmissionStatus } from "@prisma/client";
import prisma from "../config/prisma.js";
import { promoteToReady } from "./cycle-readiness.service.js";
import { appCache } from "../utils/cache.js";
import * as SnapshotService from "./snapshot.service.js";
import { createForRole, createForUser } from "./notification.service.js";
import { logAudit } from "./audit.service.js";

async function getUserSnapshot(userId: string): Promise<{ nome: string | null; perfil: string | null }> {
  const u = await prisma.user.findUnique({
    where:  { id: userId },
    select: { nome: true, perfil: true },
  });
  return { nome: u?.nome ?? null, perfil: u?.perfil ? String(u.perfil) : null };
}

const PT_MONTHS = [
  "janeiro","fevereiro","março","abril","maio","junho",
  "julho","agosto","setembro","outubro","novembro","dezembro",
];

function monthLabel(date: Date): string {
  return `${PT_MONTHS[date.getUTCMonth()]}/${date.getUTCFullYear()}`;
}

const includeRelations = {
  unidadeVenda: true,
  autor: { select: { id: true, nome: true, email: true } },
  revisor: { select: { id: true, nome: true, email: true } },
};

export const list = async (filters?: {
  status?: SubmissionStatus;
  unidadeVendaId?: string;
  autorId?: string;
}) => {
  return prisma.divisionSubmission.findMany({
    where: {
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.unidadeVendaId ? { unidadeVendaId: filters.unidadeVendaId } : {}),
      ...(filters?.autorId ? { autorId: filters.autorId } : {}),
    },
    include: includeRelations,
    orderBy: { updatedAt: "desc" },
  });
};

export const pendingCount = async () => {
  return prisma.divisionSubmission.count({ where: { status: "SUBMITTED" } });
};

export const getOrCreate = async (
  unidadeVendaId: string,
  refMonth: string,
  autorId: string
) => {
  const refDate = new Date(refMonth);

  return prisma.divisionSubmission.upsert({
    where: { refMonth_unidadeVendaId: { refMonth: refDate, unidadeVendaId } },
    create: { unidadeVendaId, refMonth: refDate, autorId, status: "DRAFT" },
    update: {},
    include: includeRelations,
  });
};

export const submit = async (id: string, autorId: string) => {
  const userSnap = await getUserSnapshot(autorId);
  const previous = await prisma.divisionSubmission.findUnique({ where: { id }, select: { status: true } });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.divisionSubmission.update({
      where: { id },
      data: { status: "SUBMITTED", submittedAt: new Date(), autoSubmitted: false },
      include: includeRelations,
    });

    await logAudit(tx, {
      userId:     autorId,
      userNome:   userSnap.nome,
      userPerfil: userSnap.perfil,
      source:     "user",
      action:     "STATE_CHANGE",
      entity:     "DivisionSubmission",
      entityId:   id,
      refMonth:   updated.refMonth.toISOString().substring(0, 7),
      unidadeId:  updated.unidadeVendaId,
      before:     { status: previous?.status ?? null },
      after:      { status: "SUBMITTED", submittedAt: updated.submittedAt },
      metadata:   { operation: "SUBMIT_CYCLE" },
    });

    return updated;
  });

  appCache.invalidateConsolidado();

  // Notifica controladoria e admins sobre nova submissão pendente de aprovação
  const notifTitle = `Forecast submetido — ${result.unidadeVenda?.descricao ?? result.unidadeVendaId}`;
  const notifBody  = `A unidade ${result.unidadeVenda?.descricao ?? result.unidadeVendaId} submeteu o forecast de ${monthLabel(result.refMonth)} para aprovação.`;
  for (const perfil of ["controladoria", "operador_pcp", "admin_ti"] as const) {
    void createForRole(perfil, "SUBMISSION_PENDING", notifTitle, notifBody, result.refMonth)
      .catch(console.error);
  }

  const _submitYear = result.refMonth.getUTCFullYear();
  void SnapshotService.refreshConsolidadoSnapshot(_submitYear,     { affectedUnits: [result.unidadeVendaId] }).catch(err => console.error("[snapshot] refreshConsolidadoSnapshot failed:", err));
  void SnapshotService.refreshConsolidadoSnapshot(_submitYear + 1, { affectedUnits: [result.unidadeVendaId] }).catch(err => console.error("[snapshot] refreshConsolidadoSnapshot year+1 failed:", err));
  return result;
};

export const approve = async (id: string, revisorId: string) => {
  const userSnap = await getUserSnapshot(revisorId);
  const previous = await prisma.divisionSubmission.findUnique({ where: { id }, select: { status: true, unidadeVendaId: true, refMonth: true } });

  // Pre-fetch approved FCTS snapshot for audit (one record per product at approval time)
  type OverrideEntry = { produtoId: string; paisIso3: string | null; totalFCTS: number; itemCount: number };
  const overrideSnapshot: OverrideEntry[] = [];
  if (previous) {
    const run = await prisma.forecastRun.findFirst({
      where:   { refMonth: previous.refMonth, status: "SUCCESS" },
      orderBy: { executedAt: "desc" },
      select:  { id: true },
    });
    if (run) {
      const items = await prisma.forecastItem.findMany({
        where:  { runId: run.id, unidadeVendaId: previous.unidadeVendaId, gestorExcluido: false, overrides: { some: {} } },
        select: { produtoId: true, paisIso3: true, overrides: { select: { volumeFCTS: true }, orderBy: { updatedAt: "desc" }, take: 1 } },
      });
      const productMap = new Map<string, OverrideEntry>();
      for (const fi of items) {
        const key   = `${fi.produtoId}|${fi.paisIso3 ?? ""}`;
        const fcts  = fi.overrides[0]?.volumeFCTS ?? 0;
        const entry = productMap.get(key);
        if (entry) { entry.totalFCTS += fcts; entry.itemCount++; }
        else productMap.set(key, { produtoId: fi.produtoId, paisIso3: fi.paisIso3 ?? null, totalFCTS: fcts, itemCount: 1 });
      }
      overrideSnapshot.push(...productMap.values());
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.divisionSubmission.update({
      where: { id },
      data: { status: "APPROVED", revisorId, reviewedAt: new Date(), rejectionReason: null },
      include: includeRelations,
    });

    await logAudit(tx, {
      userId:     revisorId,
      userNome:   userSnap.nome,
      userPerfil: userSnap.perfil,
      source:     "user",
      action:     "STATE_CHANGE",
      entity:     "DivisionSubmission",
      entityId:   id,
      refMonth:   updated.refMonth.toISOString().substring(0, 7),
      unidadeId:  updated.unidadeVendaId,
      before:     { status: previous?.status ?? null },
      after:      { status: "APPROVED", revisorId, reviewedAt: updated.reviewedAt },
      metadata:   { operation: "APPROVE_SUBMISSION" },
    });

    const correlationId = randomUUID();
    for (const entry of overrideSnapshot) {
      await logAudit(tx, {
        userId:     revisorId,
        userNome:   userSnap.nome,
        userPerfil: userSnap.perfil,
        source:     "user",
        action:     "STATE_CHANGE",
        entity:     "ForecastOverride",
        entityId:   entry.produtoId,
        refMonth:   updated.refMonth.toISOString().substring(0, 7),
        unidadeId:  updated.unidadeVendaId,
        produtoId:  entry.produtoId,
        paisIso3:   entry.paisIso3,
        before:     null,
        after:      { volumeFCTS: entry.totalFCTS },
        metadata:   { operation: "CYCLE_APPROVED", correlationId, affectedCount: entry.itemCount },
      });
    }

    return updated;
  });

  appCache.invalidateConsolidado();
  await advanceAwaitingCycles(result.refMonth);

  // Notifica o gestor autor da submissão
  void createForUser(
    result.autorId,
    "SUBMISSION_APPROVED",
    `Forecast aprovado — ${result.unidadeVenda?.descricao ?? result.unidadeVendaId}`,
    `O forecast de ${monthLabel(result.refMonth)} da unidade ${result.unidadeVenda?.descricao ?? result.unidadeVendaId} foi aprovado.`,
    result.refMonth
  ).catch(console.error);

  // Notifica admin_ti quando todas as submissões do ciclo estiverem aprovadas
  void notifyIfFullyApproved(result.refMonth).catch(console.error);

  const _approveYear = result.refMonth.getUTCFullYear();
  void SnapshotService.refreshConsolidadoSnapshot(_approveYear,     { affectedUnits: [result.unidadeVendaId] }).catch(err => console.error("[snapshot] refreshConsolidadoSnapshot failed:", err));
  void SnapshotService.refreshConsolidadoSnapshot(_approveYear + 1, { affectedUnits: [result.unidadeVendaId] }).catch(err => console.error("[snapshot] refreshConsolidadoSnapshot year+1 failed:", err));
  void SnapshotService.refreshAcuraciaSnapshot()
    .catch(err => console.error("[snapshot] refreshAcuraciaSnapshot failed:", err));
  return result;
};

export const reject = async (id: string, revisorId: string, reason: string) => {
  const userSnap = await getUserSnapshot(revisorId);
  const previous = await prisma.divisionSubmission.findUnique({ where: { id }, select: { status: true } });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.divisionSubmission.update({
      where: { id },
      data: { status: "REJECTED", revisorId, reviewedAt: new Date(), rejectionReason: reason },
      include: includeRelations,
    });

    await logAudit(tx, {
      userId:     revisorId,
      userNome:   userSnap.nome,
      userPerfil: userSnap.perfil,
      source:     "user",
      action:     "STATE_CHANGE",
      entity:     "DivisionSubmission",
      entityId:   id,
      refMonth:   updated.refMonth.toISOString().substring(0, 7),
      unidadeId:  updated.unidadeVendaId,
      before:     { status: previous?.status ?? null },
      after:      { status: "REJECTED", revisorId, reviewedAt: updated.reviewedAt, rejectionReason: reason },
      metadata:   { operation: "REJECT_SUBMISSION" },
    });

    return updated;
  });

  appCache.invalidateConsolidado();
  await advanceAwaitingCycles(result.refMonth);

  // Notifica o gestor autor da submissão
  void createForUser(
    result.autorId,
    "SUBMISSION_REJECTED",
    `Forecast reprovado — ${result.unidadeVenda?.descricao ?? result.unidadeVendaId}`,
    `O forecast de ${monthLabel(result.refMonth)} da unidade ${result.unidadeVenda?.descricao ?? result.unidadeVendaId} foi reprovado${reason ? `: ${reason}` : "."}`,
    result.refMonth
  ).catch(console.error);
  const _rejectYear = result.refMonth.getUTCFullYear();
  void SnapshotService.refreshConsolidadoSnapshot(_rejectYear,     { affectedUnits: [result.unidadeVendaId] }).catch(err => console.error("[snapshot] refreshConsolidadoSnapshot failed:", err));
  void SnapshotService.refreshConsolidadoSnapshot(_rejectYear + 1, { affectedUnits: [result.unidadeVendaId] }).catch(err => console.error("[snapshot] refreshConsolidadoSnapshot year+1 failed:", err));
  return result;
};

/**
 * Notifica admin_ti quando todas as submissões do ciclo estão aprovadas (nenhuma em aberto).
 * O admin_ti poderá então acionar o envio ao Protheus manualmente via painel.
 */
async function notifyIfFullyApproved(refMonth: Date) {
  const [stillOpen, approvedCount, totalActiveUnidades] = await Promise.all([
    prisma.divisionSubmission.count({
      where: { refMonth, status: { in: ["DRAFT", "SUBMITTED"] } },
    }),
    prisma.divisionSubmission.count({
      where: { refMonth, status: "APPROVED" },
    }),
    prisma.unidadeVenda.count({ where: { ativo: true } }),
  ]);

  // Só dispara quando TODAS as unidades ativas têm uma submissão aprovada.
  // Unidades sem registro (gestor nunca abriu o forecast) também impedem o disparo.
  if (stillOpen === 0 && approvedCount > 0 && approvedCount >= totalActiveUnidades) {
    const title = `Forecast de ${monthLabel(refMonth)} totalmente aprovado`;
    const body  = `Todas as ${approvedCount} submissão(ões) do ciclo foram aprovadas. O forecast está pronto para ser enviado ao Protheus.`;
    for (const perfil of ["admin_ti", "operador_pcp"] as const) {
      await createForRole(perfil, "CYCLE_FULLY_APPROVED", title, body, refMonth);
    }
  }
}

/**
 * Verifica se o ciclo seguinte ao `refMonth` está em AWAITING_PREV_CLOSE.
 * Se sim, e se não há mais submissões abertas em `refMonth`, promove o próximo ciclo para READY.
 */
async function advanceAwaitingCycles(refMonth: Date) {
  const nextRef = new Date(Date.UTC(refMonth.getUTCFullYear(), refMonth.getUTCMonth() + 1, 1));

  const awaitingLog = await prisma.cycleReadinessLog.findFirst({
    where: { refMonth: nextRef, gate: "AWAITING_PREV_CLOSE" },
  });
  if (!awaitingLog) return;

  const stillOpen = await prisma.divisionSubmission.count({
    where: { refMonth, status: { in: ["DRAFT", "SUBMITTED"] } },
  });
  if (stillOpen === 0) {
    await promoteToReady(nextRef);
  }
}

export const findByUnitAndMonth = async (
  unidadeVendaId: string,
  refMonth: string
) => {
  return prisma.divisionSubmission.findUnique({
    where: {
      refMonth_unidadeVendaId: {
        refMonth: new Date(refMonth),
        unidadeVendaId,
      },
    },
    include: includeRelations,
  });
};

export const getPreview = async (submissionId: string) => {
  const submission = await prisma.divisionSubmission.findUnique({
    where: { id: submissionId },
    select: { unidadeVendaId: true, refMonth: true },
  });

  if (!submission) return null;

  const run = await prisma.forecastRun.findFirst({
    where: { refMonth: submission.refMonth, status: "SUCCESS" },
    orderBy: { createdAt: "desc" },
    select: { id: true, windowStart: true, leadTimeMonths: true },
  });

  if (!run) return { months: [], topDesvios: [], resumo: { totalORC: 0, totalFCTS: 0, desvio: 0 } };

  // Janela válida: apenas meses que o gestor pode visualizar e editar
  const windowStart = run.windowStart ?? new Date(
    Date.UTC(
      submission.refMonth.getUTCFullYear(),
      submission.refMonth.getUTCMonth() + (run.leadTimeMonths ?? 2),
      1
    )
  );

  const forecastItems = await prisma.forecastItem.findMany({
    where: {
      runId: run.id,
      unidadeVendaId: submission.unidadeVendaId,
      gestorExcluido: false,
      month: { gte: windowStart },
    },
    include: {
      produto: {
        select: {
          codigo: true,
          descricao: true,
          classe: true,
          unidades: {
            where: { unidadeVendaId: submission.unidadeVendaId },
            select: { familia: true },
          },
        },
      },
      overrides: { orderBy: { updatedAt: "desc" }, take: 1 },
    },
    orderBy: { month: "asc" },
  });

  const isExport = forecastItems.some((fi) => fi.paisIso3 !== null);

  // Buscar ORC real do OrcamentoItem (fonte canônica) para todos os produtos/meses do run.
  // Para unidades NACIONAL: paisIso3 é null. Para EXPORT: cada ForecastItem tem seu paisIso3.
  // A chave do mapa inclui paisIso3 para diferenciar corretamente entre países.
  const produtoIds   = [...new Set(forecastItems.map((fi) => fi.produtoId))];
  const mesesDoRun   = [...new Set(forecastItems.map((fi) => fi.month.toISOString()))];
  const paisIso3sDoRun = [...new Set(forecastItems.map((fi) => fi.paisIso3))];
  const orcItems = produtoIds.length > 0
    ? await prisma.orcamentoItem.findMany({
        where: {
          unidadeVendaId: submission.unidadeVendaId,
          produtoId:      { in: produtoIds },
          month:          { in: mesesDoRun.map((m) => new Date(m)) },
          ...(paisIso3sDoRun.some(p => p !== null)
            ? {}                     // EXPORT: busca todos os países sem filtro
            : { paisIso3: null }),   // NACIONAL: só ORC sem país
        },
        select: { produtoId: true, paisIso3: true, month: true, volumeORC: true },
      })
    : [];

  const orcMap = new Map<string, number>();
  for (const o of orcItems) {
    const key = `${o.produtoId}|${o.paisIso3 ?? ""}|${o.month.toISOString().substring(0, 7)}`;
    orcMap.set(key, (orcMap.get(key) ?? 0) + o.volumeORC);
  }

  // ── prevFctsTotal + prevFctsByMonth + prevFctsByProduto ─────────────────
  // IMPORTANTE: Este bloco deve estar ANTES de `months` para que prevFctsByMonth
  // esteja disponível quando os months forem construídos.
  const prevRefMonth = new Date(
    Date.UTC(submission.refMonth.getUTCFullYear(), submission.refMonth.getUTCMonth() - 1, 1)
  );
  const prevRun = await prisma.forecastRun.findFirst({
    where: { refMonth: prevRefMonth, status: "SUCCESS" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  let prevFctsTotal = 0;
  const prevFctsByMonth          = new Map<string, number>(); // YYYY-MM → total unidade
  const prevFctsByProduto        = new Map<string, number>(); // produtoId → total anual
  const prevFctsByProdutoMes     = new Map<string, number>(); // produtoId|YYYY-MM → fcts
  const prevFctsByPaisFamProd    = new Map<string, number>(); // paisIso3|familia|produtoId → total
  const prevFctsByPaisFamProdMes = new Map<string, number>(); // paisIso3|familia|produtoId|YYYY-MM → fcts

  if (prevRun) {
    const prevItems = await prisma.forecastItem.findMany({
      where: { runId: prevRun.id, unidadeVendaId: submission.unidadeVendaId, gestorExcluido: false, month: { gte: windowStart } },
      include: {
        overrides: { take: 1, orderBy: { updatedAt: "desc" } },
        produto: {
          select: {
            unidades: {
              where: { unidadeVendaId: submission.unidadeVendaId },
              select: { familia: true },
            },
          },
        },
      },
    });
    for (const i of prevItems) {
      const mk   = i.month.toISOString().substring(0, 7);
      const fcts = i.overrides[0]?.volumeFCTS ?? 0;
      prevFctsTotal += fcts;
      prevFctsByMonth.set(mk, (prevFctsByMonth.get(mk) ?? 0) + fcts);
      prevFctsByProduto.set(i.produtoId, (prevFctsByProduto.get(i.produtoId) ?? 0) + fcts);
      prevFctsByProdutoMes.set(`${i.produtoId}|${mk}`, (prevFctsByProdutoMes.get(`${i.produtoId}|${mk}`) ?? 0) + fcts);

      if (i.paisIso3) {
        const familia = i.produto.unidades[0]?.familia ?? "Outros";
        const pk = `${i.paisIso3}|${familia}|${i.produtoId}`;
        prevFctsByPaisFamProd.set(pk, (prevFctsByPaisFamProd.get(pk) ?? 0) + fcts);
        prevFctsByPaisFamProdMes.set(`${pk}|${mk}`, fcts);
      }
    }
  }

  // Agrupar por mês alvo
  const monthMap = new Map<string, { totalORC: number; totalFCTS: number }>();
  const itemDesvios: Array<{
    codigo: string; descricao: string; familia: string; paisIso3: string | null;
    targetMonth: string; volumeORC: number; volumeFCTS: number; desvio: number;
  }> = [];

  type ProdRow = {
    codigo: string; descricao: string; classe: string | null; familia: string;
    orcTotal: number; fctsTotal: number; prevFctsTotal: number;
    meses: Array<{ month: string; orc: number; fcts: number; prevFcts: number }>;
  };
  const famMap        = new Map<string, Map<string, ProdRow>>();
  // paisIso3 → familia → produtoId → ProdRow
  const paisFamProdMap = new Map<string, Map<string, Map<string, ProdRow>>>();

  for (const fi of forecastItems) {
    const monthKey = fi.month.toISOString().substring(0, 7);
    const orc  = orcMap.get(`${fi.produtoId}|${fi.paisIso3 ?? ""}|${monthKey}`) ?? 0;
    // Para KPIs de resumo: override explícito ?? FCTS do ciclo anterior (produto não alterado
    // mantém o valor comprometido no ciclo anterior). Não usa volumeIA — apenas valores
    // confirmados por gestores.
    const prevFctsForItem = prevFctsByProdutoMes.get(`${fi.produtoId}|${monthKey}`) ?? 0;
    const fctsKpi      = fi.overrides[0]?.volumeFCTS ?? prevFctsForItem;
    // Para detalhes de produto / detecção de alterações: override-only (0 se não revisado).
    const fctsOverride = fi.overrides[0]?.volumeFCTS ?? 0;
    const familia = fi.produto.unidades[0]?.familia ?? "Outros";

    if (!monthMap.has(monthKey)) monthMap.set(monthKey, { totalORC: 0, totalFCTS: 0 });
    const entry = monthMap.get(monthKey)!;
    entry.totalORC  += orc;
    entry.totalFCTS += fctsKpi;

    // Acumula por família → produto (para familiaDetalhe)
    if (!famMap.has(familia)) famMap.set(familia, new Map());
    const famProds = famMap.get(familia)!;
    if (!famProds.has(fi.produtoId)) {
      famProds.set(fi.produtoId, {
        codigo:       fi.produto.codigo,
        descricao:    fi.produto.descricao,
        classe:       fi.produto.classe ?? null,
        familia,
        orcTotal:     0,
        fctsTotal:    0,
        prevFctsTotal: 0,
        meses:        [],
      });
    }
    const prod = famProds.get(fi.produtoId)!;
    prod.orcTotal  += orc;
    prod.fctsTotal += fctsOverride;
    // Agrega meses sem duplicar por país (fix para unidades EXPORT)
    const existingMesFam = prod.meses.find((m) => m.month === monthKey);
    if (existingMesFam) { existingMesFam.orc += orc; existingMesFam.fcts += fctsOverride; }
    else prod.meses.push({ month: monthKey, orc, fcts: fctsOverride, prevFcts: 0 });

    // paisFamProdMap: apenas para EXPORT
    if (fi.paisIso3) {
      if (!paisFamProdMap.has(fi.paisIso3)) paisFamProdMap.set(fi.paisIso3, new Map());
      const famProdMapEntry = paisFamProdMap.get(fi.paisIso3)!;
      if (!famProdMapEntry.has(familia)) famProdMapEntry.set(familia, new Map());
      const prodsMap = famProdMapEntry.get(familia)!;
      if (!prodsMap.has(fi.produtoId)) {
        prodsMap.set(fi.produtoId, {
          codigo:        fi.produto.codigo,
          descricao:     fi.produto.descricao,
          classe:        fi.produto.classe ?? null,
          familia,
          orcTotal:      0,
          fctsTotal:     0,
          prevFctsTotal: 0,
          meses:         [],
        });
      }
      const pprod = prodsMap.get(fi.produtoId)!;
      pprod.orcTotal  += orc;
      pprod.fctsTotal += fctsOverride;
      const existingMesPais = pprod.meses.find((m) => m.month === monthKey);
      if (existingMesPais) { existingMesPais.orc += orc; existingMesPais.fcts += fctsOverride; }
      else pprod.meses.push({ month: monthKey, orc, fcts: fctsOverride, prevFcts: 0 });
    }

    if (orc > 0 && fctsOverride > 0) {
      const desvio = ((fctsOverride / orc) - 1) * 100;
      if (Math.abs(desvio) > 15) {
        itemDesvios.push({
          codigo:     fi.produto.codigo,
          descricao:  fi.produto.descricao,
          familia,
          paisIso3:   fi.paisIso3 ?? null,
          targetMonth: monthKey,
          volumeORC:  orc,
          volumeFCTS: fctsOverride,
          desvio:     parseFloat(desvio.toFixed(1)),
        });
      }
    }
  }

  const months = [...monthMap.entries()].map(([targetMonth, { totalORC, totalFCTS }]) => ({
    targetMonth,
    totalORC,
    totalFCTS,
    prevFcts: prevFctsByMonth.get(targetMonth) ?? 0,
    desvio: totalORC > 0 && totalFCTS > 0
      ? parseFloat((((totalFCTS / totalORC) - 1) * 100).toFixed(1))
      : 0,
  }));

  // Considerar apenas meses com ORC > 0 (dentro do ano orçamentário) E FCTS > 0.
  // Isso garante que meses de 2027 sem ORC não inflem o FCTS total nem distorçam o delta.
  const filledMonths  = months.filter((m) => m.totalFCTS > 0 && m.totalORC > 0);
  const resumoORC     = filledMonths.reduce((s, m) => s + m.totalORC,  0);
  const resumoFCTS    = filledMonths.reduce((s, m) => s + m.totalFCTS, 0);
  // prevFctsTotal escopado aos mesmos meses para que o delta seja comparável.
  const prevFctsTotalScoped = filledMonths.reduce(
    (s, m) => s + (prevFctsByMonth.get(m.targetMonth) ?? 0), 0
  );

  const topDesvios = itemDesvios
    .sort((a, b) => Math.abs(b.desvio) - Math.abs(a.desvio))
    .slice(0, 5);

  // Preencher prevFctsTotal e prevFcts por mês em cada produto do famMap
  for (const [, prods] of famMap) {
    for (const [produtoId, prod] of prods) {
      prod.prevFctsTotal = prevFctsByProduto.get(produtoId) ?? 0;
      for (const m of prod.meses) {
        m.prevFcts = prevFctsByProdutoMes.get(`${produtoId}|${m.month}`) ?? 0;
      }
      prod.meses.sort((a, b) => a.month.localeCompare(b.month));
    }
  }

  // Preencher prevFcts por país+família+produto e construir paisDetalhe
  type FamiliaPaisDetalhe = {
    familia:       string;
    orcTotal:      number;
    fctsTotal:     number;
    prevFctsTotal: number;
    desvioORC:     number;
    deltaVsAnt:    number | null;
    produtos:      ProdRow[];
  };
  type PaisDetalheEntry = {
    paisIso3:      string;
    paisNome:      string;
    orcTotal:      number;
    fctsTotal:     number;
    prevFctsTotal: number;
    desvioORC:     number;
    deltaVsAnt:    number | null;
    semFcts:       boolean;
    familias:      FamiliaPaisDetalhe[];
  };

  let paisDetalhe: PaisDetalheEntry[] = [];

  if (isExport && paisFamProdMap.size > 0) {
    // Preenche prevFcts nos produtos de paisFamProdMap
    for (const [paisIso3, famProdMapEntry] of paisFamProdMap) {
      for (const [familia, prodsMap] of famProdMapEntry) {
        for (const [produtoId, prod] of prodsMap) {
          const pk = `${paisIso3}|${familia}|${produtoId}`;
          prod.prevFctsTotal = prevFctsByPaisFamProd.get(pk) ?? 0;
          for (const m of prod.meses) {
            m.prevFcts = prevFctsByPaisFamProdMes.get(`${pk}|${m.month}`) ?? 0;
          }
          prod.meses.sort((a, b) => a.month.localeCompare(b.month));
        }
      }
    }

    // Busca nomes dos países
    const paisNomesRows = await prisma.pais.findMany({
      where:  { iso3: { in: [...paisFamProdMap.keys()] } },
      select: { iso3: true, nome: true },
    });
    const nomeMap = new Map(paisNomesRows.map((p) => [p.iso3, p.nome]));

    paisDetalhe = [...paisFamProdMap.entries()]
      .map(([paisIso3, famProdMapEntry]) => {
        // Totais do país (todos os produtos, inclusive os sem alteração)
        const allProds = [...famProdMapEntry.values()].flatMap((m) => [...m.values()]);
        const orcTotal      = allProds.reduce((s, p) => s + p.orcTotal,      0);
        const fctsTotal     = allProds.reduce((s, p) => s + p.fctsTotal,     0);
        const prevFctsTotal = allProds.reduce((s, p) => s + p.prevFctsTotal, 0);
        const desvioORC     = orcTotal > 0 ? parseFloat(((fctsTotal / orcTotal - 1) * 100).toFixed(1)) : 0;
        const deltaVsAnt    = prevFctsTotal > 0 ? parseFloat(((fctsTotal / prevFctsTotal - 1) * 100).toFixed(1)) : null;

        // Famílias — apenas produtos com alteração vs ciclo anterior
        const familias: FamiliaPaisDetalhe[] = [...famProdMapEntry.entries()]
          .map(([familia, prodsMap]) => {
            const todosProds = [...prodsMap.values()];
            const produtos = todosProds
              .filter((p) =>
                (p.prevFctsTotal > 0 && p.fctsTotal !== p.prevFctsTotal) ||
                (p.prevFctsTotal === 0 && p.fctsTotal > 0)
              )
              .sort((a, b) => {
                const da = a.orcTotal > 0 ? Math.abs((a.fctsTotal / a.orcTotal - 1) * 100) : 0;
                const db = b.orcTotal > 0 ? Math.abs((b.fctsTotal / b.orcTotal - 1) * 100) : 0;
                return db - da;
              });
            if (produtos.length === 0) return null;

            const famOrc      = todosProds.reduce((s, p) => s + p.orcTotal,      0);
            const famFcts     = todosProds.reduce((s, p) => s + p.fctsTotal,     0);
            const famPrevFcts = todosProds.reduce((s, p) => s + p.prevFctsTotal, 0);
            return {
              familia,
              orcTotal:      famOrc,
              fctsTotal:     famFcts,
              prevFctsTotal: famPrevFcts,
              desvioORC:     famOrc > 0 ? parseFloat(((famFcts / famOrc - 1) * 100).toFixed(1)) : 0,
              deltaVsAnt:    famPrevFcts > 0 ? parseFloat(((famFcts / famPrevFcts - 1) * 100).toFixed(1)) : null,
              produtos,
            };
          })
          .filter((f): f is FamiliaPaisDetalhe => f !== null)
          .sort((a, b) => Math.abs(b.desvioORC) - Math.abs(a.desvioORC));

        return { paisIso3, paisNome: nomeMap.get(paisIso3) ?? paisIso3, orcTotal, fctsTotal, prevFctsTotal, desvioORC, deltaVsAnt, semFcts: fctsTotal === 0, familias };
      })
      .filter((p) => p.familias.length > 0 || p.semFcts)
      .sort((a, b) => b.fctsTotal - a.fctsTotal);
  }

  // ── classeAcuracia: lida da AcuraciaSnapshot (WAPE, ciclos aprovados) ─────
  // Mesma fonte e fórmula usadas pelo consolidado — garante consistência de números.
  const acuraciaSnap = await prisma.acuraciaSnapshot.findFirst({
    where:   { unidadeVendaId: submission.unidadeVendaId, meses: 3 },
    orderBy: { anchorMonth: "desc" },
    select:  { acuracia: true, ciclosValidos: true, totalVendas: true },
  });
  const classeAcuracia = acuraciaSnap
    ? [{
        classe:     "Unidade",
        acuracia3M: parseFloat(Number(acuraciaSnap.acuracia).toFixed(1)),
        skuCount:   acuraciaSnap.ciclosValidos,
      }]
    : [];

  // familiaDetalhe: todas as famílias com todos os produtos, ordenadas por maior desvio absoluto
  const familiaDetalhe = [...famMap.entries()]
    .map(([familia, prodsMap]) => {
      const produtos = [...prodsMap.values()].sort((a, b) => {
        const da = a.orcTotal > 0 ? Math.abs((a.fctsTotal / a.orcTotal - 1) * 100) : 0;
        const db = b.orcTotal > 0 ? Math.abs((b.fctsTotal / b.orcTotal - 1) * 100) : 0;
        return db - da;
      });
      const orcTotal      = produtos.reduce((s, p) => s + p.orcTotal,      0);
      const fctsTotal     = produtos.reduce((s, p) => s + p.fctsTotal,     0);
      const prevFctsTotal = produtos.reduce((s, p) => s + p.prevFctsTotal, 0);
      const desvioORC     = orcTotal  > 0 ? parseFloat(((fctsTotal  / orcTotal  - 1) * 100).toFixed(1)) : 0;
      const deltaVsAnt    = prevFctsTotal > 0 ? parseFloat(((fctsTotal / prevFctsTotal - 1) * 100).toFixed(1)) : null;
      return { familia, orcTotal, fctsTotal, prevFctsTotal, desvioORC, deltaVsAnt, produtos };
    })
    .sort((a, b) => Math.abs(b.desvioORC) - Math.abs(a.desvioORC));

  // produtosExcluidos: produtos marcados como gestorExcluido neste ciclo
  // Inclui prevFcts e orcTotal para o analista avaliar o impacto da exclusão
  const orcByProduto = new Map<string, number>();
  for (const [key, val] of orcMap) {
    const produtoId = key.split('|')[0];
    orcByProduto.set(produtoId, (orcByProduto.get(produtoId) ?? 0) + val);
  }

  const excludedItemsRaw = await prisma.forecastItem.findMany({
    where: {
      runId:          run.id,
      unidadeVendaId: submission.unidadeVendaId,
      gestorExcluido: true,
    },
    include: {
      produto: {
        select: {
          codigo: true,
          descricao: true,
          classe: true,
          unidades: {
            where: { unidadeVendaId: submission.unidadeVendaId },
            select: { familia: true },
          },
        },
      },
    },
  });

  // Deduplica por (produtoId, paisIso3): para EXPORT um produto pode estar excluído em múltiplos países
  const seenExcluded = new Set<string>();
  const excludedItems = excludedItemsRaw.filter((ei) => {
    const key = `${ei.produtoId}|${ei.paisIso3 ?? ""}`;
    if (seenExcluded.has(key)) return false;
    seenExcluded.add(key);
    return true;
  });

  // Para EXPORT: ORC e prevFcts granulares por (produto, país)
  const orcByProdutoPais = new Map<string, number>();
  for (const [key, val] of orcMap) {
    const parts = key.split('|');
    const ppKey = `${parts[0]}|${parts[1]}`;
    orcByProdutoPais.set(ppKey, (orcByProdutoPais.get(ppKey) ?? 0) + val);
  }

  const produtosExcluidos = excludedItems.map((ei) => {
    const familia = ei.produto.unidades[0]?.familia ?? "Outros";
    const paiKey  = `${ei.paisIso3}|${familia}|${ei.produtoId}`;
    return {
      codigo:        ei.produto.codigo,
      descricao:     ei.produto.descricao,
      classe:        ei.produto.classe ?? null,
      familia,
      paisIso3:      ei.paisIso3 ?? null,
      orcTotal:      isExport
        ? (orcByProdutoPais.get(`${ei.produtoId}|${ei.paisIso3 ?? ""}`) ?? 0)
        : (orcByProduto.get(ei.produtoId) ?? 0),
      prevFctsTotal: isExport && ei.paisIso3
        ? (prevFctsByPaisFamProd.get(paiKey) ?? 0)
        : (prevFctsByProduto.get(ei.produtoId) ?? 0),
    };
  });

  return {
    months,
    topDesvios,
    resumo: {
      totalORC:  resumoORC,
      totalFCTS: resumoFCTS,
      desvio: resumoORC > 0 && resumoFCTS > 0
        ? parseFloat((((resumoFCTS / resumoORC) - 1) * 100).toFixed(1))
        : 0,
    },
    prevFctsTotal: prevFctsTotalScoped,
    classeAcuracia,
    familiaDetalhe,
    produtosExcluidos,
    paisDetalhe,
    isExport,
  };
};

/**
 * Submete automaticamente todas as unidades ativas de um ciclo ao fim do prazo.
 * Cobre dois casos:
 *   1) Unidade com DivisionSubmission em DRAFT → muda para SUBMITTED + autoSubmitted=true.
 *   2) Unidade SEM DivisionSubmission (gestor nunca abriu a página) mas com overrides
 *      preenchidos no run → cria DivisionSubmission já em SUBMITTED + autoSubmitted=true.
 *
 * Só submete unidades que têm pelo menos um ForecastOverride com volumeFCTS > 0.
 * Unidades em SUBMITTED/APPROVED/REJECTED são ignoradas (já tratadas).
 *
 * Chamado pelo watchdog antes de closeCycle(), garantindo que o guard SUBMITTED_OPEN
 * não bloqueie o fechamento do ciclo.
 */
export const autoSubmitExpiredDrafts = async (refMonth: Date): Promise<{ submitted: string[]; skipped: string[] }> => {
  const systemUser = await prisma.user.findFirst({
    where:   { perfil: "admin_ti" },
    orderBy: { createdAt: "asc" },
    select:  { id: true, nome: true },
  });

  const run = await prisma.forecastRun.findFirst({
    where:   { refMonth, status: "SUCCESS" },
    orderBy: { executedAt: "desc" },
    select:  { id: true },
  });

  // Todas as unidades ativas — cobre tanto quem tem DivisionSubmission em DRAFT
  // quanto quem nunca criou submission (gestor não acessou a página).
  const unidadesAtivas = await prisma.unidadeVenda.findMany({
    where:  { ativo: true },
    select: { codigo: true },
  });

  // Mapa de submissions existentes para o ciclo, indexado por unidadeVendaId
  const existingSubs = await prisma.divisionSubmission.findMany({
    where:  { refMonth },
    select: { id: true, unidadeVendaId: true, status: true },
  });
  const subByUnidade = new Map(existingSubs.map(s => [s.unidadeVendaId, s]));

  const submitted: string[] = [];
  const skipped:   string[] = [];

  for (const u of unidadesAtivas) {
    const existing = subByUnidade.get(u.codigo);

    // Já submetida/aprovada/rejeitada — nada a fazer
    if (existing && existing.status !== "DRAFT") continue;

    // Só auto-submete se houver ao menos um override com volumeFCTS > 0
    const hasData = run ? await prisma.forecastOverride.count({
      where: {
        volumeFCTS: { gt: 0 },
        forecastItem: { runId: run.id, unidadeVendaId: u.codigo },
      },
    }) : 0;

    if (!hasData) {
      skipped.push(u.codigo);
      console.log(`[autoSubmit] Skipped ${u.codigo} — sem overrides preenchidos.`);
      continue;
    }

    if (!systemUser) {
      // Sem usuário sistema (admin_ti) não há autorId válido para criar do zero.
      // Mantém comportamento defensivo: pula e loga, em vez de criar registro órfão.
      console.warn(`[autoSubmit] Skipped ${u.codigo} — nenhum usuário admin_ti disponível para registrar autoria.`);
      skipped.push(u.codigo);
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const now = new Date();
      if (existing) {
        // Caso 1: DRAFT existente → SUBMITTED
        await tx.divisionSubmission.update({
          where: { id: existing.id },
          data:  { status: "SUBMITTED", submittedAt: now, autoSubmitted: true },
        });
        await logAudit(tx, {
          userId:     systemUser.id,
          userNome:   systemUser.nome,
          userPerfil: "admin_ti",
          source:     "system",
          action:     "STATE_CHANGE",
          entity:     "DivisionSubmission",
          entityId:   existing.id,
          refMonth:   refMonth.toISOString().substring(0, 7),
          unidadeId:  u.codigo,
          before:     { status: "DRAFT" },
          after:      { status: "SUBMITTED", autoSubmitted: true },
          metadata:   { operation: "AUTO_SUBMIT_EXPIRED" },
        });
      } else {
        // Caso 2: sem submission → criar já em SUBMITTED
        const created = await tx.divisionSubmission.create({
          data: {
            unidadeVendaId: u.codigo,
            refMonth,
            autorId:        systemUser.id,
            status:         "SUBMITTED",
            submittedAt:    now,
            autoSubmitted:  true,
          },
          select: { id: true },
        });
        await logAudit(tx, {
          userId:     systemUser.id,
          userNome:   systemUser.nome,
          userPerfil: "admin_ti",
          source:     "system",
          action:     "STATE_CHANGE",
          entity:     "DivisionSubmission",
          entityId:   created.id,
          refMonth:   refMonth.toISOString().substring(0, 7),
          unidadeId:  u.codigo,
          before:     { status: null },
          after:      { status: "SUBMITTED", autoSubmitted: true },
          metadata:   { operation: "AUTO_SUBMIT_EXPIRED_NO_DRAFT" },
        });
      }
    });

    submitted.push(u.codigo);
    console.log(`[autoSubmit] Auto-submitted ${u.codigo} — prazo expirado${existing ? "" : " (sem DRAFT prévio)"}.`);
  }

  if (submitted.length > 0) {
    const label = monthLabel(refMonth);
    for (const perfil of ["controladoria", "operador_pcp", "admin_ti"] as const) {
      void createForRole(
        perfil,
        "SUBMISSION_PENDING",
        `${submitted.length} forecast(s) submetido(s) automaticamente — ${label}`,
        `O prazo do ciclo de ${label} encerrou. ${submitted.length} unidade(s) foram submetidas automaticamente pelo sistema: ${submitted.join(", ")}. Verifique as submissões marcadas como "Automático" antes de aprovar.`,
        refMonth
      ).catch(console.error);
    }
  }

  appCache.invalidateConsolidado();
  return { submitted, skipped };
};
