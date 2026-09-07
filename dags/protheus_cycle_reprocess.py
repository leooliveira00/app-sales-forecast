"""
DAG: protheus_cycle_reprocess
==============================
Orquestrador de reprocessamento do ciclo mensal de forecast.

Propósito
---------
Garante que as três DAGs do ciclo sejam executadas em ordem sequencial,
respeitando as dependências de dados entre elas:

  1. protheus_produtos_sync  — atualiza catálogo de produtos (Protheus → banco)
  2. protheus_vendas_sync    — sincroniza histórico de vendas (Protheus → VendaMensal)
  3. protheus_forecast_run   — treina modelos de IA sobre os dados atualizados

Por que a ordem importa
-----------------------
- O forecast_run lê VendaMensal no início da execução (task fetch_sales_data).
  Se o vendas_sync ainda não concluiu, o modelo é treinado com dados desatualizados.
- O vendas_sync pode registrar novos pares produto×unidade na ProdutoUnidadeVenda.
  Se o produtos_sync não precedê-lo, produtos novos do Protheus podem ser ignorados.

Acionamento
-----------
Esta DAG é disparada exclusivamente pelo backend (endpoint de reprocessamento de ciclo).
Nunca deve ser acionada diretamente pelo scheduler ou manualmente pelo Airflow UI
sem que o backend tenha preparado o estado do ciclo (gate = REPROCESSING,
expectedDagRunIds registrados).

Cada DAG filha continua existindo de forma independente e pode ser acionada
isoladamente para sincronizações pontuais fora do fluxo de reprocessamento.

Configuração via dag_run.conf
-----------------------------
  refMonth      — mês de referência do ciclo (ex: "2026-04-01")  [obrigatório]
  rerunReason   — motivo do reprocessamento para auditoria        [opcional]

Variáveis Airflow utilizadas
----------------------------
  Nenhuma. Esta DAG apenas orquestra; as variáveis de cada DAG filha
  são consumidas por elas mesmas.

Callbacks ao backend
--------------------
  Cada DAG filha é responsável por chamar POST /api/airflow/callback ao finalizar.
  Esta DAG orquestradora envia POST /api/airflow/cycle-failed via on_failure_callback
  caso falhe antes de disparar qualquer DAG filha (ex.: erro de configuração).
  Isso garante que o ciclo transite para FAILED em vez de ficar preso em REPROCESSING.

Fluxo de estados no backend
----------------------------
  Backend dispara esta DAG → gate = REPROCESSING
  produtos_sync finaliza   → callback → stepsCompleted["protheus_produtos_sync"]
  vendas_sync finaliza     → callback → stepsCompleted["protheus_vendas_sync"]
  forecast_run finaliza    → callback → gate = READY (ciclo aberto para gestores)
"""

from __future__ import annotations

import urllib.request
import urllib.error
import json
from datetime import datetime, timedelta

from airflow.models.dag import DAG
from airflow.models import Variable
from airflow.operators.trigger_dagrun import TriggerDagRunOperator


def _notify_backend_orchestrator_failed(context) -> None:
    """
    Chamado quando a própria DAG orquestradora falha (ex.: erro de conf antes de
    disparar qualquer DAG filha). Nesse cenário, nenhuma DAG filha chega a rodar,
    portanto nenhum callback normal é enviado e o ciclo ficaria preso em REPROCESSING.
    Este callback força a transição do gate para FAILED no backend.
    """
    conf = context.get("dag_run").conf or {}
    ref_month = conf.get("refMonth")
    if not ref_month:
        return

    try:
        backend_url = Variable.get("FORECAST_BACKEND_URL", default_var="http://backend:3000")
        token       = Variable.get("FORECAST_INTERNAL_TOKEN", default_var="")

        payload = json.dumps({"refMonth": ref_month}).encode()
        req = urllib.request.Request(
            f"{backend_url}/api/airflow/cycle-failed",
            data=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type":  "application/json",
            },
            method="POST",
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as exc:  # noqa: BLE001
        print(f"[protheus_cycle_reprocess] Erro ao notificar backend sobre falha: {exc}")

# ── Constantes ────────────────────────────────────────────────────────────────

DAG_ID = "protheus_cycle_reprocess"

# Timeout por DAG filha: 3 horas.
# O vendas_sync pode demorar se o histórico for extenso; o forecast_run
# pode levar até 2h dependendo do volume de grupos produto×unidade×país.
CHILD_DAG_TIMEOUT = timedelta(hours=3)

DEFAULT_ARGS = {
    "owner":  "airflow",
    "retries": 0,  # Reprocessamento manual — falhas devem ser visíveis, não silenciosas
}

# ── DAG Definition ────────────────────────────────────────────────────────────

with DAG(
    dag_id=DAG_ID,
    default_args=DEFAULT_ARGS,
    description=(
        "Orquestrador de reprocessamento: executa produtos_sync → vendas_sync → "
        "forecast_run em sequência, garantindo que cada etapa conclua antes da próxima iniciar."
    ),
    schedule_interval=None,   # apenas via API (acionado pelo backend)
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,        # um reprocessamento por vez
    on_failure_callback=_notify_backend_orchestrator_failed,
    tags=["protheus", "forecast", "reprocess", "orchestrator"],
) as dag:

    # ── Task 1: Sincronização de Produtos ─────────────────────────────────────
    # Deve ser o primeiro passo para garantir que novos produtos do Protheus
    # estejam disponíveis antes da sincronização de vendas.

    task_produtos = TriggerDagRunOperator(
        task_id="trigger_produtos_sync",
        trigger_dag_id="protheus_produtos_sync",
        conf="{{ dag_run.conf | tojson }}",  # repassa refMonth e rerunReason
        wait_for_completion=True,
        poke_interval=30,                   # verifica status a cada 30s
        execution_timeout=CHILD_DAG_TIMEOUT,
        reset_dag_run=True,                 # permite reacionar se run já existir
        deferrable=False,
    )

    # ── Task 2: Sincronização de Vendas ──────────────────────────────────────
    # Atualiza VendaMensal com os dados mais recentes do Protheus.
    # Obrigatoriamente após produtos_sync para que novos pares produto×unidade
    # sejam reconhecidos durante o ETL de vendas.

    task_vendas = TriggerDagRunOperator(
        task_id="trigger_vendas_sync",
        trigger_dag_id="protheus_vendas_sync",
        conf="{{ dag_run.conf | tojson }}",
        wait_for_completion=True,
        poke_interval=30,
        execution_timeout=CHILD_DAG_TIMEOUT,
        reset_dag_run=True,
        deferrable=False,
    )

    # ── Task 3: Execução do Forecast ──────────────────────────────────────────
    # Treina os modelos de IA sobre o histórico de vendas atualizado.
    # Deve ser sempre o último passo — depende de VendaMensal atualizada.

    task_forecast = TriggerDagRunOperator(
        task_id="trigger_forecast_run",
        trigger_dag_id="protheus_forecast_run",
        conf="{{ dag_run.conf | tojson }}",
        wait_for_completion=True,
        poke_interval=60,                   # forecast é mais longo — verifica a cada 60s
        execution_timeout=CHILD_DAG_TIMEOUT,
        reset_dag_run=True,
        deferrable=False,
    )

    # ── Sequência garantida ───────────────────────────────────────────────────
    task_produtos >> task_vendas >> task_forecast
