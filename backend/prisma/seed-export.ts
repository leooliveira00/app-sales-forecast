/**
 * Seed de unidades de exportação — Sales Forecast Web
 *
 * Cria:
 *  - UnidadeVenda APAC, EMEA, LATAM (tipo=EXPORT)
 *  - Países associados a cada região
 *  - Gestor para cada região (perfil gestor)
 *  - ProdutoUnidadeVenda: vincula o portfólio completo a cada unidade export
 *  - ForecastRun + ForecastItem (com paisIso3) para Jan-Dez/2026
 *  - OrcamentoItem para todos os meses de 2026
 *  - VendaMensal por país para Jan/2025–Dez/2026
 *
 * Execute: npx tsx prisma/seed-export.ts
 */

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const d   = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));
const rnd = (base: number, seed: number, variance = 0.14) => {
  const p = Math.abs(Math.sin(base * 9301 + seed * 49297 + 233) * 0.5 + 0.5);
  return Math.max(1, Math.round(base * (1 + (p - 0.5) * 2 * variance)));
};
const SEASONAL = [0.84, 0.89, 0.99, 1.06, 1.12, 1.01, 0.88, 0.94, 1.11, 1.16, 1.09, 0.93];

const REGIOES = [
  {
    codigo: "APAC", descricao: "Ásia-Pacífico",
    gestor: { email: "gestor.apac@empresa.com", nome: "Zhang Wei" },
    paises: [
      { iso3: "JPN", nome: "Japão" },
      { iso3: "KOR", nome: "Coreia do Sul" },
      { iso3: "AUS", nome: "Austrália" },
      { iso3: "SGP", nome: "Singapura" },
      { iso3: "THA", nome: "Tailândia" },
    ],
  },
  {
    codigo: "EMEA", descricao: "Europa, Médio Oriente e África",
    gestor: { email: "gestor.emea@empresa.com", nome: "Elena Müller" },
    paises: [
      { iso3: "DEU", nome: "Alemanha" },
      { iso3: "FRA", nome: "França" },
      { iso3: "GBR", nome: "Reino Unido" },
      { iso3: "ITA", nome: "Itália" },
      { iso3: "ESP", nome: "Espanha" },
      { iso3: "NLD", nome: "Países Baixos" },
    ],
  },
  {
    codigo: "LATAM", descricao: "América Latina",
    gestor: { email: "gestor.latam@empresa.com", nome: "Carlos Herrera" },
    paises: [
      { iso3: "MEX", nome: "México" },
      { iso3: "COL", nome: "Colômbia" },
      { iso3: "ARG", nome: "Argentina" },
      { iso3: "CHL", nome: "Chile" },
      { iso3: "PER", nome: "Peru" },
    ],
  },
];

