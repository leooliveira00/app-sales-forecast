import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  TrendingUp,
  ClipboardCheck,
  BarChart3,
  LogOut,
  ChevronRight,
  ChevronDown,
  ShieldAlert,
  Users,
  Box,
  PanelLeftClose,
  PanelLeftOpen,
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Send,
  ScrollText,
  Building2,
  SlidersHorizontal,
  BookOpen,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useTour } from '../../context/TourContext';
import { cn } from '../shared/Common';
import { AirflowIcon } from '../shared/AirflowIcon';
import { Avatar } from '../shared/Avatar';
import logoIcon from '../../img/logo-icon.svg';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

interface NavItemDef {
  icon: React.ElementType;
  label: string;
  path: string;
  roles: string[];
  end?: boolean;
  badge?: number;
  alertBadge?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle, mobileOpen, onMobileClose }) => {
  const { user, logout, token, activeUnidade, setActiveUnidade } = useAuth();
  const { startTour, steps } = useTour();
  const navigate  = useNavigate();
  const location  = useLocation();
  const { t } = useTranslation('layout');
  const perfil    = user?.perfil ?? '';

  // Auto-close mobile drawer on navigation
  useEffect(() => { onMobileClose(); }, [location.pathname]);

  const [isAdminOpen, setIsAdminOpen]           = useState(location.pathname.startsWith('/admin'));
  const [unitSelectorOpen, setUnitSelectorOpen] = useState(false);
  const [collapsedUnitOpen, setCollapsedUnitOpen] = useState(false);
  const [pendingCount, setPendingCount]         = useState(0);
  const [cycleAlert, setCycleAlert]             = useState(false);

  const collapsedUnitRef = useRef<HTMLDivElement>(null);

  // Fecha o dropdown colapsado ao clicar fora
  useEffect(() => {
    if (!collapsedUnitOpen) return;
    const handler = (e: MouseEvent) => {
      if (collapsedUnitRef.current && !collapsedUnitRef.current.contains(e.target as Node)) {
        setCollapsedUnitOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [collapsedUnitOpen]);

  const isAdminRole = perfil === 'operador_pcp' || perfil === 'admin_ti';

  // Pending submissions badge
  useEffect(() => {
    if (!token || !isAdminRole) return;
    const fetch_ = () =>
      fetch('/api/submissions/pending-count', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : { count: 0 })
        .then(d => setPendingCount(d.count ?? 0))
        .catch(() => {});
    fetch_();
    const iv = setInterval(fetch_, 60_000);
    return () => clearInterval(iv);
  }, [token, perfil]);

  // Cycle alert badge
  useEffect(() => {
    if (!token || !isAdminRole) return;
    const fetch_ = () =>
      fetch('/api/cycle-readiness', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : [])
        .then((data: any[]) => {
          const now = Date.now();
          const stuck = data.some((c: any) =>
            ['PENDING', 'PARTIAL'].includes(c.gate) &&
            now - new Date(c.updatedAt).getTime() > 24 * 3_600_000
          );
          setCycleAlert(stuck);
        })
        .catch(() => {});
    fetch_();
    const iv = setInterval(fetch_, 5 * 60_000);
    return () => clearInterval(iv);
  }, [token, isAdminRole]);

  // ── Item definitions ──────────────────────────────────────────────────────────

  const analiseItems: NavItemDef[] = [
    { icon: LayoutDashboard, label: t('nav.dashboard'),   path: '/dashboard',    roles: ['gestor', 'operador_pcp', 'admin_ti', 'consulta'] },
    { icon: TrendingUp,      label: t('nav.myForecast'),  path: '/meu-forecast', roles: ['gestor'] },
    { icon: BarChart3,       label: t('nav.consolidado'), path: '/consolidado',  roles: ['gestor', 'operador_pcp', 'admin_ti', 'consulta'] },
  ];

  const operacaoItems: NavItemDef[] = [
    { icon: ClipboardCheck, label: t('nav.aprovacoes'), path: '/aprovacoes',      roles: ['operador_pcp', 'admin_ti'], badge: pendingCount },
    { icon: Activity,       label: t('nav.ciclos'),     path: '/cycle-readiness', roles: ['operador_pcp', 'admin_ti'], alertBadge: cycleAlert },
  ];

  const adminCadastroItems: NavItemDef[] = [
    { icon: Users,     label: t('nav.usuarios'), path: '/admin/usuarios', roles: ['operador_pcp', 'admin_ti'] },
    { icon: Building2, label: t('nav.unidades'), path: '/admin/unidades', roles: ['operador_pcp', 'admin_ti'] },
    { icon: Box,       label: t('nav.produtos'),  path: '/admin/produtos', roles: ['operador_pcp', 'admin_ti'] },
  ];

  const adminSistemaItems: NavItemDef[] = [
    { icon: SlidersHorizontal, label: t('nav.configuracoes'), path: '/admin/configuracoes',   roles: ['operador_pcp', 'admin_ti'] },
    { icon: Send,              label: t('nav.protheus'),      path: '/admin/protheus-export', roles: ['operador_pcp', 'admin_ti'] },
    { icon: ScrollText,        label: t('nav.auditoria'),     path: '/admin/audit',           roles: ['operador_pcp', 'admin_ti'] },
    { icon: AirflowIcon,       label: t('nav.airflow'),       path: '/admin/airflow',         roles: ['admin_ti'] },
  ];

  const filter = (items: NavItemDef[]) => items.filter(i => i.roles.includes(perfil));

  const handleLogout = () => { logout(); navigate('/login'); };

  // ── NavItem ───────────────────────────────────────────────────────────────────

  const NavItem = ({ item }: { item: NavItemDef }) => (
    <NavLink
      to={item.path}
      end={item.end ?? false}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => cn(
        'flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-150 group',
        collapsed ? 'justify-center px-0' : '',
        isActive
          ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25'
          : 'text-slate-300 hover:bg-white/5 hover:text-white'
      )}
    >
      <div className={cn('flex items-center', collapsed ? 'justify-center w-full' : 'gap-3')}>
        <div className="relative shrink-0">
          <item.icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
          {item.alertBadge && (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full border border-[#1e3a5f]" />
          )}
        </div>
        {!collapsed && <span className="font-medium">{item.label}</span>}
      </div>
      {!collapsed && (
        item.badge ? (
          <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none">
            {item.badge}
          </span>
        ) : item.alertBadge ? (
          <AlertTriangle className="w-3 h-3 text-amber-400" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
        )
      )}
    </NavLink>
  );

  // ── Section label ─────────────────────────────────────────────────────────────

  const SectionLabel = ({ label }: { label: string }) =>
    collapsed ? null : (
      <p className="px-3 pt-3 pb-0.5 text-[10px] font-bold text-slate-500/70 uppercase tracking-widest select-none">
        {label}
      </p>
    );

  // ── Derived items ─────────────────────────────────────────────────────────────

  const filteredAnalise        = filter(analiseItems);
  const filteredOperacao       = filter(operacaoItems);
  const filteredAdminCadastro  = filter(adminCadastroItems);
  const filteredAdminSistema   = filter(adminSistemaItems);

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onMobileClose}
        />
      )}
    <aside
      className={cn(
        'text-white flex flex-col fixed inset-y-0 left-0 z-40',
        'transition-all duration-300 ease-in-out',
        'w-64',
        collapsed ? 'md:w-16' : 'md:w-64',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}
      style={{
        background: `
          radial-gradient(ellipse at 130% -10%, rgba(56,189,248,0.28) 0%, transparent 55%),
          radial-gradient(ellipse at -30% 110%, rgba(96,165,250,0.22) 0%, transparent 55%),
          linear-gradient(160deg, #1a3f78 0%, #0f2850 45%, #060f20 100%)
        `
      }}
    >

      {/* Logo + toggle + seletor de unidade */}
      <div className="relative border-b border-white/10 shrink-0">
        {collapsed ? (
          <div className="flex flex-col items-center gap-3 py-4 px-2">
            <img src={logoIcon} alt="Sales Forecast Web" className="w-10 h-10 rounded-lg shadow-lg shadow-black/20" />
            <button
              onClick={onToggle}
              className="hidden md:block p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title={t('sidebar.expand')}
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
            {/* Seletor colapsado: dropdown controlado por clique */}
            {perfil === 'gestor' && (user?.unidades?.length ?? 0) > 1 && (
              <div className="relative" ref={collapsedUnitRef}>
                <button
                  onClick={() => setCollapsedUnitOpen(o => !o)}
                  title={activeUnidade?.unidadeVenda.descricao ?? ''}
                  className={cn(
                    'p-1.5 rounded-lg transition-colors',
                    collapsedUnitOpen
                      ? 'bg-white/15 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/10'
                  )}
                >
                  <ArrowLeftRight className="w-4 h-4" />
                </button>
                {collapsedUnitOpen && (
                  <div className="absolute top-0 left-full ml-2 flex flex-col gap-1 bg-[#0f2540] border border-white/10 rounded-xl p-2 shadow-xl z-50 min-w-[180px]">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wide px-1 pb-1">{t('sidebar.unit')}</p>
                    {user?.unidades.map(u => (
                      <button
                        key={u.unidadeVenda.codigo}
                        onClick={() => { setActiveUnidade(u.unidadeVenda.codigo); setCollapsedUnitOpen(false); }}
                        className={cn(
                          'text-left px-2 py-1.5 rounded-lg text-xs font-medium transition-colors',
                          activeUnidade?.unidadeVenda.codigo === u.unidadeVenda.codigo
                            ? u.unidadeVenda.tipo === 'EXPORT' ? 'bg-indigo-600 text-white' : 'bg-sky-600 text-white'
                            : 'text-slate-300 hover:bg-white/10'
                        )}
                      >
                        <span className="block font-bold truncate">{u.unidadeVenda.descricao}</span>
                        <span className="block text-[10px] opacity-60">{u.unidadeVenda.codigo}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center pt-5 pb-4 px-4">
            <div className="flex flex-col items-center gap-3">
              <img src={logoIcon} alt="Sales Forecast Web" className="w-14 h-14 rounded-xl shadow-lg shadow-black/20 shrink-0" />
              <p className="text-base font-bold text-white leading-tight truncate">Sales Forecast</p>
            </div>
            <button
              onClick={onToggle}
              className="absolute top-2 right-2 hidden md:block p-1 text-slate-500 hover:text-slate-300 hover:bg-white/10 rounded-lg transition-colors"
              title={t('sidebar.collapse')}
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
            {/* Seletor de unidade — accordion */}
            {perfil === 'gestor' && (user?.unidades?.length ?? 0) > 1 && (
              <div className="w-full mt-3 pt-3 border-t border-white/10">
                <button
                  onClick={() => setUnitSelectorOpen(o => !o)}
                  className="w-full flex items-center justify-between px-0.5 mb-1 group"
                >
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest group-hover:text-slate-300 transition-colors">
                    {t('sidebar.activeUnit')}
                  </p>
                  <ChevronDown className={cn(
                    'w-3 h-3 text-slate-500 group-hover:text-slate-300 transition-all duration-200',
                    unitSelectorOpen ? 'rotate-180' : ''
                  )} />
                </button>
                {/* Unidade selecionada (sempre visível) */}
                <p className="text-xs font-semibold text-white/80 px-0.5 truncate mb-1" title={activeUnidade?.unidadeVenda.codigo}>
                  {activeUnidade?.unidadeVenda.descricao}
                </p>
                {/* Lista de opções (visível apenas quando aberto) */}
                {unitSelectorOpen && (
                  <div className="flex flex-col gap-1 mt-1">
                    {user?.unidades.filter(u => u.unidadeVenda.codigo !== activeUnidade?.unidadeVenda.codigo).map(u => (
                      <button
                        key={u.unidadeVenda.codigo}
                        onClick={() => { setActiveUnidade(u.unidadeVenda.codigo); setUnitSelectorOpen(false); }}
                        title={u.unidadeVenda.codigo}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors truncate bg-white/8 text-slate-400 hover:bg-white/15 hover:text-white"
                      >
                        {u.unidadeVenda.descricao}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Nav — flex-1 so it fills remaining space, no scroll needed */}
      <nav className={cn(
        'flex-1 flex flex-col py-3 gap-0.5',
        collapsed ? 'px-2 items-center' : 'px-3',
        'overflow-y-auto [&::-webkit-scrollbar]:w-1',
        '[&::-webkit-scrollbar-track]:bg-transparent',
        '[&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb]:rounded-full',
      )}>

        {/* ANÁLISE */}
        {filteredAnalise.length > 0 && (
          <>
            <SectionLabel label={t('sections.analise')} />
            {filteredAnalise.map(item => <NavItem key={item.path} item={item} />)}
          </>
        )}

        {/* OPERAÇÃO */}
        {filteredOperacao.length > 0 && (
          <>
            <SectionLabel label={t('sections.operacao')} />
            {filteredOperacao.map(item => <NavItem key={item.path} item={item} />)}
          </>
        )}

        {/* SISTEMA */}
        {isAdminRole && (filteredAdminCadastro.length > 0 || filteredAdminSistema.length > 0) && (
          <>
            <SectionLabel label={t('sections.sistema')} />
            {collapsed ? (
              <NavLink
                to="/admin/usuarios"
                title={t('nav.admin')}
                className={({ isActive }) => cn(
                  'flex items-center justify-center py-2.5 rounded-xl transition-all duration-150',
                  location.pathname.startsWith('/admin') || isActive
                    ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                )}
              >
                <ShieldAlert className="w-[18px] h-[18px]" />
              </NavLink>
            ) : (
              <div>
                <button
                  onClick={() => setIsAdminOpen(!isAdminOpen)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-150 group text-slate-300 hover:bg-white/5 hover:text-white"
                >
                  <div className="flex items-center gap-3">
                    <ShieldAlert className="w-[18px] h-[18px]" />
                    <span className="font-medium">{t('nav.admin')}</span>
                  </div>
                  {isAdminOpen
                    ? <ChevronDown className="w-3.5 h-3.5" />
                    : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                {isAdminOpen && (
                  <div className="mt-0.5 pl-4 space-y-0.5">
                    {filteredAdminCadastro.map(item => <NavItem key={item.path} item={item} />)}
                    {filteredAdminCadastro.length > 0 && filteredAdminSistema.length > 0 && (
                      <div className="border-t border-white/10 my-1" />
                    )}
                    {filteredAdminSistema.map(item => <NavItem key={item.path} item={item} />)}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Spacer fills remaining space, keeping menu items top-aligned */}
        <div className="flex-1" />
      </nav>

      {/* Footer — language switcher + user + logout */}
      <div className={cn('shrink-0 border-t border-white/10', collapsed ? 'p-2' : 'p-4')}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/configuracoes')}
              title={t('nav.myAccount')}
              className="cursor-pointer rounded-full ring-2 ring-transparent hover:ring-white/30 transition-all"
            >
              <Avatar nome={user?.nome ?? ''} avatarUrl={user?.avatarUrl} size="sm" />
            </button>
            {steps.length > 0 && (
              <button onClick={startTour} title={t('buttons.start', { ns: 'tour' })}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                <BookOpen className="w-4 h-4" />
              </button>
            )}
            <button onClick={handleLogout} title={t('sidebar.logout')}
              className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => navigate('/configuracoes')}
              title={t('nav.myAccount')}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors mb-2 text-left cursor-pointer"
            >
              <Avatar nome={user?.nome ?? ''} avatarUrl={user?.avatarUrl} size="md" />
              <div className="overflow-hidden">
                <p className="font-semibold text-sm truncate">{user?.nome}</p>
                <p className="text-xs text-slate-400 truncate">
                  {perfil === 'gestor'
                    ? (activeUnidade?.unidadeVenda?.descricao ?? t('roles.gestor', { ns: 'common' }))
                    : t(`roles.${perfil}`, { ns: 'common' })}
                </p>
              </div>
            </button>
            {steps.length > 0 && (
              <button onClick={startTour}
                className="w-full flex items-center gap-3 px-4 py-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-sm font-medium mb-1"
              >
                <BookOpen className="w-4 h-4" />
                {t('buttons.start', { ns: 'tour' })}
              </button>
            )}
            <button onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-sm font-medium"
            >
              <LogOut className="w-4 h-4" />
              {t('sidebar.logout')}
            </button>
          </>
        )}
      </div>
    </aside>
    </>
  );
};
