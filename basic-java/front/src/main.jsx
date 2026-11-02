import { createRoot } from 'react-dom/client';
import { AuthProvider } from './core/context/AuthContext';
import { AppRouter } from './core/routing/AppRouter';
import './ui/styles.css';

createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <AppRouter />
  </AuthProvider>,
);
