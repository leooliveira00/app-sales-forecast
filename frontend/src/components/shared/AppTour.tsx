import React, { useCallback, useEffect } from 'react';
import {
  Joyride,
  ACTIONS,
  EVENTS,
  STATUS,
  type EventData,
  type Controls,
} from 'react-joyride';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTour } from '../../context/TourContext';
import { useIsMobile } from '../../hooks/useBreakpoint';

export const AppTour: React.FC = () => {
  const { isRunning, stepIndex, steps, locale, setStepIndex, finishTour, dismissTour, setIsRunning } = useTour();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  // Navigate to the required route when the step index changes.
  // Runs immediately after React commits the new stepIndex so the route swap
  // happens before Joyride's loaderDelay threshold is reached.
  useEffect(() => {
    if (!isRunning || isMobile) return;
    const route = steps[stepIndex]?.data?.route;
    if (!route || location.pathname === route) return;
    navigate(route);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, isRunning]);

  const handleEvent = useCallback(
    (data: EventData, _controls: Controls) => {
      const { action, index, type, status } = data;

      if (type === EVENTS.STEP_AFTER) {
        if (action === ACTIONS.NEXT || action === ACTIONS.CLOSE) {
          setStepIndex(index + 1);
        } else if (action === ACTIONS.PREV) {
          setStepIndex(Math.max(0, index - 1));
        }
      }

      // Target element not found after targetWaitTimeout: skip step or end tour
      if (type === EVENTS.TARGET_NOT_FOUND) {
        const next = index + 1;
        if (next >= steps.length) {
          finishTour();
        } else {
          setStepIndex(next);
        }
      }

      if (type === EVENTS.TOUR_END) {
        if (status === STATUS.FINISHED) finishTour();
        else dismissTour();
      }
    },
    [steps, setStepIndex, finishTour, dismissTour]
  );

  // Stop tour if user resizes to mobile mid-tour
  useEffect(() => {
    if (isMobile && isRunning) setIsRunning(false);
  }, [isMobile, isRunning, setIsRunning]);

  if (!steps.length || isMobile) return null;

  return (
    <Joyride
      steps={steps}
      run={isRunning}
      stepIndex={stepIndex}
      continuous
      locale={locale}
      options={{
        zIndex: 10000,
        primaryColor: '#0284c7',
        overlayColor: 'rgba(0,0,0,0.45)',
        showProgress: true,
        skipBeacon: true,
        overlayClickAction: false,
        buttons: ['back', 'primary', 'skip'],
        spotlightRadius: 8,
        offset: 12,
        targetWaitTimeout: 15000,
        // Only show the loader spinner if the element truly takes long to appear
        loaderDelay: 1200,
        // 16px main padding + 64px sticky header = 80px; extra 8px for comfort
        scrollOffset: 88,
      }}
      styles={{
        tooltip: {
          borderRadius: '12px',
          fontSize: '14px',
          padding: '16px 20px',
        },
        tooltipTitle: {
          fontSize: '15px',
          fontWeight: 600,
          marginBottom: '6px',
        },
        tooltipContent: {
          padding: '6px 0 0',
          lineHeight: '1.5',
        },
        buttonPrimary: {
          borderRadius: '8px',
          fontSize: '13px',
          padding: '6px 16px',
        },
        buttonBack: {
          color: '#64748b',
          fontSize: '13px',
          marginRight: '6px',
        },
        buttonSkip: {
          color: '#94a3b8',
          fontSize: '12px',
        },
      }}
      onEvent={handleEvent}
    />
  );
};
