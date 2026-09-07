"""DAG protheus_forecast_run — Executa previsão de demanda e popula ForecastRun/ForecastItem.

Fluxo:
  fetch_sales_data  →  run_forecast  →  push_forecast

Motor de previsão autocontido (6 modelos, seleção por menor sMAPE):
  Holt (damped) | ARIMA(1,2,3) | AutoARIMA | Winters | Theta | Croston

Paralelismo: ProcessPoolExecutor com FORECAST_MAX_WORKERS workers (default=2).
"""

from __future__ import annotations

import warnings
warnings.filterwarnings("ignore")

import gc
import json
import logging
import ssl
import traceback
import urllib.error
import urllib.request
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from statsmodels.tsa.holtwinters import Holt, ExponentialSmoothing
from statsmodels.tsa.arima.model import ARIMA
from pmdarima import auto_arima

try:
    from statsmodels.tools.sm_exceptions import ConvergenceWarning
    warnings.filterwarnings("ignore", category=ConvergenceWarning)
except ImportError:
    pass

from statsforecast import StatsForecast
from statsforecast.models import Theta as ThetaModel, CrostonOptimized

from airflow.models.dag import DAG
from airflow.models import Variable
from airflow.operators.python import PythonOperator

# ── Configurações ──────────────────────────────────────────────────────────────

DAG_ID     = "protheus_forecast_run"
TMP_DIR    = Path("/tmp")
CHUNK_SIZE = 500

DEFAULT_ARGS = {
    "owner":                    "airflow",
    "retries":                  2,
    "retry_delay":              timedelta(minutes=10),
    "retry_exponential_backoff": True,
}

# Parâmetros do motor estatístico
MESES_HISTORICO  = 36
MESES_TREINO     = 24
MESES_TESTE      = 12
MESES_PREVISAO   = 12
MESES_OFFSET     = 3   # meses entre última venda e início da previsão

PERCENTIL_INF    = 0.35
PERCENTIL_SUP    = 0.65
FATOR_IQR        = 1.5
BATCH_SIZE       = 100

logger = logging.getLogger(__name__)

# ── Motor de Previsão ─────────────────────────────────────────────────────────

def calcular_smape(real: np.ndarray, previsto: np.ndarray) -> float:
    """sMAPE — Symmetric Mean Absolute Percentage Error (0–200%).
    Lida com zeros sem gerar infinito, adequado para demanda intermitente.
    """
    denominador = (np.abs(real) + np.abs(previsto)) / 2
    mask = denominador > 0
    if mask.sum() == 0:
        return 0.0
    return float(np.mean(np.abs(real[mask] - previsto[mask]) / denominador[mask]) * 100)


def limpar_outliers(serie: pd.Series) -> pd.Series:
    """Remove outliers via IQR adaptado (percentis 0.35/0.65, fator 1.5)."""
    try:
        q1 = serie.quantile(PERCENTIL_INF)
        q3 = serie.quantile(PERCENTIL_SUP)
        iqr = q3 - q1
        lim_inf = serie.mean() - FATOR_IQR * iqr
        lim_sup = serie.mean() + FATOR_IQR * iqr
        return serie.clip(lower=lim_inf, upper=lim_sup).astype(float)
    except Exception:
        return serie


def _datas_previsao(data_inicio: datetime) -> List[str]:
    """Gera lista de `MESES_PREVISAO` meses a partir de data_inicio (ISO 'YYYY-MM-DD')."""
    return [
        datetime(data_inicio.year, data_inicio.month, 1) + pd.DateOffset(months=i)
        for i in range(MESES_PREVISAO)
    ]


def treinar_holt(treino: pd.Series, teste: pd.Series, dt_inicio: datetime) -> Optional[Dict]:
    try:
        m = Holt(treino, damped_trend=True).fit(maxiter=50)
        smape = calcular_smape(teste.values, m.forecast(MESES_TESTE).values)
        mf = Holt(pd.concat([treino, teste]), damped_trend=True).fit(maxiter=50)
        prev = np.clip(mf.forecast(MESES_PREVISAO).values, 0, None)
        return {"modelo": "Holt", "smape": smape,
                "previsao": list(zip(_datas_previsao(dt_inicio), prev))}
    except Exception:
        return None


