import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useIsMobile } from '../hooks/useBreakpoint';
import { createGestorSteps } from '../tours/gestor.steps';
import { createOperadorPcpSteps } from '../tours/operadorPcp.steps';
import type { TourStepDef } from '../tours/types';
import type { Locale } from 'react-joyride';

interface TourState {
  completed: boolean;
  dismissed: boolean;
}

interface TourContextValue {
  isRunning: boolean;
  stepIndex: number;
  steps: TourStepDef[];
  locale: Locale;
  setStepIndex: (i: number) => void;
  setIsRunning: (v: boolean) => void;
  startTour: () => void;
  finishTour: () => void;
  dismissTour: () => void;
}

const TourContext = createContext<TourContextValue | undefined>(undefined);

const TOUR_ROLES = new Set(['gestor', 'operador_pcp']);

export const TourProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { t } = useTranslation('tour');
  const isMobile = useIsMobile();
  const [isRunning, setIsRunning] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const autoStarted = useRef(false);

  const steps = useMemo((): TourStepDef[] => {
    if (user?.perfil === 'gestor') return createGestorSteps(t);
    if (user?.perfil === 'operador_pcp') return createOperadorPcpSteps(t);
    return [];
  }, [user?.perfil, t]);

  const locale: Locale = useMemo(() => ({
    back: t('buttons.back'),
    close: t('buttons.close'),
    last: t('buttons.last'),
    next: t('buttons.next'),
    nextWithProgress: t('buttons.nextWithProgress'),
    skip: t('buttons.skip'),
    open: t('buttons.open'),
  }), [t]);

  const storageKey = user ? `tour_state_${user.id}` : null;

  const readState = useCallback((): TourState | null => {
    if (!storageKey) return null;
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as TourState) : null;
    } catch {
      return null;
    }
  }, [storageKey]);

  const writeState = useCallback(
    (state: TourState) => {
      if (!storageKey) return;
      localStorage.setItem(storageKey, JSON.stringify(state));
    },
    [storageKey]
  );

  const startTour = useCallback(() => {
    setStepIndex(0);
    setIsRunning(true);
  }, []);

  const finishTour = useCallback(() => {
    setIsRunning(false);
    writeState({ completed: true, dismissed: false });
  }, [writeState]);

  const dismissTour = useCallback(() => {
    setIsRunning(false);
    writeState({ completed: false, dismissed: true });
  }, [writeState]);

  // Auto-start on first login for supported roles, desktop only
  useEffect(() => {
    if (!user || !TOUR_ROLES.has(user.perfil) || autoStarted.current || isMobile) return;
    autoStarted.current = true;

    const saved = readState();
    if (!saved) {
      const timer = setTimeout(() => startTour(), 800);
      return () => clearTimeout(timer);
    }
  }, [user, isMobile, readState, startTour]);

  const value = useMemo(
    () => ({
      isRunning,
      stepIndex,
      steps,
      locale,
      setStepIndex,
      setIsRunning,
      startTour,
      finishTour,
      dismissTour,
    }),
    [isRunning, stepIndex, steps, locale, startTour, finishTour, dismissTour]
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
};

export const useTour = () => {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used within TourProvider');
  return ctx;
};
