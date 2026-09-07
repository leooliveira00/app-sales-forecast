/**
 * Seed — Sales Forecast Web
 * Popula o banco com dados fictícios para MVP funcional.
 * Execute: npx tsx prisma/seed.ts
 */

import { PrismaClient, Perfil, UserUnidadeRole, RunStatus, SubmissionStatus, OrcamentoStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Random determinístico por índice — gera valores reproduzíveis */
const rnd = (base: number, idx: number, variance = 0.14) => {
  const pseudo = Math.sin(base + idx * 9301 + 49297) * 0.5 + 0.5;
  return Math.max(1, Math.round(base * (1 + (pseudo - 0.5) * 2 * variance)));
};

const d = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));

/** Fator de sazonalidade por mês (Jan=0…Dez=11) */
const SEASONAL = [0.84, 0.89, 0.99, 1.06, 1.12, 1.01, 0.88, 0.94, 1.11, 1.16, 1.09, 0.93];

// ── Definições de dados ───────────────────────────────────────────────────────

const UNIDADES = [
  { codigo: "CARDIO",       descricao: "Divisão Cardiologia"   },
  { codigo: "VASCULAR",     descricao: "Divisão Vascular"      },
  { codigo: "ENDOSCOPIA",   descricao: "Divisão Endoscopia"    },
  { codigo: "ENDOCIRURGIA", descricao: "Divisão Endocirurgia"  },
];

const USERS = [
  { email: "admin@empresa.com",        nome: "Administrador",       perfil: "admin_ti" as Perfil,     senha: "admin123",  unidade: null },
  { email: "joao.silva@empresa.com",   nome: "João Silva",          perfil: "gestor" as Perfil,       senha: "gestor123", unidade: "CARDIO" },
  { email: "maria.souza@empresa.com",  nome: "Maria Souza",         perfil: "gestor" as Perfil,       senha: "gestor123", unidade: "VASCULAR" },
  { email: "pedro.oliveira@empresa.com",nome: "Pedro Oliveira",     perfil: "gestor" as Perfil,       senha: "gestor123", unidade: "ENDOSCOPIA" },
  { email: "carla.mendes@empresa.com", nome: "Carla Mendes",        perfil: "gestor" as Perfil,       senha: "gestor123", unidade: "ENDOCIRURGIA" },
  { email: "ana.lima@empresa.com",     nome: "Ana Lima",            perfil: "consulta" as Perfil, senha: "controle123", unidade: null },
  { email: "roberto.ferreira@empresa.com", nome: "Roberto Ferreira", perfil: "consulta" as Perfil, senha: "controle123", unidade: null },
];

