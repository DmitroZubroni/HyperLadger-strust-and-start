# Базовое задание на JavaScript

Пользователь регистрируется (имя, пароль, адрес), смотрит свои данные и меняет адрес. Администратор блокирует и разблокирует пользователей, заблокированный не может менять данные. Все данные хранятся в блокчейне.

```
Браузер (React, порт 3005) → API (Express, порт 8091) → Сеть Fabric (test-network)
```

Запускается в Ubuntu: на компьютере, в виртуальной машине или в WSL.

## 1. Установка

Нужны Docker, Node.js 18+, curl и jq.

```bash
sudo apt-get update
sudo apt-get install -y curl jq
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

- **Ubuntu:** `sudo apt-get install -y docker.io docker-compose-v2`, затем `sudo usermod -aG docker $USER` и войдите в систему заново.
- **WSL:** установите Docker Desktop и включите Settings → Resources → WSL Integration для Ubuntu. Проект храните в `~/projects`, а не в `/mnt/c`.

Fabric ставится в корень репозитория, рядом с папкой `basic-js`. Скачивается несколько гигабайт.

```bash
git clone git@github.com:DmitroZubroni/HyperLadger-strust-and-start.git
cd HyperLadger-strust-and-start
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh docker binary samples
```

## 2. Быстрый запуск

```bash
./basic-js/Start
```

Откройте http://localhost:3005. Администратор: `admin` / `adminpw`. Остановка: `Ctrl+C`, затем `./network.sh down` в папке `fabric-samples/test-network`.

Ниже те же шаги по отдельности.

## 3. Сеть

```bash
cd fabric-samples/test-network
./network.sh up createChannel -ca
```

Команда поднимает две организации, ордерер, центры сертификации (флаг `-ca`) и канал `mychannel`.

## 4. Смарт-контракт

Контракт находится в `backend/contract.js`, API рядом с ним в `backend/api.js`.

| Метод | Кто вызывает | Что делает |
| --- | --- | --- |
| `RegisterUser(address)` | Пользователь из Org2 | Создаёт запись `{name, address, status}` |
| `GetMe()` | Любой | Возвращает свои данные |
| `UpdateAddress(address)` | Активный пользователь | Меняет свой адрес |
| `GetUsers()` | Администратор | Возвращает всех пользователей |
| `BlockUser(name)` | Администратор | Ставит статус `blocked` |
| `UnblockUser(name)` | Администратор | Ставит статус `active` |

Имя вызывающего контракт берёт из его сертификата, организацию из `getMSPID()`. Поэтому чужое имя подставить нельзя.

## 5. Деплой контракта

Из папки `fabric-samples/test-network`:

```bash
./network.sh deployCC -ccn users -ccp ../../basic-js/backend -ccl javascript
```

В `package.json` зависимости контракта лежат в `dependencies`, а зависимости API в `devDependencies`: пир при сборке контракта ставит только первые.

Обновление после правки кода: добавьте `-ccv 2 -ccs 2` и увеличивайте эти номера при каждом следующем обновлении.

## 6. API

```bash
cd basic-js/backend
npm install
node api.js
```

| Маршрут | Тело запроса | Что делает |
| --- | --- | --- |
| `POST /register` | `{name, password, address}` | Создаёт пользователя в CA и в контракте, возвращает `{token}` |
| `POST /login` | `{name, password}` | Проверяет пароль через CA, возвращает `{token}` |
| `POST /evaluate/<метод>` | `{args: []}` | Читает данные, блок не создаётся |
| `POST /submit/<метод>` | `{args: []}` | Записывает данные в блок |

Токен передаётся в заголовке `Authorization`. Новый метод контракта сразу доступен через эти маршруты, менять API не нужно.

```bash
TOKEN=$(curl -s -X POST localhost:8091/login -H 'Content-Type: application/json' \
  -d '{"name":"admin","password":"adminpw"}' | jq -r .token)
curl -s -X POST localhost:8091/evaluate/GetUsers -H "Authorization: $TOKEN" -H 'Content-Type: application/json' -d '{}'
```

## 7. Интерфейс

```bash
cd basic-js/front
npm install
npx vite --host --port 3005
```

```
front/src/
├── core/context/    AuthContext: сессия и вызовы контракта
├── core/routing/    AppRouter: маршруты для гостя, пользователя и администратора
├── ui/components/   Header, AuthForm
└── ui/pages/        LoginPage, RegisterPage, ProfilePage, UsersPage
```

Если браузер открыт на другом компьютере, зайдите по IP машины с решением и откройте порты `3005` и `8091`.

## 8. Пользователи и организации

| Организация | Кто в ней | Как появляется |
| --- | --- | --- |
| Org1 | Администратор `admin` | Создаётся вместе с сетью |
| Org2 | Пользователи | Регистрируются сами через `/register` |

Пользователь сети — это сертификат и закрытый ключ. Регистрация идёт в три шага:

1. Администратор CA организации Org2 создаёт учётную запись: `register`.
2. Пользователь получает сертификат: `enroll`. При неверном пароле CA вернёт ошибку, поэтому пароль проверяет сам CA.
3. Пользователь вызывает `RegisterUser`, и его запись появляется в реестре.

Сертификаты и ключи API хранит в памяти, поэтому после его перезапуска нужно войти снова.

Блокировка меняет статус в контракте и не отзывает сертификат: заблокированный может войти и посмотреть данные, но `UpdateAddress` ему откажет. Имя менять нельзя: оно записано в сертификате.

## 9. Как увидеть данные в блокчейне

Выполните какое-нибудь действие в интерфейсе, а затем из папки `fabric-samples/test-network`:

```bash
export PATH=$PWD/../bin:$PATH FABRIC_CFG_PATH=$PWD/../config
export CORE_PEER_TLS_ENABLED=true CORE_PEER_LOCALMSPID=Org1MSP CORE_PEER_ADDRESS=localhost:7051
export CORE_PEER_TLS_ROOTCERT_FILE=$PWD/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=$PWD/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp

peer channel fetch newest newest.block -c mychannel
configtxlator proto_decode --type common.Block --input newest.block --output newest.json
jq -r '.data.data[0].payload.data.actions[0].payload.action.proposal_response_payload.extension.results.ns_rwset[]
  | select(.namespace=="users") | .rwset.writes[] | .key + " = " + (.value | @base64d)' newest.json
```

В ответе будет последняя запись:

```
user:ivan = {"name":"ivan","address":"Москва","status":"active"}
```

## 10. Частые ошибки

| Ошибка | Причина | Решение |
| --- | --- | --- |
| `port is already allocated` | Порт занят другим контейнером | Остановите его или выполните `./network.sh down` |
| `permission denied` у `docker` | Пользователь не в группе `docker` | `sudo usermod -aG docker $USER`, затем войдите заново |
| `Cannot find module .../connection-org1.json` | Сеть не поднята | Выполните шаг 3 |
| `access denied` или `creator org unknown` после перезапуска сети | Старый сертификат | Перезапустите API и войдите снова |
| `$'\r': command not found` | Окончания строк Windows | Клонируйте репозиторий внутри Ubuntu |
