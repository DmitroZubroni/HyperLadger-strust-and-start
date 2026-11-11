# Модуль Б: как устроен код и как с ним работать

Путеводитель по коду: что в каком файле, как это написано, как запустить, создать пользователя, войти и добавить новую функцию. Описание задания, функций контракта и демонстрации — в [INSTRUCTION.md](INSTRUCTION.md).

## 1. Как всё связано

```
Браузер                      API                               Сеть Fabric
front/  ── POST /register ──►  backend/api.js  ── fabric-ca-client ──►  CA организации
(порт 3005)  POST /login        (порт 8091)
        ── GET и POST ──────►                  ── gRPC ──►  пир организации ──► backend/contract.js
           /contract/<функция>                                              (канал blockchain2025)
                 │
                 └─ заголовок Authorization: токен сессии
```

1. Регистрация: API создаёт пользователя в Fabric CA организации Users и записывает водителя в контракт.
2. Вход по имени и паролю: CA проверяет пароль и выдаёт сертификат и ключ. API держит их в памяти и возвращает токен сессии.
3. Фронт отправляет запросы с токеном: `GET`, чтобы прочитать данные, и `POST`, чтобы записать.
4. API подписывает транзакцию ключом пользователя, а контракт по сертификату узнаёт, кто его вызвал, и проверяет права.

## 2. Где что лежит

```
2025_B1/
├── Start1                         запуск всего: сеть, контракт, пользователи, API, фронт
├── INSTRUCTION.md                 задание, функции контракта, демонстрация
├── README.md                      этот файл
├── backend/                       эта папка целиком деплоится как контракт
│   ├── contract.js                смарт-контракт
│   ├── api.js                     REST API
│   └── package.json               dependencies — для контракта, devDependencies — для API
└── front/src/
    ├── main.jsx, App.jsx          точка входа: подключает контекст и маршруты
    ├── core/context.jsx           AtlantContext: кто вошёл, функции get и post
    ├── core/routing.jsx           маршруты: / и /func
    ├── ui/component/Header.jsx    верхнее меню
    ├── ui/component/Authorization.jsx   вход и регистрация водителя
    ├── ui/component/func/*.jsx    по форме на каждую функцию контракта
    ├── ui/pages/UserInfo.jsx      личный кабинет
    └── ui/pages/Function.jsx      вкладки с формами по ролям
```

Сама сеть лежит вне `2025_B1`: в `fabric-samples/test-network-2025`. Учётные записи пользователей хранит Fabric CA организации, а сертификат и ключ вошедшего пользователя — память API на время сессии.

## 3. Как написан контракт: `backend/contract.js`

Файл читается сверху вниз в таком порядке:

1. **Константы:** организации (`BANK_MSP`, `USERS_MSP`), суммы штрафа, срок скидки `DISCOUNT_MS` (5 дней задания = 5 минут), база удостоверений `LICENSES` и стартовые водители `DRIVERS`. Даты хранятся в формате ГГГГ-ММ-ДД: его понимает встроенный `Date`, а поле `<input type="date">` на сайте отдаёт именно его.
2. **Вспомогательные функции**, их нельзя вызвать из сети:

| Функция | Что делает |
| --- | --- |
| `read`, `write` | Читают и пишут JSON в реестр через `ctx.stub.getState` и `putState` |
| `callerLogin` | Имя вызывающего из сертификата (поле `CN`) |
| `isDps` | Сотрудник ДПС: организация Users и атрибут `role=dps`, проверка методом библиотеки `assertAttributeValue` |
| `currentDriver` | Запись водителя, который вызвал функцию |
| `answer` | Записывает сообщение водителю и возвращает `{ok, message}` |
| `fineAmount` | Сумма штрафа сейчас: 5 или 10 |

Время везде берётся из транзакции: `ctx.stub.getDateTimestamp()` возвращает обычный `Date`, одинаковый на всех пирах. `Date.now()` использовать нельзя: у пиров он разный.

3. **Класс `TrafficContract`:** каждый его метод — функция, доступная из сети. Список с параметрами — в разделе 5 [INSTRUCTION.md](INSTRUCTION.md).

