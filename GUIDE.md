# Решение на Hyperledger Fabric на JavaScript: пошагово

Краткая инструкция для разработки с нуля: установка, сеть, смарт-контракт, деплой, пользователи, API и интерфейс. Рабочий пример — папка [`basic-js`](basic-js), команды на каждый день — [`COMMANDS.md`](COMMANDS.md), схемы — [`ARCHITECTURE.md`](ARCHITECTURE.md).

```
Браузер (React) ──HTTP──► API (Express) ──gRPC, Fabric Gateway──► Пир ──► Смарт-контракт ──► Реестр
                                 ▲
                   ключи пользователей (создаёт разработчик в терминале через fabric-ca-client)
```

## 1. Установка

Ubuntu, виртуальная машина или WSL 2 с Ubuntu. Нужны Git, cURL, jq, Docker и Node.js 22.12+.

```bash
sudo apt-get update
sudo apt-get install -y git curl jq docker-compose
sudo usermod -a -G docker $USER               # затем войдите в систему заново
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

В WSL Docker ставится через Docker Desktop: Settings → Resources → WSL Integration → Ubuntu. Проект держите в `~/projects`, не в `/mnt/c`.

Fabric 2.5 ставится официальным скриптом в папку проекта:

```bash
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh docker samples binary     # образы, утилиты, fabric-samples
docker pull hyperledger/fabric-nodeenv:2.5    # образ для запуска контракта на JS
```

## 2. Что где лежит в fabric-samples

| Путь | Что там |
| --- | --- |
| `bin/` | Утилиты: `peer`, `fabric-ca-client`, `configtxlator`, `osnadmin` и др. |
| `config/` | Конфигурация утилит, нужна в `FABRIC_CFG_PATH` |
| `test-network/network.sh` | Запуск и остановка сети, создание канала, деплой контракта |
| `test-network/organizations/peerOrganizations/<орг>/` | Всё об организации: CA, пиры, пользователи |
| `.../<орг>/users/<имя>@<орг>/msp` | Сертификат (`signcerts`) и ключ (`keystore`) пользователя |
| `.../<орг>/tlsca/tlsca.<орг>-cert.pem` | TLS-сертификат для подключения к пиру организации |
| `test-network/organizations/fabric-ca/<орг>/ca-cert.pem` | Сертификат CA организации, нужен `fabric-ca-client` |
| `test-network/addOrg3/` | Скрипт добавления третьей организации |
| `asset-transfer-basic/chaincode-javascript/` | Пример контракта на JS |
| `asset-transfer-basic/application-gateway-javascript/` | Пример приложения на Fabric Gateway |

`<орг>` — это `org1.example.com` или `org2.example.com`.

## 3. Сеть

Из папки `fabric-samples/test-network`:

```bash
./network.sh up createChannel -ca     # Org1, Org2, ордерер, CA, канал mychannel
./network.sh down                     # остановить и удалить всё, включая пользователей
```

| Что | Порт |
| --- | --- |
| Пир Org1 / Org2 | 7051 / 9051 |
| CA Org1 / Org2 | 7054 / 8054 |
| Ордерер | 7050 |

Флаг `-ca` обязателен: без него пользователей нельзя создавать после запуска сети.

## 4. Смарт-контракт

### Зависимости

```json
{
  "name": "users",
  "main": "contract.js",
  "scripts": { "start": "fabric-chaincode-node start" },
  "dependencies": {
    "fabric-contract-api": "~2.5",
    "fabric-shim": "~2.5"
  }
}
```

Если API лежит в той же папке, его зависимости кладите в `devDependencies`: пир при сборке контракта ставит только `dependencies`.

### Каркас

```js
const { Contract } = require('fabric-contract-api');

class UsersContract extends Contract {
    // Каждый метод класса — функция, которую можно вызвать из сети
    async SetValue(ctx, key, value) {
        await ctx.stub.putState(key, Buffer.from(value));
        return value;
    }

    async GetValue(ctx, key) {
        const data = await ctx.stub.getState(key);
        return data.toString();
    }
}

