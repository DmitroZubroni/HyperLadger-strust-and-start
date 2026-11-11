# Модуль Б: как устроен код и как с ним работать

Путеводитель по коду: что в каком файле, как это написано, как запустить, создать пользователя, войти и добавить новую функцию. Описание задания, функций контракта и демонстрации — в [INSTRUCTION.md](INSTRUCTION.md).

## 1. Как всё связано

```
Браузер                      API                          Сеть Fabric
front/  ── GET и POST ──►  backend/api.js  ── gRPC ──►  пир организации ──► backend/contract.js
(порт 3005)  /contract/<функция>   (порт 8091)                          (канал blockchain2025)
                 │
                 └─ заголовок Authorization: имя пользователя, например petrov@users.example.com
```

1. Пользователь входит на сайте по имени.
2. Фронт отправляет запрос в API: `GET`, если нужно прочитать данные, и `POST`, если записать.
3. API берёт сертификат и ключ этого пользователя из папки сети и вызывает функцию контракта от его имени.
4. Контракт по сертификату узнаёт, кто его вызвал, проверяет права и работает с реестром.

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

Сама сеть лежит вне `2025_B1`: в `fabric-samples/test-network-2025`. Пользователи сети — в `.../peerOrganizations/<организация>/users/<имя>@<организация>/msp`.

## 3. Как написан контракт: `backend/contract.js`

Файл читается сверху вниз в таком порядке:

1. **Константы:** организации (`BANK_MSP`, `USERS_MSP`), стоимость штрафа, срок скидки, `SECONDS_PER_GAME_DAY = 60` (1 день задания = 1 минута), база удостоверений `LICENSE_BASE` и стартовые водители `INITIAL_DRIVERS`.
2. **Вспомогательные функции**, их нельзя вызвать из сети:

| Функция | Что делает |
| --- | --- |
| `readJson`, `writeJson` | Читают и пишут JSON в реестр через `ctx.stub.getState` и `putState` |
| `txSeconds` | Время транзакции. Используется вместо `Date.now()`, чтобы все пиры получили одно значение |
| `callerLogin` | Имя вызывающего из сертификата (поле `CN`) |
| `requireBank`, `requireDps` | Проверки ролей: банк — организация Bank, ДПС — атрибут `role=dps` |
| `currentDriver` | Запись водителя, который вызвал функцию |
| `accept`, `reject` | Записывают сообщение водителю и возвращают `{ok: true или false, message}` |
| `fineAmount` | Сумма штрафа на текущий момент: 5 или 10 |

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
    const license = await readJson(ctx, licenseKey(number)); // читаем реестр
    if (!license) {
        return reject(ctx, driver, 'Отказ ДПС: ...');       // отказ: сообщение сохраняется
    }
    ...
    await writeJson(ctx, licenseKey(license.number), license); // пишем реестр
    return accept(ctx, driver, 'ДПС подтвердила ...');       // успех: сообщение и ответ
}
```

Есть два вида неудачи:

- **Отказ по правилам** (`reject`): чужое удостоверение, неверная категория. Транзакция проходит, сообщение остаётся у водителя в кабинете.
- **Ошибка** (`throw new Error`): нет прав, неверные данные. Транзакция отменяется, в реестр ничего не пишется.

## 4. Как написан API: `backend/api.js`

Две части, около 110 строк:

1. **Подключение к сети.** `grpcClient(org)` держит одно соединение с пиром на организацию. `callContract(type, user, method, args)` берёт организацию из имени (часть после `@`), читает сертификат и ключ пользователя, вызывает функцию и закрывает подключение.
2. **REST.** Два маршрута на все функции контракта:

```js
app.get('/contract/:method', ...)    // чтение: callContract('evaluate', ...)
app.post('/contract/:method', ...)   // запись: callContract('submit', ...)
```

Новую функцию контракта API менять не нужно: её имя приходит в адресе.

## 5. Как написан фронт: `front/src`

### Контекст: `core/context.jsx`

`AtlantContext` хранит, кто вошёл, и даёт всем страницам две функции:

| Что | Для чего |
| --- | --- |
| `user` | Полное имя вошедшего, например `petrov@users.example.com` |
| `isBank`, `isDps`, `isDriver` | Роли из контракта (`WhoAmI`): по ним показываются вкладки и личный кабинет |
| `login(name)` | Проверяет пользователя через `WhoAmI` и пускает только банк, сотрудника ДПС и зарегистрированного водителя |
| `register(name, ФИО, год)` | Регистрирует водителя (`RegisterDriver`) от имени `name` и сразу выполняет вход |
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

Из папки `fabric-samples/test-network-2025`:

```bash
NAME=romanov PASSWORD=romanovpw ROLE=driver          # сотрудник ДПС: ROLE=dps
export PATH=$PWD/../bin:$PATH
export FABRIC_CA_CLIENT_HOME=$PWD/organizations/peerOrganizations/users.example.com

