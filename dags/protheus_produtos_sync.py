from __future__ import annotations

import json
import os
import ssl
import base64
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from pathlib import Path

from airflow.models.dag import DAG
from airflow.operators.python import PythonOperator
from airflow.models import Variable

# ── Constantes ────────────────────────────────────────────────────────────────

DAG_ID      = "protheus_produtos_sync"
TMP_DIR     = Path("/tmp")
CHUNK_SIZE  = 500   # itens por POST — evita "connection reset" em proxies com limite de body

DEFAULT_ARGS = {
    "owner": "airflow",
    "retries": 3,
    "retry_delay": timedelta(minutes=5),
    "retry_exponential_backoff": True,
}

# ── Task 1: Extrair todos os produtos do Protheus ─────────────────────────────

def _parse_tipos(raw: str) -> list[str]:
    """Converte PROTHEUS_CTIPO em lista. Aceita JSON array ou string simples."""
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [t.strip() for t in parsed if t.strip()]
        return [str(parsed).strip()]
    except json.JSONDecodeError:
        return [raw.strip()]


def fetch_all_produtos(**context) -> dict:
    base_url  = Variable.get("PROTHEUS_BASE_URL")
    user      = Variable.get("PROTHEUS_USER")
    password  = Variable.get("PROTHEUS_PASSWORD")
    tipos     = _parse_tipos(Variable.get("PROTHEUS_CTIPO", default_var='["PA"]'))
    run_id    = context["run_id"]

    credentials = base64.b64encode(f"{user}:{password}".encode()).decode()
    headers = {
        "Authorization": f"Basic {credentials}",
        "Content-Type": "application/json",
    }

    # Protheus usa certificado interno — desabilita verificação SSL
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    all_items = []

    for ctipo in tipos:
        page = 1
        total_pages = None
        type_items  = []
        # Guarda códigos das 2 primeiras páginas para diagnóstico
        page1_codes: set[str] = set()
        page2_codes: set[str] = set()
        print(f"[fetch] Iniciando extração para tipo: {ctipo}")

        while True:
            url = f"{base_url}/rest02/ProtheusCrm/listaprodutos?cTipo={ctipo}&nPage={page}"
            req = urllib.request.Request(url, headers=headers)

            try:
                with urllib.request.urlopen(req, timeout=30, context=ssl_ctx) as response:
                    data = json.loads(response.read())
            except urllib.error.HTTPError as e:
                raise RuntimeError(f"Protheus HTTP {e.code} — tipo={ctipo} página {page}: {e.reason}")
            except urllib.error.URLError as e:
                raise RuntimeError(f"Erro de conexão com Protheus — tipo={ctipo} página {page}: {e.reason}")

            meta  = data["metaDados"]
            items = data["itens"]

            # Ignora produtos bloqueados — apenas "Ativo" deve ser sincronizado
            total_recebidos = len(items)
            items = [i for i in items if str(i.get("bloqueado", "")).strip().lower() == "ativo"]
            bloqueados = total_recebidos - len(items)
            if bloqueados:
                print(f"[fetch] tipo={ctipo} página {page} — {bloqueados} produto(s) bloqueado(s) ignorado(s)")

            type_items.extend(items)

            if total_pages is None:
                total_pages = meta["totalPaginas"]
                print(f"[fetch] tipo={ctipo} — {total_pages} páginas | {meta['total']} itens")

            # Coleta códigos das 2 primeiras páginas para diagnóstico
            if page == 1:
                page1_codes = {i.get("produto", "").strip().upper() for i in items}
                print(f"[fetch][diag] tipo={ctipo} pág.1 — {len(page1_codes)} códigos únicos: {sorted(page1_codes)[:10]}...")
            elif page == 2:
                page2_codes = {i.get("produto", "").strip().upper() for i in items}
                overlap = page1_codes & page2_codes
                print(f"[fetch][diag] tipo={ctipo} pág.2 — {len(page2_codes)} únicos | sobreposição com pág.1: {len(overlap)} ({sorted(overlap)[:5]}...)")

            print(f"[fetch] tipo={ctipo} página {page}/{total_pages} — {len(items)} itens recebidos")

            if page >= total_pages:
                break
            page += 1

        unique_type = len({i.get("produto", "").strip().upper() for i in type_items})
        print(f"[fetch] tipo={ctipo} concluído — {len(type_items)} itens | {unique_type} códigos únicos")
        all_items.extend(type_items)

    # Persiste em /tmp para a próxima task
    # O payload inclui todos os campos da API:
    #   produto, tipo, descricao, classe,
    #   codigoFamiliaAGM, descricaoFamiliaAGM,
    #   codigoClasseValor, descricaoClasseValor
    tmp_file = TMP_DIR / f"produtos_sync_{run_id}.json"
    tmp_file.write_text(json.dumps(all_items, ensure_ascii=False))

    print(f"[fetch] Concluído: {len(all_items)} produtos no total ({', '.join(tipos)}) — salvos em {tmp_file}")
    return {"total": len(all_items), "tmp_file": str(tmp_file)}


