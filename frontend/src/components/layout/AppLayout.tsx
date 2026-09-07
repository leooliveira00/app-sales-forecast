import React, { useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAuth } from '../../hooks/useAuth';
import { ToastContainer, useToast } from '../shared/ToastNotification';
import { cn } from '../shared/Common';
import { ConsolidadoCacheProvider } from '../../context/ConsolidadoCacheContext';
import { TourProvider } from '../../context/TourContext';
import { HelpProvider } from '../../context/HelpContext';
import { AppTour } from '../shared/AppTour';
import { HelpPanel } from '../shared/HelpPanel';
import { MobileGuard } from '../shared/MobileGuard';

export const AppLayout: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const { toasts, removeToast } = useToast();

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebarCollapsed') === 'true'
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleSidebar = () => {
    setCollapsed(v => {
      localStorage.setItem('sidebarCollapsed', String(!v));
      return !v;
    });
  };

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <TourProvider>
      <ConsolidadoCacheProvider>
      <HelpProvider>
      <AppTour />
      <HelpPanel />
      <div className="min-h-screen bg-slate-50 flex">
        <Sidebar
          collapsed={collapsed}
          onToggle={toggleSidebar}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <div className={cn(
          'flex-grow flex flex-col transition-all duration-300 ease-in-out min-w-0',
          collapsed ? 'md:ml-16' : 'md:ml-64'
        )}>
          <Header onMobileMenuToggle={() => setMobileOpen(v => !v)} />
          <main className="p-4 md:p-8 max-w-[1600px] mx-auto w-full">
            <MobileGuard>
              <Outlet />
            </MobileGuard>
          </main>
        </div>
        <ToastContainer toasts={toasts} removeToast={removeToast} />
      </div>
      </HelpProvider>
      </ConsolidadoCacheProvider>
    </TourProvider>
  );
};