module.exports.contracts = [UsersContract];
```

Аргументы приходят строками, возвращать нужно строку, обычно `JSON.stringify(...)`. Ошибка — `throw new Error('текст')`: транзакция отменяется, текст получает клиент.

### Работа с реестром: `ctx.stub`

| Метод | Что делает |
| --- | --- |
| `getState(key)` | Прочитать значение. Пустой буфер, если ключа нет |
| `putState(key, Buffer)` | Записать значение |
| `deleteState(key)` | Удалить ключ |
| `getStateByRange('user:', 'user;')` | Все ключи с началом `user:` по порядку: `for await (const { key, value } of ...)` |
| `createCompositeKey(type, [a, b])` и `getStateByPartialCompositeKey(type, [a])` | Составные ключи и поиск по их началу |
| `getQueryResult(query)` | Поиск по полям JSON, только с CouchDB (`./network.sh up -s couchdb`) |
| `getHistoryForKey(key)` | История изменений ключа |
| `getTxID()` | ID транзакции |
| `getDateTimestamp()` и `getTxTimestamp()` | Время транзакции. `Date.now()` использовать нельзя: на пирах он разный |
| `setEvent(name, Buffer)` | Событие для клиентов |
| `getPrivateData` и `putPrivateData` | Приватные данные коллекций |

### Кто вызвал: `ctx.clientIdentity`

| Метод | Что возвращает |
| --- | --- |
| `getMSPID()` | Организацию: `Org1MSP`, `Org2MSP` |
| `getID()` | Строку с данными сертификата, из неё берётся имя `CN=ivan` |
| `getAttributeValue('role')` | Атрибут из сертификата, если его выдали с `:ecert` |
| `assertAttributeValue('role', 'admin')` | `true` или `false` |

Права проверяет контракт, по организации или атрибуту. Имя пользователя берётся из сертификата, а не из аргументов, поэтому подделать его нельзя.

## 5. Деплой

```bash
./network.sh deployCC -ccn users -ccp ../../basic-js/backend -ccl javascript
./network.sh deployCC -ccn users -ccp ../../basic-js/backend -ccl javascript -ccv 2 -ccs 2   # обновление
```

При каждом обновлении увеличивайте `-ccv` и `-ccs`. Данные в реестре сохраняются.

## 6. Пользователи

Создаются в терминале из папки `fabric-samples/test-network`. Учётную запись регистрирует администратор CA организации, а `enroll` выпускает сертификат и ключ.

```bash
NAME=ivan PASSWORD=ivanpw
export PATH=$PWD/../bin:$PATH
export FABRIC_CA_CLIENT_HOME=$PWD/organizations/peerOrganizations/org2.example.com

fabric-ca-client register --caname ca-org2 --id.name $NAME --id.secret $PASSWORD --id.type client \
  --id.affiliation org2.department1 --tls.certfiles $PWD/organizations/fabric-ca/org2/ca-cert.pem

fabric-ca-client enroll -u https://$NAME:$PASSWORD@localhost:8054 --caname ca-org2 \
  --tls.certfiles $PWD/organizations/fabric-ca/org2/ca-cert.pem \
  -M $PWD/organizations/peerOrganizations/org2.example.com/users/$NAME@org2.example.com/msp
```

- Роль для контракта: добавьте к `register` `--id.attrs 'role=dps:ecert'`.
- Тип участника: `--id.type client`, `admin`, `peer` или `orderer`.
- Администратор Org1 уже есть: `users/Admin@org1.example.com`.
- Для Org1 замените `org2` на `org1`, порт `8054` на `7054`.

## 7. Клиентские библиотеки

| Библиотека | Статус | Для чего |
| --- | --- | --- |
| `@hyperledger/fabric-gateway` + `@grpc/grpc-js` | Актуальная, рекомендована для Fabric 2.4+ | Вызов контракта |
| `fabric-network` | Устарела, репозиторий в архиве с апреля 2025 | Старый способ вызова контракта |
| `fabric-ca-client` (npm) | Из того же архивного репозитория | Работа с CA из кода |
| Утилита `fabric-ca-client` в `bin/` | Поддерживается | Работа с CA из терминала или через `execFileSync` |

### Вызов контракта через Fabric Gateway

```js
const gateway = fabric.connect({
    client: grpcClient,                                            // gRPC-соединение с пиром
    identity: { mspId: 'Org2MSP', credentials: certificate },     // сертификат пользователя
    signer: fabric.signers.newPrivateKeySigner(privateKey),       // его закрытый ключ
    hash: fabric.hash.SHA256,
});
const contract = gateway.getNetwork('mychannel').getContract('users');

