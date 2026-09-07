// ── Types ────────────────────────────────────────────────────────────────────

export interface AirflowDag {
  dag_id: string;
  description: string | null;
  is_paused: boolean;
  is_active: boolean;
  tags: { name: string }[];
  next_dagrun_data_interval_start: string | null;
}

export interface AirflowDagRun {
  dag_run_id: string;
  state: "success" | "failed" | "running" | "queued";
  execution_date: string;
  start_date: string | null;
  end_date: string | null;
  conf: Record<string, unknown>;
}

export interface AirflowDagsResponse {
  dags: AirflowDag[];
  total_entries: number;
}

export interface AirflowDagRunsResponse {
  dag_runs: AirflowDagRun[];
  total_entries: number;
}

export interface ConnectionStatus {
  ok: boolean;
  version?: string;
  baseUrl?: string;
  error?: string;
}

export interface AirflowTaskInstance {
  task_id:    string;
  dag_id:     string;
  dag_run_id: string;
  state:      "success" | "failed" | "running" | "queued" | "skipped" | "upstream_failed" | null;
  start_date: string | null;
  end_date:   string | null;
  duration:   number | null;
  try_number: number;
  operator:   string | null;
}

export interface AirflowTaskInstancesResponse {
  task_instances: AirflowTaskInstance[];
  total_entries:  number;
}

export interface AirflowVariable {
  key:         string;
  value:       string;
  description: string | null;
}

export interface AirflowVariablesResponse {
  variables:     AirflowVariable[];
  total_entries: number;
}

// ── Internal ─────────────────────────────────────────────────────────────────

const BASE_URL = process.env.AIRFLOW_BASE_URL ?? "";
const AF_USER  = process.env.AIRFLOW_USER     ?? "";
const AF_PASS  = process.env.AIRFLOW_PASSWORD ?? "";

function basicAuth(): string {
  return "Basic " + Buffer.from(`${AF_USER}:${AF_PASS}`).toString("base64");
}

async function afFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${BASE_URL}/api/v1${path}`;
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuth(),
      ...(options.headers as object ?? {}),
    },
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function testConnection(): Promise<ConnectionStatus> {
  try {
    // Primeiro obtém a versão (endpoint público — confirma que o servidor responde)
    const versionRes = await afFetch("/version");
    if (!versionRes.ok) {
      return { ok: false, baseUrl: BASE_URL, error: `Servidor inacessível: HTTP ${versionRes.status}` };
    }
    const versionData = await versionRes.json() as { version: string };

    // Depois confirma que as credenciais funcionam num endpoint protegido
    const authRes = await afFetch("/dags?limit=1");
    if (!authRes.ok) {
      const body = await authRes.text().catch(() => "");
      const hint = authRes.status === 401
        ? " — Basic Auth não está ativo no Airflow ou as credenciais são inválidas."
        : "";
      return {
        ok: false,
        version: versionData.version,
        baseUrl: BASE_URL,
        error: `Autenticação falhou: HTTP ${authRes.status}${hint}`,
      };
    }

    return { ok: true, version: versionData.version, baseUrl: BASE_URL };
  } catch (err) {
    return { ok: false, baseUrl: BASE_URL, error: (err as Error).message };
  }
}

export async function listDags(): Promise<AirflowDagsResponse> {
  const res = await afFetch("/dags?limit=100");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airflow /dags HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<AirflowDagsResponse>;
}

export async function getDag(dagId: string): Promise<AirflowDag | null> {
  const res = await afFetch(`/dags/${encodeURIComponent(dagId)}`);
  if (!res.ok) return null;
  return res.json() as Promise<AirflowDag>;
}

export async function getDagRuns(dagId: string, limit = 10): Promise<AirflowDagRunsResponse> {
  const res = await afFetch(`/dags/${encodeURIComponent(dagId)}/dagRuns?limit=${limit}&order_by=-execution_date`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airflow /dagRuns HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<AirflowDagRunsResponse>;
}

export async function triggerDag(dagId: string, conf: Record<string, unknown> = {}): Promise<AirflowDagRun> {
  const res = await afFetch(`/dags/${encodeURIComponent(dagId)}/dagRuns`, {
    method: "POST",
    body: JSON.stringify({ conf }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airflow triggerDag: HTTP ${res.status} — ${body}`);
  }
  return res.json() as Promise<AirflowDagRun>;
}

export async function pauseDag(dagId: string, isPaused: boolean): Promise<AirflowDag> {
  const res = await afFetch(`/dags/${encodeURIComponent(dagId)}`, {
    method: "PATCH",
    body: JSON.stringify({ is_paused: isPaused }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airflow pauseDag HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<AirflowDag>;
}

export async function cancelDagRun(dagId: string, dagRunId: string): Promise<AirflowDagRun> {
  const res = await afFetch(
    `/dags/${encodeURIComponent(dagId)}/dagRuns/${encodeURIComponent(dagRunId)}`,
    { method: "PATCH", body: JSON.stringify({ state: "failed" }) },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airflow cancelDagRun HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<AirflowDagRun>;
}

export async function getTaskInstances(
  dagId: string,
  runId: string
): Promise<AirflowTaskInstancesResponse> {
  const res = await afFetch(
    `/dags/${encodeURIComponent(dagId)}/dagRuns/${encodeURIComponent(runId)}/taskInstances`
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airflow /taskInstances HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<AirflowTaskInstancesResponse>;
}

export async function getTaskLog(
  dagId:     string,
  runId:     string,
  taskId:    string,
  tryNumber: number
): Promise<string> {
  const res = await afFetch(
    `/dags/${encodeURIComponent(dagId)}/dagRuns/${encodeURIComponent(runId)}/taskInstances/${encodeURIComponent(taskId)}/logs/${tryNumber}`,
    { headers: { Accept: "text/plain" } }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airflow /logs HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res.text();
}

export async function listVariables(): Promise<AirflowVariablesResponse> {
  const res = await afFetch("/variables?limit=200&order_by=key");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airflow /variables HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<AirflowVariablesResponse>;
}

export async function createVariable(
  key: string,
  value: string,
  description?: string
): Promise<AirflowVariable> {
  const res = await afFetch("/variables", {
    method: "POST",
    body: JSON.stringify({ key, value, description: description ?? "" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airflow createVariable HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<AirflowVariable>;
}

export async function updateVariable(
  key: string,
  value: string,
  description?: string
): Promise<AirflowVariable> {
  const res = await afFetch(`/variables/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify({ key, value, description: description ?? "" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airflow updateVariable HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<AirflowVariable>;
}

export async function deleteVariable(key: string): Promise<void> {
  const res = await afFetch(`/variables/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airflow deleteVariable HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
}

export async function clearDagRun(dagId: string, dagRunId: string): Promise<unknown> {
  const res = await afFetch(`/dags/${encodeURIComponent(dagId)}/clearTaskInstances`, {
    method: "POST",
    body: JSON.stringify({
      dag_run_id: dagRunId,
      include_downstream: true,
      include_future: false,
      include_parentdag: false,
      include_subdags: true,
      only_failed: false,
      reset_dag_runs: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airflow clearDagRun HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res.json();
}
