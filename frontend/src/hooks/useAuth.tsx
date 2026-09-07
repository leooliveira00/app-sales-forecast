import React, { createContext, useContext, useState, useCallback } from 'react';

export interface UnidadeVendaBasic {
  id: string;
  codigo: string;
  descricao: string;
  tipo: string;
  paises: Array<{ iso3: string; nome: string }>;
}

export interface UsuarioUnidade {
  id: string;
  role: string;
  unidadeVenda: UnidadeVendaBasic;
}

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: string;
  avatarUrl?: string;
  unidades: UsuarioUnidade[];
}

const ACTIVE_UNIDADE_KEY = 'forecast_active_unidade';

interface AuthContextType {
  user: Usuario | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Partial<Usuario>) => void;
  isAuthenticated: boolean;
  activeUnidade: UsuarioUnidade | null;
  setActiveUnidade: (codigo: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Verifica client-side se o JWT já expirou (sem checar assinatura). */
const isTokenExpired = (token: string): boolean => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
};

const loadStoredSession = (): { user: Usuario | null; token: string | null } => {
  const storedToken = sessionStorage.getItem('forecast_token');
  const storedUser  = sessionStorage.getItem('forecast_user');

  if (!storedToken || !storedUser || isTokenExpired(storedToken)) {
    sessionStorage.removeItem('forecast_token');
    sessionStorage.removeItem('forecast_user');
    return { user: null, token: null };
  }

  try {
    return { user: JSON.parse(storedUser) as Usuario, token: storedToken };
  } catch {
    sessionStorage.removeItem('forecast_token');
    sessionStorage.removeItem('forecast_user');
    return { user: null, token: null };
  }
};

const resolveActiveUnidade = (user: Usuario | null): UsuarioUnidade | null => {
  if (!user || user.unidades.length === 0) return null;
  const stored = sessionStorage.getItem(ACTIVE_UNIDADE_KEY);
  if (stored) {
    const match = user.unidades.find(u => u.unidadeVenda.codigo === stored);
    if (match) return match;
  }
  return user.unidades[0];
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const stored = loadStoredSession();
  const [user, setUser]   = useState<Usuario | null>(stored.user);
  const [token, setToken] = useState<string | null>(stored.token);
  const [activeUnidade, setActiveUnidadeState] = useState<UsuarioUnidade | null>(
    () => resolveActiveUnidade(stored.user)
  );

  const setActiveUnidade = useCallback((codigo: string) => {
    if (!user) return;
    const match = user.unidades.find(u => u.unidadeVenda.codigo === codigo);
    if (!match) return;
    setActiveUnidadeState(match);
    sessionStorage.setItem(ACTIVE_UNIDADE_KEY, codigo);
  }, [user]);

  const login = async (email: string, password: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Credenciais inválidas');
    }

    const data = await response.json();
    setUser(data.user);
    setToken(data.token);
    sessionStorage.setItem('forecast_user', JSON.stringify(data.user));
    sessionStorage.setItem('forecast_token', data.token);
    setActiveUnidadeState(resolveActiveUnidade(data.user));
  };

  const updateUser = useCallback((updates: Partial<Usuario>) => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      sessionStorage.setItem('forecast_user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const logout = () => {
    // Fire-and-forget: registra audit no backend sem bloquear a UI.
    // keepalive garante a entrega mesmo se o usuário fechar a aba em seguida.
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      }).catch(() => {});
    }
    setUser(null);
    setToken(null);
    setActiveUnidadeState(null);
    sessionStorage.removeItem('forecast_user');
    sessionStorage.removeItem('forecast_token');
    sessionStorage.removeItem(ACTIVE_UNIDADE_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, updateUser, isAuthenticated: !!user, activeUnidade, setActiveUnidade }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