await contract.evaluate('GetMe', { arguments: [] });                // чтение, блок не создаётся
await contract.submit('UpdateAddress', { arguments: ['Тула'] });    // запись в блок
// То же короче: contract.evaluateTransaction('GetMe') и contract.submitTransaction('UpdateAddress', 'Тула')
gateway.close();
```

Пир сам собирает одобрения других организаций, поэтому API подключается только к пиру своей организации.

Если контракт отказал, текст ошибки лежит в `error.details[0].message`.

### Старый вариант: fabric-network

Встречается в старых учебниках. Работает через профиль подключения `connection-org1.json` и папку `wallet`. Для новых решений не подходит: библиотека больше не поддерживается.

```js
const { Gateway, Wallets } = require('fabric-network');
const gateway = new Gateway();
await gateway.connect(profile, { wallet, identity: 'ivan', discovery: { enabled: true, asLocalhost: true } });
const contract = (await gateway.getNetwork('mychannel')).getContract('users');
await contract.submitTransaction('UpdateAddress', 'Тула');
```

## 8. API: варианты

Во всех вариантах API не знает о методах контракта: имя метода приходит в адресе, поэтому новый метод контракта не требует правок API.

| | А. Ключи из папки `users` сети | Б. Ключи в своей папке `wallet` | В. CA внутри API |
| --- | --- | --- | --- |
| Кто создаёт пользователя | разработчик в терминале | разработчик в терминале | сам API при регистрации на сайте |
| Где ключи | `peerOrganizations/<орг>/users/<имя>@<орг>/msp` | `basic-js/wallet/<имя>` | `basic-js/wallet/<токен>` |
| Как API узнаёт организацию | из имени: часть после `@` | правилом: `admin` — Org1, остальные — Org2 | вход перебирает организации |
| Вход на сайте | `ivan@org2.example.com` | `ivan` | имя и пароль, пароль проверяет CA |
| gRPC-соединение | одно на организацию | новое на каждый запрос | новое на каждый запрос |
| Маршруты | `GET` и `POST /contract/:method` | `/login`, `GET` и `POST /contract/:method` | `/register`, `/login`, `POST /evaluate/:method`, `POST /submit/:method` |
| Объём | около 110 строк | около 110 строк | около 170 строк |

Вариант А сейчас закоммичен в `basic-js`. Во всех вариантах API ничего не проверяет, кроме наличия пользователя: обязательные поля требует интерфейс, права — контракт.

### Вариант А: ключи из папки users сети

```js
const NETWORK = path.resolve(__dirname, '../../fabric-samples/test-network/organizations/peerOrganizations');
const ORGS = {
    'org1.example.com': { mspId: 'Org1MSP', peer: 'localhost:7051' },
    'org2.example.com': { mspId: 'Org2MSP', peer: 'localhost:9051' },
};

// Одно gRPC-соединение на организацию, пересоздаётся после перезапуска сети
const clients = {};
function grpcClient(org) {
    const tlsCert = fs.readFileSync(NETWORK + '/' + org + '/tlsca/tlsca.' + org + '-cert.pem');
    if (!clients[org] || !clients[org].tlsCert.equals(tlsCert)) {
        if (clients[org]) {
            clients[org].client.close();
        }
        clients[org] = {
            tlsCert: tlsCert,
            client: new grpc.Client(ORGS[org].peer, grpc.credentials.createSsl(tlsCert), {
                'grpc.ssl_target_name_override': 'peer0.' + org,
            }),
        };
    }
    return clients[org].client;
}

