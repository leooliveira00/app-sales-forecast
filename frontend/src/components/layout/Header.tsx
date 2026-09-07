import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Bell, CheckCheck, TrendingUp, Lock, AlertCircle, ArrowRight, X, Menu, HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { cn } from '../shared/Common';
import { LanguageSwitcher } from '../shared/LanguageSwitcher';
import { useHelp } from '../../context/HelpContext';
import { format } from 'date-fns';
import { ptBR, es, enUS, type Locale } from 'date-fns/locale';
import { notifTitle, notifBody } from '../../utils/notifUtils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  refMonth: string | null;
  readAt: string | null;
  createdAt: string;
}

// ── Notification type styles ──────────────────────────────────────────────────

const TYPE_STYLES: Record<string, { icon: React.ElementType; color: string }> = {
  CYCLE_OPENED:  { icon: TrendingUp,  color: 'text-sky-500'   },
  CYCLE_BLOCKED: { icon: Lock,        color: 'text-amber-500' },
  CYCLE_FAILED:  { icon: AlertCircle, color: 'text-red-500'   },
  CYCLE_STUCK:   { icon: AlertCircle, color: 'text-amber-500' },
};
const defaultStyle = { icon: Bell, color: 'text-slate-400' };

const DATE_FNS_LOCALES: Record<string, Locale> = { pt: ptBR as Locale, es: es as Locale, en: enUS as Locale };

// ── Header ────────────────────────────────────────────────────────────────────

