import { useState } from 'react';

export function MessageForm({ onSend }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSending(true);
    try {
      await onSend(text);
      setText('');
    } catch {
      // Ошибку показывает страница, текст остаётся в поле
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="row" onSubmit={handleSubmit}>
      <label>
        Сообщение
        <input value={text} onChange={(e) => setText(e.target.value)} required maxLength={1000} autoComplete="off" />
      </label>
      <button disabled={sending}>Отправить</button>
    </form>
  );
}