### Что хранится в реестре

| Ключ | Значение |
| --- | --- |
| `bank` | `{balance, payments}` — счёт банка |
| `license:<номер>` | Удостоверение из базы и логин его владельца |
| `driver:<логин>` | Водитель: ФИО, стаж, баланс, удостоверение, ТС, штрафы, сообщения |

### Как устроена типичная функция

```js
async AddLicense(ctx, number, expiresAt, category) {
    const driver = await currentDriver(ctx);                 // кто вызвал, иначе ошибка
    const license = await read(ctx, 'license:' + number);    // читаем реестр
    if (!license) {
        return answer(ctx, driver, false, 'Отказ ДПС: ...'); // отказ: сообщение сохраняется
    }
    ...
    await write(ctx, 'license:' + number, license);          // пишем реестр
    return answer(ctx, driver, true, 'ДПС подтвердила ...'); // успех: сообщение и ответ
}
```

Есть два вида неудачи:

- **Отказ по правилам** (`answer` с `false`): чужое удостоверение, неверная категория. Транзакция проходит, сообщение остаётся у водителя в кабинете.
- **Ошибка** (`throw new Error`): нет прав, неверные данные. Транзакция отменяется, в реестр ничего не пишется.

## 4. Как написан API: `backend/api.js`

Три части, около 170 строк:

1. **Fabric CA.** `runCaClient` запускает утилиту `fabric-ca-client` от имени администратора CA организации. `register` создаёт учётную запись водителя с атрибутом `role=driver`. `login` выпускает сертификат во временную папку, читает его и ключ в память сессии, удаляет папку и возвращает токен.
2. **Контракт.** `grpcClient(org)` держит одно соединение с пиром на организацию. `callContract(type, token, method, args)` по токену находит сертификат и ключ пользователя, вызывает функцию и закрывает подключение.
3. **REST:**

```js
app.post('/register', ...)           // регистрация: CA + RegisterDriver, возвращает токен
app.post('/login', ...)              // вход: сначала Bank, потом Users, возвращает токен
app.get('/contract/:method', ...)    // чтение: callContract('evaluate', ...)
app.post('/contract/:method', ...)   // запись: callContract('submit', ...)
```

Новую функцию контракта API менять не нужно: её имя приходит в адресе. Пароль в журнал и в ответы не попадает: при ошибке CA API возвращает свой текст.

## 5. Как написан фронт: `front/src`

### Контекст: `core/context.jsx`

`AtlantContext` хранит, кто вошёл, и даёт всем страницам две функции:

| Что | Для чего |
| --- | --- |
| `user`, `token` | Имя вошедшего и токен его сессии |
| `isBank`, `isDps`, `isDriver` | Роли из контракта (`WhoAmI`): по ним показываются вкладки и личный кабинет |
| `login(name, password)` | Вход через API (`/login`), затем `WhoAmI` сообщает роли |
| `register(name, password, ФИО, год)` | Регистрация через API (`/register`) и сразу вход |
| `logout()` | Выход |
| `get(функция, [аргументы])` | Чтение. Возвращает данные или выбрасывает ошибку |
| `post(функция, [аргументы])` | Запись. Показывает уведомление: результат контракта или ошибку |

### Форма функции: `ui/component/func/*.jsx`

Все формы устроены одинаково: поле — `useState`, отправка — `post`:

```jsx
const IssueFine = () => {
    const { post } = useContext(AtlantContext);
    const [licenseNumber, setLicenseNumber] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();
        await post("IssueFine", [licenseNumber]);
    };

    return (
        <Form onSubmit={handleSubmit}>
            <h2>IssueFine</h2>
            <FormControl placeholder="Номер водительского удостоверения"
                         onChange={(e) => setLicenseNumber(e.target.value)} />
            <Button type="submit">Отправить</Button>
        </Form>
    );
};
```

### Страницы: `ui/pages`

