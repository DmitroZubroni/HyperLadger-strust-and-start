import { useAuth } from '../../core/context/AuthContext';

export function Header() {
  const { user, logout } = useAuth();
  return (
    <header>
      <strong>Пользователи на Fabric</strong>
      {user && <button className="link" onClick={logout}>Выйти ({user.name})</button>}
    </header>
  );
}
