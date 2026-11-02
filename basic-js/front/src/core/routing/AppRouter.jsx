import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Header } from '../../ui/components/Header';
import { ChatPage } from '../../ui/pages/ChatPage';
import { LoginPage } from '../../ui/pages/LoginPage';
import { RegisterPage } from '../../ui/pages/RegisterPage';
import { UsersPage } from '../../ui/pages/UsersPage';

/** Только для вошедших. С adminOnly — только для администратора. */
function PrivateRoute({ adminOnly = false }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/chat" replace />;
  return <Outlet />;
}

/** Только для гостей: вошедший пользователь сразу попадает в чат. */
function GuestRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/chat" replace /> : <Outlet />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Header />
      <main>
        <Routes>
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Route>
          <Route element={<PrivateRoute />}>
            <Route path="/chat" element={<ChatPage />} />
          </Route>
          <Route element={<PrivateRoute adminOnly />}>
            <Route path="/users" element={<UsersPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