def treinar_arima(treino: pd.Series, teste: pd.Series, dt_inicio: datetime) -> Optional[Dict]:
    try:
        m = ARIMA(treino, order=(1, 2, 3), trend="n").fit(maxiter=50)
        smape = calcular_smape(teste.values, m.forecast(MESES_TESTE).values)
        mf = ARIMA(pd.concat([treino, teste]), order=(1, 2, 3), trend="n").fit(maxiter=50)
        prev = np.clip(mf.forecast(MESES_PREVISAO).values, 0, None)
        return {"modelo": "ARIMA(1,2,3)", "smape": smape,
                "previsao": list(zip(_datas_previsao(dt_inicio), prev))}
    except Exception:
        return None


def treinar_autoarima(treino: pd.Series, teste: pd.Series, dt_inicio: datetime) -> Optional[Dict]:
    try:
        m = auto_arima(
            treino,
            seasonal=False,       # Winters já cobre sazonalidade; SARIMA(m=12) é ~10× mais lento
            max_p=2, max_q=2,
            max_d=1,
            max_order=4,
            max_iter=50,
            stepwise=True,
            suppress_warnings=True,
            error_action="ignore",
            trace=False,
        )
        smape = calcular_smape(teste.values, m.predict(n_periods=MESES_TESTE))
        mf = auto_arima(
            pd.concat([treino, teste]),
            seasonal=False,
            max_p=2, max_q=2,
            max_d=1,
            max_order=4,
            max_iter=50,
            stepwise=True,
            suppress_warnings=True,
            error_action="ignore",
            trace=False,
        )
        prev = np.clip(mf.predict(n_periods=MESES_PREVISAO), 0, None)
        return {"modelo": "AutoARIMA", "smape": smape,
                "previsao": list(zip(_datas_previsao(dt_inicio), prev))}
    except Exception:
        return None


def treinar_winters(treino: pd.Series, teste: pd.Series, dt_inicio: datetime) -> Optional[Dict]:
    """Triple Exponential Smoothing (Winters) com sazonalidade anual.
    Tenta multiplicativa (melhor para séries sem zeros), fallback para aditiva.
    """
    def _fit(serie: pd.Series, seasonal: str):
        return ExponentialSmoothing(
            serie, trend="add", seasonal=seasonal, seasonal_periods=12
        ).fit(maxiter=50)

    try:
        try:
            m = _fit(treino, "mul")
        except Exception:
            m = _fit(treino, "add")

        smape = calcular_smape(teste.values, m.forecast(MESES_TESTE).values)

        try:
            mf = _fit(pd.concat([treino, teste]), "mul")
        except Exception:
            mf = _fit(pd.concat([treino, teste]), "add")

        prev = np.clip(mf.forecast(MESES_PREVISAO).values, 0, None)
        return {"modelo": "Winters", "smape": smape,
                "previsao": list(zip(_datas_previsao(dt_inicio), prev))}
    except Exception:
        return None


def _statsforecast_df(serie: pd.Series) -> pd.DataFrame:
    """Converte pd.Series com DatetimeIndex para o formato esperado por StatsForecast."""
    df = serie.reset_index()
    df.columns = ["ds", "y"]
    df["unique_id"] = "serie"
    return df[["unique_id", "ds", "y"]]


def treinar_theta(treino: pd.Series, teste: pd.Series, dt_inicio: datetime) -> Optional[Dict]:
    """Modelo Theta — vencedor da competição M3; robusto para séries curtas."""
    try:
        sf_treino = StatsForecast(
            models=[ThetaModel(season_length=12)], freq="MS", verbose=False
        )
        sf_treino.fit(_statsforecast_df(treino))
        prev_teste = sf_treino.predict(h=MESES_TESTE)["ThetaModel"].values
        smape = calcular_smape(teste.values, prev_teste)

        serie_completa = pd.concat([treino, teste])
        sf_final = StatsForecast(
            models=[ThetaModel(season_length=12)], freq="MS", verbose=False
        )
        sf_final.fit(_statsforecast_df(serie_completa))
        prev = np.clip(sf_final.predict(h=MESES_PREVISAO)["ThetaModel"].values, 0, None)
        return {"modelo": "Theta", "smape": smape,
                "previsao": list(zip(_datas_previsao(dt_inicio), prev))}
    except Exception:
        return None


