export const ROLES = {
  GESTOR:        "gestor",
  OPERADOR_PCP:  "operador_pcp",
  ADMIN_TI:      "admin_ti",
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

/** Papéis com acesso de administração (PCP + TI) */
export const ADMIN_ROLES: string[] = [ROLES.OPERADOR_PCP, ROLES.ADMIN_TI];

/** Todos os perfis válidos */
export const ALL_ROLES: string[] = Object.values(ROLES);
