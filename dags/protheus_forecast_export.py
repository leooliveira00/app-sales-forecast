"""
DAG: protheus_forecast_export
==============================
Envia os dados de forecast aprovados ao Protheus ERP para geração das
demandas de compra de matéria-prima.

Acionada pelo backend após o admin_ti clicar "Enviar ao Protheus".
Nunca é agendada por cron — apenas manual/via API.

Fluxo:
  1. fetch_export_data  — busca itens PENDING no backend (snapshot já criado)
  2. process_units      — FASE 1: DELETE mês a mês (a exclusão da janela inteira
                          responde OK mas deixa produtos para trás), cada mês
                          conferido por leitura antes de seguir.
                          FASE 2: POST por unidade/mês.
                          O Protheus responde HTTP 200 mesmo com itens
                          rejeitados (itensComErro); por isso o POST parseia
                          esse campo e, além disso, LÊ O MÊS DE VOLTA
                          (read-after-write) antes de reportar sucesso — o ERP
                          grava de forma sincrônica e o 200 não prova gravação.
  3. verify_export      — relê a janela inteira por unidade, com tudo enviado, e
                          reclassifica como FAILED o que não está no ERP. Pega a
                          interferência entre unidades (o POST de uma unidade pode
                          remover itens de outra já gravados) e as duplicidades.
  4. finalize           — reporta status final ao backend

Política de divergência: qualquer desvio entre o forecast aprovado e o que está no
ERP INTERROMPE o envio (mês que não limpou, item não confirmado, volume diferente,
duplicidade, erro transitório que sobreviveu aos retries) — o PCP planeja a compra de
matéria-prima sobre esses números. A única exceção é o produto bloqueado no cadastro
(B1_MSBLQL): divergência conhecida, reportada por item, que não trava o ciclo.

Callbacks ao backend:
  POST /api/internal/protheus-export/delete-status  (por unidade)
  POST /api/internal/protheus-export/progress       (por mês×unidade)
  POST /api/internal/protheus-export/finalize       (ao final)

Configuração (Airflow Variables):
  FORECAST_BACKEND_URL  — URL base do backend (ex: http://backend:3000/api)
  FORECAST_INTERNAL_TOKEN — token para autenticação interna
  PROTHEUS_BASE_URL     — base URL do Protheus REST
  PROTHEUS_USER         — usuário Basic Auth Protheus
  PROTHEUS_PASSWORD     — senha Basic Auth Protheus
"""

from __future__ import annotations

import json
import ssl
import base64
import time
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from airflow.models.dag import DAG
from airflow.operators.python import PythonOperator
from airflow.models import Variable

# ── Constantes ────────────────────────────────────────────────────────────────

DAG_ID       = "protheus_forecast_export"
MAX_RETRIES       = 3           # tentativas por chamada HTTP ao Protheus
RETRY_DELAYS      = [5, 15, 30] # backoff em segundos — dá tempo ao Protheus de se recuperar
ITEM_RETRY_MAX    = 3           # tentativas reenviando APENAS os itens rejeitados pelo Protheus
ITEM_RETRY_DELAY  = 10          # backoff em segundos entre reenvios de itens rejeitados
HTTP_TIMEOUT      = 300         # Protheus leva 6-50s normalmente; 300s para absorver picos de carga
HTTP_TIMEOUT_DELETE = 300       # timeout para DELETE da janela inteira (segundos)

# Verificação de gravação (read-after-write).
# O Protheus grava de forma SINCRÔNICA: o lote precisa estar efetivamente gravado
# antes da próxima chamada. Como o WS responde HTTP 200 sem garantir isso, cada POST
# é conferido lendo de volta o mês em `listaprevisoes` antes de seguir adiante.
VERIFY_SETTLE     = 5           # espera (s) antes de ler de volta o lote recém-enviado
VERIFY_READ_TRIES = 3           # leituras antes de declarar um item como não gravado
VERIFY_READ_DELAY = 10          # espera (s) entre leituras de conferência
DELETE_VERIFY_TRIES = 3         # tentativas de DELETE até o mês ficar vazio no ERP

DEFAULT_ARGS = {
    "owner":                    "airflow",
    "retries":                  3,
    "retry_delay":              timedelta(minutes=2),
    "retry_exponential_backoff": True,
}

# ── Helpers SSL / HTTP ────────────────────────────────────────────────────────

def _ssl_ctx() -> ssl.SSLContext:
    """SSL context sem verificação de certificado.

    Necessário em dois destinos: o Protheus (self-signed) e o próprio backend,
    quando FORECAST_BACKEND_URL é HTTPS servido pelo Traefik com certificado de
    CA interna (dev/hml, FRONTEND_CERTRESOLVER vazio) — essa CA não está no trust
    store do container do Airflow. Mesmo tratamento das demais DAGs.
    """
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode    = ssl.CERT_NONE
    return ctx


