import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../core/context/AuthContext';
import { ErrorMessage } from '../components/ErrorMessage';
import { MessageForm } from '../components/MessageForm';
import { MessageList } from '../components/MessageList';

export function ChatPage() {
  const { user, request, refreshUser } = useAuth();
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setMessages(await request('GET', '/api/messages'));
    await refreshUser();
  }, [request, refreshUser]);

  // Новые сообщения и блокировка появляются без перезагрузки страницы
  useEffect(() => {
    load().catch((err) => setError(err.message));
    const timer = setInterval(() => load().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [load]);

  async function send(text) {
    setError('');
    try {
      await request('POST', '/api/messages', { text });
      await load();
    } catch (err) {
      setError(err.message);
      await refreshUser().catch(() => {});
      throw err;
    }
  }

  return (
    <section className="card">
      <h2>Чат</h2>
      <ErrorMessage text={error} />
      {user.status === 'blocked' && <p className="error">Вы заблокированы администратором и не можете отправлять сообщения.</p>}
      <MessageList messages={messages} />
      {user.status !== 'blocked' && <MessageForm onSend={send} />}
    </section>
  );
}
