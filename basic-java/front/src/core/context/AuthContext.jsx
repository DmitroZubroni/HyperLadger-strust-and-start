import { createContext, useContext, useState } from 'react';

const API_URL = `http://${window.location.hostname}:8091`;
const AuthContext = createContext(null);

async function post(path, body, token) {
  const response = await fetch(API_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token || '' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);

  // Вызовы смарт-контракта
  const evaluate = (method, ...args) => post(`/evaluate/${method}`, { args }, token);
  const submit = (method, ...args) => post(`/submit/${method}`, { args }, token);

  async function enter(path, form) {
    const { token: newToken } = await post(path, form);
    setUser(await post('/evaluate/GetMe', {}, newToken));
    setToken(newToken);
  }

  const login = (form) => enter('/login', form);
  const register = (form) => enter('/register', form);
  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, evaluate, submit, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
