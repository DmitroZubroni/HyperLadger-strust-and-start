import { Link } from 'react-router-dom';
import { useAuth } from '../../core/context/AuthContext';
import { AuthForm } from '../components/AuthForm';

export function LoginPage() {
  const { login } = useAuth();
  return (
    <AuthForm title="Войти" fields={{ name: 'Имя' }} onSubmit={login}>
      <Link to="/register">Регистрация</Link>
    </AuthForm>
  );
}