interface HeaderProps {
  onMobileMenuToggle: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onMobileMenuToggle }) => {
  const navigate  = useNavigate();
  const { user, token } = useAuth();
  const { t, i18n } = useTranslation('layout');
  const { openHelp } = useHelp();

  const dateFnsLocale = DATE_FNS_LOCALES[i18n.language] ?? ptBR;
  const dateFormat    = t('header.dateFormat');

  const [open, setOpen]                   = useState(false);
  const [unreadCount, setUnreadCount]     = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading]             = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef   = useRef<HTMLButtonElement>(null);

  // ── Poll unread count ────────────────────────────────────────────────────────
  const fetchCount = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch('/api/notifications/unread-count', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setUnreadCount((await r.json()).count ?? 0);
    } catch { /* silent */ }
  }, [token]);

  useEffect(() => {
    fetchCount();
    const iv = setInterval(fetchCount, 60_000);
    return () => clearInterval(iv);
  }, [fetchCount]);

  // ── Load notifications when panel opens ──────────────────────────────────────
  useEffect(() => {
    if (!open || !token) return;
    setLoading(true);
    fetch('/api/notifications?limit=8', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((data: Notification[]) => setNotifications(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, token]);

  // ── Close on click outside ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ── Actions ───────────────────────────────────────────────────────────────────
  const markRead = async (id: string) => {
    if (!token) return;
    await fetch(`/api/notifications/${id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
    setUnreadCount(c => Math.max(0, c - 1));
  };

  const markAllRead = async () => {
    if (!token) return;
    await fetch('/api/notifications/mark-all-read', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    setNotifications(prev => prev.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
  };

  const handleNotificationClick = async (n: Notification) => {
    if (!n.readAt) await markRead(n.id);
    setOpen(false);
    if (n.type === 'CYCLE_OPENED')          navigate('/meu-forecast');
    else if (n.type === 'SUBMISSION_PENDING')   navigate('/aprovacoes');
    else if (n.type === 'SUBMISSION_APPROVED')  navigate('/meu-forecast');
    else if (n.type === 'SUBMISSION_REJECTED')  navigate('/meu-forecast');
    else if (n.type === 'CYCLE_FULLY_APPROVED') navigate('/admin/protheus-export');
  };

  const handleViewAll = () => { setOpen(false); navigate('/notificacoes'); };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <header className="h-16 bg-white/90 backdrop-blur-md border-b border-slate-200/80 flex items-center justify-between px-4 md:px-8 sticky top-0 z-30">

      <div className="flex items-center">
        {/* Hamburger — mobile only */}
        <button
          className="md:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 mr-2 transition-colors"
          onClick={onMobileMenuToggle}
          aria-label={t('notifications.openMenu')}
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Nome da plataforma */}
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center select-none cursor-pointer hover:opacity-75 transition-opacity"
        >
        <span className="text-base font-bold text-sky-950 tracking-tight">{t('header.platformName')}</span>
        <span className="mx-1.5 text-slate-300 font-light">·</span>
        <span className="text-base font-light text-slate-400 tracking-tight">{t('header.platformSub')}</span>
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 relative">

        <LanguageSwitcher popoverDir="down" />

        {/* Ajuda — todos os perfis */}
        <button
          data-tour="help-button"
          onClick={() => openHelp()}
          className="p-2 rounded-full text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-all"
          title={t('help.title')}
          aria-label={t('help.title')}
        >
          <HelpCircle className="w-5 h-5" />
        </button>

        {/* Bell — todos os perfis */}
        <div className="relative">
            <button
              ref={btnRef}
              onClick={() => setOpen(o => !o)}
              className={cn(
                'p-2 rounded-full transition-all relative',
                open
                  ? 'text-sky-600 bg-sky-50'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
              )}
              title={t('notifications.title')}
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 border-2 border-white leading-none">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* Dropdown panel */}
            {open && (
              <div
                ref={panelRef}
                className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] md:w-96 bg-white rounded-2xl border border-slate-200 shadow-2xl shadow-slate-200/60 overflow-hidden z-50"
              >
                {/* Panel header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-semibold text-slate-700">{t('notifications.title')}</span>
                    {unreadCount > 0 && (
                      <span className="bg-sky-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                        {unreadCount}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllRead}
                        className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                        {t('notifications.clearAll')}
                      </button>
                    )}
                    <button
                      onClick={() => setOpen(false)}
                      className="p-1 text-slate-300 hover:text-slate-500 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Notification list */}
                <div className="max-h-80 overflow-y-auto">
                  {loading ? (
                    <div className="flex items-center justify-center py-10 text-slate-300">
                      <Bell className="w-5 h-5 animate-pulse" />
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-300">
                      <Bell className="w-8 h-8" />
                      <p className="text-sm text-slate-400">{t('notifications.empty')}</p>
                    </div>
                  ) : (
                    notifications.map(n => {
                      const style  = TYPE_STYLES[n.type] ?? defaultStyle;
                      const Icon   = style.icon;
                      const unread = !n.readAt;
                      return (
                        <div
                          key={n.id}
                          onClick={() => handleNotificationClick(n)}
                          className={cn(
                            'flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-slate-50 last:border-0',
                            unread ? 'bg-sky-50/50 hover:bg-sky-50' : 'hover:bg-slate-50'
                          )}
                        >
                          {/* Unread dot */}
                          <div className="shrink-0 mt-1 w-2 flex justify-center">
                            {unread
                              ? <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                              : <span className="w-1.5 h-1.5 rounded-full bg-transparent" />
                            }
                          </div>
                          {/* Icon */}
                          <div className={cn('shrink-0 mt-0.5', style.color)}>
                            <Icon className="w-4 h-4" />
                          </div>
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <p className={cn('text-xs font-semibold leading-snug', unread ? 'text-slate-800' : 'text-slate-500')}>
                              {notifTitle(n, t, i18n.language)}
                            </p>
                            <p className="text-xs text-slate-400 mt-0.5 leading-snug line-clamp-2">{notifBody(n, t, i18n.language)}</p>
                            <p className="text-[10px] text-slate-300 mt-1">
                              {format(new Date(n.createdAt), dateFormat, { locale: dateFnsLocale })}
                            </p>
                          </div>
                          {/* Arrow for opened cycles */}
                          {n.type === 'CYCLE_OPENED' && (
                            <ArrowRight className="w-3.5 h-3.5 text-sky-300 shrink-0 mt-1" />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Panel footer */}
                <div className="border-t border-slate-100 px-4 py-2.5">
                  <button
                    onClick={handleViewAll}
                    className="w-full text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center justify-center gap-1.5 py-1.5 rounded-lg hover:bg-sky-50 transition-colors"
                  >
                    {t('notifications.viewAll')}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
      </div>
    </header>
  );
};
