import { useState, useEffect, useMemo } from 'react';
import type { ForecastRun } from '../types/forecast';
import { toMonthParam } from '../types/forecast';

interface UseForecastNavigationResult {
  cycleDate:          Date | null;
  availableRuns:      ForecastRun[];
  runsLoaded:         boolean;
  cycleParam:         string | null;
  activeRun:          ForecastRun | null;
  cycleSortedKeys:    string[];
  cycleIdx:           number;
  isHistorical:       boolean;
  cycleIsClosed:      boolean;
  canPrevCycle:       boolean;
  canNextCycle:       boolean;
  pendingReleaseDate: string | null;
  setCycleByKey:      (key: string) => void;
  navigateCycle:      (direction: 'prev' | 'next') => void;
}

export function useForecastNavigation(token: string | null): UseForecastNavigationResult {
  const [cycleDate, setCycleDate]                   = useState<Date | null>(null);
  const [availableRuns, setAvailableRuns]           = useState<ForecastRun[]>([]);
  const [runsLoaded, setRunsLoaded]                 = useState(false);
  const [pendingReleaseDate, setPendingReleaseDate] = useState<string | null>(null);

  // Busca a data do próximo ciclo ainda não liberado (endpoint dedicado)
  useEffect(() => {
    if (!token) return;
    fetch('/api/forecast/runs/next-release', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : { availableFrom: null })
      .then((data: { availableFrom: string | null }) => setPendingReleaseDate(data.availableFrom ?? null))
      .catch(() => {});
  }, [token]);

  // Busca os ciclos navegáveis (backend já exclui futuros, inclui encerrados via sentinel)
  useEffect(() => {
    if (!token) return;
    fetch('/api/forecast/runs', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((runs: ForecastRun[]) => {
        const success = (runs as ForecastRun[])
          .filter(r => r.status === 'SUCCESS')
          .sort((a, b) => new Date(a.refMonth).getTime() - new Date(b.refMonth).getTime());

        setAvailableRuns(success);
        setRunsLoaded(true);

        if (success.length === 0) return;

        const now       = new Date();
        const currentYM = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

        // Prefere o mês atual aberto; senão usa o último ciclo disponível
        const runForCurrentMonth = success.find(r => r.refMonth.substring(0, 7) === currentYM);
        const latest             = success[success.length - 1];
        setCycleDate(new Date((runForCurrentMonth ?? latest).refMonth));
      })
      .catch(() => setRunsLoaded(true));
  }, [token]);

  const cycleParam = cycleDate ? toMonthParam(cycleDate) : null;

  const activeRun = useMemo(() =>
    cycleParam
      ? (availableRuns.find(r => r.refMonth.substring(0, 7) === cycleParam.substring(0, 7)) ?? null)
      : null,
    [availableRuns, cycleParam]
  );

  const cycleSortedKeys = useMemo(() =>
    availableRuns.map(r => r.refMonth.substring(0, 7)).sort(),
    [availableRuns]
  );

  const cycleIdx     = cycleParam ? cycleSortedKeys.indexOf(cycleParam.substring(0, 7)) : -1;
  const isHistorical = runsLoaded && cycleIdx >= 0 && cycleIdx < cycleSortedKeys.length - 1;
  const canPrevCycle = cycleIdx > 0;
  const canNextCycle = cycleIdx >= 0 && cycleIdx < cycleSortedKeys.length - 1;

  // Ciclo encerrado: janela expirada (availableUntil < agora) ou sentinel (availableFrom >= 9000-01-01)
  const SENTINEL = new Date('9000-01-01');
  const cycleIsClosed = activeRun !== null && (
    (activeRun.availableFrom !== null && new Date(activeRun.availableFrom) >= SENTINEL) ||
    (activeRun.availableUntil !== null && new Date(activeRun.availableUntil) < new Date())
  );

  const setCycleByKey = (key: string) => {
    const [y, m] = key.split('-').map(Number);
    setCycleDate(new Date(Date.UTC(y, m - 1, 1)));
  };

  const navigateCycle = (direction: 'prev' | 'next') => {
    const newKey = direction === 'prev' ? cycleSortedKeys[cycleIdx - 1] : cycleSortedKeys[cycleIdx + 1];
    if (newKey) setCycleByKey(newKey);
  };

  return {
    cycleDate, availableRuns, runsLoaded,
    cycleParam, activeRun, cycleSortedKeys, cycleIdx,
    isHistorical, cycleIsClosed, canPrevCycle, canNextCycle,
    pendingReleaseDate,
    setCycleByKey, navigateCycle,
  };
}
