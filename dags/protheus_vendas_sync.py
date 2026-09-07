from __future__ import annotations

import json
import ssl
import base64
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, date
from pathlib import Path

from airflow.models.dag import DAG
from airflow.operators.python import PythonOperator
from airflow.models import Variable

# ── Constantes ────────────────────────────────────────────────────────────────

DAG_ID      = "protheus_vendas_sync"
TMP_DIR     = Path("/tmp")
CHUNK_SIZE  = 500
CONCURRENCY = 5  # requests paralelas no fetch dia-a-dia

DEFAULT_ARGS = {
    "owner": "airflow",
    "retries": 3,
    "retry_delay": timedelta(minutes=5),
    "retry_exponential_backoff": True,
}

# Blacklist de codigoClasseValor — exclusões estruturais permanentes
CLASSE_VALOR_EXCLUIDOS = {"3202001", "3201002"}

# Reclassificação temporária por cliente — vendas do OEM devem ir para unidade dedicada
# Remover quando o Protheus passar a classificar corretamente via codigoClasseValor
CLIENTE_RECLASSIF = {
    "04907399": ("3160002", "OEM ENDOCIRURGIA"),
}

# Mapeamento país → (iso3, unidadeVendaId)
# Nomes exatamente como retornados pelo Protheus (após .strip().upper())
# Códigos reais de produção: APAC=3201004, EMEA=3201003, LATAM=3201005
PAIS_MAP = {
    # APAC → 3201004
    "INDIA":                       ("IND", "3201004"),
    "VIETNA":                      ("VNM", "3201004"),
    "BANGLADESH":                  ("BGD", "3201004"),
    "CAMBOJA":                     ("KHM", "3201004"),
    "INDONESIA":                   ("IDN", "3201004"),
    "CAZAQUISTAO, REPUBLICA DO":   ("KAZ", "3201004"),
    "JAPAO":                       ("JPN", "3201004"),
    "COREIA DO SUL":               ("KOR", "3201004"),
    "AUSTRALIA":                   ("AUS", "3201004"),
    "SINGAPURA":                   ("SGP", "3201004"),
    "TAILANDIA":                   ("THA", "3201004"),
    # EMEA → 3201003
    "ITALIA":                      ("ITA", "3201003"),
    "SUICA":                       ("CHE", "3201003"),
    "POLONIA, REPUBLICA DA":       ("POL", "3201003"),
    "EMIRADOS ARABES UNIDOS":      ("ARE", "3201003"),
    "RUSSIA, FEDERACAO DA":        ("RUS", "3201003"),
    "CHIPRE":                      ("CYP", "3201003"),
    "SERVIA":                      ("SRB", "3201003"),
    "AFRICA DO SUL":               ("ZAF", "3201003"),
    "ALEMANHA":                    ("DEU", "3201003"),
    "EGITO":                       ("EGY", "3201003"),
    "LITUANIA, REPUBLICA DA":      ("LTU", "3201003"),
    "TURQUIA":                     ("TUR", "3201003"),
    "GRECIA":                      ("GRC", "3201003"),
    "MARROCOS":                    ("MAR", "3201003"),
    "JORDANIA":                    ("JOR", "3201003"),
    "ESPANHA":                     ("ESP", "3201003"),
    "PORTUGAL":                    ("PRT", "3201003"),
    "PAISES BAIXOS (HOLANDA)":     ("NLD", "3201003"),
    "SUECIA":                      ("SWE", "3201003"),
    "UCRANIA":                     ("UKR", "3201003"),
    "IRLANDA":                     ("IRL", "3201003"),
    "FRANCA":                      ("FRA", "3201003"),
    "REINO UNIDO":                 ("GBR", "3201003"),
    "TUNISIA":                     ("TUN", "3201003"),
    "IRA, REPUBLICA ISLAMICA DO":  ("IRN", "3201003"),
    "BELGICA":                     ("BEL", "3201003"),
    "BAHREIN, ILHAS":              ("BHR", "3201003"),
    # LATAM → 3201005
    "CHILE":                       ("CHL", "3201005"),
    "ARGENTINA":                   ("ARG", "3201005"),
    "MEXICO":                      ("MEX", "3201005"),
    "PANAMA":                      ("PAN", "3201005"),
    "REPUBLICA DOMINICANA":        ("DOM", "3201005"),
    "URUGUAI":                     ("URY", "3201005"),
    "GUATEMALA":                   ("GTM", "3201005"),
    "COLOMBIA":                    ("COL", "3201005"),
    "PERU":                        ("PER", "3201005"),
    "PARAGUAI":                    ("PRY", "3201005"),
    # Nacional
    "BRASIL":                      (None,  None),
}