def _basic_auth(user: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()


def _decode_response(raw: bytes, content_encoding: str) -> str:
    """Descomprime (se necessário) e decodifica bytes da resposta."""
    import gzip as _gzip
    if content_encoding == "gzip":
        raw = _gzip.decompress(raw)
    elif content_encoding == "deflate":
        import zlib as _zlib
        raw = _zlib.decompress(raw)
    return raw.decode("utf-8", errors="replace")


def _backend_get(url: str, token: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "Authorization":   f"Bearer {token}",
            "Content-Type":    "application/json",
            "Accept-Encoding": "identity",   # impede gzip — evita body binário
        },
    )
    try:
        with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=HTTP_TIMEOUT) as resp:
            raw      = resp.read()
            encoding = resp.headers.get("Content-Encoding", "").lower()
            ct       = resp.headers.get("Content-Type", "?")
            cl       = resp.headers.get("Content-Length", "?")
            print(
                f"[_backend_get] status={resp.status} ct={ct!r} "
                f"encoding={encoding!r} cl={cl} raw_len={len(raw)} "
                f"raw_hex={raw[:40].hex()}"
            )
            body = _decode_response(raw, encoding)
            if not body.strip():
                raise ValueError(
                    f"Backend retornou resposta vazia (HTTP {resp.status}, "
                    f"{len(raw)} bytes brutos) para GET {url}"
                )
            return json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Backend retornou HTTP {e.code} para GET {url} — corpo: {body!r}"
        ) from e


def _backend_post(url: str, token: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization":   f"Bearer {token}",
            "Content-Type":    "application/json",
            "Accept-Encoding": "identity",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=HTTP_TIMEOUT) as resp:
            raw      = resp.read()
            encoding = resp.headers.get("Content-Encoding", "").lower()
            body     = _decode_response(raw, encoding)
            if not body.strip():
                raise ValueError(
                    f"Backend retornou resposta vazia (HTTP {resp.status}, "
                    f"{len(raw)} bytes brutos) para POST {url}"
                )
            return json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Backend retornou HTTP {e.code} para POST {url} — corpo: {body!r}"
        ) from e


def _log_protheus_response(raw: bytes, operation: str, url: str, http_status: int) -> None:
    """Loga o body da resposta Protheus para diagnóstico de falhas silenciosas."""
    try:
        text = raw.decode("utf-8", errors="replace").strip()
    except Exception:
        text = ""
    preview = text[:800] if text else "(body vazio)"
    print(f"[protheus {operation}] http={http_status} url={url} response={preview}")


def _protheus_delete(url: str, credentials: str) -> None:
    req = urllib.request.Request(
        url,
        headers={"Authorization": credentials, "Content-Type": "application/json"},
        method="DELETE",
    )
    with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=HTTP_TIMEOUT_DELETE) as resp:
        raw = resp.read()
        _log_protheus_response(raw, "DELETE", url, resp.status)


def _parse_itens_com_erro(raw: bytes) -> dict:
    """Extrai os produtos REJEITADOS da resposta do Protheus.

    A resposta tem o formato:
        {"status":200,"msg":"...","itensComErro":[["100126","Tabela SC4 ..."],["128032",""], ...]}
    Cada par é [produtoId, mensagem]. Mensagem vazia = item importado com
    sucesso; mensagem não-vazia = item rejeitado pelo Protheus. Retorna
    {produtoId: mensagem} apenas dos rejeitados. Retorna {} se a resposta
    não puder ser parseada (mantém o comportamento antigo de "sucesso").
    """
    try:
        body = raw.decode("utf-8", errors="replace").strip()
        data = json.loads(body)
    except Exception:
        return {}
    erros = {}
    for entry in (data.get("itensComErro") or []):
        if isinstance(entry, (list, tuple)) and len(entry) >= 2:
            produto = str(entry[0]).strip()
            msg     = str(entry[1]).strip()
            if produto and msg:
                erros[produto] = msg
    return erros


