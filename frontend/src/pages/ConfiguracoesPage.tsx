import React, { useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { User, Lock, Save, CheckCircle, AlertCircle, Eye, EyeOff, Camera, Trash2 } from 'lucide-react';
import { Avatar } from '../components/shared/Avatar';

function SaveFeedback({ status, t }: { status: 'idle' | 'saving' | 'ok' | 'error'; t: (k: string) => string }) {
  if (status === 'idle')   return null;
  if (status === 'saving') return <span className="text-sm text-slate-500">{t('profile.saving')}</span>;
  if (status === 'ok')     return <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle className="w-4 h-4" /> {t('profile.saved')}</span>;
  return <span className="flex items-center gap-1 text-sm text-red-600"><AlertCircle className="w-4 h-4" /> {t('profile.errorSave')}</span>;
}

export const ConfiguracoesPage: React.FC = () => {
  const { user, token, updateUser } = useAuth();
  const { t } = useTranslation('layout');

  const [nome, setNome]             = useState(user?.nome ?? '');
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha]   = useState('');
  const [showSenha, setShowSenha]   = useState(false);
  const [status, setStatus]         = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');

  const fileInputRef                  = useRef<HTMLInputElement>(null);
  const [preview, setPreview]         = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [avatarStatus, setAvatarStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');

  const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400';
  const labelCls = 'block text-sm font-medium text-slate-600 mb-1';

  async function saveConta() {
    setStatus('saving');
    try {
      const body: Record<string, string> = {};
      if (nome.trim()) body.nome = nome.trim();
      if (senhaAtual && novaSenha) { body.senhaAtual = senhaAtual; body.novaSenha = novaSenha; }
      const r = await fetch(`/api/users/${user?.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      setStatus(r.ok ? 'ok' : 'error');
      if (r.ok) { setSenhaAtual(''); setNovaSenha(''); }
      setTimeout(() => setStatus('idle'), 2500);
    } catch {
      setStatus('error');
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    const reader = new FileReader();
    reader.onload = ev => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function saveAvatar() {
    if (!pendingFile || !user) return;
    setAvatarStatus('saving');
    try {
      const form = new FormData();
      form.append('avatar', pendingFile);
      const r = await fetch(`/api/users/${user.id}/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (r.ok) {
        const { avatarUrl } = await r.json();
        updateUser({ avatarUrl });
        setPendingFile(null);
        setAvatarStatus('ok');
      } else {
        setAvatarStatus('error');
      }
      setTimeout(() => setAvatarStatus('idle'), 2500);
    } catch {
      setAvatarStatus('error');
    }
  }

  async function removeAvatar() {
    if (!user) return;
    setAvatarStatus('saving');
    try {
      const r = await fetch(`/api/users/${user.id}/avatar`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        updateUser({ avatarUrl: undefined });
        setPreview(null);
        setPendingFile(null);
        setAvatarStatus('ok');
      } else {
        setAvatarStatus('error');
      }
      setTimeout(() => setAvatarStatus('idle'), 2500);
    } catch {
      setAvatarStatus('error');
    }
  }

  const currentAvatar = preview ?? user?.avatarUrl;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">{t('profile.title')}</h1>

      {/* Foto de Perfil */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-4">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">{t('profile.sectionPhoto')}</p>
        <div className="flex items-center gap-5">
          <div className="relative shrink-0">
            {currentAvatar ? (
              <img src={currentAvatar} alt={user?.nome} className="w-20 h-20 rounded-full object-cover border-2 border-slate-200" />
            ) : (
              <Avatar nome={user?.nome ?? ''} size="lg" />
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileSelect}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <Camera className="w-4 h-4" /> {t('profile.changePhoto')}
              </button>

              {pendingFile && (
                <button
                  onClick={saveAvatar}
                  disabled={avatarStatus === 'saving'}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {avatarStatus === 'saving' ? t('profile.saving') : t('profile.savePhoto')}
                </button>
              )}

              {user?.avatarUrl && !pendingFile && (
                <button
                  onClick={removeAvatar}
                  disabled={avatarStatus === 'saving'}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" /> {t('profile.removePhoto')}
                </button>
              )}
            </div>

            <p className="text-xs text-slate-400">{t('profile.photoHint')}</p>
            <SaveFeedback status={avatarStatus} t={t} />
          </div>
        </div>
      </div>

      {/* Dados da conta */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
        <h2 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
          <User className="w-5 h-5" /> {t('profile.sectionData')}
        </h2>

        <div>
          <label className={labelCls}>{t('profile.labelName')}</label>
          <input className={inputCls} value={nome} onChange={e => setNome(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>{t('profile.labelEmail')}</label>
          <input className={inputCls} value={user?.email ?? ''} disabled />
        </div>

        <hr className="border-slate-100" />
        <h3 className="text-sm font-semibold text-slate-600 flex items-center gap-2">
          <Lock className="w-4 h-4" /> {t('profile.sectionPassword')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>{t('profile.labelCurrentPassword')}</label>
            <div className="relative">
              <input className={inputCls} type={showSenha ? 'text' : 'password'}
                value={senhaAtual} onChange={e => setSenhaAtual(e.target.value)} placeholder="••••••••" />
              <button type="button" onClick={() => setShowSenha(p => !p)} className="absolute right-3 top-2.5 text-slate-400">
                {showSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className={labelCls}>{t('profile.labelNewPassword')}</label>
            <input className={inputCls} type={showSenha ? 'text' : 'password'}
              value={novaSenha} onChange={e => setNovaSenha(e.target.value)} placeholder="••••••••" />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button onClick={saveConta}
            className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            <Save className="w-4 h-4" /> {t('profile.saveChanges')}
          </button>
          <SaveFeedback status={status} t={t} />
        </div>
      </div>
    </div>
  );
};