async function main() {
  console.log("🌍 Seed de unidades de exportação...\n");

  const produtos = await prisma.produto.findMany({ where: { ativo: true } });
  if (produtos.length === 0) {
    console.error("❌ Nenhum produto encontrado. Execute o seed principal primeiro.");
    process.exit(1);
  }
  console.log(`   ${produtos.length} produtos encontrados.`);

  const orcRun2026 = await prisma.orcamentoRun.findUnique({ where: { ano: 2026 } });
  const orcRun2025 = await prisma.orcamentoRun.findUnique({ where: { ano: 2025 } });

  const hashedPassword = await bcrypt.hash("gestor123", 10);

  for (const [ri, regiao] of REGIOES.entries()) {
    console.log(`\n── ${regiao.codigo} ──`);

    // 1. UnidadeVenda EXPORT
    const unidade = await prisma.unidadeVenda.upsert({
      where: { codigo: regiao.codigo },
      create: { codigo: regiao.codigo, descricao: regiao.descricao, tipo: "EXPORT" },
      update: { tipo: "EXPORT" },
    });
    console.log(`   ✓ UnidadeVenda ${regiao.codigo}`);

    // 2. Países
    for (const p of regiao.paises) {
      await prisma.pais.upsert({
        where: { iso3: p.iso3 },
        create: { iso3: p.iso3, nome: p.nome, unidadeVendaId: unidade.codigo },
        update: { nome: p.nome },
      });
    }
    console.log(`   ✓ ${regiao.paises.length} países`);

    // 3. Gestor
    let gestor = await prisma.user.findUnique({ where: { email: regiao.gestor.email } });
    if (!gestor) {
      gestor = await prisma.user.create({
        data: {
          email:    regiao.gestor.email,
          nome:     regiao.gestor.nome,
          password: hashedPassword,
          perfil:   "gestor",
        },
      });
    }
    await prisma.userUnidadeVenda.upsert({
      where: { userId_unidadeVendaId_role: { userId: gestor.id, unidadeVendaId: unidade.codigo, role: "GESTOR" } },
      create: { userId: gestor.id, unidadeVendaId: unidade.codigo, role: "GESTOR" },
      update: { ativo: true },
    });
    console.log(`   ✓ Gestor ${regiao.gestor.nome}`);

    // 4. Vincula produtos à unidade export
    for (const prod of produtos) {
      const nationalLink = await prisma.produtoUnidadeVenda.findFirst({
        where: { produtoId: prod.codigo, unidade: { tipo: "NACIONAL" }, ativo: true },
        select: { familia: true, divisao: true },
      });
      await prisma.produtoUnidadeVenda.upsert({
        where: { produtoId_unidadeVendaId: { produtoId: prod.codigo, unidadeVendaId: unidade.codigo } },
        create: {
          produtoId:      prod.codigo,
          unidadeVendaId: unidade.codigo,
          familia:        nationalLink?.familia ?? null,
          divisao:        nationalLink?.divisao ?? null,
        },
        update: { ativo: true },
      });
    }
    console.log(`   ✓ ${produtos.length} produtos vinculados`);

    const REG_FACTOR  = [0.25, 0.35, 0.20][ri];
    const LEAD_TIME   = 2;
    const WINDOW_SIZE = 12;

    // 5. ForecastRun Jan-Dez/2026 + ForecastItem por país (paisIso3 no item)
    for (const refMonthNum of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const refDate     = new Date(Date.UTC(2026, refMonthNum - 1, 1));
      const windowStart = new Date(Date.UTC(2026, refMonthNum - 1 + LEAD_TIME, 1));
      const windowEnd   = new Date(Date.UTC(2026, refMonthNum - 1 + LEAD_TIME + WINDOW_SIZE - 1, 1));

      let run = await prisma.forecastRun.findFirst({
        where: { refMonth: d(2026, refMonthNum), status: "SUCCESS" },
        orderBy: { executedAt: "desc" },
      });
      if (!run) {
        run = await prisma.forecastRun.create({
          data: {
            refMonth:       d(2026, refMonthNum),
            executedAt:     d(2026, refMonthNum),
            status:         "SUCCESS",
            windowStart,
            windowEnd,
            leadTimeMonths: LEAD_TIME,
            sourceKey:      `airflow-export-${regiao.codigo.toLowerCase()}-2026-${String(refMonthNum).padStart(2, "0")}`,
          },
        });
      } else {
        await prisma.forecastRun.update({
          where: { id: run.id },
          data: { windowStart, windowEnd, leadTimeMonths: LEAD_TIME },
        });
      }

      // ForecastItem: um por (produto, mês da janela, país)
      for (const [pi, prod] of produtos.entries()) {
        for (let wi = 0; wi < WINDOW_SIZE; wi++) {
          const itemDate = new Date(Date.UTC(2026, refMonthNum - 1 + LEAD_TIME + wi, 1));
          const seasonal = SEASONAL[itemDate.getUTCMonth()];
          const baseUnit = Math.round(600 * REG_FACTOR);
          const totalIA  = rnd(Math.round(baseUnit * seasonal), pi + refMonthNum * 1001 + ri * 10000 + wi * 71, 0.08);

          for (const [ci, pais] of regiao.paises.entries()) {
            const shareIA   = rnd(Math.round(totalIA / regiao.paises.length), pi * 100 + ci + ri * 50001 + wi * 13, 0.12);
            const shareFCTS = wi === 0
              ? rnd(shareIA, pi * 100 + ci + ri * 50002 + wi * 13, 0.10)
              : undefined;

            const fi = await prisma.forecastItem.upsert({
              where: {
                runId_produtoId_unidadeVendaId_month_paisIso3: {
                  runId:          run.id,
                  produtoId:      prod.codigo,
                  unidadeVendaId: unidade.codigo,
                  month:          itemDate,
                  paisIso3:       pais.iso3,
                },
              },
              create: {
                runId:          run.id,
                produtoId:      prod.codigo,
                unidadeVendaId: unidade.codigo,
                month:          itemDate,
                paisIso3:       pais.iso3,
                volumeIA:       shareIA,
              },
              update: { volumeIA: shareIA },
            });

            // FCTS no primeiro mês da janela
            if (shareFCTS !== undefined) {
              await prisma.forecastOverride.upsert({
                where: { forecastItemId: fi.id },
                create: { forecastItemId: fi.id, gestorId: gestor.id, volumeFCTS: shareFCTS },
                update: { volumeFCTS: shareFCTS },
              });
            }
          }
        }
      }
    }
    console.log(`   ✓ ForecastItems (run × produto × país × mês) Jan-Dez/2026`);

    // 6. OrcamentoItems 2025 e 2026 (por país)
    for (const [orcRun, ano] of [[orcRun2025, 2025], [orcRun2026, 2026]] as const) {
      if (!orcRun) continue;

      for (const [pi, prod] of produtos.entries()) {
        for (let month = 1; month <= 12; month++) {
          const seasonal = SEASONAL[month - 1];
          const baseUnit = Math.round(600 * REG_FACTOR * (ano === 2025 ? 0.92 : 1.0));

          for (const [ci, pais] of regiao.paises.entries()) {
            const shareORC = rnd(Math.round(baseUnit * seasonal / regiao.paises.length), pi + month * 2000 + ri * 20000 + ano + ci);

            await prisma.orcamentoItem.upsert({
              where: {
                orcamentoAno_produtoId_unidadeVendaId_month: {
                  orcamentoAno:   orcRun.ano,
                  produtoId:      prod.codigo,
                  unidadeVendaId: unidade.codigo,
                  month:          d(ano, month),
                },
              },
              create: {
                orcamentoAno:   orcRun.ano,
                produtoId:      prod.codigo,
                unidadeVendaId: unidade.codigo,
                month:          d(ano, month),
                volumeORC:      shareORC,
                paisIso3:       pais.iso3,
              },
              update: { volumeORC: shareORC },
            });
          }
        }
      }
      console.log(`   ✓ OrcamentoItems ${ano} por país`);
    }

    // 7. VendaMensal Jan/2025–Dez/2026 por país
    for (const [pi, prod] of produtos.entries()) {
      for (const ano of [2025, 2026]) {
        for (let m = 1; m <= 12; m++) {
          for (const [ci, pais] of regiao.paises.entries()) {
            const seasonal = SEASONAL[m - 1];
            const base     = Math.round(600 * REG_FACTOR / regiao.paises.length * (ano === 2025 ? 0.92 : 1.0));
            const qtd      = rnd(Math.round(base * seasonal), pi * 200 + m * 13 + ci + ri * 100000 + ano);

            await prisma.vendaMensal.upsert({
              where: {
                produtoId_unidadeVendaId_month_canal: {
                  produtoId:      prod.codigo,
                  unidadeVendaId: unidade.codigo,
                  month:          d(ano, m),
                  canal:          pais.iso3,
                },
              },
              create: {
                produtoId:      prod.codigo,
                unidadeVendaId: unidade.codigo,
                month:          d(ano, m),
                quantidade:     qtd,
                canal:          pais.iso3,
                paisIso3:       pais.iso3,
              },
              update: { quantidade: qtd },
            });
          }
        }
      }
    }
    console.log(`   ✓ VendaMensal 2025-2026 por país`);
  }

  console.log(`
╔═══════════════════════════════════════════════════════╗
║   Seed de exportação concluído                       ║
╠═══════════════════════════════════════════════════════╣
║  Regiões criadas   : APAC, EMEA, LATAM              ║
║  Países por região : 5 / 6 / 5                      ║
║  Gestores criados  : 3                              ║
╠═══════════════════════════════════════════════════════╣
║  Credenciais de acesso:                             ║
║  gestor.apac@empresa.com  / gestor123               ║
║  gestor.emea@empresa.com  / gestor123               ║
║  gestor.latam@empresa.com / gestor123               ║
╚═══════════════════════════════════════════════════════╝`);
}

main()
  .catch((e) => { console.error("❌ Erro:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
