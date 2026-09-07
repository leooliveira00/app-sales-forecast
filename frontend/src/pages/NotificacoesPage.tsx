import React, { useEffect, useState, useCallback } from 'react';
import { Bell, CheckCheck, TrendingUp, Lock, AlertCircle, CheckCircle2, RefreshCw, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { cn } from '../components/shared/Common';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR, es, enUS, type Locale } from 'date-fns/locale';
import { notifTitle, notifBody } from '../utils/notifUtils';

const DATE_FNS_LOCALES: Record<string, Locale> = { pt: ptBR as Locale, es: es as Locale, en: enUS as Locale };

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

// ── Type styles ───────────────────────────────────────────────────────────────

const TYPE_STYLES: Record<string, { icon: React.ElementType; color: string; border: string }> = {
  CYCLE_OPENED: { icon: TrendingUp,   color: 'text-sky-500',    border: 'border-sky-100' },
  CYCLE_BLOCKED:{ icon: Lock,         color: 'text-amber-500',  border: 'border-amber-100' },
  CYCLE_FAILED: { icon: AlertCircle,  color: 'text-red-500',    border: 'border-red-100' },
  CYCLE_STUCK:  { icon: AlertCircle,  color: 'text-amber-500',  border: 'border-amber-100' },
  PROTHEUS_EXPORT_SUCCESS: { icon: CheckCircle2, color: 'text-emerald-500', border: 'border-emerald-100' },
  PROTHEUS_EXPORT_PARTIAL: { icon: AlertCircle,  color: 'text-amber-500',   border: 'border-amber-100' },
  PROTHEUS_EXPORT_FAILED:  { icon: AlertCircle,  color: 'text-red-500',     border: 'border-red-100' },
};

const defaultStyle = { icon: Bell, color: 'text-slate-400', border: 'border-slate-100' };

// ── Main Page ─────────────────────────────────────────────────────────────────

export const NotificacoesPage: React.FC = () => {
  const { t, i18n } = useTranslation('layout');
  const dateFnsLocale = DATE_FNS_LOCALES[i18n.language] ?? ptBR;
  const dateFormat    = t('header.dateFormat');
  const { token } = useAuth();
  const navigate  = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading]         = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/notifications', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setNotifications(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id: string) => {
    if (!token) return;
    await fetch(`/api/notifications/${id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
  };

  const markAllRead = async () => {
    if (!token) return;
    await fetch('/api/notifications/mark-all-read', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    setNotifications(prev => prev.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  };

  const handleNotificationClick = async (n: Notification) => {
    if (!n.readAt) await markRead(n.id);
    if      (n.type === 'CYCLE_OPENED')          navigate('/meu-forecast');
    else if (n.type === 'SUBMISSION_PENDING')     navigate('/aprovacoes');
    else if (n.type === 'SUBMISSION_APPROVED')    navigate('/meu-forecast');
    else if (n.type === 'SUBMISSION_REJECTED')    navigate('/meu-forecast');
    else if (n.type === 'CYCLE_FULLY_APPROVED')   navigate('/admin/protheus-export');
    else if (n.type.startsWith('PROTHEUS_EXPORT')) navigate('/admin/protheus-export');
  };

  const unreadCount = notifications.filter(n => !n.readAt).length;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Bell className="w-6 h-6 text-sky-500" />
            {t('notificationsPage.title')}
            {unreadCount > 0 && (
              <span className="bg-sky-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </h1>
          <p className="text-slate-500 text-sm mt-1">{t('notificationsPage.description')}</p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 px-3 py-2 rounded-xl transition-colors"
          >
            <CheckCheck className="w-4 h-4" />
            {t('notificationsPage.markAllRead')}
          </button>
        )}
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            {t('notificationsPage.loading')}
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-12 text-center">
            <Bell className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-500">{t('notificationsPage.empty')}</p>
            <p className="text-sm text-slate-400 mt-1">{t('notificationsPage.emptyHint')}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {notifications.map(n => {
              const style = TYPE_STYLES[n.type] ?? defaultStyle;
              const Icon  = style.icon;
              const isUnread = !n.readAt;
              return (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={cn(
                    'flex items-start gap-4 px-5 py-4 cursor-pointer transition-colors',
                    isUnread ? 'bg-sky-50/50 hover:bg-sky-50' : 'hover:bg-slate-50',
                    'border-l-2',
                    isUnread ? style.border : 'border-transparent'
                  )}
                >
                  {/* Unread indicator */}
                  <div className="shrink-0 mt-0.5 flex items-center justify-center w-5">
                    {isUnread
                      ? <span className="w-2 h-2 rounded-full bg-sky-500" />
                      : <span className="w-2 h-2 rounded-full bg-transparent border border-slate-200" />
                    }
                  </div>

                  {/* Icon */}
                  <div className={cn('shrink-0 mt-0.5', style.color)}>
                    <Icon className="w-5 h-5" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm font-semibold', isUnread ? 'text-slate-800' : 'text-slate-600')}>
                      {notifTitle(n, t, i18n.language)}
                    </p>
                    <p className="text-sm text-slate-500 mt-0.5 leading-snug">{notifBody(n, t, i18n.language)}</p>
                    <p className="text-xs text-slate-400 mt-1.5">
                      {format(new Date(n.createdAt), dateFormat, { locale: dateFnsLocale })}
                      {' · '}
                      {formatDistanceToNow(new Date(n.createdAt), { locale: dateFnsLocale, addSuffix: true })}
                    </p>
                  </div>

                  {/* Action arrow */}
                  {n.type === 'CYCLE_OPENED' && (
                    <div className="shrink-0 mt-1">
                      <ArrowRight className="w-4 h-4 text-sky-400" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
