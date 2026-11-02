import { useEffect, useState } from 'react';
import { useAuth } from '../../core/context/AuthContext';

export function UsersPage() {
  const { evaluate, submit } = useAuth();
  const [users, setUsers] = useState([]);
  const load = () => evaluate('GetUsers').then(setUsers);

  useEffect(() => {
    load();
  }, []);

  async function toggle(user) {
    await submit(user.status === 'blocked' ? 'UnblockUser' : 'BlockUser', user.name);
    await load();
  }

  return (
    <section className="card">
      <h2>Пользователи</h2>
      <table>
        <tbody>
          {users.map((user) => (
            <tr key={user.name}>
              <td>{user.name}</td>
              <td>{user.address}</td>
              <td className={user.status}>{user.status === 'blocked' ? 'Заблокирован' : 'Активен'}</td>
              <td>
                <button onClick={() => toggle(user)}>{user.status === 'blocked' ? 'Разблокировать' : 'Заблокировать'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
