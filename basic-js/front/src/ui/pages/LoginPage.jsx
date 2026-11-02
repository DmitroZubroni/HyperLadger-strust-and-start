import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../core/context/AuthContext';
import { ErrorMessage } from '../components/ErrorMessage';

export function LoginPage() {
  const { login } = useAuth();
  const [form, setForm] = useState({ name: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const change = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(form);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="card narrow" onSubmit={handleSubmit}>
      <h2>Вход</h2>
      <ErrorMessage text={error} />
      <label>Имя <input name="name" value={form.name} onChange={change} required autoComplete="username" /></label>
      <label>Пароль <input name="password" type="password" value={form.password} onChange={change} required autoComplete="current-password" /></label>
      <button disabled={busy}>Войти</button>
      <p className="hint">Нет аккаунта? <Link to="/register">Зарегистрироваться</Link></p>
    </form>
  );
}
