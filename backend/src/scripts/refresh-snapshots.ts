import "dotenv/config";
import * as SnapshotService from "../services/snapshot.service.js";

for (const ano of [2024, 2025, 2026]) {
  console.log("Refreshing", ano);
  await SnapshotService.refreshConsolidadoSnapshot(ano);
}
await SnapshotService.refreshAcuraciaSnapshot({});
console.log("done");
process.exit(0);