def treinar_croston(treino: pd.Series, teste: pd.Series, dt_inicio: datetime) -> Optional[Dict]:
    """Croston Optimized — especialmente eficaz para demanda intermitente com zeros."""
    try:
        sf_treino = StatsForecast(
            models=[CrostonOptimized()], freq="MS", verbose=False
        )
        sf_treino.fit(_statsforecast_df(treino))
        prev_teste = sf_treino.predict(h=MESES_TESTE)["CrostonOptimized"].values
        smape = calcular_smape(teste.values, prev_teste)

        serie_completa = pd.concat([treino, teste])
        sf_final = StatsForecast(
            models=[CrostonOptimized()], freq="MS", verbose=False
        )
        sf_final.fit(_statsforecast_df(serie_completa))
        prev = np.clip(sf_final.predict(h=MESES_PREVISAO)["CrostonOptimized"].values, 0, None)
        return {"modelo": "Croston", "smape": smape,
                "previsao": list(zip(_datas_previsao(dt_inicio), prev))}
    except Exception:
        return None


# ── Helpers HTTP ──────────────────────────────────────────────────────────────

def _ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def processar_grupo(args: tuple) -> Dict:
    """Função standalone (picklable) — processa um grupo produto×unidade×país.

    Retorna dict com: results, sucesso, pulados, falhados, smape, modelo.
    Projetada para uso com ProcessPoolExecutor.
    """
    (classe_codigo, classe_nome, produto, pais_iso3), grupo, \
        full_range, dt_inicio_prev, meses_min_real = args

    vazio = {"results": [], "sucesso": 0, "pulados": 0, "falhados": 0,
             "smape": None, "modelo": None}

    try:
        grupo = grupo.sort_values("Data")

        serie = (
            grupo.set_index("Data")["Vendas_limpa"]
            .reindex(full_range)
            .fillna(0)
        )
        serie.index.freq = "MS"

        if len(serie) < MESES_HISTORICO:
            return {**vazio, "pulados": 1}

        meses_com_venda = int((grupo["Quantidade"] > 0).sum())
        if meses_com_venda < meses_min_real:
            return {**vazio, "pulados": 1}

        treino = serie.iloc[:MESES_TREINO]
        teste  = serie.iloc[MESES_TREINO:MESES_HISTORICO]
        dt_inicio = dt_inicio_prev.to_pydatetime()

        candidatos = [
            treinar_holt(treino, teste, dt_inicio),
            treinar_arima(treino, teste, dt_inicio),
            treinar_autoarima(treino, teste, dt_inicio),
            treinar_winters(treino, teste, dt_inicio),
            treinar_theta(treino, teste, dt_inicio),
            treinar_croston(treino, teste, dt_inicio),
        ]
        resultados = [c for c in candidatos if c is not None]

        if not resultados:
            return {**vazio, "falhados": 1}

        melhor = min(resultados, key=lambda x: x["smape"])

        results = [
            {
                "unidadeVendaId": classe_codigo,
                "produtoId":      produto,
                "paisIso3":       None if pd.isna(pais_iso3) else pais_iso3,
                "month":          data_prev.strftime("%Y-%m-%d") if hasattr(data_prev, "strftime")
                                  else str(data_prev)[:10],
                "volumeIA":       int(round(float(valor))),
                "modelo":         melhor["modelo"],
                "smape":          round(melhor["smape"], 2),
            }
            for data_prev, valor in melhor["previsao"]
        ]

        return {
            "results":  results,
            "sucesso":  1,
            "pulados":  0,
            "falhados": 0,
            "smape":    melhor["smape"],
            "modelo":   melhor["modelo"],
        }

    except Exception as exc:
        logging.getLogger(__name__).warning(
            "[processar_grupo] Produto %s erro: %s", produto, str(exc)[:120]
        )
        return {**vazio, "falhados": 1}


def _get(url: str, token: str) -> Any:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=120) as resp:
        return json.loads(resp.read().decode())


def _post(url: str, token: str, payload: Any) -> Any:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type":  "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=120) as resp:
        return json.loads(resp.read().decode())



