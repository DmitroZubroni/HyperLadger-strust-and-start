# Базовое задание на JavaScript

Пользователь регистрируется (имя, пароль, адрес), смотрит свои данные, меняет адрес и пишет в общий чат, который видят все. Администратор блокирует и разблокирует пользователей. Заблокированный читает чат, но не может писать и менять данные. Все данные хранятся в блокчейне.

```
Браузер (React, порт 3005) → API (Express, порт 8091) → Сеть Fabric (test-network)
```

Запускается в Ubuntu: на компьютере, в виртуальной машине или в WSL.

## 1. Установка

Нужны Git, cURL, jq, Docker и Node.js 22.12 или новее.

**Ubuntu (компьютер или виртуальная машина):**

```bash
sudo apt-get update
sudo apt-get install -y git curl jq docker-compose
sudo systemctl start docker
sudo usermod -a -G docker $USER      # затем выйдите из системы и войдите снова
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Windows с WSL 2:**

1. Установите Docker Desktop и WSL 2 с Ubuntu.
2. Включите в Docker Desktop: Settings → Resources → WSL Integration для Ubuntu.
3. В терминале Ubuntu выполните команды выше, кроме установки Docker: `git curl jq` вместо `git curl jq docker-compose` и без `systemctl` и `usermod`.
4. Проект храните в файловой системе Ubuntu, например в `~/projects`, а не в `/mnt/c`.

Fabric ставится официальным скриптом в корень репозитория, рядом с папкой `basic-js`. Скрипт скачивает образы Docker, утилиты в `fabric-samples/bin` и примеры. Это несколько гигабайт. По умолчанию ставятся Fabric 2.5.16 и Fabric CA 1.5.17.

```bash
git clone https://github.com/DmitroZubroni/HyperLadger-strust-and-start.git
cd HyperLadger-strust-and-start
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh docker samples binary
docker pull hyperledger/fabric-nodeenv:2.5
```

Образ `fabric-nodeenv` пир использует для запуска контракта. Скрипт установки его не скачивает, поэтому без этой команды образ загрузится при первом деплое.

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

Команда поднимает две организации, ордерер, центры сертификации (флаг `-ca`) и канал `mychannel`. Это тестовая сеть из документации Fabric: она предназначена для обучения и проверки на своём компьютере, а не для промышленного использования.

## 4. Смарт-контракт

Контракт находится в `backend/contract.js`, API рядом с ним в `backend/api.js`.

| Метод | Кто вызывает | Что делает |
| --- | --- | --- |
| `RegisterUser(address)` | Пользователь из Org2 | Создаёт запись `{name, address, status}` |
| `GetMe()` | Любой | Возвращает свои данные |
| `UpdateAddress(address)` | Активный пользователь | Меняет свой адрес |
| `SendMessage(text)` | Активный пользователь | Пишет сообщение `{author, time, text}` в общий чат |
| `GetMessages()` | Любой | Возвращает все сообщения по времени |
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

Документация Fabric советует выполнять `npm install` в папке контракта перед упаковкой, но для деплоя через `network.sh` пир сам ставит зависимости при сборке.

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

Файл `backend/api.js` состоит из трёх частей, их удобно писать по порядку:

| Часть | Функции | Что делает |
| --- | --- | --- |
| 1. Fabric CA | `runCaClient`, `register`, `login` | Запускает утилиту `fabric-ca-client`: создаёт пользователя, выпускает его сертификат и ключ в папку `wallet/<токен>` и открывает сессию |
| 2. Смарт-контракт | `callContract` | По токену находит организацию и ключи сессии, подключается к пиру своей организации и вызывает метод: `evaluate` читает, `submit` записывает |
| 3. REST API | `/register`, `/login`, `/evaluate/:method`, `/submit/:method` | Принимает запросы интерфейса и возвращает ответы или ошибки |

Контракт вызывается через Fabric Gateway, официальный клиент для Fabric 2.4 и новее. Клиент открывает gRPC-соединение с пиром своей организации, а пир сам собирает одобрения других организаций. Старые `fabric-network` и `fabric-gateway-java` устарели, их репозитории в архиве, поэтому здесь они не используются.

API ничего не проверяет, кроме сессии: обязательные поля требует интерфейс, а права и данные проверяет контракт. Организации перечислены в объекте `ORGS`: вход перебирает их по очереди, поэтому для новой организации достаточно добавить в него строку.

Соединение создаётся заново на каждый запрос и сразу закрывается. Для учебной сети это незаметно по скорости, зато API не держит старые сертификаты и продолжает работать после перезапуска сети.

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
└── ui/pages/        LoginPage, RegisterPage, ProfilePage, UsersPage, ChatPage
```

Если браузер открыт на другом компьютере, зайдите по IP машины с решением и откройте порты `3005` и `8091`.

## 8. Пользователи и организации

| Организация | Кто в ней | Как появляется |
| --- | --- | --- |
| Org1 | Администратор `admin` | Создаётся вместе с сетью |
| Org2 | Пользователи | Регистрируются сами через `/register` |

Пользователь сети — это сертификат и закрытый ключ. API работает с CA через официальную утилиту `fabric-samples/bin/fabric-ca-client`. Регистрация идёт в три шага:

1. Администратор CA организации Org2 создаёт учётную запись: `fabric-ca-client register`.
2. Пользователь получает сертификат: `fabric-ca-client enroll`. При неверном пароле CA вернёт ошибку, поэтому пароль проверяет сам CA.
3. Пользователь вызывает `RegisterUser`, и его запись появляется в реестре.

Сертификаты и ключи лежат в папке `basic-js/wallet`, своя папка на каждую сессию. Она вне папки контракта, поэтому ключи не попадают в пакет контракта при деплое, а в git она не добавляется. Сессии хранятся в памяти API, поэтому при запуске API очищает `wallet`, и после перезапуска нужно войти снова. Пароль передаётся утилите в командной строке: для учебной сети это допустимо, но на общем сервере его могут увидеть другие пользователи системы.

Блокировка меняет статус в контракте и не отзывает сертификат: заблокированный может войти и посмотреть данные, но `UpdateAddress` и `SendMessage` ему откажут. Имя менять нельзя: оно записано в сертификате.

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
| `ENOENT` с путём к `organizations` | Сеть не поднята | Выполните шаг 3 |
| `access denied` или `creator org unknown` после перезапуска сети | Старый сертификат сессии | Выйдите и войдите снова |
| Ошибка `nodeenv` или `javaenv` при деплое | Образ не скачался | Выполните `docker pull` из раздела 1 |
| `$'\r': command not found` | Окончания строк Windows | Клонируйте репозиторий внутри Ubuntu |
