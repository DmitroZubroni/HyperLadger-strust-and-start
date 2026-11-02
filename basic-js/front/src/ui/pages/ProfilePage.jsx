import { useEffect, useState } from 'react';
import { useAuth } from '../../core/context/AuthContext';

const STATUS = { active: 'Активен', blocked: 'Заблокирован' };

export function ProfilePage() {
  const { user, evaluate } = useAuth();
  const [me, setMe] = useState(user);

  // Данные каждый раз читаются из блокчейна
  useEffect(() => {
    evaluate('GetMe').then(setMe);
  }, []);

  return (
    <section className="card">
      <h2>Мои данные</h2>
      <p>Имя: {me.name}</p>
      <p>Адрес: {me.address}</p>
      <p className={me.status}>Статус: {STATUS[me.status]}</p>
    </section>
  );
}
