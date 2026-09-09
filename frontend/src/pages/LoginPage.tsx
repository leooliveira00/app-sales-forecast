import React from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { LogIn, AlertCircle } from 'lucide-react';
import { LanguageSwitcher } from '../components/shared/LanguageSwitcher';
import logoIcon from '../img/logo-icon.svg';

export const LoginPage: React.FC = () => {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation('login');

  const [email, setEmail]       = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError]       = React.useState('');
  const [loading, setLoading]   = React.useState(false);

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError(t('errors.required'));
      return;
    }

    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || t('errors.invalid'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden p-4"
      style={{ background: 'linear-gradient(135deg, #0e2a4d 0%, #0a1f3d 40%, #060d1f 100%)' }}
    >
      {/* Orbs decorativos — mesh gradient (z-0 para ficarem atrás do conteúdo) */}
      <div className="pointer-events-none absolute -top-40 -right-40 h-[560px] w-[560px] rounded-full bg-sky-400/40 blur-[110px] z-0" />
      <div className="pointer-events-none absolute -bottom-32 -left-32 h-[460px] w-[460px] rounded-full bg-blue-400/30 blur-[100px] z-0" />
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[380px] w-[380px] rounded-full bg-cyan-300/20 blur-[90px] z-0" />

      {/* Language switcher — top right */}
      <div className="absolute top-4 right-4 z-10">
        <LanguageSwitcher variant="inline" />
      </div>

      <div className="relative z-10 max-w-md w-full">
        <div className="text-center mb-6 md:mb-8">
          <img
            src={logoIcon}
            alt="Sales Forecast Web"
            className="mx-auto mb-4 md:mb-6 w-20 h-20 md:w-24 md:h-24 rounded-2xl shadow-xl shadow-black/20"
          />
          <h1 className="text-2xl md:text-3xl font-semibold text-white mb-2">{t('title')}</h1>
          <p className="text-slate-400 text-sm md:text-base">{t('subtitle')}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8">
          <form className="space-y-5" onSubmit={handleLogin} noValidate>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('emailLabel')}
              </label>
              <input
                type="email"
                placeholder={t('emailPlaceholder')}
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                autoComplete="email"
                disabled={loading}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-all outline-none disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('passwordLabel')}</label>
              <input
                type="password"
                placeholder={t('passwordPlaceholder')}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                autoComplete="current-password"
                disabled={loading}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-all outline-none disabled:opacity-60"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-sky-600/20 flex items-center justify-center gap-2"
            >
              <LogIn className="w-5 h-5" />
              {loading ? t('submitting') : t('submitButton')}
            </button>
          </form>
        </div>

        <p className="text-center text-slate-500 text-xs mt-6">
          {t('copyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </div>
  );
};
