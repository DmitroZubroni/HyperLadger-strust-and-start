# Общий чат на Hyperledger Fabric: решение на Java

Система работает так: одна нода в Docker, в неё задеплоен смарт-контракт, рядом с контрактом работает API, а интерфейс на React вызывает API из браузера. Каждая запись проходит через смарт-контракт и попадает в блок.

```
Браузер (React, localhost:3006)
   │  REST
   ▼
┌───────────── контейнер chat-node ─────────────┐
│  API (Spring Boot, порт 8090)                 │
│     │ Fabric Gateway          │ Fabric CA     │
│     ▼                         ▼               │
│  пиры Admins и Users       центры сертификации│
│     │  смарт-контракт chat                    │
│     ▼                                         │
│  ордерер → блоки канала chatchannel           │
└───────────────────────────────────────────────┘
```

Что умеет система:

- при старте существует администратор `administrator`, пароль `admin123`;
- пользователь регистрируется сам: имя, пароль, адрес;
- администратор блокирует и разблокирует пользователей;
- активный пользователь пишет в общий чат, у сообщения есть автор, время и текст.

## Быстрый запуск

```bash
./Start
```

Откройте http://localhost:3006. Первый запуск скачивает образ ноды (около 2,6 ГБ) и зависимости Maven, поэтому занимает 5–10 минут.

Команда удаляет данные прошлого запуска и поднимает всё заново. Для остановки нажмите `Ctrl+C`, затем выполните `docker rm -f chat-node`.

## 1. Установка

Решение запускается в Linux: на обычном компьютере, в виртуальной машине или в WSL с Ubuntu. Нужны Docker и Node.js 18 или новее.

JDK и Maven устанавливать не нужно: они, как и пир, ордерер, CA и утилита `peer` есть внутри образа ноды.

**Ubuntu (компьютер или виртуальная машина):**

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 nodejs npm curl
sudo usermod -aG docker $USER      # затем выйдите из системы и войдите снова
node --version                     # если меньше 18, установите свежую версию с nodejs.org
docker run --rm hello-world
```

**Windows с WSL и Ubuntu:**

1. Установите [Docker Desktop](https://www.docker.com/products/docker-desktop/) и включите Settings → Resources → WSL Integration для Ubuntu.
2. Откройте терминал Ubuntu и установите Node.js внутри WSL: `sudo apt update && sudo apt install -y nodejs npm`. Проверьте, что `which node` показывает путь не в `/mnt/c`.
3. Держите проект в файловой системе Ubuntu, например в `~/projects`, а не в `/mnt/c`.
4. Браузер открывайте в Windows по адресу `http://localhost:3006`.

**Виртуальная машина с браузером на основном компьютере:** откройте страницу по IP-адресу виртуальной машины, например `http://192.168.56.10:3006`. Адрес API страница берёт из своего адреса. Порты `3006` и `8090` должны быть доступны снаружи: подойдёт сетевой мост или проброс обоих портов.

Нужен доступ в интернет: Microfab использует адреса вида `*.127-0-0-1.nip.io`, а зависимости скачиваются при сборке. Порты `3006` и `8090` должны быть свободны. Если порт интерфейса занят: `FRONT_PORT=3105 ./Start`.

## 2. Файлы проекта

```
basic-java/
├── Start                  запуск всего решения
├── backend/               копируется в контейнер в /tmp/app
│   ├── contract/          смарт-контракт
│   │   ├── pom.xml        собирает target/chaincode.jar
│   │   └── src/main/java/chat/   ChatContract, User, Message
│   └── api/               REST API рядом с контрактом
│       ├── pom.xml
│       └── src/main/java/chat/api/   ChatApplication, ChatController, Fabric
└── front/src/
    ├── core/
    │   ├── context/       AuthContext: сессия и запросы к API
    │   └── routing/       AppRouter: маршруты и проверка доступа
    └── ui/
        ├── components/    Header, MessageList, MessageForm, UsersTable, ErrorMessage
        └── pages/         LoginPage, RegisterPage, ChatPage, UsersPage
```

## 3. Нода одной командой

Нода запускается образом Microfab. Это один контейнер, внутри которого работают пиры, ордерер и центры сертификации. Организации и канал задаются в переменной `MICROFAB_CONFIG`:

```bash
docker run -d --name chat-node -p 8090:8090 -e MICROFAB_CONFIG='{
  "port": 9000,
  "endorsing_organizations": [{"name": "Admins"}, {"name": "Users"}],
  "channels": [{"name": "chatchannel", "endorsing_organizations": ["Admins", "Users"]}],
  "capability_level": "V2_5",
  "certificate_authorities": true
}' ghcr.io/hyperledger-labs/microfab:latest
```

Нода готова, когда в журнале появится строка `Microfab started`:

```bash
docker logs chat-node 2>&1 | grep 'Microfab started'
```

