import app from "./src/app.js";
import prisma from "./src/config/prisma.js";
import bcrypt from "bcryptjs";
import { startWatchdogScheduler } from "./src/services/cycle-watchdog.service.js";
import { initAllSnapshots } from "./src/services/snapshot.service.js";

const PORT = process.env.PORT || 3000;

async function ensureAdmin() {
  const email    = process.env.ADMIN_INITIAL_EMAIL;
  const password = process.env.ADMIN_INITIAL_PASSWORD;

  if (!email || !password) {
    return; // criação automática desabilitada — defina ADMIN_INITIAL_EMAIL e ADMIN_INITIAL_PASSWORD para novos deploys
  }

  try {
    const exists = await prisma.user.findUnique({ where: { email } });
    if (!exists) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await prisma.user.create({
        data: { email, password: hashedPassword, nome: "Administrador", perfil: "admin_ti" as const },
      });
      console.log(`✔ Admin inicial criado: ${email}`);
    }
  } catch (err) {
    console.error("Erro ao garantir admin:", err);
  }
}

async function start() {
  await ensureAdmin();
  app.listen(PORT, () => {
    console.log(`✔ Server running on http://localhost:${PORT}`);
    startWatchdogScheduler();
    // Popula snapshots em background — não bloqueia o boot do servidor.
    // Se as tabelas já estiverem populadas, initAllSnapshots retorna imediatamente.
    void initAllSnapshots().catch(err =>
      console.error("[snapshot] init failed — dashboards will use live queries:", err)
    );
  });
}

start().catch((err) => {
  console.error("Erro ao iniciar o servidor:", err);
  process.exit(1);
});