# ── Task 2: Enviar payload ao backend ─────────────────────────────────────────

def push_to_backend(**context) -> None:
    backend_url = Variable.get("FORECAST_BACKEND_URL")
    token       = Variable.get("FORECAST_INTERNAL_TOKEN")
    tipos       = _parse_tipos(Variable.get("PROTHEUS_CTIPO", default_var='["PA"]'))
    run_id      = context["run_id"]

    # triggered_by: vem do conf do DAG se disparado manualmente
    dag_conf     = context["dag_run"].conf or {}
    triggered_by = dag_conf.get("triggered_by", "airflow-scheduler")

    tmp_file = TMP_DIR / f"produtos_sync_{run_id}.json"

    # SSL context reutilizado caso FORECAST_BACKEND_URL seja HTTPS com certificado interno
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    try:
        all_items = json.loads(tmp_file.read_text())
        total     = len(all_items)
        chunks    = [all_items[i:i + CHUNK_SIZE] for i in range(0, total, CHUNK_SIZE)]
        ctipo_label = ",".join(tipos)

        print(f"[push] {total} itens divididos em {len(chunks)} lote(s) de até {CHUNK_SIZE}")

        url = f"{backend_url}/api/internal/sync/produtos"

        for idx, chunk in enumerate(chunks, start=1):
            # O backend usa todos os campos para sincronizar Produto e ProdutoUnidadeVenda:
            #   - Produto: codigo, descricao, tipo, classe
            #   - ProdutoUnidadeVenda: produtoId (produto), unidadeVendaId (codigoClasseValor),
            #                          codigoFamilia (codigoFamiliaAGM), familia (descricaoFamiliaAGM),
            #                          divisao (descricaoClasseValor)
            payload = json.dumps({
                "triggeredBy": triggered_by,
                "cTipo": ctipo_label,  # ex: "PA,PI,MP" — apenas para log no backend
                "itens": chunk,
            }, ensure_ascii=False).encode("utf-8")

            req = urllib.request.Request(
                url,
                data=payload,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )

            with urllib.request.urlopen(req, timeout=60, context=ssl_ctx) as response:
                result = json.loads(response.read())
                print(f"[push] Lote {idx}/{len(chunks)} ({len(chunk)} itens) — backend: {result}")

        print(f"[push] Concluído: {total} itens enviados em {len(chunks)} lote(s)")

        # Callback ao backend para avançar gate do ciclo
        ref_month = context["logical_date"].strftime("%Y-%m-01")
        try:
            cb_payload = json.dumps({
                "dag_id": DAG_ID, "dag_run_id": run_id, "state": "success",
                "refMonth": ref_month,
                "issued_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            }).encode("utf-8")
            cb_req = urllib.request.Request(
                f"{backend_url}/api/airflow/callback",
                data=cb_payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(cb_req, timeout=30, context=ssl_ctx) as cb_resp:
                print(f"[push] Callback enviado — refMonth={ref_month} resp={json.loads(cb_resp.read())}")
        except Exception as exc:
            print(f"[push] Falha no callback (não crítico): {exc}")

    finally:
        # Garante limpeza do arquivo temporário mesmo em caso de erro
        if tmp_file.exists():
            tmp_file.unlink()
            print(f"[push] Arquivo temporário removido: {tmp_file}")


# ── DAG ───────────────────────────────────────────────────────────────────────

with DAG(
    dag_id=DAG_ID,
    description="Extrai produtos do Protheus e sincroniza Produto (tipo, classe) + ProdutoUnidadeVenda (codigoFamilia, familia, divisao) no backend Forecast",
    schedule_interval=Variable.get("SYNC_PRODUTOS_CRON_SCHEDULE", default_var="0 3 1 * *"),
    start_date=datetime(2026, 1, 1),
    catchup=False,
    default_args=DEFAULT_ARGS,
    tags=["protheus", "sync", "produtos", "produto-unidade-venda"],
) as dag:

    task_fetch = PythonOperator(
        task_id="fetch_all_produtos",
        python_callable=fetch_all_produtos,
    )

    task_push = PythonOperator(
        task_id="push_to_backend",
        python_callable=push_to_backend,
    )

    task_fetch >> task_push
