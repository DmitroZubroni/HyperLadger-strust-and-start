import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../core/context/AuthContext';

export function ChatPage() {
  const { user, evaluate, submit } = useAuth();
  const [messages, setMessages] = useState([]);
  const [me, setMe] = useState(user);
  const [error, setError] = useState('');
  const list = useRef(null);

  async function load() {
    setMessages(await evaluate('GetMessages'));
    setMe(await evaluate('GetMe'));
  }

  // Раз в 3 секунды: новые сообщения и блокировка появляются без перезагрузки страницы
  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    list.current.scrollTop = list.current.scrollHeight;
  }, [messages.length]);

  async function send(event) {
    event.preventDefault();
    const form = event.target;
    setError('');
    try {
      await submit('SendMessage', new FormData(form).get('text'));
      form.reset();
    } catch (err) {
      setError(err.message);
    }
    await load();
  }

  return (
    <section className="card">
      <h2>Общий чат</h2>
      {error && <p className="error">{error}</p>}
      <ul className="messages" ref={list}>
        {messages.length === 0 && <li>Сообщений пока нет</li>}
        {messages.map((message, index) => (
          <li key={index}>
            <b>{message.author}</b> <time>{new Date(message.time).toLocaleString('ru-RU')}</time>
            <p>{message.text}</p>
          </li>
        ))}
      </ul>
      {me.status === 'blocked' && <p className="error">Вы заблокированы и не можете писать сообщения.</p>}
      {me.status === 'active' && (
        <form className="send" onSubmit={send}>
          <input name="text" placeholder="Сообщение" required autoComplete="off" />
          <button>Отправить</button>
        </form>
      )}
    </section>
  );
}