// Вызов метода от имени пользователя ivan@org2.example.com
async function callContract(type, user, method, args) {
    const org = String(user).split('@')[1];
    const msp = NETWORK + '/' + org + '/users/' + user + '/msp';
    if (!ORGS[org] || !fs.existsSync(msp)) {
        throw new Error('Пользователь не найден');
    }
    const certificate = fs.readFileSync(msp + '/signcerts/cert.pem');
    const keyFile = fs.readdirSync(msp + '/keystore')[0];
    const privateKey = crypto.createPrivateKey(fs.readFileSync(msp + '/keystore/' + keyFile));

    const gateway = fabric.connect({
        client: grpcClient(org),
        identity: { mspId: ORGS[org].mspId, credentials: certificate },
        signer: fabric.signers.newPrivateKeySigner(privateKey),
        hash: fabric.hash.SHA256,
    });
    try {
        const contract = gateway.getNetwork('mychannel').getContract('users');
        let result;
        if (type === 'submit') {
            result = await contract.submit(method, { arguments: args });
        } else {
            result = await contract.evaluate(method, { arguments: args });
        }
        return JSON.parse(Buffer.from(result).toString());
    } catch (error) {
        if (error.details && error.details.length > 0) {
            throw new Error(error.details[0].message.replace(/^.*chaincode response \d+, /, ''));
        }
        throw error;
    } finally {
        gateway.close();
    }
}

app.get('/contract/:method', async function (req, res) {
    try {
        const args = [].concat(req.query.args || []);
        res.json(await callContract('evaluate', req.headers.authorization, req.params.method, args));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/contract/:method', async function (req, res) {
    try {
        res.json(await callContract('submit', req.headers.authorization, req.params.method, req.body.args || []));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});
```

Полный файл — [`basic-js/backend/api.js`](basic-js/backend/api.js) в коммите `66bb138`.

### Вариант Б: своя папка wallet

Пользователь выпускается в `basic-js/wallet/<имя>` (`enroll ... -M .../basic-js/wallet/ivan`). Организация определяется правилом, а соединение создаётся на каждый запрос:

```js
function connect(name) {
    const msp = WALLET + '/' + name;
    if (!fs.existsSync(msp)) {
        throw new Error('Требуется вход');
    }
    let org = 'org2';
    if (name === 'admin') {
        org = 'org1';
    }
    // дальше: сертификат и ключ из msp, gRPC-клиент и fabric.connect, как в варианте А
}
```

Папка `wallet` должна лежать вне папки контракта, иначе ключи попадут в пакет контракта при деплое. Полный файл — коммит `1f6b965`.

### Вариант В: CA внутри API

Пользователь регистрируется на сайте с паролем, API сам вызывает утилиту `fabric-ca-client`:

```js
function runCaClient(org, args, errorMessage) {
    const env = Object.assign({}, process.env, {
        FABRIC_CA_CLIENT_HOME: NETWORK + '/peerOrganizations/' + org + '.example.com',
    });
    const caArgs = ['--caname', 'ca-' + org, '--tls.certfiles', NETWORK + '/fabric-ca/' + org + '/ca-cert.pem'];
    try {
        childProcess.execFileSync(SAMPLES + '/bin/fabric-ca-client', args.concat(caArgs), { env: env, stdio: 'pipe' });
    } catch (error) {
        throw new Error(errorMessage);    // текст ошибки утилиты содержит пароль
    }
}

// Регистрация: register, затем enroll; вход: только enroll, неверный пароль отклонит CA
```

Пароль проверяет CA, поэтому вход по паролю настоящий. Цена — больше кода и сессии в памяти API. Полный файл — коммит `a1a1151`.

## 9. Интерфейс

React-приложение вызывает API двумя функциями:

```js
// Чтение: GET, аргументы в адресе
request('GET', '/contract/GetMe?' + new URLSearchParams([['args', 'a']]), user);
// Запись: POST, аргументы в теле
request('POST', '/contract/UpdateAddress', user, { args: ['Тула'] });
```

Пример целиком — [`basic-js/front/src`](basic-js/front/src): `core/context` (запросы и вход), `core/routing` (маршруты), `ui/pages` и `ui/components`.

API и страница на разных портах, поэтому в API нужен `app.use(cors())`.

## 10. Порядок работы

1. Поднять сеть: `./network.sh up createChannel -ca`.
2. Написать контракт, задеплоить: `./network.sh deployCC ...`.
3. Создать пользователей в терминале: `register` и `enroll`.
4. Запустить API: `node api.js`.
5. Сделать интерфейс: вход, страницы, вызовы `GET` и `POST /contract/:method`.
6. Проверить, что данные в блоке: раздел «Содержимое блока» в [`COMMANDS.md`](COMMANDS.md).
7. Изменили контракт — задеплоить с новыми `-ccv` и `-ccs`. Перезапустили сеть — создать пользователей заново.
