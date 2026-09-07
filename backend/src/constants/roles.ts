export const ROLES = {
  GESTOR:        "gestor",
  CONTROLADORIA: "controladoria",
  OPERADOR_PCP:  "operador_pcp",
  ADMIN_TI:      "admin_ti",
  /** Somente leitura — nenhuma rota de mutação aceita este perfil. */
  CONSULTA:      "consulta",
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

/** Papéis com acesso de administração (PCP + TI) */
export const ADMIN_ROLES = [ROLES.OPERADOR_PCP, ROLES.ADMIN_TI] as const;

/** Todos os perfis válidos */
export const ALL_ROLES = Object.values(ROLES) as Role[];
