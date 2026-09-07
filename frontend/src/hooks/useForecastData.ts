import { useState, useCallback, useRef, useEffect } from 'react';
import type { ForecastItem, Submission } from '../types/forecast';
import { toMonthParam } from '../types/forecast';

export interface UnitPais {
  iso3: string;
  nome: string;
}

interface UseForecastDataOptions {
  unidadeVendaId: string | undefined;
  cycleDate: Date | null;
  targetDate: Date | null;
  token: string | null;
  onError: (msg: string) => void;
}

interface UseForecastDataResult {
  items: ForecastItem[];
  setItems: React.Dispatch<React.SetStateAction<ForecastItem[]>>;
  submission: Submission | null;
  setSubmission: React.Dispatch<React.SetStateAction<Submission | null>>;
  isLoading: boolean;
  fcts: Record<string, string>;
  setFcts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  initialFcts: React.MutableRefObject<Record<string, string>>;
  itemCache: React.MutableRefObject<Map<string, ForecastItem[]>>;
  subCache: React.MutableRefObject<Map<string, Submission | null>>;
  fetchData: (bustCache?: boolean) => Promise<void>;
  unitPaises: UnitPais[];
  isExport: boolean;
}

export function useForecastData({
  unidadeVendaId,
  cycleDate,
  targetDate,
  token,
  onError,
}: UseForecastDataOptions): UseForecastDataResult {
  const [items, setItems]           = useState<ForecastItem[]>([]);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [isLoading, setIsLoading]   = useState(false);
  const [fcts, setFcts]             = useState<Record<string, string>>({});
  const [unitPaises, setUnitPaises] = useState<UnitPais[]>([]);
  const [isExport, setIsExport]     = useState(false);
  const initialFcts = useRef<Record<string, string>>({});
  const itemCache   = useRef<Map<string, ForecastItem[]>>(new Map());
  const subCache    = useRef<Map<string, Submission | null>>(new Map());

  // Busca tipo e países da unidade via API
  useEffect(() => {
    if (!unidadeVendaId || !token) {
      setIsExport(false);
      setUnitPaises([]);
      return;
    }
    fetch(`/api/unidades/${encodeURIComponent(unidadeVendaId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        const exportFlag = u?.tipo === 'EXPORT';
        setIsExport(exportFlag);
        setUnitPaises(exportFlag && Array.isArray(u?.paises) ? u.paises : []);
      })
      .catch(() => { setIsExport(false); setUnitPaises([]); });
  }, [unidadeVendaId, token]);

  // Inicializa o estado de FCTS a partir dos dados carregados.
  // Funciona igual para NACIONAL e EXPORT — cada ForecastItem tem seu próprio override.
  const initFctsState = useCallback((data: ForecastItem[]) => {
    const initial: Record<string, string> = {};
    data.forEach(item => {
      const saved = item.overrides[0]?.volumeFCTS;
      const value = saved != null          ? saved.toString()
                  : item.prevFCTS != null  ? item.prevFCTS.toString()
                  : item.volumeORC != null ? item.volumeORC.toString()
                  : '';
      if (value) initial[item.id] = value;
    });
    initialFcts.current = { ...initial };
    setFcts(initial);
  }, []);

  const fetchData = useCallback(async (bustCache = false) => {
    if (!unidadeVendaId || !cycleDate || !targetDate) return;

    const cp = toMonthParam(cycleDate);
    const tp = toMonthParam(targetDate);
    const ck = `${cp}_${tp}`;

    setIsLoading(true);

    const cached    = !bustCache && itemCache.current.get(ck);
    const cachedSub = !bustCache && subCache.current.has(cp) ? subCache.current.get(cp) : undefined;

    if (cached && cachedSub !== undefined) {
      setItems(cached);
      setSubmission(cachedSub ?? null);
      initFctsState(cached);
      setIsLoading(false);
      return;
    }

    try {
      const [itemsRes, subRes] = await Promise.all([
        fetch(
          `/api/forecast/items?unidadeVendaId=${unidadeVendaId}&refMonth=${cp}&targetMonth=${tp}`,
          { headers: { Authorization: `Bearer ${token}` } }
        ),
        fetch(
          `/api/submissions/by-unit?unidadeVendaId=${unidadeVendaId}&month=${cp}`,
          { headers: { Authorization: `Bearer ${token}` } }
        ),
      ]);

      const result = itemsRes.ok ? await itemsRes.json() : { items: [] };
      const data: ForecastItem[] = Array.isArray(result) ? result : (result.items ?? []);
      const sub: Submission | null = subRes.ok ? await subRes.json() : null;

      itemCache.current.set(ck, data);
      subCache.current.set(cp, sub);

      setItems(data);
      setSubmission(sub);
      initFctsState(data);
    } catch {
      onError('Erro ao carregar dados');
    } finally {
      setIsLoading(false);
    }
  }, [unidadeVendaId, cycleDate, targetDate, token, initFctsState, onError]);

  return {
    items, setItems,
    submission, setSubmission,
    isLoading,
    fcts, setFcts,
    initialFcts,
    itemCache, subCache,
    fetchData,
    unitPaises,
    isExport,
  };
}
