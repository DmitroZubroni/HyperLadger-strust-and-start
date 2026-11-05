# Как устроена система

Локальная сеть Hyperledger Fabric 2.5 (`test-network`, запуск с флагом `-ca`). Команды для повседневной работы собраны в [COMMANDS.md](COMMANDS.md).

## 1. Организации, Fabric CA, пользователи, MSP и роли

Цвета на схемах: синий — организация и её MSP, жёлтый — Fabric CA, зелёный — пользователи, фиолетовый — узлы, красный — общий реестр.

```mermaid
flowchart TB
  CH[("Канал mychannel<br/>общий реестр и контракт")]:::ledger

  subgraph O1["Организация Org1 · MSP: Org1MSP"]
    CA1["Fabric CA ca-org1<br/>порт 7054"]:::ca
    A1["admin<br/>администратор приложения<br/>тип client"]:::person
    AD1["org1admin<br/>тип admin"]:::person
    U1["user1<br/>тип client"]:::person
    P1["peer0.org1<br/>порт 7051<br/>тип peer"]:::node_
    CA1 -->|выпускает сертификат| A1
    CA1 --> AD1
    CA1 --> U1
    CA1 --> P1
  end

  subgraph O2["Организация Org2 · MSP: Org2MSP"]
    CA2["Fabric CA ca-org2<br/>порт 8054"]:::ca
    A2["admin, org2admin, user1<br/>созданы при поднятии сети"]:::person
    U2["ivan, peter, andrey<br/>регистрируются в приложении<br/>тип client"]:::person
    P2["peer0.org2<br/>порт 9051<br/>тип peer"]:::node_
    CA2 --> A2
    CA2 -->|выпускает сертификат| U2
    CA2 --> P2
  end

  subgraph O3["Организация OrdererOrg · MSP: OrdererMSP"]
    CA3["Fabric CA ca-orderer<br/>порт 9054"]:::ca
    OR["orderer.example.com<br/>порт 7050<br/>собирает блоки"]:::node_
    CA3 --> OR
  end

  P1 --- CH
  P2 --- CH
  OR --- CH

  classDef org fill:#e8f1fb,stroke:#2f6db5,color:#12314f
  classDef ca fill:#fdf1dc,stroke:#c98a1b,color:#4a3208
  classDef person fill:#e6f5ea,stroke:#3b8f57,color:#14361f
  classDef node_ fill:#f0e9fa,stroke:#7650b5,color:#2b1b4a
  classDef ledger fill:#fbe8e8,stroke:#b84a4a,color:#4a1616
  class O1,O2,O3 org
```

| Понятие | Что это | Пример |
| --- | --- | --- |
| Организация | Участник сети со своими узлами и центром сертификации | Org2 |
| Fabric CA | Сервис организации: заводит пользователей и подписывает их сертификаты | `ca-org2` |
| Пользователь (identity) | Сертификат и закрытый ключ | `ivan` |
| MSP | Правила организации: каким центрам сертификации она доверяет и как определять тип участника | `Org2MSP` |

### Как сеть определяет пользователя

```mermaid
flowchart LR
  C["Сертификат ivan"]:::person
  C -->|кем выпущен| A["CA организации Org2"]:::ca
  A --> AR["Принадлежит Org2MSP"]:::org
  C -->|поле OU=client| B["Тип участника: client"]:::org
  C -->|поле CN=ivan| D["Имя: ivan"]:::org
  C -->|атрибут role=driver, если задан| E["Роль для нашего контракта"]:::org

  classDef org fill:#e8f1fb,stroke:#2f6db5,color:#12314f
  classDef ca fill:#fdf1dc,stroke:#c98a1b,color:#4a3208
  classDef person fill:#e6f5ea,stroke:#3b8f57,color:#14361f
  classDef node_ fill:#f0e9fa,stroke:#7650b5,color:#2b1b4a
  classDef ledger fill:#fbe8e8,stroke:#b84a4a,color:#4a1616
```

Роль бывает двух видов, их легко спутать:

