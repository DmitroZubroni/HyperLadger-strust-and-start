import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// API работает в контейнере с нодой, на том же компьютере, откуда открыта страница
const API_URL = `http://${window.location.hostname}:8090`;
const AuthContext = createContext(null);

function readToken() {
  try {
    return sessionStorage.getItem('token');
  } catch {
    return null;
  }
}

function writeToken(token) {
  try {
    if (token) sessionStorage.setItem('token', token);
    else sessionStorage.removeItem('token');
  } catch {
    // В приватном режиме токен живёт только в памяти
  }
}

/** Состояние входа: токен, данные пользователя из реестра и запросы к API. */
export function AuthProvider({ children }) {
  const [token, setToken] = useState(readToken);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));

  const clearSession = useCallback(() => {
    writeToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const request = useCallback(async (method, path, body, authToken = token) => {
    const response = await fetch(API_URL + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken || ''}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (response.status === 401 && authToken) {
      clearSession();
    }
    if (!response.ok) {
      throw new Error(data.error);
    }
    return data;
  }, [token, clearSession]);

  const refreshUser = useCallback(async () => {
    setUser(await request('GET', '/api/me'));
  }, [request]);

  // Загрузка пользователя при входе и после перезагрузки страницы
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    refreshUser().catch(() => {}).finally(() => setLoading(false));
  }, [token, refreshUser]);

  const startSession = useCallback((data) => {
    writeToken(data.token);
    setLoading(true);
    setToken(data.token);
  }, []);

  const login = useCallback(async (form) => {
    startSession(await request('POST', '/api/login', form, null));
  }, [request, startSession]);

  const register = useCallback(async (form) => {
    startSession(await request('POST', '/api/register', form, null));
  }, [request, startSession]);

  const logout = useCallback(async () => {
    await request('POST', '/api/logout').catch(() => {});
    clearSession();
  }, [request, clearSession]);

  const value = useMemo(
    () => ({ user, loading, request, refreshUser, login, register, logout }),
    [user, loading, request, refreshUser, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
