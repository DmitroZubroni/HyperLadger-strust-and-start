import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Header } from '../../ui/components/Header';
import { ChatPage } from '../../ui/pages/ChatPage';
import { LoginPage } from '../../ui/pages/LoginPage';
import { ProfilePage } from '../../ui/pages/ProfilePage';
import { RegisterPage } from '../../ui/pages/RegisterPage';
import { UsersPage } from '../../ui/pages/UsersPage';

export function AppRouter() {
  const { user } = useAuth();
  const home = user?.role === 'admin' ? '/users' : '/profile';

  return (
    <BrowserRouter>
      <Header />
      <main>
        {user ? (
          <Routes>
            {user.role === 'admin'
              ? <Route path="/users" element={<UsersPage />} />
              : <Route path="/profile" element={<ProfilePage />} />}
            <Route path="/chat" element={<ChatPage />} />
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        )}
      </main>
    </BrowserRouter>
  );
}