# ── Tasks ──────────────────────────────────────────────────────────────────────

def fetch_sales_data(**context) -> str:
    """Task 1 — Busca histórico de vendas do backend e salva em /tmp."""
    backend_url    = Variable.get("FORECAST_BACKEND_URL").rstrip("/")
    token          = Variable.get("FORECAST_INTERNAL_TOKEN")
    meses_hist     = int(Variable.get("FORECAST_MESES_HISTORICO",  default_var="36"))
    meses_atv      = int(Variable.get("FORECAST_MESES_ATIVOS",     default_var="12"))
    # Usa a data atual para determinar o mês do ciclo em andamento.
    # data_interval_end não é confiável em triggers manuais antes do dia agendado
    # (Airflow retorna o último intervalo concluído, defasando o mês em 1).
    now        = datetime.utcnow()
    prev_year  = now.year if now.month > 1 else now.year - 1
    prev_month = now.month - 1 if now.month > 1 else 12
    prev_ref_month = f"{prev_year:04d}-{prev_month:02d}-01"

    url = (
        f"{backend_url}/api/internal/forecast/sales-data"
        f"?months={meses_hist}&activeMonths={meses_atv}&prevRefMonth={prev_ref_month}"
    )
    logger.info("[fetch_sales_data] prevRefMonth=%s | GET %s", prev_ref_month, url)

    resp  = _get(url, token)
    items = resp.get("items", [])
    total = resp.get("total", len(items))
    mode  = resp.get("mode", "unknown")

    logger.info("[fetch_sales_data] modo=%s | %d registros (%d pares produto/unidade únicos)",
                mode,
                total,
                len({(i["Codigo Produto"], i["Codigo ClasseValor"]) for i in items}))

    run_id  = context["run_id"]
    arquivo = str(TMP_DIR / f"forecast_sales_{run_id}.json")
    with open(arquivo, "w") as f:
        json.dump(items, f)

    logger.info("[fetch_sales_data] Dados salvos em %s", arquivo)
    return arquivo


