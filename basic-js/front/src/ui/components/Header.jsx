import { Link } from 'react-router-dom';
import { useAuth } from '../../core/context/AuthContext';

export function Header() {
  const { user, logout } = useAuth();
  return (
    <header>
      <strong>Пользователи на Fabric</strong>
      {user && (
        <nav>
          {user.role === 'admin' ? <Link to="/users">Пользователи</Link> : <Link to="/profile">Мои данные</Link>}
          <Link to="/chat">Чат</Link>
          <button className="link" onClick={logout}>Выйти ({user.name})</button>
        </nav>
      )}
    </header>
  );
}
