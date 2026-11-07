import { Link } from 'react-router-dom';
import { useAuth } from '../../core/context/AuthContext';
import { AuthForm } from '../components/AuthForm';

export function LoginPage() {
  const { login } = useAuth();
  return (
    <AuthForm title="Войти" fields={{ name: 'Имя, например ivan@org2.example.com' }} onSubmit={login}>
      <Link to="/register">Регистрация</Link>
    </AuthForm>
  );
}
