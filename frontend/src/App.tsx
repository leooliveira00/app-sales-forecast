import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { MeuForecastPage } from './pages/MeuForecastPage';
import { AprovacoesPage } from './pages/AprovacoesPage';
import { ConsolidadoPage } from './pages/ConsolidadoPage';
import { ConsolidadoGestorPage } from './pages/ConsolidadoGestorPage';
import Produtos from './pages/Produtos';
import { UsuariosPage } from './pages/UsuariosPage';
import { UnidadesPage } from './pages/UnidadesPage';
import { SistemaConfigPage } from './pages/SistemaConfigPage';
import { ConfiguracoesPage } from './pages/ConfiguracoesPage';
import { AirflowPage } from './pages/AirflowPage';
import { CycleReadinessPage } from './pages/CycleReadinessPage';
import { ProtheusExportPage } from './pages/ProtheusExportPage';
import { NotificacoesPage } from './pages/NotificacoesPage';
import { AuditTrailPage } from './pages/AuditTrailPage';

const queryClient = new QueryClient();

const ConsolidadoRouterPage: React.FC = () => {
  const { user } = useAuth();
  return user?.perfil === 'gestor' ? <ConsolidadoGestorPage /> : <ConsolidadoPage />;
};

/**
 * Restringe uma rota a perfis específicos.
 *
 * A Sidebar já esconde os itens que não pertencem ao perfil, mas até aqui isso
 * era a única barreira: quem digitasse a URL abria a tela e só descobria a
 * ausência de permissão quando a API respondia 403 — ou, pior, via uma tela
 * administrativa vazia. Vale para todos os perfis, não só para o de consulta.
 *
 * Segurança de verdade continua no backend (`requireRole`); aqui é navegação.
 */
const RequirePerfil: React.FC<{ roles: string[]; children: React.ReactNode }> = ({ roles, children }) => {
  const { user } = useAuth();
  if (!user) return null;                                    // AuthProvider ainda resolvendo
  if (!roles.includes(user.perfil)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

const GESTOR_ONLY  = ['gestor'];
const APROVACOES   = ['controladoria', 'operador_pcp', 'admin_ti'];
const ADMIN        = ['operador_pcp', 'admin_ti'];
const ADMIN_TI     = ['admin_ti'];

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Suspense fallback={null}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<AppLayout />}>
              <Route path="/dashboard"        element={<DashboardPage />} />
              <Route path="/meu-forecast"     element={<RequirePerfil roles={GESTOR_ONLY}><MeuForecastPage /></RequirePerfil>} />
              <Route path="/aprovacoes"       element={<RequirePerfil roles={APROVACOES}><AprovacoesPage /></RequirePerfil>} />
              <Route path="/consolidado"      element={<ConsolidadoRouterPage />} />
              <Route path="/cycle-readiness"  element={<RequirePerfil roles={ADMIN}><CycleReadinessPage /></RequirePerfil>} />
              <Route path="/notificacoes"              element={<NotificacoesPage />} />
              <Route path="/admin"                   element={<Navigate to="/admin/usuarios" replace />} />
              <Route path="/admin/usuarios"          element={<RequirePerfil roles={ADMIN}><UsuariosPage /></RequirePerfil>} />
              <Route path="/admin/unidades"          element={<RequirePerfil roles={ADMIN}><UnidadesPage /></RequirePerfil>} />
              <Route path="/admin/produtos"          element={<RequirePerfil roles={ADMIN}><Produtos /></RequirePerfil>} />
              <Route path="/admin/configuracoes"     element={<RequirePerfil roles={ADMIN}><SistemaConfigPage /></RequirePerfil>} />
              <Route path="/admin/airflow"           element={<RequirePerfil roles={ADMIN_TI}><AirflowPage /></RequirePerfil>} />
              <Route path="/admin/protheus-export"   element={<RequirePerfil roles={ADMIN}><ProtheusExportPage /></RequirePerfil>} />
              <Route path="/admin/audit"             element={<RequirePerfil roles={ADMIN}><AuditTrailPage /></RequirePerfil>} />
              <Route path="/configuracoes"    element={<ConfiguracoesPage />} />
              <Route path="/"                 element={<Navigate to="/dashboard" replace />} />
            </Route>

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </BrowserRouter>
        </Suspense>
      </AuthProvider>
    </QueryClientProvider>
  );
}
