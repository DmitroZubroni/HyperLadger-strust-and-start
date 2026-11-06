import { Link } from 'react-router-dom';
import { useAuth } from '../../core/context/AuthContext';
import { AuthForm } from '../components/AuthForm';

export function RegisterPage() {
  const { register } = useAuth();
  return (
    <AuthForm title="Зарегистрироваться" fields={{ name: 'Имя из терминала', address: 'Адрес' }} onSubmit={register}>
      <Link to="/login">Вход</Link>
    </AuthForm>
  );
}
