import { createContext, useContext, useState } from 'react';

const API_URL = 'http://' + window.location.hostname + ':8091';
const AuthContext = createContext(null);

// Запрос к API. token — имя вошедшего пользователя
async function request(method, path, token, body) {
  const response = await fetch(API_URL + path, {
    method: method,
    headers: { 'Content-Type': 'application/json', Authorization: token || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error);
  }
  return data;
}

// Чтение: GET, аргументы в адресе
function evaluateAs(token, method, args) {
  const query = new URLSearchParams(args.map(function (arg) { return ['args', arg]; }));
  return request('GET', '/contract/' + method + '?' + query, token);
}

// Запись: POST, аргументы в теле
function submitAs(token, method, args) {
  return request('POST', '/contract/' + method, token, { args: args });
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);

  function evaluate(method, ...args) {
    return evaluateAs(token, method, args);
  }

  function submit(method, ...args) {
    return submitAs(token, method, args);
  }

  // Вход по имени пользователя, созданного в терминале
  async function login(form) {
    const me = await evaluateAs(form.name, 'GetMe', []);
    if (!me) {
      throw new Error('Сначала зарегистрируйтесь');
    }
    setUser(me);
    setToken(form.name);
  }

  // Регистрация: запись своих данных в контракт
  async function register(form) {
    await submitAs(form.name, 'RegisterUser', [form.address]);
    setUser(await evaluateAs(form.name, 'GetMe', []));
    setToken(form.name);
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, evaluate, submit, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