Для другой задачи достаточно поменять названия организаций и канала. Например, для организаций `Bank` и `Users` будут созданы `BankMSP` и `UsersMSP`, а также пиры `bankpeer-api...` и `userspeer-api...`.

## 4. Смарт-контракт

Контракт находится в `backend/contract/src/main/java/chat/ChatContract.java`. Класс реализует `ContractInterface`, а каждый метод с аннотацией `@Transaction` становится функцией, которую можно вызвать из сети.

| Функция | Кто вызывает | Параметры | Результат |
| --- | --- | --- | --- |
| `initLedger` | Администратор, один раз | `address` | Запись администратора |
| `registerUser` | Пользователь из организации Users | `address` | Запись пользователя |
| `getMe` | Зарегистрированный пользователь | нет | Своя запись |
| `getUsers` | Администратор | нет | Все пользователи |
| `blockUser` | Администратор | `name` | Обновлённая запись |
| `unblockUser` | Администратор | `name` | Обновлённая запись |
| `sendMessage` | Активный пользователь | `text` | Сообщение `{author, time, text}` |
| `getMessages` | Зарегистрированный пользователь | нет | Сообщения по времени |

Запись пользователя: `{name, address, role, org, status}`. Поле `status` равно `active` или `blocked`.

Четыре правила, без которых контракт будет работать неверно:

1. **Личность берётся из сертификата.** Имя читается из поля CN, организация из `getClientIdentity().getMSPID()`, роль из атрибута `role`. Контракт не принимает имя отправителя параметром, поэтому подделать автора сообщения нельзя.
2. **Время берётся из транзакции.** Нужен `ctx.getStub().getTxTimestamp()`. С `Instant.now()` пиры получат разный результат, и транзакция не пройдёт проверку.
3. **Каждое сообщение лежит под своим ключом.** Ключ выглядит как `message:<время>:<ID транзакции>`. Если хранить все сообщения в одном списке, одновременные отправки будут конфликтовать (`MVCC_READ_CONFLICT`).
4. **Пароль не попадает в реестр.** Реестр видят все участники канала. Пароль хранит Fabric CA.

Запуск тестов (нужен только запущенный контейнер как среда с Maven):

```bash
docker exec -w /tmp/app/contract chat-node mvn -B test -DskipTests=false
```

При деплое нода собирает контракт сама, поэтому в `pom.xml` тесты по умолчанию отключены.

## 5. API

API находится в `backend/api`, рядом с контрактом, и запускается внутри контейнера. Он делает три вещи: выпускает сертификаты через Fabric CA, вызывает контракт через Fabric Gateway и хранит сессии в памяти.

| Метод | Путь | Тело запроса | Функция контракта |
| --- | --- | --- | --- |
| POST | `/api/register` | `{name, password, address}` | `registerUser` |
| POST | `/api/login` | `{name, password}` | нет, только Fabric CA |
| POST | `/api/logout` | нет | нет |
| GET | `/api/me` | нет | `getMe` |
| GET | `/api/users` | нет | `getUsers` |
| POST | `/api/users/{name}/block` | нет | `blockUser` |
| POST | `/api/users/{name}/unblock` | нет | `unblockUser` |
| GET | `/api/messages` | нет | `getMessages` |
| POST | `/api/messages` | `{text}` | `sendMessage` |

Вход и регистрация возвращают `{token}`. Остальные запросы передают его в заголовке `Authorization: Bearer <токен>`. Ошибка приходит в виде `{error}`.

Вызов контракта занимает пару строк. Разница между чтением и записью принципиальная:

```java
contract.evaluateTransaction("getMessages");          // чтение: выполняется на пире, блок не создаётся
contract.submitTransaction("sendMessage", "Привет");  // запись: одобрение пирами, затем запись в блок
```

Запись выполняется от имени конкретного пользователя: `Gateway.newInstance()` получает его сертификат и закрытый ключ (класс `Fabric`).

Проверка через curl:

```bash
TOKEN=$(curl -s -X POST localhost:8090/api/login -H 'Content-Type: application/json' \
  -d '{"name":"administrator","password":"admin123"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')

curl -s -X POST localhost:8090/api/messages -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"text":"Привет из curl"}'

curl -s localhost:8090/api/messages -H "Authorization: Bearer $TOKEN"
```

## 6. Деплой контракта

Деплой состоит из четырёх шагов: упаковка, установка на пир, одобрение каждой организацией и коммит в канал. Шаги выполняются утилитой `peer` внутри контейнера. Она работает от имени администратора организации, поэтому сначала задаётся функция-обёртка:

```bash
HOST=127-0-0-1.nip.io:9000
peer() {
  docker exec -e CORE_PEER_LOCALMSPID="$2" -e CORE_PEER_ADDRESS="$1peer-api.$HOST" \
    -e CORE_PEER_MSPCONFIGPATH="/home/microfab/data/admin-$1" chat-node peer "${@:3}"
}
```