| | Тип участника | Атрибут |
| --- | --- | --- |
| Как задаётся | `--id.type` | `--id.attrs 'role=driver:ecert'` |
| Где лежит | поле `OU` сертификата | расширение сертификата |
| Значения | `client`, `admin`, `peer`, `orderer` | любые, придумываем сами |
| Кто проверяет | сама сеть, по правилам MSP и политик | наш контракт |

| Тип | Для кого |
| --- | --- |
| `client` | Пользователи приложения: подписывают транзакции |
| `admin` | Администраторы организации |
| `peer` | Пиры, не для людей |
| `orderer` | Ордереры, не для людей |

### Как роль задана в нашем решении

| Кто | Организация | Как контракт его узнаёт |
| --- | --- | --- |
| Администратор приложения | Org1 | по организации: `Org1MSP` |
| Пользователь | Org2 | по организации и имени: `Org2MSP` и `CN` |

Статус `active` или `blocked` хранится не в сертификате, а в записи контракта `user:<имя>`.

## 2. Команды

Выполняются из папки `fabric-samples/test-network` на работающей сети.

### Подготовка

```bash
export PATH=$PWD/../bin:$PATH
export FABRIC_CA_CLIENT_HOME=$PWD/organizations/peerOrganizations/org2.example.com
export CA_CERT=$PWD/organizations/fabric-ca/org2/ca-cert.pem
```

`FABRIC_CA_CLIENT_HOME` указывает, от чьего имени работает утилита: здесь это администратор CA организации Org2.

### Создать пользователя с ролью

Шаг 1. Завести учётную запись. Тип задаёт `--id.type`, а роль для контракта задаёт атрибут с окончанием `:ecert`, благодаря которому он попадает в сертификат.

```bash
# Обычный пользователь с ролью driver
fabric-ca-client register --caname ca-org2 --id.name ivan --id.secret ivanpw \
  --id.type client --id.affiliation org2.department1 \
  --id.attrs 'role=driver:ecert' --tls.certfiles $CA_CERT

# Администратор организации с ролью manager
fabric-ca-client register --caname ca-org2 --id.name maria --id.secret mariapw \
  --id.type admin --id.affiliation org2.department1 \
  --id.attrs 'role=manager:ecert' --tls.certfiles $CA_CERT
```

Шаг 2. Выпустить сертификат и закрытый ключ.

```bash
fabric-ca-client enroll -u https://ivan:ivanpw@localhost:8054 --caname ca-org2 \
  --tls.certfiles $CA_CERT -M $PWD/wallet/ivan/msp
```

Шаг 3. Проверить результат.

```bash
fabric-ca-client identity list --id ivan --caname ca-org2 --tls.certfiles $CA_CERT
openssl x509 -in wallet/ivan/msp/signcerts/cert.pem -noout -subject
openssl x509 -in wallet/ivan/msp/signcerts/cert.pem -noout -text | grep -A1 '1.2.3.4.5.6.7.8.1'
```

Шаг 4. Прочитать роль в контракте. Наш контракт атрибут пока не использует, это пример на будущее.

```js
// JavaScript
const role = ctx.clientIdentity.getAttributeValue('role');
if (role !== 'manager') throw new Error('Доступ только для менеджера');
```

```java
// Java
String role = ctx.getClientIdentity().getAttributeValue("role");
if (!"manager".equals(role)) {
    throw new ChaincodeException("Доступ только для менеджера");
}
```

### Создать организацию

В `test-network` есть готовый скрипт для третьей организации Org3:

```bash
cd addOrg3
./addOrg3.sh up -ca
cd ..
docker ps | grep org3     # peer0.org3.example.com (порт 11051) и ca_org3 (порт 11054)
```

Скрипт создаёт CA и пир организации и подключает её к каналу. Контракт на её пир нужно установить отдельно, а пользователей регистрировать так же, как выше, через `ca-org3`.

Чтобы организации назывались иначе, например Bank и Users, используйте блок «Смена имён организаций» в [COMMANDS.md](COMMANDS.md).

## 3. Взаимодействие компонентов