# ── Task 1: Resolver período ──────────────────────────────────────────────────

def resolve_period(**context) -> dict:
    """Determina cDataDe/cDataAte.
    Se VENDAS_C_DATA_DE e VENDAS_C_DATA_ATE estiverem definidas, usa seus valores.
    Caso contrário, calcula o último mês fechado automaticamente.
    """
    c_data_de  = Variable.get("VENDAS_C_DATA_DE",  default_var="").strip()
    c_data_ate = Variable.get("VENDAS_C_DATA_ATE", default_var="").strip()

    if c_data_de and c_data_ate:
        print(f"[resolve_period] Usando variáveis: cDataDe={c_data_de}, cDataAte={c_data_ate}")
    else:
        today            = date.today()
        first_of_current = today.replace(day=1)
        last_month_end   = first_of_current - timedelta(days=1)
        c_data_de  = last_month_end.replace(day=1).strftime("%Y%m%d")
        c_data_ate = last_month_end.strftime("%Y%m%d")
        print(f"[resolve_period] Calculado: cDataDe={c_data_de}, cDataAte={c_data_ate}")

    ref_month = datetime.strptime(c_data_de, "%Y%m%d").replace(day=1).strftime("%Y-%m-%d")
    print(f"[resolve_period] refMonth={ref_month}")

    # Mês de execução corrente (para gate do ciclo atual — pode diferir do mês dos dados)
    execution_ref_month = date.today().replace(day=1).strftime("%Y-%m-%d")
    print(f"[resolve_period] executionRefMonth={execution_ref_month}")

    ti = context["ti"]
    ti.xcom_push(key="c_data_de",           value=c_data_de)
    ti.xcom_push(key="c_data_ate",          value=c_data_ate)
    ti.xcom_push(key="ref_month",           value=ref_month)
    ti.xcom_push(key="execution_ref_month", value=execution_ref_month)

    return {"cDataDe": c_data_de, "cDataAte": c_data_ate, "refMonth": ref_month, "executionRefMonth": execution_ref_month}


# ── Task 2: Extrair e filtrar vendas do Protheus ──────────────────────────────
#
# Estratégia: fetch dia-a-dia em paralelo (não pagination por offset).
# Motivo: o endpoint /listavendas tem bug de paginação para resultsets grandes
# — registros silenciosamente perdidos e outros duplicados quando o resultado
# requer múltiplas páginas. Cada dia tem em média ~280 registros e cabe em 1
# página, contornando o bug.

def _fetch_day(c_data: str, base_url: str, headers: dict, ssl_ctx, n_limit: int) -> list:
    """Extrai todos os registros de um único dia (geralmente 1 página)."""
    items_dia = []
    page        = 1
    total_pages = 1

    while page <= total_pages:
        url = (
            f"{base_url}/rest02/ForecastXProtheus/listavendas"
            f"?cDataDe={c_data}&cDataAte={c_data}&nPage={page}&nLimit={n_limit}"
        )
        req = urllib.request.Request(url, headers=headers)

        try:
            with urllib.request.urlopen(req, timeout=60, context=ssl_ctx) as response:
                data = json.loads(response.read())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Protheus HTTP {e.code} — dia {c_data} pág {page}: {e.reason}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"Erro de conexão Protheus — dia {c_data} pág {page}: {e.reason}")

        meta  = data.get("metaDados") or {}
        items = data.get("itens") or []

        if page == 1:
            total_pages = meta.get("totalPaginas", 1) or 1
            if not meta or meta.get("total", 0) == 0:
                return []

        items_dia.extend(items)

        if page >= total_pages:
            break
        page += 1

    return items_dia