def run_forecast(**context) -> str:
    """Task 2 — Executa os 6 modelos e seleciona o melhor por sMAPE."""
    run_id  = context["run_id"]
    arquivo_entrada = context["task_instance"].xcom_pull(task_ids="fetch_sales_data")

    meses_min_real = int(Variable.get("FORECAST_MESES_MIN_VENDA_REAL", default_var="6"))

    logger.info("[run_forecast] Carregando dados de %s", arquivo_entrada)
    with open(arquivo_entrada) as f:
        raw = json.load(f)

    if not raw:
        raise ValueError("[run_forecast] Arquivo de entrada vazio — nenhuma venda encontrada.")

    df = pd.DataFrame(raw)
    df["Data"]      = pd.to_datetime(df["Data"], format="%m/%Y", errors="coerce")
    df["Quantidade"] = pd.to_numeric(df["Quantidade"], errors="coerce").fillna(0)
    df = df.dropna(subset=["Data"])

    # 1. Soma de canais — agrega VENDA DIRETA + DISTRIBUIDOR
    df = (
        df.groupby(
            ["Codigo ClasseValor", "Classe Valor", "Codigo Produto", "Data", "paisIso3"],
            dropna=False, as_index=False,
        )
        .agg(Quantidade=("Quantidade", "sum"))
    )

    # 2. Limpeza de outliers por produto
    df["Vendas_limpa"] = np.nan
    for produto in df["Codigo Produto"].unique():
        idx = df["Codigo Produto"] == produto
        df.loc[idx, "Vendas_limpa"] = limpar_outliers(df.loc[idx, "Quantidade"]).values

    # Referências temporais
    data_maxima      = df["Data"].max()
    dt_inicio_prev   = data_maxima + pd.DateOffset(months=MESES_OFFSET)
    full_range       = pd.date_range(
        start=data_maxima - pd.DateOffset(months=MESES_HISTORICO - 1),
        end=data_maxima,
        freq="MS",
    )

    logger.info("[run_forecast] Dados: %s → %s | início previsão: %s",
                df["Data"].min().strftime("%m/%Y"),
                data_maxima.strftime("%m/%Y"),
                dt_inicio_prev.strftime("%m/%Y"))

    grupos = list(df.groupby(
        ["Codigo ClasseValor", "Classe Valor", "Codigo Produto", "paisIso3"],
        dropna=False,
    ))
    total = len(grupos)
    logger.info("[run_forecast] %d grupos (produto × unidade × país) a processar", total)

    all_results: List[Dict] = []
    contador_modelos: Dict[str, int] = {
        "Holt": 0, "ARIMA(1,2,3)": 0, "AutoARIMA": 0,
        "Winters": 0, "Theta": 0, "Croston": 0,
    }
    smapes: List[float] = []
    pulados = falhados = sucesso = 0

    max_workers = int(Variable.get("FORECAST_MAX_WORKERS", default_var="2"))
    log_step    = max(1, total // 20)   # progresso a cada 5%

    args_list = [
        ((classe_codigo, classe_nome, produto, pais_iso3), grupo,
         full_range, dt_inicio_prev, meses_min_real)
        for (classe_codigo, classe_nome, produto, pais_iso3), grupo in grupos
    ]

    # Airflow (Local Executor) roda tasks como processos daemon, o que impede criar
    # processos filhos diretamente. Desabilitar temporariamente para usar ProcessPoolExecutor.
    import multiprocessing as _mp
    _current = _mp.current_process()
    _original_daemon = _current.daemon
    _current.daemon = False

    concluidos = 0
    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(processar_grupo, args): args[0][2]  # produto como chave
                   for args in args_list}

        for future in as_completed(futures):
            concluidos += 1
            try:
                r = future.result()
            except Exception as exc:
                falhados += 1
                logger.warning("[run_forecast] Future erro inesperado: %s", str(exc)[:120])
                continue

            all_results.extend(r["results"])
            sucesso  += r["sucesso"]
            pulados  += r["pulados"]
            falhados += r["falhados"]

            if r["smape"] is not None:
                smapes.append(r["smape"])
                contador_modelos[r["modelo"]] = contador_modelos.get(r["modelo"], 0) + 1
                if r["smape"] > 60:
                    logger.warning("[run_forecast] Produto %s — sMAPE alto (%.1f%%) modelo=%s",
                                   futures[future], r["smape"], r["modelo"])

            if concluidos % log_step == 0 or concluidos == total:
                pct = concluidos / total * 100
                logger.info("[run_forecast] %d/%d (%.0f%%) | ok=%d pulados=%d falhas=%d",
                            concluidos, total, pct, sucesso, pulados, falhados)

        gc.collect()

    _current.daemon = _original_daemon  # restaura flag original

    # Resumo final
    logger.info("=" * 60)
    logger.info("[run_forecast] RESUMO")
    logger.info("  Total grupos : %d", total)
    logger.info("  Sucesso      : %d", sucesso)
    logger.info("  Pulados      : %d", pulados)
    logger.info("  Falhados     : %d", falhados)
    logger.info("  sMAPE médio  : %.2f%%", np.mean(smapes) if smapes else 0)
    logger.info("  Modelos vencedores:")
    for nome, cnt in sorted(contador_modelos.items(), key=lambda x: -x[1]):
        if cnt:
            logger.info("    %-16s %d (%.1f%%)", nome, cnt, cnt / max(sucesso, 1) * 100)
    logger.info("=" * 60)

    if not all_results:
        raise ValueError("[run_forecast] Nenhuma previsão gerada — verifique os dados de entrada.")

    arquivo_saida = str(TMP_DIR / f"forecast_results_{run_id}.json")
    with open(arquivo_saida, "w") as f:
        json.dump(all_results, f)

    logger.info("[run_forecast] %d previsões salvas em %s", len(all_results), arquivo_saida)
    return arquivo_saida


