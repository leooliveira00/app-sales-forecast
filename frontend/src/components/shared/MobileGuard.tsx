import React, { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Monitor } from 'lucide-react';
import { useIsMobile } from '../../hooks/useBreakpoint';

const MOBILE_ALLOWED = ['/dashboard', '/consolidado', '/configuracoes'];

export const MobileGuard: React.FC<{ children: ReactNode }> = ({ children }) => {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();

  if (!isMobile) return <>{children}</>;

  const allowed = MOBILE_ALLOWED.some(p => pathname.startsWith(p));
  if (allowed) return <>{children}</>;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <Monitor className="w-12 h-12 text-slate-300 mb-4" />
      <h2 className="text-lg font-bold text-slate-700 mb-2">
        Funcionalidade disponível no desktop
      </h2>
      <p className="text-sm text-slate-400 max-w-xs">
        Esta página é otimizada para telas maiores. Acesse pelo computador para usar esta funcionalidade.
      </p>
    </div>
  );
};
