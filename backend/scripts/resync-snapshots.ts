import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env") });

import { refreshConsolidadoSnapshot, refreshAcuraciaSnapshot } from "../src/services/snapshot.service.js";

async function main() {
  console.log("Refreshing 2026...");
  await refreshConsolidadoSnapshot(2026);
  console.log("Refreshing 2027...");
  await refreshConsolidadoSnapshot(2027);
  console.log("Refreshing acurácia...");
  await refreshAcuraciaSnapshot();
  console.log("Done.");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
