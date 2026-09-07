import "dotenv/config";
import { runBackfill } from "../services/backfill.service.js";

const args   = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Uso: npm run backfill -- [flags]

Flags:
  --dry-run              Simula sem escrever no banco.
  --anos=2024,2025       Anos do orçamento a popular (padrão: 2024,2025,2026).
  --ciclo-de=YYYY-MM-DD  Primeiro ciclo a backfillar (padrão: 2023-11-01).
  --ciclo-ate=YYYY-MM-DD Último ciclo a backfillar (padrão: 2026-03-01).
  --tipos=NACIONAL,EXPORT  Restringe por tipo de unidade.
  --unidades=COD1,COD2     Restringe por código(s) de unidade.
  --all                  Em produção, autoriza escopo total (sem filtro de unidade).
  --help, -h             Mostra esta ajuda.

Exemplos:
  npm run backfill -- --dry-run --tipos=EXPORT
  npm run backfill -- --tipos=EXPORT --ciclo-de=2025-01-01
  npm run backfill -- --unidades=3201002 --dry-run
`);
  process.exit(0);
}

const anoFlag = args.find(a => a.startsWith("--anos="));
const orcAnos = anoFlag
  ? anoFlag.replace("--anos=", "").split(",").map(Number)
  : undefined;

const deFlag  = args.find(a => a.startsWith("--ciclo-de="));
const ateFlag = args.find(a => a.startsWith("--ciclo-ate="));
const cicloDe  = deFlag  ? new Date(deFlag.replace("--ciclo-de=",  "") + "T00:00:00.000Z") : undefined;
const cicloAte = ateFlag ? new Date(ateFlag.replace("--ciclo-ate=", "") + "T00:00:00.000Z") : undefined;

const tiposFlag = args.find(a => a.startsWith("--tipos="));
const tiposRaw  = tiposFlag ? tiposFlag.replace("--tipos=", "").split(",").map(s => s.trim().toUpperCase()) : [];
const tiposValidos = ["NACIONAL", "EXPORT"] as const;
const tiposInvalidos = tiposRaw.filter(t => !tiposValidos.includes(t as typeof tiposValidos[number]));
if (tiposInvalidos.length) {
  console.error(`✗ Tipos inválidos: ${tiposInvalidos.join(", ")}. Use NACIONAL ou EXPORT.`);
  process.exit(1);
}
const unidadeTipos = tiposRaw.length ? (tiposRaw as ("NACIONAL" | "EXPORT")[]) : undefined;

const unidadesFlag   = args.find(a => a.startsWith("--unidades="));
const unidadeCodigos = unidadesFlag
  ? unidadesFlag.replace("--unidades=", "").split(",").map(s => s.trim()).filter(Boolean)
  : undefined;

const allowFullBackfill = args.includes("--all");

console.log("╔══════════════════════════════════════════════╗");
console.log("║       BACKFILL — Orçado + Forecast           ║");
console.log("╚══════════════════════════════════════════════╝");

runBackfill({ dryRun, orcAnos, cicloDe, cicloAte, unidadeTipos, unidadeCodigos, allowFullBackfill })
  .then(stats => {
    console.log("\n✓ Backfill finalizado:");
    console.table(stats);
    process.exit(0);
  })
  .catch(err => {
    console.error("\n✗ Erro no backfill:", err);
    process.exit(1);
  });
