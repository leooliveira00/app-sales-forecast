import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Testes unitários de lógica pura — nenhum acessa o banco.
    env: { TZ: "UTC" },
  },
});