def fetch_vendas(**context) -> dict:
    """Extrai vendas do Protheus dia a dia em paralelo e aplica filtros ETL:
    1. Whitelist de CFOP (VENDAS_CFOP_PERMITIDOS — obrigatória)
    2. Blacklist de codigoClasseValor (CLASSE_VALOR_EXCLUIDOS — hardcoded)
    """
    base_url = Variable.get("PROTHEUS_BASE_URL")
    user     = Variable.get("PROTHEUS_USER")
    password = Variable.get("PROTHEUS_PASSWORD")
    run_id   = context["run_id"]

    ti = context["ti"]
    c_data_de  = ti.xcom_pull(task_ids="resolve_period", key="c_data_de")
    c_data_ate = ti.xcom_pull(task_ids="resolve_period", key="c_data_ate")

    cfops_raw        = Variable.get("VENDAS_CFOP_PERMITIDOS", default_var="[]").strip()
    cfops_permitidos = set(json.loads(cfops_raw))
    if not cfops_permitidos:
        raise ValueError(
            "VENDAS_CFOP_PERMITIDOS não configurada — abortando para evitar envio de base completa"
        )
    print(f"[fetch_vendas] CFOPs permitidos: {sorted(cfops_permitidos)}")

    n_limit = int(Variable.get("VENDAS_N_LIMIT", default_var="500"))

    credentials = base64.b64encode(f"{user}:{password}".encode()).decode()
    headers = {
        "Authorization": f"Basic {credentials}",
        "Content-Type": "application/json",
    }

    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode    = ssl.CERT_NONE

    # Gera lista de dias no range [c_data_de, c_data_ate]
    de  = datetime.strptime(c_data_de,  "%Y%m%d").date()
    ate = datetime.strptime(c_data_ate, "%Y%m%d").date()

    days = []
    cur  = de
    while cur <= ate:
        days.append(cur.strftime("%Y%m%d"))
        cur += timedelta(days=1)

    print(f"[fetch_vendas] Extração dia a dia: {len(days)} dias (concorrência: {CONCURRENCY})")
    print("[fetch_vendas] Workaround para bug de paginação por offset em resultsets grandes")

    # Fetch paralelo
    all_items      = []
    dias_vazios    = 0

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        future_to_day = {
            executor.submit(_fetch_day, dia, base_url, headers, ssl_ctx, n_limit): dia
            for dia in days
        }
        for future in as_completed(future_to_day):
            dia   = future_to_day[future]
            items = future.result()
            if not items:
                dias_vazios += 1
            else:
                all_items.extend(items)

    total_bruto = len(all_items)
    print(f"[fetch_vendas] Dias vazios (sem vendas): {dias_vazios}/{len(days)}")
    print(f"[fetch_vendas] Total bruto extraído: {total_bruto}")

    cfops_amostra = sorted({i.get("cfop", "").strip() for i in all_items[:500] if i.get("cfop")})
    print(f"[fetch_vendas] CFOPs encontrados (amostra): {cfops_amostra}")

    # Filtro 1: Whitelist CFOP
    all_items       = [i for i in all_items if i.get("cfop", "").strip() in cfops_permitidos]
    total_apos_cfop = len(all_items)
    print(f"[fetch_vendas] Após filtro CFOP: {total_apos_cfop} (descartados: {total_bruto - total_apos_cfop})")

    # Filtro 2: Blacklist codigoClasseValor
    all_items          = [i for i in all_items if i.get("codigoClasseValor", "").strip() not in CLASSE_VALOR_EXCLUIDOS]
    total_apos_classe  = len(all_items)
    print(f"[fetch_vendas] Após filtro codigoClasseValor: {total_apos_classe} (descartados: {total_apos_cfop - total_apos_classe})")

    tmp_file = TMP_DIR / f"vendas_raw_{run_id}.json"
    tmp_file.write_text(json.dumps(all_items, ensure_ascii=False))
    print(f"[fetch_vendas] Dados filtrados salvos em {tmp_file}")

    return {
        "total_dias":        len(days),
        "dias_vazios":       dias_vazios,
        "total_bruto":       total_bruto,
        "total_apos_cfop":   total_apos_cfop,
        "total_apos_classe": total_apos_classe,
    }


# ── Task 3: Transformar e agregar ─────────────────────────────────────────────