- **`UserInfo.jsx`, маршрут `/`.** Если никто не вошёл, показывает вход и регистрацию. Иначе читает `GetBankAccount` для банка или `GetMyProfile` для водителя и выводит карточки. Кнопка «оплатить» у штрафа вызывает `post("PayFine", [id])` и блокируется до ответа, чтобы штраф не оплатили дважды.
- **`Function.jsx`, маршрут `/func`.** Вкладки `Tabs` по ролям: «Водитель» — если `isDriver`, «Сотрудник ДПС» — если `isDps`. На каждой вкладке — формы из `component/func`.

## 6. Запуск

Один раз установите окружение по разделу 1 [INSTRUCTION.md](INSTRUCTION.md). Затем из корня репозитория:

```bash
./2025_B1/Start1
```

Откройте http://localhost:3005. Остановка: `Ctrl+C`, затем `./network.sh down` в `fabric-samples/test-network-2025`.

По частям, если нужно перезапустить что-то одно:

```bash
cd 2025_B1/backend && node api.js           # только API
cd 2025_B1/front && npx vite --port 3005    # только фронт
```

## 7. Создать пользователя

**Водитель** — на сайте: страница входа → «регистрация водителя» → имя латиницей, пароль, ФИО, год начала стажа. Терминал не нужен.

**Сотрудник ДПС** — в терминале, потому что роль `dps` задаёт тот, кто создаёт пользователя. Из папки `fabric-samples/test-network-2025`:

```bash
NAME=sidorov PASSWORD=sidorovpw
export PATH=$PWD/../bin:$PATH
export FABRIC_CA_CLIENT_HOME=$PWD/organizations/peerOrganizations/users.example.com

fabric-ca-client register --caname ca-users --id.name $NAME --id.secret $PASSWORD --id.type client \
  --id.affiliation users.department1 --id.attrs "role=dps:ecert" \
  --tls.certfiles $PWD/organizations/fabric-ca/users/ca-cert.pem
```

Сертификат выпускать не нужно: его выдаст API при входе.

## 8. Войти и работать

1. Новый водитель: форма «регистрация водителя» на странице входа. После регистрации вход выполнится сам.
2. Уже зарегистрированный: имя и пароль в форме входа, например `petrov` / `petrovpw`.
3. Водитель: «функции» → «Водитель» → удостоверение, ТС, продление, оплата штрафа по ID.
4. Сотрудник ДПС (`ivanov` / `ivanovpw`): «функции» → «Сотрудник ДПС» → штраф по номеру удостоверения.
5. Банк (`admin` / `adminpw`): «личный кабинет» → баланс и поступления.

Результат каждого действия приходит уведомлением, а личный кабинет показывает данные из блокчейна. После действий нажмите «обновить».

| Ситуация | Что видно |
| --- | --- |
| Неверный пароль или несуществующее имя | «Неверное имя или пароль» |
| Регистрация с занятым именем | «Имя ... уже занято» |
| API перезапущен, а страница открыта | «Требуется вход»: войдите снова |
| Водитель пытается выписать штраф | «Доступ только для сотрудника ДПС» |

## 9. Как добавить новую функцию

Например, «водитель пополняет баланс»:

1. **Контракт.** В класс `TrafficContract` в `backend/contract.js` добавьте метод:

```js
async TopUp(ctx, amount) {
    const driver = await currentDriver(ctx);
    driver.balance += Number(amount);
    return answer(ctx, driver, true, 'Баланс пополнен на ' + amount);
}
```

2. **Деплой новой версии.** Из `fabric-samples/test-network-2025`, без `-cci`: `InitLedger` уже выполнен. Версию и sequence увеличивайте при каждом обновлении. Данные сохраняются.

```bash
./network.sh deployCC -c blockchain2025 -ccn traffic -ccp ../../2025_B1/backend -ccl javascript -ccv 2 -ccs 2
```

3. **API** менять не нужно.
4. **Форма.** Создайте `front/src/ui/component/func/TopUp.jsx` по образцу `IssueFine.jsx` с `post("TopUp", [amount])` и добавьте `<TopUp />` во вкладку «Водитель» в `ui/pages/Function.jsx`. Вкладка уже показывается только водителям.

Для функции, которая только читает данные, вместо формы используйте `get("ИмяФункции")` на странице, как `UserInfo.jsx` читает `GetMyProfile`.
