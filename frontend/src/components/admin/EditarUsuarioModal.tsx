import React, { useRef, useState } from 'react';
import { UserCog, X, Building, Plus, Trash2, KeyRound, Eye, EyeOff, Camera, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { Avatar } from '../shared/Avatar';
import { Dropdown } from '../shared/Dropdown';
import { PERFIS } from './NovoUsuarioModal';

interface UserLink {
  id: string;
  unidadeVenda: { codigo: string; descricao: string };
}

interface AdminUser {
  id: string;
  nome: string;
  email: string;
  perfil: string;
  avatarUrl?: string;
  unidades: UserLink[];
}

interface UnidadeOption {
  codigo: string;
  descricao: string;
}

interface EditarUsuarioModalProps {
  user: AdminUser;
  token: string | null;
  allUnidades: UnidadeOption[];
  onClose: () => void;
  onUpdated: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export const EditarUsuarioModal: React.FC<EditarUsuarioModalProps> = ({
  user, token, allUnidades, onClose, onUpdated, showToast,
}) => {
  const [nome, setNome]       = useState(user.nome);
  const [email, setEmail]     = useState(user.email);
  const [perfil, setPerfil]   = useState(user.perfil);
  const [saving, setSaving]   = useState(false);

  const [unidades, setUnidades]           = useState<UserLink[]>(user.unidades);
  const [selectedUnit, setSelectedUnit]   = useState('');
  const [linkingUnit, setLinkingUnit]     = useState(false);
  const [removingUnit, setRemovingUnit]   = useState<string | null>(null);

  const [novaSenha, setNovaSenha]               = useState('');
  const [confirmarSenha, setConfirmarSenha]     = useState('');
  const [showSenha, setShowSenha]               = useState(false);
  const [savingPassword, setSavingPassword]     = useState(false);
  const [showPasswordSection, setShowPasswordSection] = useState(false);

  const fileInputRef                      = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState(user.avatarUrl);
  const [savingAvatar, setSavingAvatar]   = useState(false);

  const linkedCodigos = new Set(unidades.map(u => u.unidadeVenda.codigo));
  const availableUnidades = allUnidades.filter(u => !linkedCodigos.has(u.codigo));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nome, email, perfil }),
      });
      if (res.ok) {
        showToast('Usuário atualizado com sucesso!', 'success');
        onUpdated();
        onClose();
      } else {
        const err = await res.json();
        showToast(err.error || 'Erro ao atualizar usuário', 'error');
      }
    } catch {
      showToast('Erro ao atualizar usuário', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddUnidade = async () => {
    if (!selectedUnit) return;
    setLinkingUnit(true);
    try {
      const res = await fetch(`/api/users/${user.id}/unidades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unidadeVendaId: selectedUnit, role: 'GESTOR' }),
      });
      if (res.ok) {
        const link = await res.json();
        setUnidades(prev => [...prev, link]);
        setSelectedUnit('');
        showToast('Unidade vinculada!', 'success');
        onUpdated();
      } else {
        const err = await res.json();
        showToast(err.error || 'Erro ao vincular unidade', 'error');
      }
    } catch {
      showToast('Erro ao vincular unidade', 'error');
    } finally {
      setLinkingUnit(false);
    }
  };

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingAvatar(file);
    const reader = new FileReader();
    reader.onload = ev => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSaveAvatar = async () => {
    if (!pendingAvatar) return;
    setSavingAvatar(true);
    try {
      const form = new FormData();
      form.append('avatar', pendingAvatar);
      const res = await fetch(`/api/users/${user.id}/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (res.ok) {
        const { avatarUrl } = await res.json();
        setCurrentAvatarUrl(avatarUrl);
        setPendingAvatar(null);
        setAvatarPreview(null);
        showToast('Foto atualizada!', 'success');
        onUpdated();
      } else {
        showToast('Erro ao salvar foto', 'error');
      }
    } catch {
      showToast('Erro ao salvar foto', 'error');
    } finally {
      setSavingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setSavingAvatar(true);
    try {
      const res = await fetch(`/api/users/${user.id}/avatar`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setCurrentAvatarUrl(undefined);
        setAvatarPreview(null);
        setPendingAvatar(null);
        showToast('Foto removida!', 'success');
        onUpdated();
      } else {
        showToast('Erro ao remover foto', 'error');
      }
    } catch {
      showToast('Erro ao remover foto', 'error');
    } finally {
      setSavingAvatar(false);
    }
  };

  const handleResetPassword = async () => {
    if (!novaSenha) return;
    if (novaSenha !== confirmarSenha) {
      showToast('As senhas não coincidem.', 'error');
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ novaSenha }),
      });
      if (res.ok) {
        showToast('Senha redefinida com sucesso!', 'success');
        setNovaSenha('');
        setConfirmarSenha('');
      } else {
        const err = await res.json();
        showToast(err.error || 'Erro ao redefinir senha', 'error');
      }
    } catch {
      showToast('Erro ao redefinir senha', 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleRemoveUnidade = async (unidadeCodigo: string) => {
    setRemovingUnit(unidadeCodigo);
    try {
      const res = await fetch(`/api/users/${user.id}/unidades/${unidadeCodigo}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setUnidades(prev => prev.filter(u => u.unidadeVenda.codigo !== unidadeCodigo));
        showToast('Vínculo removido!', 'success');
        onUpdated();
      } else {
        showToast('Erro ao remover vínculo', 'error');
      }
    } catch {
      showToast('Erro ao remover vínculo', 'error');
    } finally {
      setRemovingUnit(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg relative flex flex-col max-h-[90vh]">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 z-10">
          <X className="w-5 h-5" />
        </button>

        <div className="p-8 pb-0">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <UserCog className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-lg">Editar Usuário</h3>
              <p className="text-xs text-slate-400">{user.email}</p>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-8">
          {/* Foto de Perfil */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Camera className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-bold text-slate-400 uppercase">Foto de Perfil</span>
            </div>
            <div className="flex items-center gap-4">
              {(avatarPreview ?? currentAvatarUrl) ? (
                <img
                  src={avatarPreview ?? currentAvatarUrl}
                  alt={user.nome}
                  className="w-14 h-14 rounded-full object-cover border border-slate-200 shrink-0"
                />
              ) : (
                <Avatar nome={user.nome} size="md" className="shrink-0" />
              )}
              <div className="space-y-2">
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarSelect} />
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    <Camera className="w-3.5 h-3.5" /> Alterar
                  </button>
                  {pendingAvatar && (
                    <button
                      type="button"
                      onClick={handleSaveAvatar}
                      disabled={savingAvatar}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" /> {savingAvatar ? 'Salvando…' : 'Salvar'}
                    </button>
                  )}
                  {currentAvatarUrl && !pendingAvatar && (
                    <button
                      type="button"
                      onClick={handleRemoveAvatar}
                      disabled={savingAvatar}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remover
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-slate-400">JPG, PNG ou WEBP · Máx. 2 MB</p>
              </div>
            </div>
          </div>

          <form id="edit-user-form" onSubmit={handleSubmit} className="space-y-4 mb-6">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Nome Completo</label>
              <input
                required type="text"
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">E-mail</label>
              <input
                required type="email"
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </form>

          {/* Redefinir Senha */}
          <div className="mb-6 border border-slate-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setShowPasswordSection(p => !p);
                setNovaSenha('');
                setConfirmarSenha('');
              }}
              className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-semibold text-slate-700">Redefinir Senha</span>
              </div>
              {showPasswordSection
                ? <ChevronUp className="w-4 h-4 text-slate-400" />
                : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>

            {showPasswordSection && (
              <div className="px-4 py-4 space-y-3 bg-white">
                <p className="text-xs text-slate-500">
                  Preencha os dois campos e clique em <strong>Confirmar Redefinição</strong>.
                </p>
                <div className="relative">
                  <input
                    type={showSenha ? 'text' : 'password'}
                    placeholder="Nova senha"
                    value={novaSenha}
                    onChange={e => setNovaSenha(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400 pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSenha(p => !p)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <input
                  type={showSenha ? 'text' : 'password'}
                  placeholder="Confirmar nova senha"
                  value={confirmarSenha}
                  onChange={e => setConfirmarSenha(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400"
                />
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={savingPassword || !novaSenha || !confirmarSenha}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <KeyRound className="w-4 h-4" />
                  {savingPassword ? 'Salvando...' : 'Confirmar Redefinição'}
                </button>
              </div>
            )}
          </div>

          {/* Papel */}
          <div className="mb-6">
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Papel / Nível</label>
            <Dropdown
              aria="Papel / Nível"
              valor={perfil}
              opcoes={PERFIS}
              onChange={setPerfil}
            />
          </div>

          {/* Gestão de Unidades */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Building className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-bold text-slate-400 uppercase">Unidades Vinculadas</span>
            </div>

            {unidades.length > 0 ? (
              <div className="space-y-1.5 mb-3">
                {unidades.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <Building className="w-3 h-3 text-slate-400" />
                      <span className="text-xs font-bold text-slate-700">{link.unidadeVenda.codigo}</span>
                      <span className="text-xs text-slate-400">{link.unidadeVenda.descricao}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveUnidade(link.unidadeVenda.codigo)}
                      disabled={removingUnit === link.unidadeVenda.codigo}
                      className="p-1 text-slate-300 hover:text-red-500 transition-colors disabled:opacity-30"
                      title="Remover vínculo"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 mb-3">Nenhuma unidade vinculada.</p>
            )}

            {availableUnidades.length > 0 && (
              <div className="flex gap-2">
                <div className="flex-1">
                  <Dropdown
                    aria="Adicionar unidade"
                    valor={selectedUnit}
                    placeholder="Adicionar unidade..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                    opcoes={availableUnidades.map((u) => ({
                      valor:  u.codigo,
                      rotulo: `${u.codigo} — ${u.descricao}`,
                    }))}
                    onChange={setSelectedUnit}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddUnidade}
                  disabled={!selectedUnit || linkingUnit}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {linkingUnit ? 'Vinculando...' : 'Vincular'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="px-8 pb-8 pt-4 border-t border-slate-100 flex gap-3">
          <button type="button" onClick={onClose}
            className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-all text-sm"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="edit-user-form"
            disabled={saving}
            className="flex-1 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-50 text-sm"
          >
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </div>
    </div>
  );
};
