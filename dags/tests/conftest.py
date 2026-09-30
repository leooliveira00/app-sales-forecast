"""Stubs mínimos do Airflow para importar os módulos das DAGs sem o Airflow instalado.

Os testes exercitam só o motor de forecast (funções puras); a definição do DAG no
fim de cada módulo precisa apenas "executar" na importação: `with DAG(...)`,
`PythonOperator(...)`, `t1 >> t2` e `Variable.get(..., default_var=...)`.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

# Permite `import protheus_forecast_run` a partir de dags/tests/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class _Operator:
    def __init__(self, *args, **kwargs):
        pass

    def __rshift__(self, other):
        return other


class _DAG:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _Variable:
    @staticmethod
    def get(key, default_var=None):
        return default_var


def _module(name: str, **attrs) -> types.ModuleType:
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules[name] = mod
    return mod


if "airflow" not in sys.modules:
    _module("airflow")
    _module("airflow.models", Variable=_Variable)
    _module("airflow.models.dag", DAG=_DAG)
    _module("airflow.operators")
    _module("airflow.operators.python", PythonOperator=_Operator)
    _module("airflow.operators.trigger_dagrun", TriggerDagRunOperator=_Operator)
