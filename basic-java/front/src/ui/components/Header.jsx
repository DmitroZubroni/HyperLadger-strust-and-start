import { Link } from 'react-router-dom';
import { useAuth } from '../../core/context/AuthContext';

export function Header() {
  const { user, logout } = useAuth();
  return (
    <header>
      <strong>Общий чат</strong>
      {user && <Link to="/chat">Чат</Link>}
      {user?.role === 'admin' && <Link to="/users">Пользователи</Link>}
      {user && (
        <div className="who">
          <span>{user.role === 'admin' ? `${user.name}, администратор` : `${user.name}, ${user.address}`}</span>
          <button className="link" onClick={logout}>Выйти</button>
        </div>
      )}
    </header>
  );
}
