export function UsersTable({ users, busyName, onToggle }) {
  if (users.length === 0) {
    return <p className="empty">Пользователей пока нет</p>;
  }
  return (
    <table>
      <thead>
        <tr><th>Имя</th><th>Адрес</th><th>Состояние</th><th /></tr>
      </thead>
      <tbody>
        {users.map((user) => {
          const blocked = user.status === 'blocked';
          return (
            <tr key={user.name}>
              <td>{user.name}</td>
              <td>{user.address}</td>
              <td className={blocked ? 'blocked' : ''}>{blocked ? 'Заблокирован' : 'Активен'}</td>
              <td>
                <button className={blocked ? '' : 'danger'} disabled={busyName === user.name} onClick={() => onToggle(user)}>
                  {blocked ? 'Разблокировать' : 'Заблокировать'}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
