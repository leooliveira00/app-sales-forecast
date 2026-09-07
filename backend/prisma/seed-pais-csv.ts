/**
 * Seed a partir do CSV Pais.csv
 * Carrega ou atualiza registros da tabela Pais via upsert (idempotente).
 *
 * Estrutura esperada do CSV (separador ";"):
 *   iso3;nome;unidadeVendaId;ativo
 *   GRC;Grecia;3201003;true
 *   DEU;Alemanha;3201003;true
 *
 * Campos:
 *   iso3          — Código ISO 3166-1 alpha-3 (chave primária)
 *   nome          — Nome do país
 *   unidadeVendaId — Código da unidade de exportação (ex: 3201003=EMEA, 3201004=APAC, 3201005=LATAM)
 *   ativo         — "true" | "false" (opcional, padrão true)
 *
 * Execute dentro do container backend:
 *   npx tsx prisma/seed-pais-csv.ts
 *   npx tsx prisma/seed-pais-csv.ts MeuArquivo.csv   (arquivo alternativo em prisma/data/)
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const csvArg   = process.argv[2] ?? "Pais.csv";
const CSV_PATH = path.resolve(__dirname, "data", csvArg);

function readCsv(filePath: string) {
  const content = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, ""); // remove BOM
  const lines   = content.split("\n").filter((l) => l.trim() !== "");
  const [headerLine, ...dataLines] = lines;
  const headers = headerLine.split(";").map((h) => h.trim());

  return dataLines.map((line) => {
    const values = line.split(";").map((v) => v.trim());
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
}

async function main() {
  console.log(`🌱 Seed Pais a partir de: ${path.basename(CSV_PATH)}\n`);

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(
      `Arquivo não encontrado: ${CSV_PATH}\n` +
      `Coloque o arquivo em backend/prisma/data/ e reexecute.`
    );
  }

  const rows = readCsv(CSV_PATH);
  console.log(`📄 ${rows.length} linhas lidas`);

  const unidadesValidas = new Set(
    (await prisma.unidadeVenda.findMany({ select: { codigo: true } })).map((u) => u.codigo)
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const iso3           = row.iso3?.trim();
    const nome           = row.nome?.trim();
    const unidadeVendaId = row.unidadeVendaId?.trim();
    const ativo          = row.ativo?.trim().toLowerCase() !== "false";

    if (!iso3 || !nome || !unidadeVendaId) {
      console.warn(`  ⚠️  Linha inválida (campo obrigatório vazio): ${JSON.stringify(row)}`);
      skipped++;
      continue;
    }

    if (!unidadesValidas.has(unidadeVendaId)) {
      console.warn(`  ⚠️  unidadeVendaId "${unidadeVendaId}" não encontrada no banco — iso3=${iso3}`);
      skipped++;
      continue;
    }

    const existing = await prisma.pais.findUnique({ where: { iso3 } });

    await prisma.pais.upsert({
      where:  { iso3 },
      create: { iso3, nome, unidadeVendaId, ativo },
      update: { nome, unidadeVendaId, ativo },
    });

    if (existing) { updated++; } else { created++; }
  }

  console.log(`\n✔ ${created} países criados | ${updated} atualizados`);
  if (skipped > 0) {
    console.log(`⚠️  ${skipped} linhas ignoradas (campo vazio ou unidadeVendaId inexistente)`);
  }
}

main()
  .catch((e) => { console.error("❌ Erro:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
