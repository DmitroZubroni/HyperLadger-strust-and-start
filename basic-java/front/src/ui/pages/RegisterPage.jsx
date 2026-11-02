import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../core/context/AuthContext';
import { ErrorMessage } from '../components/ErrorMessage';

export function RegisterPage() {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', password: '', address: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const change = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register(form);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="card narrow" onSubmit={handleSubmit}>
      <h2>Регистрация</h2>
      <ErrorMessage text={error} />
      <label>Имя (латиница) <input name="name" value={form.name} onChange={change} required pattern="[a-zA-Z0-9_\-]{3,32}" autoComplete="off" /></label>
      <label>Пароль (от 6 символов) <input name="password" type="password" value={form.password} onChange={change} required minLength={6} autoComplete="new-password" /></label>
      <label>Адрес <input name="address" value={form.address} onChange={change} required /></label>
      <button disabled={busy}>Зарегистрироваться</button>
      <p className="hint">Уже есть аккаунт? <Link to="/login">Войти</Link></p>
    </form>
  );
}
