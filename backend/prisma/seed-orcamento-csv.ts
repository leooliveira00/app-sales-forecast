/**
 * Seed a partir do CSV OrcamentoItem.csv (ou OrcamentoItem_nacional.csv)
 * Suporta registros nacionais (paisIso3 vazio) e de exportação (paisIso3 preenchido).
 *
 * Estratégia: delete-then-createMany por ano — idempotente e sem conflito de constraint.
 *
 * Execute dentro do container backend:
 *   npx tsx prisma/seed-orcamento-csv.ts
 *   npx tsx prisma/seed-orcamento-csv.ts OrcamentoItem_nacional.csv   (arquivo alternativo)
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const csvArg    = process.argv[2] ?? "OrcamentoItem.csv";
const CSV_PATH  = path.resolve(__dirname, "data", csvArg);

/** Converte "2026-01" → Date UTC no primeiro dia do mês */
function parseMonth(raw: string): Date {
  const [year, month] = raw.trim().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

/** Lê o CSV (separador ";") e retorna array de objetos */
function readCsv(filePath: string) {
  const content = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, ""); // remove BOM
  const lines = content.split("\n").filter((l) => l.trim() !== "");
  const [headerLine, ...dataLines] = lines;
  const headers = headerLine.split(";").map((h) => h.trim());

  return dataLines.map((line) => {
    const values = line.split(";").map((v) => v.trim());
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
}

async function main() {
  console.log(`🌱 Seed OrcamentoItem a partir de: ${path.basename(CSV_PATH)}\n`);

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Arquivo não encontrado: ${CSV_PATH}`);
  }

  const rows = readCsv(CSV_PATH);
  console.log(`📄 ${rows.length} linhas lidas`);

  // Pré-carrega FKs válidas para filtrar linhas com referências inexistentes
  const produtosValidos = new Set(
    (await prisma.produto.findMany({ select: { codigo: true } })).map((p) => p.codigo)
  );
  const unidadesValidas = new Set(
    (await prisma.unidadeVenda.findMany({ select: { codigo: true } })).map((u) => u.codigo)
  );
  const paisesValidos = new Set(
    (await prisma.pais.findMany({ select: { iso3: true } })).map((p) => p.iso3)
  );

  // Monta registros válidos e coleta anos únicos
  const registros: {
    orcamentoAno:   number;
    produtoId:      string;
    unidadeVendaId: string;
    month:          Date;
    volumeORC:      number;
    paisIso3:       string | null;
  }[] = [];

  let skipped = 0;

  for (const row of rows) {
    const orcamentoAno   = Number(row.ano);
    const produtoId      = row.produtoId;
    const unidadeVendaId = row.unidadeVendaId;
    const month          = parseMonth(row.month);
    const volumeORC      = Number(row.volumeORC);
    const paisIso3       = row.paisIso3 !== "" ? row.paisIso3 : null;

    if (!produtosValidos.has(produtoId))      { skipped++; continue; }
    if (!unidadesValidas.has(unidadeVendaId)) { skipped++; continue; }
    if (paisIso3 && !paisesValidos.has(paisIso3)) { skipped++; continue; }

    registros.push({ orcamentoAno, produtoId, unidadeVendaId, month, volumeORC, paisIso3 });
  }

  if (skipped > 0) {
    console.log(`⚠️  ${skipped} linhas ignoradas (FK não encontrada no banco)`);
  }

  const anos = [...new Set(registros.map((r) => r.orcamentoAno))];

  // Garante que todos os OrcamentoRun existam
  for (const ano of anos) {
    const existing = await prisma.orcamentoRun.findUnique({ where: { ano } });
    if (!existing) {
      await prisma.orcamentoRun.create({ data: { ano, status: "APROVADO" } });
      console.log(`✔ OrcamentoRun ${ano} criado`);
    } else {
      console.log(`ℹ️  OrcamentoRun ${ano} já existe`);
    }
  }

  // Delete-then-createMany por ano — idempotente, suporta paisIso3 nulo e não-nulo
  for (const ano of anos) {
    const lote = registros.filter((r) => r.orcamentoAno === ano);

    const { count: deleted } = await prisma.orcamentoItem.deleteMany({
      where: { orcamentoAno: ano },
    });

    const { count: created } = await prisma.orcamentoItem.createMany({
      data: lote,
    });

    console.log(`  Ano ${ano}: ${deleted} removidos → ${created} inseridos`);
  }

  console.log(`\n✔ Concluído: ${registros.length} OrcamentoItems carregados`);
}

main()
  .catch((e) => { console.error("❌ Erro:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