Параметры этого деплоя и функция установки с одобрением в одной организации:

```bash
LABEL=chat_1 VERSION=1 SEQUENCE=1
deploy_org() {
  peer "$1" "$2" lifecycle chaincode install "/tmp/$LABEL.tgz"
  ID=$(peer "$1" "$2" lifecycle chaincode queryinstalled | sed -n "s/^Package ID: \($LABEL:[^,]*\), Label.*/\1/p")
  peer "$1" "$2" lifecycle chaincode approveformyorg -o "orderer-api.$HOST" -C chatchannel \
    -n chat -v "$VERSION" --sequence "$SEQUENCE" --package-id "$ID"
}
```

Код контракта и API копируется в контейнер. На Linux это избавляет от проблем с правами: внутри контейнера работает отдельный пользователь.

```bash
tar -c --exclude=node_modules --exclude=target -C backend . | \
  docker exec -i chat-node sh -c 'mkdir -p /tmp/app && tar -x -C /tmp/app'
```

Упаковка, затем установка и одобрение в обеих организациях:

```bash
peer admins AdminsMSP lifecycle chaincode package "/tmp/$LABEL.tgz" --path /tmp/app/contract --lang java --label "$LABEL"
deploy_org admins AdminsMSP
deploy_org users UsersMSP
```

Коммит:

```bash
peer admins AdminsMSP lifecycle chaincode commit -o "orderer-api.$HOST" -C chatchannel -n chat -v "$VERSION" --sequence "$SEQUENCE" \
  --peerAddresses "adminspeer-api.$HOST" --peerAddresses "userspeer-api.$HOST"
```

Проверка:

```bash
peer admins AdminsMSP lifecycle chaincode querycommitted -C chatchannel -n chat
```

**Обновление контракта.** Измените код, снова скопируйте его в контейнер, задайте `LABEL=chat_2 VERSION=2 SEQUENCE=2` и повторите упаковку, `deploy_org` и коммит. Данные в реестре сохранятся.

После деплоя запустите API:

```bash
docker exec -e OTEL_SDK_DISABLED=true -w /tmp/app/api chat-node mvn -q -B spring-boot:run
```

Переменная `OTEL_SDK_DISABLED` отключает отправку телеметрии библиотекой Fabric: без неё в журнале появляются лишние предупреждения. При старте API создаёт администратора в CA и в реестре.

## 7. Подключение интерфейса

Интерфейс работает на компьютере, а не в контейнере:

```bash
cd front
npm install
npx vite --host --port 3006 --strictPort
```

Он обращается к API по адресу из константы `API_URL` в `src/core/context/AuthContext.jsx`: тот же хост, с которого открыта страница, порт 8090. Страница и API работают на разных портах, поэтому в API включён CORS: аннотация `@CrossOrigin` у `ChatController`.

| Слой | Что делает |
| --- | --- |
| `core/context/AuthContext.jsx` | Хранит токен и пользователя, отправляет запросы (`request`), выполняет `login`, `register`, `logout` |
| `core/routing/AppRouter.jsx` | Маршруты. `PrivateRoute` пускает только вошедших, с `adminOnly` только администратора |
| `ui/pages` | Страницы `/login`, `/register`, `/chat`, `/users` |
| `ui/components` | Части страниц без собственных запросов к API |

`ChatPage` и `UsersPage` запрашивают данные раз в 3 секунды, поэтому новые сообщения и блокировка появляются без перезагрузки.

Скрыть кнопку в интерфейсе недостаточно для защиты. Настоящая проверка прав находится в контракте: обратиться к нему в обход страницы и получить чужие права нельзя.

## 8. Пользователи и организации

В сети две организации, у каждой свой пир и свой центр сертификации:

| Организация | MSP | Кто в ней | Атрибут role |
| --- | --- | --- | --- |
| Admins | `AdminsMSP` | Администратор | `admin` |
| Users | `UsersMSP` | Все пользователи | `user` |

Пользователь сети — это сертификат и закрытый ключ. Появляется он в два шага:

```java
// 1. Регистрация: администратор CA заводит имя, пароль и атрибут
RegistrationRequest request = new RegistrationRequest(name);
request.setSecret(password);
request.setType("client");
request.setAffiliation("");
request.setMaxEnrollments(-1);
request.addAttribute(new Attribute("role", "user", true));
ca.register(request, registrar);

// 2. Выпуск сертификата: при неверном пароле CA вернёт ошибку
Enrollment enrollment = ca.enroll(name, password);
```

