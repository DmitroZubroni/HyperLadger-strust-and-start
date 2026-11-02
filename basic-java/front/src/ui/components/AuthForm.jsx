import { useState } from 'react';

// Форма входа и регистрации: fields = { имя поля: подпись }
export function AuthForm({ title, fields, onSubmit, children }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(Object.fromEntries(new FormData(event.target)));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>{title}</h2>
      {error && <p className="error">{error}</p>}
      {Object.entries(fields).map(([name, label]) => (
        <label key={name}>
          {label}
          <input name={name} type={name === 'password' ? 'password' : 'text'} required />
        </label>
      ))}
      <button disabled={busy}>{title}</button>
      <p>{children}</p>
    </form>
  );
}
