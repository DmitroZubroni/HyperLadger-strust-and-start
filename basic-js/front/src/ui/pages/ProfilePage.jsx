import { useEffect, useState } from 'react';
import { useAuth } from '../../core/context/AuthContext';

const STATUS = { active: 'Активен', blocked: 'Заблокирован' };

export function ProfilePage() {
  const { user, evaluate, submit } = useAuth();
  const [me, setMe] = useState(user);
  const [error, setError] = useState('');

  // Данные каждый раз читаются из блокчейна
  useEffect(() => {
    evaluate('GetMe').then(setMe);
  }, []);

  async function save(event) {
    event.preventDefault();
    setError('');
    try {
      setMe(await submit('UpdateAddress', new FormData(event.target).get('address')));
    } catch (err) {
      setError(err.message);
      setMe(await evaluate('GetMe'));
    }
  }

  return (
    <section className="card">
      <h2>Мои данные</h2>
      {error && <p className="error">{error}</p>}
      <p>Имя: {me.name}</p>
      <p>Адрес: {me.address}</p>
      <p className={me.status}>Статус: {STATUS[me.status]}</p>
      {me.status !== 'blocked' && (
        <form onSubmit={save}>
          <label>
            Новый адрес
            <input name="address" required />
          </label>
          <button>Сохранить</button>
        </form>
      )}
    </section>
  );
}