def _protheus_post(url: str, credentials: str, payload: dict) -> dict:
    """Envia POST ao Protheus. Retorna {produtoId: mensagem} dos itens
    rejeitados (itensComErro com mensagem não-vazia); dict vazio = todos OK.

    O `importarprevisaovendas` era exposto como PUT; o time Protheus passou a
    aceitá-lo como POST. Só o método mudou — path, payload e resposta seguem os
    mesmos, assim como a semântica de substituição da previsão do mês/unidade.

    Atenção: o Protheus responde HTTP 200 mesmo quando alguns produtos
    falham — por isso o sucesso real é determinado pelo itensComErro, não
    pelo status HTTP."""
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(
        url,
        data=data,
        headers={"Authorization": credentials, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=HTTP_TIMEOUT) as resp:
        raw = resp.read()
        _log_protheus_response(raw, "POST", url, resp.status)
    erros = _parse_itens_com_erro(raw)
    if erros:
        print(f"[protheus POST] {len(erros)} item(ns) rejeitado(s): {sorted(erros.keys())}")
    return erros


def _month_bounds(month_str: str) -> tuple[str, str]:
    """"YYYYMM" → ("YYYYMM01", "YYYYMMúltimo-dia") no formato aceito pelo Protheus."""
    import calendar
    ano, mes = int(month_str[:4]), int(month_str[4:])
    ultimo   = calendar.monthrange(ano, mes)[1]
    return f"{month_str}01", f"{month_str}{ultimo:02d}"


def _protheus_list(list_url: str, credentials: str, unidade: str, data_de: str, data_ate: str) -> dict:
    """Lê a previsão gravada no ERP.

    Retorna {(produtoId, "YYYYMM"): [quantidade_somada, qtd_de_lançamentos]}.
    Mais de um lançamento para a mesma chave indica DUPLICIDADE no ERP — o
    `importarprevisaovendas` deveria substituir, mas em parte dos casos insere.
    """
    out: dict = {}
    page, total_pages = 1, 1
    while page <= total_pages:
        url = (
            f"{list_url}?cClasse={unidade}&cTipo=R"
            f"&cDataDe={data_de}&cDataAte={data_ate}&nPage={page}"
        )
        req = urllib.request.Request(
            url, headers={"Authorization": credentials, "Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=HTTP_TIMEOUT) as resp:
            body = json.loads(resp.read().decode("utf-8", errors="replace"))
        meta        = body.get("metaDados") or {}
        total_pages = int(meta.get("totalPaginas") or 1)
        for it in body.get("itens") or []:
            key = (str(it.get("produto", "")).strip(), str(it.get("data", ""))[:6])
            acc = out.setdefault(key, [0, 0])
            acc[0] += int(it.get("quantidade") or 0)
            acc[1] += 1
        page += 1
    return out


def _confirmar_gravacao(
    list_url: str, credentials: str, unidade: str, month_str: str, esperado: dict
) -> tuple[dict, dict]:
    """Confere no ERP o que foi realmente gravado para unidade/mês.

    `esperado` é {produtoId: quantidade}. Re-lê algumas vezes antes de desistir,
    porque a gravação é sincrônica e pode ainda estar em curso quando o WS responde.

    Retorna (nao_gravados, duplicados):
      nao_gravados = {produtoId: (esperado, encontrado)}
      duplicados   = {produtoId: qtd_de_lançamentos}
    """
    data_de, data_ate = _month_bounds(month_str)
    nao_gravados: dict = {}
    duplicados:   dict = {}

    for tentativa in range(1, VERIFY_READ_TRIES + 1):
        gravado      = _with_retry(_protheus_list, list_url, credentials, unidade, data_de, data_ate)
        nao_gravados = {}
        duplicados   = {}
        for produto, qtd in esperado.items():
            soma, lancamentos = gravado.get((produto, month_str), [0, 0])
            if soma != qtd:
                nao_gravados[produto] = (qtd, soma)
            if lancamentos > 1:
                duplicados[produto] = lancamentos
        if not nao_gravados:
            break
        if tentativa < VERIFY_READ_TRIES:
            print(
                f"[verify] {unidade}/{month_str}: {len(nao_gravados)} item(ns) ainda não "
                f"confirmado(s) — nova leitura em {VERIFY_READ_DELAY}s "
                f"(tentativa {tentativa}/{VERIFY_READ_TRIES})"
            )
            time.sleep(VERIFY_READ_DELAY)

    return nao_gravados, duplicados


def _delete_mes(
    delete_url_base: str,
    list_url:        str,
    credentials:     str,
    unidade:         str,
    month_str:       str,
) -> None:
    """Apaga a previsão de UM mês da unidade e confirma que o mês ficou vazio.

    O DELETE da janela inteira (12 meses de uma vez) é inconsistente: responde
    "Processamento concluido!" mas deixa produtos para trás. Por isso o apagamento
    segue o mesmo recorte do envio — um mês por chamada — e é conferido lendo o mês
    de volta. Sobra no ERP antes do POST viraria lançamento duplicado.

    Levanta exceção se o mês não ficar vazio após DELETE_VERIFY_TRIES tentativas.

    Atenção aos formatos de data, que DIFEREM entre os dois endpoints:
      - deletarprevisaovendas → "AAAAMM"   (6 dígitos)
      - listaprevisoes        → "AAAAMMDD" (8 dígitos; com 6 devolve HTTP 500)
    """
    url = (
        f"{delete_url_base}"
        f"?cTipo=R"
        f"&cDataDe={month_str}"
        f"&cDataAte={month_str}"
        f"&cClasse={unidade}"
    )
    data_de, data_ate = _month_bounds(month_str)   # só para a leitura de conferência

    sobrando: dict = {}
    for tentativa in range(1, DELETE_VERIFY_TRIES + 1):
        print(f"[delete] {unidade}/{month_str} tentativa {tentativa}/{DELETE_VERIFY_TRIES} — {url}")
        _with_retry(_protheus_delete, url, credentials)
        time.sleep(VERIFY_SETTLE)

        restante = _with_retry(_protheus_list, list_url, credentials, unidade, data_de, data_ate)
        sobrando = {produto: qtd for (produto, _), (qtd, _) in restante.items() if qtd != 0}
        if not sobrando:
            print(f"[delete] {unidade}/{month_str} limpo (confirmado no ERP)")
            return

        print(
            f"[delete] {unidade}/{month_str}: {len(sobrando)} item(ns) ainda no ERP após o DELETE "
            f"— {sorted(sobrando)[:10]}{'…' if len(sobrando) > 10 else ''}"
        )

    raise RuntimeError(
        f"DELETE não limpou {unidade}/{month_str} após {DELETE_VERIFY_TRIES} tentativas — "
        f"{len(sobrando)} item(ns) restante(s): {sorted(sobrando)[:10]}"
    )


def _is_permanent_error(msg: str) -> bool:
    """True para erros que NÃO se resolvem reenviando — ex.: produto bloqueado
    no cadastro (B1_MSBLQL='1'). Reenviar esses só desperdiça tempo."""
    m = msg.lower()
    return "registro bloqueado" in m or "b1_msblql" in m


def _post_with_item_retry(
    url:          str,
    credentials:  str,
    post_payload: dict,
    list_url:     str,
    unidade:      str,
    month_str:    str,
) -> dict:
    """Envia o POST e re-tenta enquanto houver erro transitório.

    CRÍTICO: o retry reenvia SEMPRE o LOTE COMPLETO — reenviar apenas os
    rejeitados apagaria os itens que já tinham entrado, caso o
    `importarprevisaovendas` substitua a previsão do mês/unidade.

    Só que a substituição NÃO é garantida: em parte dos casos o ERP insere um
    novo lançamento em vez de trocar o existente, duplicando o volume (visto no
    ciclo 2026-07: 3201005/202610 ficou com duas linhas idênticas de cada item
    após o reenvio). Como a gravação é sincrônica, antes de cada reenvio o mês é
    lido de volta: se o que falta já está gravado, não há motivo para reenviar.

    "Pesquisa nao encontrada" / "Tabela SC4 …" são transitórias; "REGISTRO
    BLOQUEADO" (B1_MSBLQL) é permanente. Retorna {produtoId: mensagem} dos que
    continuaram falhando."""
    esperado = {
        str(i["C4_PRODUTO"]).strip(): i["C4_QUANT"]
        for i in post_payload["itens"]
    }

    erros   = _with_retry(_protheus_post, url, credentials, post_payload)
    attempt = 1
    while attempt < ITEM_RETRY_MAX and any(not _is_permanent_error(m) for m in erros.values()):
        transitorios = [p for p, m in erros.items() if not _is_permanent_error(m)]

        # Confere antes de reenviar: o lote pode já estar gravado apesar do erro
        # reportado, e o reenvio duplicaria o que entrou.
        pendentes = {p: q for p, q in esperado.items() if p in transitorios}
        time.sleep(VERIFY_SETTLE)
        nao_gravados, _ = _confirmar_gravacao(list_url, credentials, unidade, month_str, pendentes)
        if not nao_gravados:
            print(
                f"[item-retry] {unidade}/{month_str}: os {len(transitorios)} item(ns) com erro "
                f"transitório JÁ constam no ERP — reenvio dispensado (evita duplicidade)"
            )
            return {p: m for p, m in erros.items() if _is_permanent_error(m)}

        attempt += 1
        print(
            f"[item-retry] tentativa {attempt}/{ITEM_RETRY_MAX}: "
            f"{len(nao_gravados)} item(ns) ausente(s) no ERP — reenviando LOTE COMPLETO "
            f"({len(post_payload['itens'])} itens) — aguardando {ITEM_RETRY_DELAY}s"
        )
        time.sleep(ITEM_RETRY_DELAY)
        erros = _with_retry(_protheus_post, url, credentials, post_payload)
    return erros


def _with_retry(fn, *args, max_retries=MAX_RETRIES, delays=RETRY_DELAYS, **kwargs):
    """Executa fn com retry e backoff exponencial."""
    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            last_err = e
            if attempt < max_retries:
                delay = delays[attempt - 1] if attempt - 1 < len(delays) else delays[-1]
                print(f"[retry] tentativa {attempt} falhou: {e}. Aguardando {delay}s...")
                time.sleep(delay)
    raise last_err


# ── Task 1: Buscar dados de export ────────────────────────────────────────────

def fetch_export_data(**context):
    """Busca os ProtheusExportItems PENDING do backend e salva em XCom."""
    log_id      = context["dag_run"].conf.get("logId")
    backend_url = Variable.get("FORECAST_BACKEND_URL").rstrip("/")
    token       = Variable.get("FORECAST_INTERNAL_TOKEN")

    if not log_id:
        raise ValueError("logId não encontrado em dag_run.conf")

    url  = f"{backend_url}/api/internal/protheus-export/data?logId={log_id}"
    data = _backend_get(url, token)

    window_start = data.get("windowStart")
    window_end   = data.get("windowEnd")
    items        = data.get("items", [])

    print(f"[fetch] logId={log_id} | windowStart={window_start} | windowEnd={window_end} | {len(items)} itens PENDING")

    if not window_start or not window_end:
        raise ValueError(f"windowStart/windowEnd ausentes na resposta: {data}")

    ti = context["ti"]
    ti.xcom_push(key="log_id",       value=log_id)
    ti.xcom_push(key="window_start", value=window_start)
    ti.xcom_push(key="window_end",   value=window_end)
    ti.xcom_push(key="items",        value=items)
    ti.xcom_push(key="started_at",   value=datetime.utcnow().isoformat())

    return {"count": len(items), "windowStart": window_start, "windowEnd": window_end}


# ── Task 2: Processar unidades ────────────────────────────────────────────────

def process_units(**context):
    """
    Para cada unidade:
    1. DELETE janela inteira no Protheus
    2. Para cada mês com itens: POST no Protheus
    3. Reporta progresso ao backend após cada mês
    """
    ti           = context["ti"]
    log_id       = ti.xcom_pull(task_ids="fetch_export_data", key="log_id")
    window_start = ti.xcom_pull(task_ids="fetch_export_data", key="window_start")
    window_end   = ti.xcom_pull(task_ids="fetch_export_data", key="window_end")
    items        = ti.xcom_pull(task_ids="fetch_export_data", key="items")

    backend_url   = Variable.get("FORECAST_BACKEND_URL").rstrip("/")
    token         = Variable.get("FORECAST_INTERNAL_TOKEN")
    protheus_base = Variable.get("PROTHEUS_BASE_URL").rstrip("/")
    proto_user    = Variable.get("PROTHEUS_USER")
    proto_pass    = Variable.get("PROTHEUS_PASSWORD")
    credentials   = _basic_auth(proto_user, proto_pass)

    forecast_base   = f"{protheus_base}/rest02/ForecastXProtheus"
    delete_url_base = f"{forecast_base}/deletarprevisaovendas"
    insert_url      = f"{forecast_base}/importarprevisaovendas"
    list_url        = f"{forecast_base}/listaprevisoes"

    # Agrupa itens por unidade → mês → lista
    by_unit = defaultdict(lambda: defaultdict(list))
    for item in items:
        by_unit[item["unidadeVendaId"]][item["month"]].append(item)

    units_ok     = 0
    units_failed = 0
    all_details  = []
    problem_item_ids: set = set()  # itens reportados como FAILED (rejeição de cadastro)

    # ── FASE 1: DELETE mês a mês, por unidade ──────────────────────────────
    # Mesmo recorte do envio: uma chamada por unidade/mês. O DELETE da janela
    # inteira responde "Processamento concluido!" mas deixa produtos para trás, e
    # sobra no ERP antes do POST viraria lançamento duplicado.
    # Todos os DELETEs vêm antes de qualquer POST, para que nenhuma exclusão possa
    # interferir no que outra unidade já gravou.
    total_meses = sum(len(m) for m in by_unit.values())
    print(f"\n[process_units] === FASE 1: DELETE ({len(by_unit)} unidades / {total_meses} meses) ===")
    for unidade_id in sorted(by_unit.keys()):
        try:
            status_resp    = _backend_get(
                f"{backend_url}/api/internal/protheus-export/log-status?logId={log_id}",
                token,
            )
            current_status = status_resp.get("status", "RUNNING")
        except Exception as e:
            print(f"[process_units] AVISO: não foi possível verificar status do log: {e} — continuando")
            current_status = "RUNNING"

        if current_status != "RUNNING":
            print(f"[process_units] Export cancelado (status={current_status}). Abortando DELETEs restantes.")
            break

        meses_unidade = sorted(by_unit[unidade_id].keys())
        try:
            for month_str in meses_unidade:
                _delete_mes(delete_url_base, list_url, credentials, unidade_id, month_str)
        except Exception as e:
            # Mês que não fica limpo produziria divergência entre forecast e ERP —
            # o envio é interrompido para não deixar o PCP planejando sobre dado sujo.
            error_msg = f"DELETE não confirmado — {e}"
            print(f"[process_units] ABORTANDO O ENVIO — {unidade_id}: {error_msg}")
            _backend_post(
                f"{backend_url}/api/internal/protheus-export/delete-status",
                token,
                {"logId": log_id, "unidadeVendaId": unidade_id, "status": "FAILED", "error": error_msg},
            )
            all_details.append({
                "unidadeVendaId": unidade_id,
                "totalMeses":     len(meses_unidade),
                "deleteStatus":   "FAILED",
                "overallStatus":  "FAILED",
                "meses":          [],
                "error":          error_msg,
            })
            ti.xcom_push(key="units_ok",         value=units_ok)
            ti.xcom_push(key="units_failed",     value=units_failed + 1)
            ti.xcom_push(key="all_details",      value=all_details)
            ti.xcom_push(key="problem_item_ids", value=sorted(problem_item_ids))
            raise RuntimeError(
                f"Envio interrompido na limpeza de {unidade_id}: {error_msg}. "
                f"Nenhum POST foi executado; a janela das unidades já apagadas está vazia no ERP."
            )

        print(f"[process_units] DELETE OK — unidade {unidade_id} ({len(meses_unidade)} meses confirmados)")
        _backend_post(
            f"{backend_url}/api/internal/protheus-export/delete-status",
            token,
            {"logId": log_id, "unidadeVendaId": unidade_id, "status": "SUCCESS"},
        )

    # ── FASE 2: POST por unidade/mês ───────────────────────────────────────
    print(f"\n[process_units] === FASE 2: POST ({len(by_unit)} unidades) ===")
    for unidade_id, months in sorted(by_unit.items()):

        try:
            status_resp    = _backend_get(
                f"{backend_url}/api/internal/protheus-export/log-status?logId={log_id}",
                token,
            )
            current_status = status_resp.get("status", "RUNNING")
        except Exception as e:
            print(f"[process_units] AVISO: não foi possível verificar status do log: {e} — continuando")
            current_status = "RUNNING"

        if current_status != "RUNNING":
            print(f"[process_units] Export cancelado (status={current_status}). Abortando POSTs restantes.")
            break

        print(f"\n[process_units] POST unidade {unidade_id} ({len(months)} meses)")

        unit_detail = {
            "unidadeVendaId": unidade_id,
            "totalMeses":     len(months),
            "deleteStatus":   "SUCCESS",
            "overallStatus":  "PENDING",
            "meses":          [],
        }

        mes_ok = 0
        mes_failed = 0

        for month_str, month_items in sorted(months.items()):
            # month_str = "YYYYMM"
            year  = int(month_str[:4])
            month = int(month_str[4:])
            c4_data = f"{year}{month_str[4:]}01"  # "YYYYMMDD"

            itens_payload = [
                {
                    "C4_PRODUTO":  item["produtoId"],
                    "C4_QUANT":    item["volumeFCTS"],
                    "C4_XFAMAGM":  item.get("codigoFamilia") or "",
                }
                for item in month_items
            ]

            post_payload = {
                "C4_DATA":  c4_data,
                "C4_XCLVL": unidade_id,
                "C4_XTIPO": "R",
                "itens":    itens_payload,
            }

            export_item_ids = [item["exportItemId"] for item in month_items]

            # produtoId → exportItemIds (para reportar sucesso/falha por item)
            ids_por_produto = defaultdict(list)
            for item in month_items:
                ids_por_produto[str(item["produtoId"]).strip()].append(item["exportItemId"])

            progress_url = f"{backend_url}/api/internal/protheus-export/progress"

            try:
                erros_itens = _post_with_item_retry(
                    insert_url, credentials, post_payload, list_url, unidade_id, month_str
                )
            except Exception as e:
                # Falha de transporte/HTTP — o mês inteiro não chegou ao Protheus
                error_msg = str(e)
                mes_failed += 1
                print(f"[process_units]   POST FALHOU — {unidade_id}/{month_str}: {error_msg}")
                _backend_post(progress_url, token, {
                    "logId":          log_id,
                    "unidadeVendaId": unidade_id,
                    "month":          month_str,
                    "itemIds":        export_item_ids,
                    "status":         "FAILED",
                    "error":          error_msg,
                })
                unit_detail["meses"].append({
                    "month":     month_str,
                    "status":    "FAILED",
                    "itemCount": len(itens_payload),
                    "attempt":   MAX_RETRIES,
                    "error":     error_msg,
                })
                continue

            # ── Read-after-write ───────────────────────────────────────────────
            # O ERP grava de forma sincrônica e responde HTTP 200 sem garantir que
            # o lote foi gravado; a única prova é ler o mês de volta. Confere só o
            # que o Protheus não rejeitou — item rejeitado obviamente não está lá.
            esperado_confirmar = {
                str(i["C4_PRODUTO"]).strip(): i["C4_QUANT"]
                for i in itens_payload
                if str(i["C4_PRODUTO"]).strip() not in erros_itens
            }
            time.sleep(VERIFY_SETTLE)
            try:
                nao_conformes, duplicados = _confirmar_gravacao(
                    list_url, credentials, unidade_id, month_str, esperado_confirmar
                )
            except Exception as e:
                # Não conseguir conferir é, em si, um desvio: sem leitura não há como
                # afirmar que o ERP recebeu o lote.
                raise RuntimeError(
                    f"Envio interrompido: falha ao conferir a gravação de "
                    f"{unidade_id}/{month_str} no ERP — {e}"
                ) from e

            # ── Classificação dos itens do mês ────────────────────────────────
            # Rejeição de cadastro (B1_MSBLQL) é divergência CONHECIDA: o item vai
            # como FAILED com o motivo e o envio continua. Qualquer outro desvio
            # (item não confirmado, volume diferente, duplicidade, erro transitório
            # que sobreviveu aos retries) interrompe o envio — o PCP não pode
            # planejar sobre um ERP que não corresponde ao forecast aprovado.
            bloqueados   = {p: m for p, m in erros_itens.items() if _is_permanent_error(m)}
            inesperados  = {p: m for p, m in erros_itens.items() if not _is_permanent_error(m)}

            rejeitados_ids = [
                iid for produto in bloqueados for iid in ids_por_produto.get(produto, [])
            ]
            nao_conf_ids = [
                iid
                for produto in list(nao_conformes.keys()) + list(inesperados.keys())
                for iid in ids_por_produto.get(produto, [])
            ]
            problema_set = set(rejeitados_ids) | set(nao_conf_ids)
            ok_ids       = [iid for iid in export_item_ids if iid not in problema_set]
            problem_item_ids |= problema_set

            if erros_itens and not problema_set:
                # Protheus reportou erro mas o produtoId não bateu com o payload
                print(f"[process_units]   AVISO: {len(erros_itens)} erro(s) do Protheus sem "
                      f"correspondência de produtoId no payload: {sorted(erros_itens.keys())}")

            erro_partes = []
            if bloqueados:
                resumo = "; ".join(f"{p}: {msg}" for p, msg in list(bloqueados.items())[:10])
                if len(bloqueados) > 10:
                    resumo += f" (+{len(bloqueados) - 10} outros)"
                erro_partes.append(f"Bloqueados no cadastro do ERP — {resumo}")
            if inesperados:
                resumo = "; ".join(f"{p}: {msg}" for p, msg in list(inesperados.items())[:10])
                if len(inesperados) > 10:
                    resumo += f" (+{len(inesperados) - 10} outros)"
                erro_partes.append(f"Rejeitados pelo Protheus — {resumo}")
            if nao_conformes:
                detalhe = "; ".join(
                    f"{p}: enviado {esp}, no ERP {enc}"
                    + (f" ({duplicados[p]} lançamentos)" if p in duplicados else "")
                    for p, (esp, enc) in list(nao_conformes.items())[:10]
                )
                if len(nao_conformes) > 10:
                    detalhe += f" (+{len(nao_conformes) - 10} outros)"
                erro_partes.append(f"Gravação não confirmada no ERP — {detalhe}")
            erro_resumo = " | ".join(erro_partes)

            if not problema_set:
                mes_ok += 1
                print(f"[process_units]   POST OK — {unidade_id}/{month_str} "
                      f"({len(itens_payload)} itens, gravação confirmada no ERP)")
                _backend_post(progress_url, token, {
                    "logId":          log_id,
                    "unidadeVendaId": unidade_id,
                    "month":          month_str,
                    "itemIds":        export_item_ids,
                    "status":         "SUCCESS",
                })
                unit_detail["meses"].append({
                    "month":     month_str,
                    "status":    "SUCCESS",
                    "itemCount": len(itens_payload),
                    "attempt":   1,
                })
            else:
                print(f"[process_units]   POST PARCIAL — {unidade_id}/{month_str}: "
                      f"{len(ok_ids)} confirmado(s) / {len(rejeitados_ids)} rejeitado(s) / "
                      f"{len(nao_conf_ids)} não confirmado(s) no ERP")

                if ok_ids:
                    _backend_post(progress_url, token, {
                        "logId":          log_id,
                        "unidadeVendaId": unidade_id,
                        "month":          month_str,
                        "itemIds":        ok_ids,
                        "status":         "SUCCESS",
                    })
                _backend_post(progress_url, token, {
                    "logId":          log_id,
                    "unidadeVendaId": unidade_id,
                    "month":          month_str,
                    "itemIds":        sorted(problema_set),
                    "status":         "FAILED",
                    "error":          erro_resumo,
                })

                # Mês com ao menos 1 sucesso conta para mes_ok; com ao menos 1
                # falha conta para mes_failed → unidade vira PARTIAL.
                if ok_ids:
                    mes_ok += 1
                mes_failed += 1
                unit_detail["meses"].append({
                    "month":     month_str,
                    "status":    "FAILED",
                    "itemCount": len(problema_set),
                    "attempt":   ITEM_RETRY_MAX,
                    "error":     erro_resumo,
                })

                # Desvio que não seja bloqueio de cadastro interrompe o envio: o ERP
                # ficaria diferente do forecast aprovado e o PCP planejaria sobre
                # dado inconsistente. Estado já reportado ao backend acima.
                if nao_conf_ids:
                    unit_detail["overallStatus"] = "PARTIAL" if mes_ok else "FAILED"
                    all_details.append(unit_detail)
                    units_failed += 1
                    if mes_ok:
                        units_ok += 1
                    ti.xcom_push(key="units_ok",         value=units_ok)
                    ti.xcom_push(key="units_failed",     value=units_failed)
                    ti.xcom_push(key="all_details",      value=all_details)
                    ti.xcom_push(key="problem_item_ids", value=sorted(problem_item_ids))
                    raise RuntimeError(
                        f"Envio interrompido em {unidade_id}/{month_str}: {erro_resumo}. "
                        f"Unidades/meses posteriores NÃO foram enviados e estão com a janela "
                        f"vazia no ERP — verifique antes de liberar o planejamento."
                    )

        # Determina overallStatus da unidade
        if mes_failed == 0:
            unit_detail["overallStatus"] = "SUCCESS"
            units_ok += 1
        elif mes_ok == 0:
            unit_detail["overallStatus"] = "FAILED"
            units_failed += 1
        else:
            unit_detail["overallStatus"] = "PARTIAL"
            units_ok    += 1  # parcial conta como "chegou a enviar algo"
            units_failed += 1

        all_details.append(unit_detail)
        print(f"[process_units] unidade {unidade_id} → {unit_detail['overallStatus']} (meses ok={mes_ok} / failed={mes_failed})")

    ti.xcom_push(key="units_ok",        value=units_ok)
    ti.xcom_push(key="units_failed",    value=units_failed)
    ti.xcom_push(key="all_details",     value=all_details)
    ti.xcom_push(key="problem_item_ids", value=sorted(problem_item_ids))

    print(f"\n[process_units] RESUMO: {units_ok} ok / {units_failed} failed")
    return {"units_ok": units_ok, "units_failed": units_failed}


# ── Task 3: Conferir o estado final no ERP ────────────────────────────────────

def verify_export(**context):
    """Relê a janela inteira no ERP, por unidade, DEPOIS de todos os POSTs.

    A conferência feita durante o envio (read-after-write por mês) não pega
    interferência posterior: no ciclo 2026-07, 41 itens da 3103001 estavam
    corretamente gravados durante o envio e desapareceram após os envios das
    unidades seguintes. Só uma leitura final, com tudo enviado, revela isso.

    Itens que não conferem são reportados ao backend como FAILED — assim o
    ProtheusExportItem deixa de dizer SUCCESS para algo que não está no ERP.
    Não reenvia nada: reenvio às cegas duplica lançamentos.
    """
    ti           = context["ti"]
    log_id       = ti.xcom_pull(task_ids="fetch_export_data", key="log_id")
    window_start = ti.xcom_pull(task_ids="fetch_export_data", key="window_start")
    window_end   = ti.xcom_pull(task_ids="fetch_export_data", key="window_end")
    items        = ti.xcom_pull(task_ids="fetch_export_data", key="items") or []
    problem_ids  = set(ti.xcom_pull(task_ids="process_units", key="problem_item_ids") or [])

    if not log_id or not items or not window_start or not window_end:
        print("[verify-final] Sem dados de envio para conferir — nada a fazer.")
        return {"unidades": 0, "divergentes": 0}

    backend_url   = Variable.get("FORECAST_BACKEND_URL").rstrip("/")
    token         = Variable.get("FORECAST_INTERNAL_TOKEN")
    protheus_base = Variable.get("PROTHEUS_BASE_URL").rstrip("/")
    credentials   = _basic_auth(Variable.get("PROTHEUS_USER"), Variable.get("PROTHEUS_PASSWORD"))
    list_url      = f"{protheus_base}/rest02/ForecastXProtheus/listaprevisoes"
    progress_url  = f"{backend_url}/api/internal/protheus-export/progress"

    data_de  = f"{window_start}01"
    data_ate = _month_bounds(window_end)[1]

    # unidade → (produto, mês) → [qtd esperada, [exportItemIds]]
    esperado_por_unidade: dict = defaultdict(lambda: defaultdict(lambda: [0, []]))
    for item in items:
        if item["exportItemId"] in problem_ids:
            continue  # já reportado como falha durante o envio
        chave = (str(item["produtoId"]).strip(), item["month"])
        acc   = esperado_por_unidade[item["unidadeVendaId"]][chave]
        acc[0] += item["volumeFCTS"]
        acc[1].append(item["exportItemId"])

    total_divergentes = 0

    for unidade_id in sorted(esperado_por_unidade.keys()):
        esperado = esperado_por_unidade[unidade_id]
        try:
            gravado = _with_retry(_protheus_list, list_url, credentials, unidade_id, data_de, data_ate)
        except Exception as e:
            print(f"[verify-final] {unidade_id}: falha ao consultar o ERP: {e} — unidade não conferida")
            continue

        divergentes: dict = {}   # (produto, mês) → (esperado, encontrado, lançamentos)
        for chave, (qtd, ids) in esperado.items():
            soma, lancamentos = gravado.get(chave, [0, 0])
            if soma != qtd:
                divergentes[chave] = (qtd, soma, lancamentos, ids)

        # Lançamentos presentes no ERP que não foram enviados neste ciclo
        residuos = [k for k, v in gravado.items() if k not in esperado and v[0] > 0]

        if not divergentes:
            print(f"[verify-final] {unidade_id}: {len(esperado)} item(ns) conferidos — OK"
                  + (f" ({len(residuos)} resíduo(s) de outro ciclo no ERP)" if residuos else ""))
            continue

        ausentes   = sum(1 for (_, enc, _, _) in divergentes.values() if enc == 0)
        duplicados = sum(1 for (_, _, lanc, _) in divergentes.values() if lanc > 1)
        print(f"[verify-final] {unidade_id}: {len(divergentes)} item(ns) DIVERGENTE(S) "
              f"({ausentes} ausente(s), {duplicados} duplicado(s) no ERP)")

        # Reporta por mês, para casar com o formato de progresso do backend
        por_mes: dict = defaultdict(list)
        for (produto, mes), (qtd, soma, lanc, ids) in divergentes.items():
            por_mes[mes].append((produto, qtd, soma, lanc, ids))

        for mes, linhas in sorted(por_mes.items()):
            item_ids = [iid for l in linhas for iid in l[4]]
            detalhe  = "; ".join(
                f"{produto}: enviado {qtd}, no ERP {soma}"
                + (f" ({lanc} lançamentos)" if lanc > 1 else "")
                for produto, qtd, soma, lanc, _ in linhas[:10]
            )
            if len(linhas) > 10:
                detalhe += f" (+{len(linhas) - 10} outros)"
            total_divergentes += len(item_ids)
            _backend_post(progress_url, token, {
                "logId":          log_id,
                "unidadeVendaId": unidade_id,
                "month":          mes,
                "itemIds":        item_ids,
                "status":         "FAILED",
                "error":          f"Conferência final: estado no ERP difere do enviado — {detalhe}",
            })

    print(f"\n[verify-final] RESUMO: {len(esperado_por_unidade)} unidade(s) conferida(s), "
          f"{total_divergentes} item(ns) divergente(s) reclassificado(s) como FAILED")
    return {"unidades": len(esperado_por_unidade), "divergentes": total_divergentes}


# ── Task 4: Finalizar ─────────────────────────────────────────────────────────

def finalize(**context):
    """Reporta status final ao backend."""
    ti = context["ti"]

    log_id       = ti.xcom_pull(task_ids="fetch_export_data", key="log_id")
    started_at   = ti.xcom_pull(task_ids="fetch_export_data", key="started_at")
    units_ok     = ti.xcom_pull(task_ids="process_units",     key="units_ok")     or 0
    units_failed = ti.xcom_pull(task_ids="process_units",     key="units_failed") or 0
    all_details  = ti.xcom_pull(task_ids="process_units",     key="all_details")  or []

    # Fallback: fetch_export_data falhou antes de fazer xcom_push (ex: backend inacessível)
    # O logId ainda está disponível em dag_run.conf — usado para marcar o log como FAILED
    error_msg = None
    if not log_id:
        log_id    = context["dag_run"].conf.get("logId")
        error_msg = "DAG falhou em fetch_export_data antes de iniciar o processamento"
        print(f"[finalize] AVISO: log_id ausente no XCom — fallback para dag_run.conf: {log_id}")

    if not log_id:
        print("[finalize] CRÍTICO: log_id não encontrado nem em XCom nem em dag_run.conf — backend não será notificado.")
        return

    backend_url = Variable.get("FORECAST_BACKEND_URL").rstrip("/")
    token       = Variable.get("FORECAST_INTERNAL_TOKEN")

    payload = {
        "logId":          log_id,
        "unidadesOk":     units_ok,
        "unidadesFailed": units_failed,
        "details":        all_details,
        "startedAt":      started_at or datetime.utcnow().isoformat(),
    }
    if error_msg:
        payload["error"] = error_msg

    _backend_post(f"{backend_url}/api/internal/protheus-export/finalize", token, payload)
    print(f"[finalize] logId={log_id} | ok={units_ok} | failed={units_failed}")


# ── DAG Definition ────────────────────────────────────────────────────────────

with DAG(
    dag_id=DAG_ID,
    default_args=DEFAULT_ARGS,
    description="Envia forecast aprovado ao Protheus ERP (demanda de compra)",
    schedule_interval=None,    # apenas manual / via API
    start_date=datetime(2025, 1, 1),
    catchup=False,
    max_active_runs=1,         # evita execuções paralelas do mesmo ciclo
    tags=["protheus", "forecast", "export"],
) as dag:

    task_fetch = PythonOperator(
        task_id="fetch_export_data",
        python_callable=fetch_export_data,
    )

    task_process = PythonOperator(
        task_id="process_units",
        python_callable=process_units,
        retries=0,   # interrupção por divergência é decisão final: repetir reenviaria tudo
    )

    task_verify = PythonOperator(
        task_id="verify_export",
        python_callable=verify_export,
        trigger_rule="all_done",   # confere o que chegou ao ERP mesmo após falha parcial
        retries=1,                 # é só leitura; não faz sentido insistir muito
    )

    task_finalize = PythonOperator(
        task_id="finalize",
        python_callable=finalize,
        trigger_rule="all_done",   # executa mesmo se process_units falhar
    )

    task_fetch >> task_process >> task_verify >> task_finalize