def push_forecast(**context) -> Dict:
    """Task 3 — Cria ForecastRun e envia ForecastItems em chunks ao backend."""
    run_id          = context["run_id"]
    arquivo_results = context["task_instance"].xcom_pull(task_ids="run_forecast")

    backend_url = Variable.get("FORECAST_BACKEND_URL").rstrip("/")
    token       = Variable.get("FORECAST_INTERNAL_TOKEN")
    lead_time   = int(Variable.get("FORECAST_LEAD_TIME_MONTHS", default_var="2"))
    triggered_by = f"airflow:{run_id}"

    with open(arquivo_results) as f:
        items = json.load(f)

    # Usa datetime.utcnow() em vez de data_interval_end: em triggers manuais antes do
    # dia agendado (cron "0 6 5 * *"), o Airflow devolve o último intervalo concluído,
    # causando ref_month 1 mês defasado.
    now = datetime.utcnow()
    ref_month = f"{now.year:04d}-{now.month:02d}-01"
    logger.info("[push_forecast] Criando ForecastRun refMonth=%s leadTime=%d", ref_month, lead_time)

    run_resp = _post(
        f"{backend_url}/api/internal/forecast/run",
        token,
        {"refMonth": ref_month, "leadTimeMonths": lead_time, "triggeredBy": triggered_by},
    )
    forecast_run_id = run_resp["runId"]
    logger.info("[push_forecast] ForecastRun criado: %s | window %s → %s",
                forecast_run_id, run_resp.get("windowStart"), run_resp.get("windowEnd"))

    # Envia em chunks de CHUNK_SIZE
    total    = len(items)
    inserted = 0
    for start in range(0, total, CHUNK_SIZE):
        chunk = items[start:start + CHUNK_SIZE]
        payload = [
            {
                "produtoId":      i["produtoId"],
                "unidadeVendaId": i["unidadeVendaId"],
                "month":          i["month"],
                "volumeIA":       i["volumeIA"],
                "paisIso3":       i["paisIso3"],
            }
            for i in chunk
        ]
        resp = _post(
            f"{backend_url}/api/internal/forecast/run/{forecast_run_id}/items",
            token,
            {"items": payload},
        )
        inserted += resp.get("inserted", len(chunk))
        logger.info("[push_forecast] Chunk %d/%d — %d itens inseridos",
                    min(start + CHUNK_SIZE, total), total, resp.get("inserted", len(chunk)))

    logger.info("[push_forecast] Concluído — %d/%d itens inseridos no run %s",
                inserted, total, forecast_run_id)

    # Finaliza o run (PROCESSING → SUCCESS)
    finalize_resp = _post(
        f"{backend_url}/api/internal/forecast/run/{forecast_run_id}/finalize",
        token,
        {},
    )
    logger.info("[push_forecast] Run finalizado: %s", finalize_resp)

    # Notifica o backend para avançar o gate do ciclo
    try:
        callback_resp = _post(
            f"{backend_url}/api/airflow/callback",
            token,
            {
                "dag_id":      DAG_ID,
                "dag_run_id":  run_id,
                "state":       "success",
                "refMonth":    ref_month,
                "issued_at":   datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
        )
        logger.info("[push_forecast] Callback enviado — gate: %s", callback_resp.get("gate", "?"))
    except Exception as exc:
        logger.warning("[push_forecast] Falha no callback (não crítico): %s", exc)

    # Limpeza de arquivos temporários
    for f_path in [
        TMP_DIR / f"forecast_sales_{run_id}.json",
        TMP_DIR / f"forecast_results_{run_id}.json",
    ]:
        try:
            f_path.unlink(missing_ok=True)
        except Exception:
            pass

    return {"runId": forecast_run_id, "totalItens": inserted}


# ── DAG ───────────────────────────────────────────────────────────────────────

with DAG(
    dag_id=DAG_ID,
    description="Executa modelos de previsão de demanda e publica ForecastRun + ForecastItems",
    default_args=DEFAULT_ARGS,
    schedule_interval=Variable.get("FORECAST_CRON_SCHEDULE", default_var="0 6 5 * *"),
    start_date=datetime(2026, 1, 1),
    catchup=False,
    tags=["forecast", "previsao"],
    max_active_runs=1,
) as dag:

    t1 = PythonOperator(
        task_id="fetch_sales_data",
        python_callable=fetch_sales_data,
    )

    t2 = PythonOperator(
        task_id="run_forecast",
        python_callable=run_forecast,
        execution_timeout=timedelta(hours=10),
    )

    t3 = PythonOperator(
        task_id="push_forecast",
        python_callable=push_forecast,
    )

    t1 >> t2 >> t3
