import { useEffect, useRef } from 'react';

export function MessageList({ messages }) {
  const list = useRef(null);

  // Новое сообщение прокручивает список вниз
  useEffect(() => {
    list.current.scrollTop = list.current.scrollHeight;
  }, [messages.length]);

  return (
    <ul className="messages" ref={list}>
      {messages.length === 0 && <li className="empty">Сообщений пока нет</li>}
      {messages.map((message, index) => (
        <li key={`${message.time}-${index}`}>
          <b>{message.author}</b>
          <time dateTime={message.time}>{new Date(message.time).toLocaleString('ru-RU')}</time>
          <p>{message.text}</p>
        </li>
      ))}
    </ul>
  );
}
