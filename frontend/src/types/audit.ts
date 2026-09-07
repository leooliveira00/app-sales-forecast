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

export interface AuditLogEntry {
  id: string;
  createdAt: string;
  userId: string | null;
  userNome: string | null;
  userPerfil: string | null;
  source: string;
  action: string;
  entity: string;
  entityId: string;
  refMonth: string | null;
  unidadeId: string | null;
  produtoId: string | null;
  paisIso3:  string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface AuditResponse {
  total: number;
  page: number;
  limit: number;
  logs: AuditLogEntry[];
  produtoMap: Record<string, { codigo: string; descricao: string; familia?: string | null }>;
  familiaMap: Record<string, string | null>;
  userMap:    Record<string, string>;
}

export interface ItemHistoryEntry {
  type: "history" | "audit";
  timestamp: string;
  userId: string | null;
  userNome: string | null;
  userPerfil: string;
  action: string;
  operation?: string;
  volumeFCTS?: number;
  note?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}
