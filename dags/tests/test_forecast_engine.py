"""Testes do motor de forecast (protheus_forecast_run.py) — sMAPE e seleção de modelo."""

from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd
import pytest

import protheus_forecast_run as fr


# ── calcular_smape ────────────────────────────────────────────────────────────

class TestCalcularSmape:
    def test_previsao_perfeita_e_zero(self):
        real = np.array([10.0, 20.0, 30.0])
        assert fr.calcular_smape(real, real.copy()) == 0.0

    def test_valor_conhecido(self):
        # |100-80| / ((100+80)/2) = 20/90 → 22.22%
        assert fr.calcular_smape(np.array([100.0]), np.array([80.0])) == pytest.approx(22.2222, abs=1e-4)

    def test_e_simetrico(self):
        a, b = np.array([100.0, 50.0]), np.array([80.0, 70.0])
        assert fr.calcular_smape(a, b) == pytest.approx(fr.calcular_smape(b, a))

    def test_limitado_a_200_quando_um_lado_e_zero(self):
        # Venda zero com previsão positiva (ou o inverso) é o erro máximo, não infinito.
        assert fr.calcular_smape(np.array([0.0, 0.0]), np.array([5.0, 9.0])) == pytest.approx(200.0)
        assert fr.calcular_smape(np.array([5.0]), np.array([0.0])) == pytest.approx(200.0)

    def test_meses_com_real_e_previsto_zero_nao_contam(self):
        # Demanda intermitente: meses sem venda e sem previsão ficam fora da média.
        com_zeros = fr.calcular_smape(np.array([0.0, 100.0]), np.array([0.0, 80.0]))
        sem_zeros = fr.calcular_smape(np.array([100.0]), np.array([80.0]))
        assert com_zeros == pytest.approx(sem_zeros)

    def test_serie_toda_zerada_retorna_zero(self):
        assert fr.calcular_smape(np.zeros(12), np.zeros(12)) == 0.0


# ── limpar_outliers ───────────────────────────────────────────────────────────

class TestLimparOutliers:
    # O critério de corte (média ± 1.5×IQR dos percentis 35–65) está em revisão;
    # aqui só o que independe dele.
    def test_serie_constante_fica_inalterada(self):
        serie = pd.Series([42.0] * 12)
        assert fr.limpar_outliers(serie).tolist() == [42.0] * 12


# ── _datas_previsao ───────────────────────────────────────────────────────────

class TestDatasPrevisao:
    def test_gera_12_meses_a_partir_do_primeiro_dia(self):
        datas = fr._datas_previsao(datetime(2026, 11, 17))
        assert len(datas) == fr.MESES_PREVISAO == 12
        assert datas[0].strftime("%Y-%m-%d") == "2026-11-01"

    def test_atravessa_a_virada_de_ano(self):
        datas = [d.strftime("%Y-%m") for d in fr._datas_previsao(datetime(2026, 11, 1))]
        assert datas[:4] == ["2026-11", "2026-12", "2027-01", "2027-02"]


# ── selecionar_melhor_modelo ──────────────────────────────────────────────────

def _candidato(modelo: str, smape: float) -> dict:
    return {"modelo": modelo, "smape": smape, "previsao": []}


class TestSelecionarMelhorModelo:
    def test_escolhe_menor_smape(self):
        melhor = fr.selecionar_melhor_modelo([
            _candidato("Holt", 30.0),
            _candidato("Theta", 12.5),
            _candidato("Croston", 18.0),
        ])
        assert melhor["modelo"] == "Theta"

    def test_ignora_modelos_que_falharam(self):
        melhor = fr.selecionar_melhor_modelo([None, _candidato("Winters", 40.0), None])
        assert melhor["modelo"] == "Winters"

    def test_nenhum_modelo_convergiu(self):
        assert fr.selecionar_melhor_modelo([None, None]) is None
        assert fr.selecionar_melhor_modelo([]) is None

    def test_empate_mantem_a_ordem_dos_candidatos(self):
        melhor = fr.selecionar_melhor_modelo([_candidato("Holt", 10.0), _candidato("ARIMA(1,2,3)", 10.0)])
        assert melhor["modelo"] == "Holt"


