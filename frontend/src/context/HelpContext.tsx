import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

interface HelpContextValue {
  isOpen: boolean;
  /** Seção/aba inicial ao abrir ('guides' | 'glossary'). */
  initialTab: 'guides' | 'glossary';
  openHelp: (tab?: 'guides' | 'glossary') => void;
  closeHelp: () => void;
}

const HelpContext = createContext<HelpContextValue | undefined>(undefined);

export const HelpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<'guides' | 'glossary'>('guides');

  const openHelp = useCallback((tab: 'guides' | 'glossary' = 'guides') => {
    setInitialTab(tab);
    setIsOpen(true);
  }, []);

  const closeHelp = useCallback(() => setIsOpen(false), []);

  const value = useMemo(
    () => ({ isOpen, initialTab, openHelp, closeHelp }),
    [isOpen, initialTab, openHelp, closeHelp],
  );

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
};

export const useHelp = () => {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error('useHelp must be used within HelpProvider');
  return ctx;
};