# 1. Учётная запись в CA организации Users
fabric-ca-client register --caname ca-users --id.name $NAME --id.secret $PASSWORD --id.type client \
  --id.affiliation users.department1 --id.attrs "role=$ROLE:ecert" \
  --tls.certfiles $PWD/organizations/fabric-ca/users/ca-cert.pem

# 2. Сертификат и ключ в папку пользователей сети
fabric-ca-client enroll -u https://$NAME:$PASSWORD@localhost:8054 --caname ca-users \
  --tls.certfiles $PWD/organizations/fabric-ca/users/ca-cert.pem \
  -M $PWD/organizations/peerOrganizations/users.example.com/users/$NAME@users.example.com/msp
```

После этого пользователь сразу появляется в сети, API перезапускать не нужно. Водитель затем регистрируется на сайте (см. раздел 8), сотрудник ДПС может входить сразу.

## 8. Войти и работать

1. Новый водитель: на странице входа, форма «регистрация водителя» → имя `romanov@users.example.com`, ФИО, год начала стажа. После регистрации вход выполнится сам.
2. Уже зарегистрированный: в поле входа введите **полное** имя, например `romanov@users.example.com`. Пароль на сайте не нужен.
3. Водитель: «функции» → «Водитель» → удостоверение, ТС, продление, оплата штрафа по ID.
4. Сотрудник ДПС (`ivanov@users.example.com`): «функции» → «Сотрудник ДПС» → штраф по номеру удостоверения.
5. Банк (`Admin@bank.example.com`): «личный кабинет» → баланс и поступления.

Результат каждого действия приходит уведомлением, а личный кабинет показывает данные из блокчейна. После действий нажмите «обновить».

| Ситуация | Что видно |
| --- | --- |
| Ввели короткое или несуществующее имя | «Пользователь не найден», вход не выполняется |
| Пустое имя или пробелы | «введите имя пользователя» |
| Имя кириллицей | «Имя пользователя пишется латиницей» |
| Пользователь есть, но не зарегистрирован как водитель | Предложение зарегистрироваться, вход не выполняется |
| Водитель пытается выписать штраф | «Доступ только для сотрудника ДПС» |

## 9. Как добавить новую функцию

Например, «водитель пополняет баланс»:

1. **Контракт.** В класс `TrafficContract` в `backend/contract.js` добавьте метод:

```js
async TopUp(ctx, amount) {
    const driver = await currentDriver(ctx);
    driver.balance += Number(amount);
    return accept(ctx, driver, 'Баланс пополнен на ' + amount);
}
```

2. **Деплой новой версии.** Из `fabric-samples/test-network-2025`, без `-cci`: `InitLedger` уже выполнен. Версию и sequence увеличивайте при каждом обновлении. Данные сохраняются.

```bash
./network.sh deployCC -c blockchain2025 -ccn traffic -ccp ../../2025_B1/backend -ccl javascript -ccv 2 -ccs 2
```

3. **API** менять не нужно.
4. **Форма.** Создайте `front/src/ui/component/func/TopUp.jsx` по образцу `IssueFine.jsx` с `post("TopUp", [amount])` и добавьте `<TopUp />` во вкладку «Водитель» в `ui/pages/Function.jsx`. Вкладка уже показывается только водителям.

Для функции, которая только читает данные, вместо формы используйте `get("ИмяФункции")` на странице, как `UserInfo.jsx` читает `GetMyProfile`.