def transform_vendas(**context) -> dict:
    """Reclassifica registros legados (codigoClasseValor=3201001 → unidade correta),
    resolve paisIso3, renomeia campos e agrega com pandas.
    """
    import pandas as pd

    run_id  = context["run_id"]
    tmp_raw = TMP_DIR / f"vendas_raw_{run_id}.json"

    itens         = json.loads(tmp_raw.read_text())
    total_entrada = len(itens)

    itens_processados        = []
    descartados_reclassif    = 0
    reclassif_cliente        = 0

    for item in itens:
        pais_nome      = item.get("pais", "").strip().upper()
        iso3, unidade  = PAIS_MAP.get(pais_nome, (None, None))

        if item.get("codigoClasseValor", "").strip() == "3201001":
            if unidade is None:
                print(
                    f"[transform_vendas] Descartado: codigoClasseValor=3201001, "
                    f"pais='{pais_nome}' não mapeado"
                )
                descartados_reclassif += 1
                continue
            item = dict(item)
            item["codigoClasseValor"] = unidade

        # Reclassificação temporária por cliente
        cliente = item.get("cliente", "").strip()
        if cliente in CLIENTE_RECLASSIF:
            nova_unidade, nova_descricao = CLIENTE_RECLASSIF[cliente]
            item = dict(item)
            item["codigoClasseValor"]    = nova_unidade
            item["descricaoClasseValor"] = nova_descricao
            reclassif_cliente += 1

        item["paisIso3"] = iso3
        itens_processados.append(item)

    print(
        f"[transform_vendas] Após reclassificação: {len(itens_processados)} "
        f"(descartados: {descartados_reclassif})"
    )
    print(f"[transform_vendas] Reclassificados por cliente (OEM): {reclassif_cliente}")

    if not itens_processados:
        raise ValueError(
            f"[transform_vendas] Nenhum item após reclassificação. "
            f"Total entrada: {total_entrada}. Verifique os filtros CFOP, blacklist de "
            f"codigoClasseValor e o mapeamento PAIS_MAP para registros 3201001."
        )

    # Log das chaves presentes para diagnóstico
    print(f"[transform_vendas] Chaves do primeiro item: {list(itens_processados[0].keys())}")

    # Agregação com pandas
    df = pd.DataFrame(itens_processados)
    df["produtoId"]      = df["codigoProduto"].str.strip().str.upper()
    df["unidadeVendaId"] = df["codigoClasseValor"].str.strip()
    df["month"]          = (
        pd.to_datetime(df["emissaoNF"], format="%Y%m%d")
        .dt.to_period("M")
        .dt.to_timestamp()
        .dt.strftime("%Y-%m-%d")
    )

    df_agg = (
        df.groupby(
            ["produtoId", "unidadeVendaId", "month", "canal", "paisIso3"],
            dropna=False,
            as_index=False,
        )
        .agg(
            quantidade    = ("quantidade",        "sum"),
            receita       = ("valor",             "sum"),
            codigoFamilia = ("codigoFamiliaAGM",  "first"),
            familia       = ("descricaoFamiliaAGM", "first"),
            divisao       = ("descricaoClasseValor", "first"),
        )
    )

    # Converte NaN pandas → None (JSON null) em campos string opcionais
    for col in ("paisIso3", "codigoFamilia", "familia", "divisao"):
        if col in df_agg.columns:
            df_agg[col] = df_agg[col].where(df_agg[col].notna(), None)

    total_agregado = len(df_agg)
    print(f"[transform_vendas] Grupos agregados: {total_agregado}")

    # ── Reconciliação de grupos negativos ────────────────────────────────────
    # Devoluções com canal ou paisIso3 diferente da venda original ficam em grupos
    # isolados com qtd negativa. Em vez de descartá-las, busca venda correspondente
    # do mesmo (produto, unidade) no ano:
    #   1. Mesmo mês (qualquer canal/país) — maior qtd primeiro
    #   2. Meses anteriores no ano — mais recente primeiro
    #   3. Meses posteriores no ano — mais antigo primeiro
    # Devoluções sem correspondência (órfãs) são descartadas com log estruturado.

    grupos_pos = df_agg[df_agg["quantidade"] >  0].to_dict("records")
    grupos_neg = df_agg[df_agg["quantidade"] <  0].to_dict("records")
    zerados    = int((df_agg["quantidade"] == 0).sum())

    print(f"[transform_vendas] Grupos positivos: {len(grupos_pos)} | negativos: {len(grupos_neg)} | zerados: {zerados}")

    def _mes_num(s: str) -> int:
        # "2026-04-01" → 4
        return int(s.split("-")[1])

    def _ano(s: str) -> str:
        return s.split("-")[0]

    aplicadas    = 0
    qtd_aplicada = 0
    orfas        = []
    qtd_orfa     = 0

    for ng in grupos_neg:
        produto = ng["produtoId"]
        unidade = ng["unidadeVendaId"]
        mes_neg = ng["month"]
        ano_neg = _ano(mes_neg)
        mn_neg  = _mes_num(mes_neg)
        restante = -int(ng["quantidade"])  # vira positivo

        # Candidatos ordenados por prioridade
        same    = sorted(
            [(i, p) for i, p in enumerate(grupos_pos)
             if p["produtoId"] == produto and p["unidadeVendaId"] == unidade
             and p["month"] == mes_neg and p["quantidade"] > 0],
            key=lambda x: x[1]["quantidade"], reverse=True,
        )
        earlier = sorted(
            [(i, p) for i, p in enumerate(grupos_pos)
             if p["produtoId"] == produto and p["unidadeVendaId"] == unidade
             and _ano(p["month"]) == ano_neg and _mes_num(p["month"]) < mn_neg
             and p["quantidade"] > 0],
            key=lambda x: _mes_num(x[1]["month"]), reverse=True,
        )
        later   = sorted(
            [(i, p) for i, p in enumerate(grupos_pos)
             if p["produtoId"] == produto and p["unidadeVendaId"] == unidade
             and _ano(p["month"]) == ano_neg and _mes_num(p["month"]) > mn_neg
             and p["quantidade"] > 0],
            key=lambda x: _mes_num(x[1]["month"]),
        )
        candidatos = same + earlier + later

        for idx, _ in candidatos:
            if restante <= 0:
                break
            disponivel = grupos_pos[idx]["quantidade"]
            if disponivel <= 0:
                continue
            take = min(restante, disponivel)
            grupos_pos[idx]["quantidade"] = disponivel - take
            restante     -= take
            qtd_aplicada += take

        if restante > 0:
            orfas.append({
                "produto": produto, "unidade": unidade, "mes": mes_neg,
                "qtd": -restante, "canal": ng.get("canal"), "paisIso3": ng.get("paisIso3"),
            })
            qtd_orfa += restante
        else:
            aplicadas += 1

    print(f"[transform_vendas] Reconciliação: {aplicadas} de {len(grupos_neg)} aplicadas | qtd absorvida: {qtd_aplicada}")
    print(f"[transform_vendas] Devoluções órfãs (descartadas — sem venda no ano): {len(orfas)} | qtd: {qtd_orfa}")
    if orfas:
        print("[transform_vendas] Detalhe das órfãs:")
        for o in orfas:
            print(
                f"  produto={o['produto']} unidade={o['unidade']} mes={o['mes']} "
                f"qtd={o['qtd']} canal={o['canal']} paisIso3={o['paisIso3']}"
            )

    # Mantém apenas grupos com quantidade > 0 após reconciliação
    itens_agg      = [p for p in grupos_pos if p["quantidade"] > 0]
    total_positivo = len(itens_agg)
    print(f"[transform_vendas] Grupos finais (qtd > 0) enviados ao backend: {total_positivo}")

    tmp_agg = TMP_DIR / f"vendas_agg_{run_id}.json"
    tmp_agg.write_text(json.dumps(itens_agg, ensure_ascii=False, default=str))

    # Remove arquivo raw intermediário
    if tmp_raw.exists():
        tmp_raw.unlink()
        print(f"[transform_vendas] Arquivo raw removido: {tmp_raw}")

    print(f"[transform_vendas] Agregado salvo em {tmp_agg}")
    return {
        "total_entrada":        total_entrada,
        "total_agregado":       total_agregado,
        "grupos_positivos":     len(grupos_pos),
        "grupos_negativos":     len(grupos_neg),
        "devolucoes_aplicadas": aplicadas,
        "qtd_aplicada":         qtd_aplicada,
        "devolucoes_orfas":     len(orfas),
        "qtd_orfa":             qtd_orfa,
        "total_final":          total_positivo,
    }