type ProdDef = { codigo: string; descricao: string; unidade: string; familia: string; classe: string; base: number };
const PRODUTOS: ProdDef[] = [
  // ── CARDIO ───────────────────────────────────────────────────
  { codigo: "CAR10001", descricao: "CATETER BALÃO CORONÁRIO 2.0X15MM",     unidade: "CARDIO",       familia: "Intervenção Coronária", classe: "A", base: 600  },
  { codigo: "CAR10002", descricao: "CATETER BALÃO CORONÁRIO 3.0X20MM",     unidade: "CARDIO",       familia: "Intervenção Coronária", classe: "A", base: 450  },
  { codigo: "CAR10003", descricao: "STENT CORONÁRIO DES 2.5X18MM",         unidade: "CARDIO",       familia: "Stents",               classe: "A", base: 280  },
  { codigo: "CAR10004", descricao: "STENT CORONÁRIO BMS 3.0X28MM",         unidade: "CARDIO",       familia: "Stents",               classe: "B", base: 185  },
  { codigo: "CAR10005", descricao: "GUIDEWIRE CORONÁRIO 0.014\" 190CM",    unidade: "CARDIO",       familia: "Suporte",              classe: "B", base: 1200 },
  { codigo: "CAR10006", descricao: "INTRODUTOR HEMOSTÁTICO 6FR",           unidade: "CARDIO",       familia: "Suporte",              classe: "C", base: 900  },
  { codigo: "CAR10007", descricao: "CATETER DIAGNÓSTICO JL4 5FR",          unidade: "CARDIO",       familia: "Diagnóstico",          classe: "B", base: 310  },
  { codigo: "CAR10008", descricao: "BALÃO DE CONTRAPULSAÇÃO AÓRTICA 40CC", unidade: "CARDIO",       familia: "Suporte Circulatório", classe: "A", base: 82   },
  // ── VASCULAR ─────────────────────────────────────────────────
  { codigo: "VAS20001", descricao: "STENT PERIFÉRICO ILÍACO 7X60MM",       unidade: "VASCULAR",     familia: "Stents Periféricos",   classe: "A", base: 350  },
  { codigo: "VAS20002", descricao: "ANGIOPLASTIA PTA FEMORAL 5X80MM",      unidade: "VASCULAR",     familia: "Dilatação",            classe: "B", base: 280  },
  { codigo: "VAS20003", descricao: "ENDOPRÓTESE AÓRTICA BIFURCADA",        unidade: "VASCULAR",     familia: "Cirurgia Endovascular", classe: "A", base: 45   },
  { codigo: "VAS20004", descricao: "CATETER FOGARTY 4FR 80CM",             unidade: "VASCULAR",     familia: "Embolectomia",         classe: "B", base: 175  },
  { codigo: "VAS20005", descricao: "FILTRO VENA CAVA RECUPERÁVEL",         unidade: "VASCULAR",     familia: "Proteção",             classe: "A", base: 120  },
  { codigo: "VAS20006", descricao: "STENT CAROTÍDEO OTW 8X30MM",           unidade: "VASCULAR",     familia: "Neurointervencão",     classe: "A", base: 158  },
  { codigo: "VAS20007", descricao: "CATETER VENOSO CENTRAL 7FR 3VL",       unidade: "VASCULAR",     familia: "Acesso Venoso",        classe: "C", base: 520  },
  // ── ENDOSCOPIA ───────────────────────────────────────────────
  { codigo: "END30001", descricao: "GASTROSCÓPIO HD 1100MM",               unidade: "ENDOSCOPIA",   familia: "Equipamentos",         classe: "A", base: 14   },
  { codigo: "END30002", descricao: "COLONOSCÓPIO HD 1650MM",               unidade: "ENDOSCOPIA",   familia: "Equipamentos",         classe: "A", base: 11   },
  { codigo: "END30003", descricao: "CLIPE HEMOSTÁTICO ROTACIONAL",         unidade: "ENDOSCOPIA",   familia: "Hemostasia",           classe: "B", base: 380  },
  { codigo: "END30004", descricao: "ALÇA DE POLIPECTOMIA 15MM",            unidade: "ENDOSCOPIA",   familia: "Polipectomia",         classe: "C", base: 520  },
  { codigo: "END30005", descricao: "AGULHA INJEÇÃO ESCLEROTERAPIA 23G",    unidade: "ENDOSCOPIA",   familia: "Hemostasia",           classe: "C", base: 295  },
  // ── ENDOCIRURGIA ─────────────────────────────────────────────
  { codigo: "ECO40001", descricao: "TROCAR DESCARTÁVEL 5MM",               unidade: "ENDOCIRURGIA", familia: "Acesso Laparoscópico", classe: "C", base: 810  },
  { codigo: "ECO40002", descricao: "TROCAR DESCARTÁVEL 12MM",              unidade: "ENDOCIRURGIA", familia: "Acesso Laparoscópico", classe: "C", base: 650  },
  { codigo: "ECO40003", descricao: "CLIPADOR LAPAROSCÓPICO TITÂNIO",       unidade: "ENDOCIRURGIA", familia: "Hemostasia",           classe: "B", base: 425  },
  { codigo: "ECO40004", descricao: "LIGASURE VESSEL SEALER 5MM",           unidade: "ENDOCIRURGIA", familia: "Selagem Tecidual",     classe: "A", base: 280  },
  { codigo: "ECO40005", descricao: "GRAMPEADOR LINEAR 60MM",               unidade: "ENDOCIRURGIA", familia: "Anastomose",           classe: "A", base: 180  },
  { codigo: "ECO40006", descricao: "STAPLER CIRCULAR 29MM",                unidade: "ENDOCIRURGIA", familia: "Anastomose",           classe: "A", base: 148  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Iniciando seed do banco de dados...\n");

  // Verifica se já foi populado
  const already = await prisma.unidadeVenda.count();
  if (already > 0) {
    console.log("ℹ️  Banco já populado. Use --force para re-semear.\n");
    const force = process.argv.includes("--force");
    if (!force) return;
    console.log("⚠️  --force detectado. Limpando dados antigos...");
    await prisma.$executeRaw`TRUNCATE TABLE "VendaMensal", "ForecastOverride", "ForecastItem", "ForecastRun", "DivisionSubmission", "ProdutoUnidadeVenda", "Produto", "UserUnidadeVenda", "User", "UnidadeVenda" RESTART IDENTITY CASCADE`;
    console.log("✔ Dados limpos.\n");
  }

  // ── 1. Unidades de Venda ─────────────────────────────────────────────────

  console.log("1/7  Criando Unidades de Venda...");
  const unidadeMap:      Record<string, string> = {}; // codigo → id
  const unidadeDescMap:  Record<string, string> = {}; // codigo → descricao
  for (const u of UNIDADES) {
    const rec = await prisma.unidadeVenda.upsert({
      where: { codigo: u.codigo },
      create: u,
      update: {},
    });
    unidadeMap[u.codigo]     = rec.codigo;
    unidadeDescMap[u.codigo] = u.descricao;
  }
  console.log(`     ✔ ${UNIDADES.length} unidades criadas.`);

  // ── 2. Usuários ──────────────────────────────────────────────────────────

  console.log("2/7  Criando Usuários...");
  const userMap: Record<string, string> = {}; // email → id
  for (const u of USERS) {
    const hashed = await bcrypt.hash(u.senha, 10);
    const rec = await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, nome: u.nome, perfil: u.perfil, password: hashed },
      update: {},
    });
    userMap[u.email] = rec.id;

    if (u.unidade && unidadeMap[u.unidade]) {
      await prisma.userUnidadeVenda.upsert({
        where: {
          userId_unidadeVendaId_role: {
            userId: rec.id,
            unidadeVendaId: unidadeMap[u.unidade],
            role: "GESTOR",
          },
        },
        create: {
          userId: rec.id,
          unidadeVendaId: unidadeMap[u.unidade],
          role: "GESTOR" as UserUnidadeRole,
        },
        update: {},
      });
    }
  }
  console.log(`     ✔ ${USERS.length} usuários criados.`);

  // ── 3. Produtos ──────────────────────────────────────────────────────────

  console.log("3/7  Criando Produtos...");
  const prodMap: Record<string, string> = {}; // codigo → id
  for (const p of PRODUTOS) {
    const rec = await prisma.produto.upsert({
      where: { codigo: p.codigo },
      create: { codigo: p.codigo, descricao: p.descricao, classe: p.classe },
      update: {},
    });
    prodMap[p.codigo] = rec.codigo;

    if (unidadeMap[p.unidade]) {
      await prisma.produtoUnidadeVenda.upsert({
        where: {
          produtoId_unidadeVendaId: { produtoId: rec.codigo, unidadeVendaId: unidadeMap[p.unidade] },
        },
        create: {
          produtoId: rec.codigo,
          unidadeVendaId: unidadeMap[p.unidade],
          familia: p.familia,
          divisao: unidadeDescMap[p.unidade] ?? p.unidade,
        },
        update: {},
      });
    }
  }
  console.log(`     ✔ ${PRODUTOS.length} produtos criados.`);

  // ── 4. ForecastRuns + ForecastItems ──────────────────────────────────────
  //
  // Cada run cobre uma janela de 12 meses a partir de refMonth + leadTime (2 meses).
  // Exemplo: Run JAN/2026 → janela MAR/2026 – FEV/2027
  //          Run FEV/2026 → janela ABR/2026 – MAR/2027
  //          Run MAR/2026 → janela MAI/2026 – ABR/2027

  console.log("4/7  Criando ForecastRuns e ForecastItems (janela 12 meses)...");

  const LEAD_TIME    = 2;   // meses de lead time
  const WINDOW_SIZE  = 12;  // meses editáveis por ciclo

  // Cria runs para todos os meses de 2026
  const MONTHS_2026 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const runMap: Record<number, string> = {};
  // Guarda windowStart de cada run para usar nas overrides
  const runWindowStart: Record<number, Date> = {};

  for (const month of MONTHS_2026) {
    const windowStart = new Date(Date.UTC(2026, month - 1 + LEAD_TIME, 1));
    const windowEnd   = new Date(Date.UTC(2026, month - 1 + LEAD_TIME + WINDOW_SIZE - 1, 1));

    const existing = await prisma.forecastRun.findFirst({
      where: { refMonth: d(2026, month), status: "SUCCESS" },
    });
    const run = existing ?? await prisma.forecastRun.create({
      data: {
        refMonth:       d(2026, month),
        executedAt:     d(2026, month),
        status:         "SUCCESS" as RunStatus,
        windowStart,
        windowEnd,
        leadTimeMonths: LEAD_TIME,
        sourceKey: `airflow-2026-${String(month).padStart(2, "0")}`,
      },
    });

    // Se o run já existia, actualiza a janela (retrocompat.)
    if (existing) {
      await prisma.forecastRun.update({
        where: { id: run.id },
        data: { windowStart, windowEnd, leadTimeMonths: LEAD_TIME },
      });
    }

    runMap[month]         = run.id;
    runWindowStart[month] = windowStart;
  }

  // Cria ForecastItems: todos os produtos × 12 meses da janela de cada run
  let itemCount = 0;
  for (const month of MONTHS_2026) {
    const runId = runMap[month];
    for (const [pIdx, p] of PRODUTOS.entries()) {
      for (let wi = 0; wi < WINDOW_SIZE; wi++) {
        // Deriva a data do item a partir do mês do ciclo — JS normaliza overflow de mês para o ano correto
        const refDate     = new Date(Date.UTC(2026, month - 1, 1));
        const targetMonth = refDate.getUTCMonth() + LEAD_TIME + wi; // 0-indexed, pode ultrapassar 11
        const itemDate    = new Date(Date.UTC(refDate.getUTCFullYear(), targetMonth, 1));

        const seasonal = SEASONAL[itemDate.getUTCMonth()];
        const baseORC  = Math.round(p.base * seasonal);
        const volumeIA = rnd(baseORC, pIdx + month * 100 + wi * 37 + 500, 0.10);
        const estoque  = rnd(p.base * 2, pIdx + month * 100 + wi * 37 + 999);

        // Prisma 6 não aceita null no where de upsert com compound unique index
        // (paisIso3 faz parte da chave) — usa findFirst + create, como em forecast.service.ts.
        const existingItem = await prisma.forecastItem.findFirst({
          where: {
            runId,
            produtoId:      prodMap[p.codigo],
            unidadeVendaId: unidadeMap[p.unidade],
            month:          itemDate,
            paisIso3:       null,
          },
          select: { id: true },
        });
        if (!existingItem) {
          await prisma.forecastItem.create({
            data: {
              runId,
              produtoId:      prodMap[p.codigo],
              unidadeVendaId: unidadeMap[p.unidade],
              month:          itemDate,
              volumeIA,
              estoque,
              paisIso3:       null,
            },
          });
        }
        itemCount++;
      }
    }
  }
  console.log(`     ✔ ${Object.keys(runMap).length} runs + ${itemCount} itens criados.`);

  // ── 5. ForecastOverrides (FCTS preenchidos pelos gestores) ────────────────

  console.log("5/7  Criando ForecastOverrides (FCTS)...");

  // Unidades com overrides completos em Jan e Fev (prontas para submissão/aprovação)
  const OVERRIDE_CONFIG: { unidade: string; gestor: string; months: number[]; partialFeb?: boolean }[] = [
    { unidade: "CARDIO",       gestor: "joao.silva@empresa.com",    months: [1, 2, 3] },
    { unidade: "VASCULAR",     gestor: "maria.souza@empresa.com",   months: [1, 2] },
    { unidade: "ENDOSCOPIA",   gestor: "pedro.oliveira@empresa.com",months: [1, 2] },
    { unidade: "ENDOCIRURGIA", gestor: "carla.mendes@empresa.com",  months: [1] },
  ];

  let overrideCount = 0;
  for (const cfg of OVERRIDE_CONFIG) {
    const gestorId  = userMap[cfg.gestor];
    const unidadeId = unidadeMap[cfg.unidade];
    const unitProds = PRODUTOS.filter(p => p.unidade === cfg.unidade);

    for (const cycleMonth of cfg.months) {
      const runId      = runMap[cycleMonth];
      // Alvo: primeiro mês da janela do ciclo (windowStart)
      const targetDate = runWindowStart[cycleMonth];

      for (const [pIdx, p] of unitProds.entries()) {
        // Busca o item para o primeiro mês da janela
        const item = await prisma.forecastItem.findFirst({
          where: {
            runId,
            produtoId:      prodMap[p.codigo],
            unidadeVendaId: unidadeId,
            month:          targetDate,
          },
        });
        if (!item) continue;

        const seasonal = SEASONAL[targetDate.getUTCMonth()];
        const fcts     = rnd(Math.round(p.base * seasonal), pIdx + cycleMonth * 50, 0.09);

        await prisma.forecastOverride.upsert({
          where: { forecastItemId: item.id },
          create: { forecastItemId: item.id, gestorId, volumeFCTS: fcts },
          update: {},
        });
        overrideCount++;
      }
    }
  }
  console.log(`     ✔ ${overrideCount} overrides criados.`);

  // ── 6. DivisionSubmissions ────────────────────────────────────────────────

  console.log("6/7  Criando DivisionSubmissions...");

  const SUBMISSIONS: {
    unidade: string; month: number; gestor: string;
    status: SubmissionStatus; revisor?: string; rejectionReason?: string
  }[] = [
    // CARDIO — Jan aprovado, Fev aprovado, Mar em andamento
    { unidade: "CARDIO",       month: 1, gestor: "joao.silva@empresa.com",    status: "APPROVED",  revisor: "ana.lima@empresa.com" },
    { unidade: "CARDIO",       month: 2, gestor: "joao.silva@empresa.com",    status: "APPROVED",  revisor: "ana.lima@empresa.com" },
    // VASCULAR — Jan aprovado, Fev pendente
    { unidade: "VASCULAR",     month: 1, gestor: "maria.souza@empresa.com",   status: "APPROVED",  revisor: "ana.lima@empresa.com" },
    { unidade: "VASCULAR",     month: 2, gestor: "maria.souza@empresa.com",   status: "SUBMITTED" },
    // ENDOSCOPIA — Jan aprovado, Fev rejeitado
    { unidade: "ENDOSCOPIA",   month: 1, gestor: "pedro.oliveira@empresa.com",status: "APPROVED",  revisor: "roberto.ferreira@empresa.com" },
    { unidade: "ENDOSCOPIA",   month: 2, gestor: "pedro.oliveira@empresa.com",status: "REJECTED",  revisor: "roberto.ferreira@empresa.com",
      rejectionReason: "Volumes FCTS acima do ORC sem justificativa técnica. Revisar produtos END30003 e END30004." },
    // ENDOCIRURGIA — Jan aprovado, Fev rascunho (não submetido)
    { unidade: "ENDOCIRURGIA", month: 1, gestor: "carla.mendes@empresa.com",  status: "APPROVED",  revisor: "ana.lima@empresa.com" },
  ];

  const subDate = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month - 1, day));

  for (const s of SUBMISSIONS) {
    const autorId   = userMap[s.gestor];
    const revisorId = s.revisor ? userMap[s.revisor] : undefined;
    const unidadeId = unidadeMap[s.unidade];

    await prisma.divisionSubmission.upsert({
      where: {
        refMonth_unidadeVendaId: {
          refMonth: d(2026, s.month),
          unidadeVendaId: unidadeId,
        },
      },
      create: {
        refMonth: d(2026, s.month),
        unidadeVendaId: unidadeId,
        autorId,
        status: s.status,
        revisorId:  revisorId ?? null,
        submittedAt: subDate(2026, s.month, 20),
        reviewedAt:  revisorId ? subDate(2026, s.month, 22) : null,
        rejectionReason: s.rejectionReason ?? null,
      },
      update: {},
    });
  }
  console.log(`     ✔ ${SUBMISSIONS.length} submissões criadas.`);

  // ── 7. VendaMensal (histórico 2025 + Jan-Fev 2026) ───────────────────────

  console.log("7/7  Criando VendaMensal (histórico)...");

  let vendaCount = 0;
  const HISTORY_MONTHS: { year: number; month: number }[] = [
    ...Array.from({ length: 12 }, (_, i) => ({ year: 2025, month: i + 1 })),
    { year: 2026, month: 1 },
    { year: 2026, month: 2 },
  ];

  for (const { year, month } of HISTORY_MONTHS) {
    const seasonal = SEASONAL[month - 1];
    for (const [pIdx, p] of PRODUTOS.entries()) {
      // Vendas reais ficam 85-105% do orçamento
      const quantidade = rnd(Math.round(p.base * seasonal), pIdx + year * 100 + month * 13, 0.12);

      // Sem @@unique composto (paisIso3 usa índices parciais) — findFirst + create, como em vendas-sync.service.ts.
      const existingVenda = await prisma.vendaMensal.findFirst({
        where: {
          produtoId: prodMap[p.codigo],
          unidadeVendaId: unidadeMap[p.unidade],
          month: d(year, month),
          canal: "VENDA DIRETA",
          paisIso3: null,
        },
        select: { id: true },
      });
      if (!existingVenda) {
        await prisma.vendaMensal.create({
          data: {
            produtoId: prodMap[p.codigo],
            unidadeVendaId: unidadeMap[p.unidade],
            month: d(year, month),
            quantidade,
            canal: "VENDA DIRETA",
          },
        });
      }
      vendaCount++;
    }
  }
  console.log(`     ✔ ${vendaCount} registros de vendas criados.`);

  // ── 8. OrcamentoRun 2026 + OrcamentoItems ────────────────────────────────

  console.log("8/8  Criando OrcamentoRun 2026 + OrcamentoItems...");

  let orcRun = await prisma.orcamentoRun.findUnique({ where: { ano: 2026 } });
  if (!orcRun) {
    orcRun = await prisma.orcamentoRun.create({
      data: {
        ano: 2026,
        aprovadoEm: new Date("2025-11-30"),
        status: "APROVADO" as OrcamentoStatus,
        sourceKey: "ERP-2026-ORC-v1",
      },
    });
  }

  // OrcamentoItems cobrem todos os 12 meses de 2026 para todos os produtos
  let orcItemCount = 0;
  for (const [pIdx, p] of PRODUTOS.entries()) {
    for (let month = 1; month <= 12; month++) {
      const seasonal = SEASONAL[month - 1];
      // OrcamentoItem é a fonte canônica do ORC — ForecastItem não armazena mais volumeORC
      const volumeORC = rnd(Math.round(p.base * seasonal), pIdx + month * 200 + 77777);

      // Sem @@unique composto (paisIso3 usa índices parciais) — findFirst + create.
      const existingOrcItem = await prisma.orcamentoItem.findFirst({
        where: {
          orcamentoAno: orcRun.ano,
          produtoId: prodMap[p.codigo],
          unidadeVendaId: unidadeMap[p.unidade],
          month: d(2026, month),
          paisIso3: null,
        },
        select: { id: true },
      });
      if (!existingOrcItem) {
        await prisma.orcamentoItem.create({
          data: {
            orcamentoAno: orcRun.ano,
            produtoId: prodMap[p.codigo],
            unidadeVendaId: unidadeMap[p.unidade],
            month: d(2026, month),
            volumeORC,
          },
        });
      }
      orcItemCount++;
    }
  }
  console.log(`     ✔ 1 OrcamentoRun + ${orcItemCount} OrcamentoItems criados.`);

  // ── Configurações globais do sistema ──────────────────────────────────────

  console.log("  9. Configurações globais (SystemConfig)...");
  await prisma.systemConfig.upsert({
    where:  { key: "cycleOpenDay"  },
    create: { key: "cycleOpenDay",  value: "5" },
    update: {},   // preserva valor configurado pelo admin
  });
  await prisma.systemConfig.upsert({
    where:  { key: "cycleOpenHour" },
    create: { key: "cycleOpenHour", value: "0" },
    update: {},   // preserva valor configurado pelo admin
  });
  const openDay  = (await prisma.systemConfig.findUnique({ where: { key: "cycleOpenDay"  } }))?.value ?? "5";
  const openHour = (await prisma.systemConfig.findUnique({ where: { key: "cycleOpenHour" } }))?.value ?? "0";
  console.log(`     ✔ SystemConfig: cycleOpenDay=${openDay}, cycleOpenHour=${openHour}.`);

  // Nota: availableFrom é deixado como null em todos os runs.
  // A disponibilidade de cada ciclo é calculada dinamicamente pela regra global (SystemConfig.cycleOpenDay).
  // Administradores podem sobrescrever via painel "Gestão de Ciclos" na tela de administração.

  // ── Sumário ───────────────────────────────────────────────────────────────

  console.log(`
╔══════════════════════════════════════════════╗
║         Seed concluído com sucesso!          ║
╠══════════════════════════════════════════════╣
║  Unidades de Venda : ${String(UNIDADES.length).padEnd(24)}║
║  Usuários          : ${String(USERS.length).padEnd(24)}║
║  Produtos          : ${String(PRODUTOS.length).padEnd(24)}║
║  ForecastRuns      : ${String(MONTHS_2026.length).padEnd(24)}║
║  ForecastItems     : ${String(itemCount).padEnd(24)}║
║  Overrides (FCTS)  : ${String(overrideCount).padEnd(24)}║
║  Submissions       : ${String(SUBMISSIONS.length).padEnd(24)}║
║  Vendas Mensais    : ${String(vendaCount).padEnd(24)}║
║  OrcamentoItems    : ${String(orcItemCount).padEnd(24)}║
╠══════════════════════════════════════════════╣
║  Logins de acesso:                           ║
║  admin@empresa.com        / admin123         ║
║  joao.silva@empresa.com   / gestor123        ║
║  maria.souza@empresa.com  / gestor123        ║
║  pedro.oliveira@empresa.com / gestor123      ║
║  carla.mendes@empresa.com / gestor123        ║
║  ana.lima@empresa.com     / controle123      ║
╚══════════════════════════════════════════════╝
`);
}

main()
  .catch((e) => { console.error("❌ Erro no seed:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