# ── processar_grupo (orquestração, com modelos substituídos) ─────────────────

FULL_RANGE = pd.date_range("2023-06-01", periods=fr.MESES_HISTORICO, freq="MS")
INICIO_PREV = pd.Timestamp("2026-09-01")


def _grupo(meses_com_venda: int = fr.MESES_HISTORICO) -> pd.DataFrame:
    qtd = [100.0] * meses_com_venda + [0.0] * (fr.MESES_HISTORICO - meses_com_venda)
    return pd.DataFrame({"Data": FULL_RANGE, "Quantidade": qtd, "Vendas_limpa": qtd})


def _args(grupo: pd.DataFrame, pais=np.nan, meses_min_real: int = 6) -> tuple:
    return (("CARDIO", "Cardio", "P001", pais), grupo, FULL_RANGE, INICIO_PREV, meses_min_real)


@pytest.fixture
def modelos_fixos(monkeypatch):
    """Substitui os 6 treinadores por resultados determinísticos (sem statsmodels)."""
    def fixo(nome, smape, valor):
        def treinar(treino, teste, dt_inicio):
            return {"modelo": nome, "smape": smape,
                    "previsao": list(zip(fr._datas_previsao(dt_inicio), [valor] * fr.MESES_PREVISAO))}
        return treinar

    monkeypatch.setattr(fr, "treinar_holt",      fixo("Holt", 35.0, 90.0))
    monkeypatch.setattr(fr, "treinar_arima",     lambda *a: None)          # não convergiu
    monkeypatch.setattr(fr, "treinar_autoarima", fixo("AutoARIMA", 22.0, 95.0))
    monkeypatch.setattr(fr, "treinar_winters",   fixo("Winters", 14.3, 101.6))
    monkeypatch.setattr(fr, "treinar_theta",     fixo("Theta", 18.0, 99.0))
    monkeypatch.setattr(fr, "treinar_croston",   fixo("Croston", 40.0, 80.0))


class TestProcessarGrupo:
    def test_publica_a_previsao_do_modelo_vencedor(self, modelos_fixos):
        out = fr.processar_grupo(_args(_grupo()))

        assert (out["sucesso"], out["modelo"], out["smape"]) == (1, "Winters", 14.3)
        assert len(out["results"]) == fr.MESES_PREVISAO
        primeiro = out["results"][0]
        assert primeiro == {
            "unidadeVendaId": "CARDIO",
            "produtoId": "P001",
            "paisIso3": None,         # NaN do pandas vira null no payload
            "month": "2026-09-01",
            "volumeIA": 102,          # 101.6 arredondado para inteiro
            "modelo": "Winters",
            "smape": 14.3,
        }

    def test_mantem_pais_das_unidades_de_export(self, modelos_fixos):
        out = fr.processar_grupo(_args(_grupo(), pais="ARG"))
        assert {r["paisIso3"] for r in out["results"]} == {"ARG"}

    def test_pula_serie_com_poucos_meses_de_venda_real(self, modelos_fixos):
        out = fr.processar_grupo(_args(_grupo(meses_com_venda=3), meses_min_real=6))
        assert (out["pulados"], out["results"]) == (1, [])

    def test_pula_historico_mais_curto_que_o_exigido(self, modelos_fixos):
        range_curto = FULL_RANGE[:24]
        grupo = _grupo().iloc[:24]
        out = fr.processar_grupo((("CARDIO", "Cardio", "P001", np.nan), grupo, range_curto, INICIO_PREV, 6))
        assert out["pulados"] == 1

    def test_conta_falha_quando_nenhum_modelo_converge(self, monkeypatch):
        for nome in ("holt", "arima", "autoarima", "winters", "theta", "croston"):
            monkeypatch.setattr(fr, f"treinar_{nome}", lambda *a: None)
        out = fr.processar_grupo(_args(_grupo()))
        assert (out["falhados"], out["results"]) == (1, [])