# ── Task 4: Enviar payload ao backend ─────────────────────────────────────────

def push_to_backend(**context) -> None:
    backend_url = Variable.get("FORECAST_BACKEND_URL")
    token       = Variable.get("FORECAST_INTERNAL_TOKEN")
    run_id      = context["run_id"]

    ti = context["ti"]
    ref_month  = ti.xcom_pull(task_ids="resolve_period", key="ref_month")
    c_data_de  = ti.xcom_pull(task_ids="resolve_period", key="c_data_de")
    c_data_ate = ti.xcom_pull(task_ids="resolve_period", key="c_data_ate")

    dag_conf     = context["dag_run"].conf or {}
    triggered_by = dag_conf.get("triggered_by", "airflow-scheduler")

    tmp_agg = TMP_DIR / f"vendas_agg_{run_id}.json"

    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode    = ssl.CERT_NONE

    try:
        all_items = json.loads(tmp_agg.read_text())
        total     = len(all_items)
        chunks    = [all_items[i:i + CHUNK_SIZE] for i in range(0, total, CHUNK_SIZE)]

        print(f"[push_to_backend] {total} grupos em {len(chunks)} lote(s) de até {CHUNK_SIZE}")

        url = f"{backend_url}/api/internal/sync/vendas"

        for idx, chunk in enumerate(chunks, start=1):
            payload = json.dumps(
                {
                    "triggeredBy": triggered_by,
                    "refMonth":    ref_month,
                    "cDataDe":     c_data_de,
                    "cDataAte":    c_data_ate,
                    "itens":       chunk,
                },
                ensure_ascii=False,
            ).encode("utf-8")

            req = urllib.request.Request(
                url,
                data=payload,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )

            try:
                with urllib.request.urlopen(req, timeout=60, context=ssl_ctx) as response:
                    result = json.loads(response.read())
                    print(f"[push_to_backend] Lote {idx}/{len(chunks)} ({len(chunk)} itens) — backend: {result}")
            except urllib.error.HTTPError as http_err:
                body = http_err.read().decode("utf-8", errors="replace")
                raise RuntimeError(
                    f"[push_to_backend] HTTP {http_err.code} no lote {idx}/{len(chunks)}: {body}"
                ) from http_err

        print(f"[push_to_backend] Concluído: {total} grupos em {len(chunks)} lote(s)")

        # Callback ao backend para avançar gate do ciclo
        # ref_month já disponível via XCom (puxado acima)
        execution_ref_month = ti.xcom_pull(task_ids="resolve_period", key="execution_ref_month")

        def _send_callback(ref: str, label: str, data_ref: str | None = None) -> None:
            payload_obj = {
                "dag_id": DAG_ID, "dag_run_id": run_id, "state": "success",
                "refMonth": ref,
                "issued_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            # dataRefMonth: mês dos dados sincronizados — usado pelo backend para
            # resolver o ano correto no refresh de snapshots (pode diferir de
            # refMonth na virada de ano).
            if data_ref:
                payload_obj["dataRefMonth"] = data_ref
            cb_payload = json.dumps(payload_obj).encode("utf-8")
            cb_req = urllib.request.Request(
                f"{backend_url}/api/airflow/callback",
                data=cb_payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(cb_req, timeout=30, context=ssl_ctx) as cb_resp:
                print(f"[push_to_backend] Callback {label} enviado — refMonth={ref} dataRefMonth={data_ref} resp={json.loads(cb_resp.read())}")

        if execution_ref_month:
            try:
                # Callback: mês de execução corrente — avança o gate do ciclo atual.
                # data_ref = ref_month (mês dos dados) é enviado em paralelo para
                # que o backend use o ano correto no refresh de snapshots.
                _send_callback(execution_ref_month, "ciclo", data_ref=ref_month)
            except Exception as exc:
                print(f"[push_to_backend] Falha no callback de ciclo (não crítico): {exc}")

    finally:
        if tmp_agg.exists():
            tmp_agg.unlink()
            print(f"[push_to_backend] Arquivo temporário removido: {tmp_agg}")


# ── DAG ───────────────────────────────────────────────────────────────────────

with DAG(
    dag_id=DAG_ID,
    description=(
        "Extrai vendas do Protheus, aplica ETL (filtros CFOP + blacklist, "
        "reclassificação 3201001, resolução paisIso3, agregação pandas) "
        "e sincroniza VendaMensal + ProdutoUnidadeVenda no backend Forecast"
    ),
    schedule_interval=Variable.get("SYNC_VENDAS_CRON_SCHEDULE", default_var="0 4 1 * *"),
    start_date=datetime(2026, 1, 1),
    catchup=False,
    default_args=DEFAULT_ARGS,
    tags=["protheus", "sync", "vendas", "venda-mensal"],
) as dag:

    task_resolve = PythonOperator(
        task_id="resolve_period",
        python_callable=resolve_period,
    )

    task_fetch = PythonOperator(
        task_id="fetch_vendas",
        python_callable=fetch_vendas,
    )

    task_transform = PythonOperator(
        task_id="transform_vendas",
        python_callable=transform_vendas,
    )

    task_push = PythonOperator(
        task_id="push_to_backend",
        python_callable=push_to_backend,
    )

    task_resolve >> task_fetch >> task_transform >> task_push
