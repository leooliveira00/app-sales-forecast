export interface AuditContext {
  operation: string;
  basis?: string;
  percentageApplied?: number;
  fixedValue?: number;
  totalVolume?: number;
  refinementPercentage?: number;
  correlationId?: string;
  affectedCount?: number;
  skipAudit?:     boolean;
}

export interface AuditEntry {
  userId: string | null;
  userNome: string | null;
  userPerfil: string | null;
  source: "user" | "airflow" | "system";
  action: "CREATE" | "UPDATE" | "DELETE" | "STATE_CHANGE" | "LOGIN" | "LOGOUT";
  entity: "ForecastOverride" | "ForecastItem" | "DivisionSubmission" | "Session";
  entityId: string;
  refMonth?: string | null;
  unidadeId?: string | null;
  produtoId?: string | null;
  paisIso3?:  string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}
