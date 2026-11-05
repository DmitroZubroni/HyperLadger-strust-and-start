# Вариант API: GET читает, POST записывает

Пример альтернативы текущему API. Рабочий `backend/api.js` не изменён: этот файл показывает, что поменять, если перейти на такой вариант.

## Идея

В API два маршрута на все методы контракта. Название метода приходит в адресе, поэтому при добавлении метода в контракт API менять не нужно.

| Что | Сейчас | В этом варианте |
| --- | --- | --- |
| Чтение | `POST /evaluate/GetMe` | `GET /contract/GetMe` |
| Запись | `POST /submit/SendMessage` | `POST /contract/SendMessage` |
| Аргументы чтения | в теле: `{"args": [...]}` | в адресе: `?args=a&args=b` |
| Аргументы записи | в теле: `{"args": [...]}` | в теле: `{"args": [...]}` |
| Вход и регистрация | `/login`, `/register` | без изменений |

Запомнить просто: **GET читает данные, POST записывает их в блок.**

## Изменения в API

В `backend/api.js` маршрут

```js
// Один маршрут на все методы контракта
app.post('/:kind(evaluate|submit)/:method', route(async (req) => {
    const user = sessions.get(req.headers.authorization);
    if (!user) throw new Error('Требуется вход');
    return callContract(req.params.kind, user, req.params.method, req.body.args || []);
}));
```

заменяется на:

```js
// Два маршрута на все методы контракта: GET читает, POST записывает в блок
const contractRoute = (kind, getArgs) => route(async (req) => {
    const user = sessions.get(req.headers.authorization);
    if (!user) throw new Error('Требуется вход');
    return callContract(kind, user, req.params.method, getArgs(req));
});

app.get('/contract/:method', contractRoute('evaluate', (req) => [].concat(req.query.args ?? [])));
app.post('/contract/:method', contractRoute('submit', (req) => req.body.args || []));
```

- `:method` — это переменная, а не конкретный метод: в неё попадает любое имя из адреса.
- `[].concat(req.query.args ?? [])` превращает `?args=a` в `['a']`, `?args=a&args=b` в `['a', 'b']`, а отсутствие аргументов в `[]`.
- Префикс `/contract` отделяет методы контракта от `/login` и `/register`.

## Изменения в интерфейсе

В `front/src/core/context/AuthContext.jsx` функции `evaluate` и `submit` остаются с тем же видом вызова, меняется только запрос внутри:

```js
async function request(method, path, body, token) {
  const response = await fetch(API_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: token || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

// Чтение: GET, аргументы в адресе
const evaluate = (method, ...args) => {
  const query = new URLSearchParams(args.map((arg) => ['args', arg]));
  return request('GET', `/contract/${method}?${query}`, null, token);
};

// Запись: POST, аргументы в теле
const submit = (method, ...args) => request('POST', `/contract/${method}`, { args }, token);
```

Остальной код фронта менять не нужно: страницы и так вызывают `evaluate('GetMessages')` и `submit('SendMessage', текст)`.

`/login` и `/register` тоже идут через `request('POST', ...)`, а при входе `GetMe` берётся через `GET /contract/GetMe`.

## Проверка через curl

```bash
TOKEN=$(curl -s -X POST localhost:8091/login -H 'Content-Type: application/json' \
  -d '{"name":"admin","password":"adminpw"}' | jq -r .token)

# Чтение
curl -s localhost:8091/contract/GetUsers -H "Authorization: $TOKEN"
curl -s localhost:8091/contract/GetMessages -H "Authorization: $TOKEN"

# Запись
curl -s -X POST localhost:8091/contract/BlockUser -H "Authorization: $TOKEN" \
  -H 'Content-Type: application/json' -d '{"args":["ivan"]}'
```

## Главная ловушка

Метод записи, вызванный через GET, выполнится, но в блок не попадёт. Контракт вернёт результат так, будто всё получилось.

Проверено на копии API: `GET /contract/UnblockUser?args=ivan` вернул `"status":"active"`, но следующий `GET /contract/GetMe` показал, что пользователь по-прежнему заблокирован.

Поэтому правило одно: **всё, что меняет данные, отправляется через POST.**

## Что проверено

- Серверная часть: на копии API на порту 8092 через curl. Чтение через GET, запись через POST, блокировка, вход и регистрация работают; без токена API отвечает «Требуется вход».
- Изменения во фронте: не запускались, код приведён как пример.