```mermaid
flowchart TB
  B["Браузер: интерфейс на React<br/>порт 3005 (JS) или 3006 (Java)"]:::person
  API["API: Express или Spring Boot, порт 8091<br/>хранит сертификаты и ключи вошедших"]:::org
  CA["Fabric CA организаций<br/>пользователи и сертификаты"]:::ca

  B -->|HTTP и JSON| API
  API -->|"fabric-ca-client, HTTPS"| CA
  API -->|"Fabric Gateway, gRPC и TLS<br/>подпись ключом пользователя"| P1

  subgraph NET["Сеть Fabric в Docker"]
    P1["Пир Org1"]:::node_
    P2["Пир Org2"]:::node_
    C1["Контейнер контракта"]:::node_
    C2["Контейнер контракта"]:::node_
    L1[("Реестр")]:::ledger
    L2[("Реестр")]:::ledger
    OR["Ордерер"]:::node_
    P1 <--> C1
    P2 <--> C2
    P1 --- L1
    P2 --- L2
    P1 <-->|одобрения| P2
    P1 -->|транзакция| OR
    OR -->|блоки| P1
    OR -->|блоки| P2
  end

  classDef org fill:#e8f1fb,stroke:#2f6db5,color:#12314f
  classDef ca fill:#fdf1dc,stroke:#c98a1b,color:#4a3208
  classDef person fill:#e6f5ea,stroke:#3b8f57,color:#14361f
  classDef node_ fill:#f0e9fa,stroke:#7650b5,color:#2b1b4a
  classDef ledger fill:#fbe8e8,stroke:#b84a4a,color:#4a1616
```

На схеме API подключён к пиру Org1, а пользователи Org2 работают так же через пир своей организации.

### Чтение: `GetMe`

Блок не создаётся, поэтому высота цепочки не меняется.

```mermaid
sequenceDiagram
  actor U as Браузер
  participant A as API
  participant P as Пир своей организации
  participant C as Контракт
  participant L as Реестр
  U->>A: POST /evaluate/GetMe с токеном
  A->>P: Запрос, подписанный ключом ivan
  P->>C: Выполнить GetMe
  C->>L: Прочитать user:ivan
  L-->>C: Данные
  C-->>P: Результат
  P-->>A: Результат
  A-->>U: JSON с данными
```

### Запись: `UpdateAddress`

Подтверждение нужно от обеих организаций: по умолчанию действует правило большинства, а их в канале две.

```mermaid
sequenceDiagram
  actor U as Браузер
  participant A as API
  participant P2 as Пир Org2 с Gateway
  participant P1 as Пир Org1
  participant O as Ордерер
  U->>A: POST /submit/UpdateAddress с токеном
  A->>P2: Транзакция, подписанная ключом ivan
  Note over P2,P1: Одобрение: контракт выполняется,<br/>реестр пока не меняется
  P2->>P2: Выполнить контракт и подписать результат
  P2->>P1: Запросить одобрение
  P1-->>P2: Результат с подписью
  P2->>O: Транзакция с подписями пиров
  O->>P1: Новый блок
  O->>P2: Новый блок
  Note over P1,P2: Проверка подписей и конфликтов,<br/>запись блока и обновление реестра
  P2-->>A: Транзакция записана
  A-->>U: Результат
```

### Регистрация: откуда берётся новый пользователь

Пароль остаётся в CA и в блокчейн не попадает.

```mermaid
sequenceDiagram
  actor U as Браузер
  participant A as API
  participant CA as Fabric CA Org2
  participant N as Сеть и контракт
  U->>A: POST /register: имя, пароль, адрес
  A->>CA: register: создать учётную запись
  CA-->>A: Готово
  A->>CA: enroll: выпустить сертификат
  CA-->>A: Сертификат и закрытый ключ ivan
  A->>N: RegisterUser, подпись ключом ivan
  Note over N: Контракт берёт имя из сертификата<br/>и сохраняет user:ivan
  N-->>A: Запись создана
  A-->>U: Токен сессии
```

### Где что хранится

| Данные | Где |
| --- | --- |
| Учётные записи и пароли | База Fabric CA |
| Сертификаты и ключи организаций и узлов | `test-network/organizations` |
| Сертификаты и ключи вошедших пользователей | Память API, после его перезапуска нужно войти снова |
| Записи `user:<имя>` и история транзакций | Реестр на пирах |
| Токен сессии | Память браузера |

После `./network.sh down` и нового запуска сети сертификаты другие, поэтому перезапускайте и API.
