const REQUIRED_VARS: Array<{ name: string; context: string }> = [
  { name: "DATABASE_URL",        context: "conexão Prisma com PostgreSQL" },
  { name: "JWT_SECRET",          context: "assinatura de tokens JWT" },
  { name: "INTERNAL_SYNC_TOKEN", context: "autenticação de callbacks do Airflow" },
  { name: "AIRFLOW_BASE_URL",    context: "trigger de DAGs no Airflow" },
  { name: "AIRFLOW_USER",        context: "credencial Airflow" },
  { name: "AIRFLOW_PASSWORD",    context: "credencial Airflow" },
];

export function validateEnv(): void {
  const missing = REQUIRED_VARS.filter(({ name }) => !process.env[name]);

  if (missing.length === 0) return;

  console.error("\n[STARTUP] Variáveis de ambiente obrigatórias não definidas:");
  missing.forEach(({ name, context }) => {
    console.error(`  ✗ ${name.padEnd(22)} — ${context}`);
  });
  console.error("\nConfigure as variáveis acima no arquivo .env e reinicie a aplicação.\n");

  process.exit(1);
}
