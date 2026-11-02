import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../core/context/AuthContext';
import { ErrorMessage } from '../components/ErrorMessage';
import { UsersTable } from '../components/UsersTable';

export function UsersPage() {
  const { request } = useAuth();
  const [users, setUsers] = useState([]);
  const [busyName, setBusyName] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const all = await request('GET', '/api/users');
    setUsers(all.filter((user) => user.role !== 'admin'));
  }, [request]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
    const timer = setInterval(() => load().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [load]);

  async function toggle(user) {
    setBusyName(user.name);
    setError('');
    try {
      const action = user.status === 'blocked' ? 'unblock' : 'block';
      await request('POST', `/api/users/${encodeURIComponent(user.name)}/${action}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyName(null);
    }
  }

  return (
    <section className="card">
      <h2>Пользователи</h2>
      <ErrorMessage text={error} />
      <UsersTable users={users} busyName={busyName} onToggle={toggle} />
    </section>
  );
}