- Третий параметр `Attribute` (`ecert`) записывает атрибут в сертификат, откуда его читает контракт.
- `setMaxEnrollments(-1)` разрешает выпускать сертификат при каждом входе. Имя в нём остаётся прежним, поэтому контракт узнаёт пользователя.
- Администратор CA (`admin` / `adminpw`) создан Microfab и управляет только учётными записями в CA. Администратор системы — отдельная учётная запись `administrator`.

**Блокировка** работает на уровне контракта: `blockUser` меняет `status`, а `sendMessage` отклоняет заблокированного. Заблокированный пользователь может войти и читать чат, потому что в задании запрещена только отправка.

**Новая организация.** Добавьте её в `endorsing_organizations` и в список организаций канала в `MICROFAB_CONFIG`, допишите её в цикл деплоя и в `ORGS` в классе `Fabric`. При двух организациях для записи нужно одобрение обеих: правило по умолчанию требует большинства.

## 9. Как убедиться, что данные в блокчейне

Отправьте сообщение в интерфейсе и прочитайте последний блок прямо с пира, в обход API:

```bash
HOST=127-0-0-1.nip.io:9000
docker exec -e CORE_PEER_LOCALMSPID=UsersMSP -e CORE_PEER_ADDRESS=userspeer-api.$HOST \
  -e CORE_PEER_MSPCONFIGPATH=/home/microfab/data/admin-users chat-node sh -c "
  peer channel fetch newest /tmp/b.block -c chatchannel -o orderer-api.$HOST 2>/dev/null
  configtxlator proto_decode --type common.Block --input /tmp/b.block | jq -r '
    .data.data[0].payload.data.actions[0].payload.action.proposal_response_payload.extension.results.ns_rwset[]
    | select(.namespace==\"chat\") | .rwset.writes[] | .key + \" = \" + (.value | @base64d)'"
```

Ответ содержит ваше сообщение:

```
message:001793615071094:56eb71dc... = {"author":"ivan","time":"2026-11-02T10:24:31.094Z","text":"Я вернулся"}
```

Высота цепочки растёт с каждой записью и не меняется при чтении:

```bash
docker exec -e CORE_PEER_LOCALMSPID=UsersMSP -e CORE_PEER_ADDRESS=userspeer-api.$HOST \
  -e CORE_PEER_MSPCONFIGPATH=/home/microfab/data/admin-users chat-node peer channel getinfo -c chatchannel
```

## 10. Демонстрация

1. Откройте http://localhost:3006 и зарегистрируйте пользователя: имя `ivan`, пароль, адрес.
2. Отправьте сообщение. В чате видны автор, время и текст.
3. Выйдите и войдите как `administrator` / `admin123`.
4. На странице «Пользователи» заблокируйте `ivan`.
5. Войдите как `ivan`: появится предупреждение, формы отправки нет.
6. Войдите как администратор и разблокируйте `ivan`.
7. Войдите как `ivan` и снова отправьте сообщение.
8. Выполните команду из раздела 9 и покажите сообщение в блоке.

## 11. Типичные ошибки

| Симптом | Причина | Что сделать |
| --- | --- | --- |
| `Порт ... занят` | Порт интерфейса занят другой программой | `FRONT_PORT=3105 ./Start` |
| `port is already allocated` для 8090 | Порт API занят | Освободите порт или запущено другое решение: `docker rm -f chat-node` |
| Ошибка на `nip.io`, `no such host` | Нет интернета или DNS не отдаёт `nip.io` | Подключите интернет или смените DNS, например на `8.8.8.8` |
| `chaincode definition not agreed` | Одна из организаций не одобрила контракт | Повторите `approveformyorg` для обеих организаций с одинаковыми параметрами |
| `ProposalResponsePayloads do not match` | В контракте недетерминированный код | Уберите `Instant.now()`, `Math.random()` и подобное |
| `Could not find artifact ...everit...` при сборке | В `pom.xml` нет репозитория JitPack | Верните блок `repositories` с `https://jitpack.io` |
| `NoClassDefFoundError` про protobuf в API | Конфликт версий библиотек | Сохраните блок `dependencyManagement` в `api/pom.xml` |
| В журнале API строка `Повтор ...` с `RST_STREAM` | Прокси Microfab изредка обрывает запрос | API сам повторяет чтение и этап одобрения. Действий не требуется |
| `permission denied` при вызове `docker` | Пользователь не в группе `docker` | `sudo usermod -aG docker $USER`, затем войдите в систему заново |
| `$'\r': command not found` | Файлы получены с окончаниями строк Windows | Клонируйте репозиторий внутри Ubuntu или выполните `sed -i 's/\r$//' Start` |
| `docker` не найден в WSL | Не включена интеграция | Docker Desktop → Settings → Resources → WSL Integration |
| `Требуется вход в систему` после перезапуска | Сессии хранятся в памяти API | Войдите снова |
| После `./Start` пропали данные | `Start` создаёт контейнер заново | Это штатное поведение. Перезапускайте только API командой из раздела 6 |
