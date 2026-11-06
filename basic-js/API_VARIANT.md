# Вариант API: GET читает, POST записывает

> Устарел: рабочий `backend/api.js` уже использует GET для чтения и POST для записи. Файл оставлен как история обсуждения.

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

## Полный код `backend/api.js` в этом варианте

Отличается от рабочего `api.js` только блоком «Два маршрута на все методы контракта».

```js
'use strict';
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const cors = require('cors');
const express = require('express');
const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');

const SAMPLES = path.resolve(__dirname, '../../fabric-samples');
const NETWORK = `${SAMPLES}/test-network/organizations`;
const ORGS = {
    org1: { msp: 'Org1MSP', peer: 'localhost:7051', caPort: 7054 },   // администратор
    org2: { msp: 'Org2MSP', peer: 'localhost:9051', caPort: 8054 },   // пользователи
};
const sessions = new Map();     // токен -> { org, name, certificate, key }

// --- Пользователи: официальная утилита fabric-ca-client ---

// Команда выполняется от имени администратора CA организации
function caCommand(org, args) {
    return promisify(execFile)(`${SAMPLES}/bin/fabric-ca-client`,
        [...args, '--caname', `ca-${org}`, '--tls.certfiles', `${NETWORK}/fabric-ca/${org}/ca-cert.pem`],
        { env: { ...process.env, FABRIC_CA_CLIENT_HOME: `${NETWORK}/peerOrganizations/${org}.example.com` } });
}

function register(name, password) {
    return caCommand('org2', ['register', '--id.name', name, '--id.secret', password,
        '--id.type', 'client', '--id.affiliation', 'org2.department1']);
}

// Выпуск сертификата. При неверном пароле CA вернёт ошибку: это и есть проверка входа
async function enroll(org, name, password) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enroll-'));
    try {
        const url = `https://${encodeURIComponent(name)}:${encodeURIComponent(password)}@localhost:${ORGS[org].caPort}`;
        await caCommand(org, ['enroll', '-u', url, '-M', dir]);
        const keyFile = fs.readdirSync(`${dir}/keystore`)[0];
        return {
            org,
            name,
            certificate: fs.readFileSync(`${dir}/signcerts/cert.pem`),
            key: crypto.createPrivateKey(fs.readFileSync(`${dir}/keystore/${keyFile}`)),
        };
    } finally {
        fs.rmSync(dir, { recursive: true });
    }
}

// --- Контракт: Fabric Gateway ---

// Одно gRPC-соединение на организацию: так советует документация Fabric.
// После перезапуска сети сертификат другой, тогда соединение создаётся заново
const clients = {};
function grpcClient(org) {
    const tlsCert = fs.readFileSync(`${NETWORK}/peerOrganizations/${org}.example.com/tlsca/tlsca.${org}.example.com-cert.pem`);
    if (!clients[org]?.tlsCert.equals(tlsCert)) {
        clients[org]?.client.close();
        clients[org] = {
            tlsCert,
            client: new grpc.Client(ORGS[org].peer, grpc.credentials.createSsl(tlsCert), {
                'grpc.ssl_target_name_override': `peer0.${org}.example.com`,
            }),
        };
    }
    return clients[org].client;
}

// Вызов любого метода контракта от имени пользователя: evaluate читает, submit записывает в блок
async function callContract(kind, user, method, args) {
    const gateway = connect({
        client: grpcClient(user.org),
        identity: { mspId: ORGS[user.org].msp, credentials: user.certificate },
        signer: signers.newPrivateKeySigner(user.key),
        hash: hash.SHA256,
    });
    try {
        const contract = gateway.getNetwork('mychannel').getContract('users');
        const call = kind === 'submit' ? contract.submitTransaction(method, ...args) : contract.evaluateTransaction(method, ...args);
        return JSON.parse(Buffer.from(await call).toString());
    } finally {
        gateway.close();
    }
}

// --- REST API ---

function openSession(user) {
    const token = crypto.randomUUID();
    sessions.set(token, user);
    return { token };
}

const app = express();
app.use(cors());
app.use(express.json());

const route = (handler) => (req, res) => handler(req).then((data) => res.json(data)).catch((err) => {
    res.status(400).json({ error: err.details?.[0]?.message.replace(/^.*?chaincode response \d+, /, '') || err.message });
});

app.post('/register', route(async (req) => {
    const { name, password, address } = req.body;
    if (!name || !password || !address) throw new Error('Укажите имя, пароль и адрес');
    await register(name, password).catch(() => {
        throw new Error('Не удалось зарегистрировать: имя занято или недопустимо');   // текст утилиты содержит пароль
    });
    const user = await enroll('org2', name, password);
    await callContract('submit', user, 'RegisterUser', [address]);
    return openSession(user);
}));

app.post('/login', route(async (req) => {
    const { name, password } = req.body;
    for (const org of ['org1', 'org2']) {
        const user = await enroll(org, name, password).catch(() => null);
        if (user) return openSession(user);
    }
    throw new Error('Неверное имя или пароль');
}));

// Два маршрута на все методы контракта: GET читает, POST записывает в блок
const contractRoute = (kind, getArgs) => route(async (req) => {
    const user = sessions.get(req.headers.authorization);
    if (!user) throw new Error('Требуется вход');
    return callContract(kind, user, req.params.method, getArgs(req));
});

app.get('/contract/:method', contractRoute('evaluate', (req) => [].concat(req.query.args ?? [])));
app.post('/contract/:method', contractRoute('submit', (req) => req.body.args || []));

app.listen(8091, () => console.log('API: http://localhost:8091'));
```
