'use strict';
/**
 * REST API. Работает в контейнере рядом с нодой, страница из front/ обращается к нему из браузера.
 *
 * Пользователь сети — это сертификат и закрытый ключ. Их выпускает Fabric CA, он же
 * проверяет пароль. Браузер ключей не видит: сервер держит их в памяти на время сессии
 * и подписывает транзакции сам.
 */
const crypto = require('node:crypto');
const cors = require('cors');
const express = require('express');
const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const FabricCAServices = require('fabric-ca-client');
const { User } = require('fabric-common');

const DOMAIN = '127-0-0-1.nip.io:9000';      // Microfab различает сервисы по имени хоста
const ORGS = {
    Admins: { mspId: 'AdminsMSP', peer: `adminspeer-api.${DOMAIN}`, ca: `adminsca-api.${DOMAIN}`, caName: 'adminsca' },
    Users: { mspId: 'UsersMSP', peer: `userspeer-api.${DOMAIN}`, ca: `usersca-api.${DOMAIN}`, caName: 'usersca' },
};
const ADMIN = { name: 'administrator', password: 'admin123', address: 'Главный офис' };
const RESERVED_NAMES = new Set(['admin', ADMIN.name]);       // admin — служебная учётная запись CA

const sessions = new Map();      // токен -> { org, name, certificate, privateKey }

// --- Fabric CA: пользователи ---

const caClient = (org) => new FabricCAServices(`http://${ORGS[org].ca}`, undefined, ORGS[org].caName);

/** Выпуск сертификата. При неверном пароле CA вернёт ошибку: это и есть проверка входа. */
async function enroll(org, name, password) {
    const { certificate, key } = await caClient(org).enroll({ enrollmentID: name, enrollmentSecret: password });
    return { org, name, certificate, privateKey: key.toBytes() };
}

/** Регистрация в CA. Атрибут role попадает в сертификат, контракт читает его оттуда. */
async function register(org, name, password, role) {
    const caAdmin = await enroll(org, 'admin', 'adminpw');
    const registrar = User.createUser('admin', 'adminpw', ORGS[org].mspId, caAdmin.certificate, caAdmin.privateKey);
    await caClient(org).register({
        enrollmentID: name,
        enrollmentSecret: password,
        role: 'client',
        affiliation: '',
        maxEnrollments: -1,      // каждый вход выпускает новый сертификат
        attrs: [{ name: 'role', value: role, ecert: true }],
    }, registrar);
}

// --- Fabric Gateway: вызов смарт-контракта ---

const clients = new Map();      // одно gRPC-соединение на организацию

function grpcClient(org) {
    if (!clients.has(org.mspId)) {
        clients.set(org.mspId, new grpc.Client('localhost:9000', grpc.credentials.createInsecure(), {
            'grpc.default_authority': org.peer,
        }));
    }
    return clients.get(org.mspId);
}

function contractFor(identity) {
    const org = ORGS[identity.org];
    const gateway = connect({
        client: grpcClient(org),
        identity: { mspId: org.mspId, credentials: Buffer.from(identity.certificate) },
        signer: signers.newPrivateKeySigner(crypto.createPrivateKey(identity.privateKey)),
        hash: hash.SHA256,
    });
    return { contract: gateway.getNetwork('chatchannel').getContract('chat'), close: () => gateway.close() };
}

/**
 * Прокси Microfab изредка обрывает запрос (RST_STREAM). Повторять безопасно только чтение
 * и этап одобрения: транзакция ещё не ушла в блок, поэтому дубля не будет.
 */
const canRetry = (kind, err) => /RST_STREAM/.test(err.message) && (kind === 'read' || err.name === 'EndorseError');

/** Чтение: выполняется на пире, в блок не попадает. Запись: одобрение пирами, затем запись в блок. */
async function call(kind, identity, fn, ...args) {
    const { contract, close } = contractFor(identity);
    const method = kind === 'read' ? 'evaluateTransaction' : 'submitTransaction';
    try {
        for (let attempt = 1; ; attempt++) {
            try {
                return JSON.parse(Buffer.from(await contract[method](fn, ...args)).toString());
            } catch (err) {
                if (attempt === 3 || !canRetry(kind, err)) throw err;
                console.warn(`Повтор ${fn}: ${err.message}`);
            }
        }
    } finally {
        close();
    }
}

/** Текст ошибки контракта лежит в details ошибки Gateway. */
function errorText(err) {
    const detail = err.details && err.details[0] && err.details[0].message;
    return detail ? detail.replace(/^.*?chaincode response \d+, /, '') : err.message;
}

// --- REST API ---

const app = express();
app.use(cors());      // страница открыта с другого порта
app.use(express.json());

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

const route = (handler) => async (req, res) => {
    try {
        res.json(await handler(req));
    } catch (err) {
        res.status(err.status || 400).json({ error: errorText(err) });
    }
};

function auth(req, res, next) {
    req.token = (req.headers.authorization || '').replace(/^Bearer /, '');
    req.identity = sessions.get(req.token);
    return req.identity ? next() : res.status(401).json({ error: 'Требуется вход в систему' });
}

function openSession(identity) {
    const token = crypto.randomUUID();
    sessions.set(token, identity);
    return { token };
}

app.post('/api/register', route(async (req) => {
    const { name, password, address } = req.body;
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(name || '') || RESERVED_NAMES.has(name)) {
        throw httpError(400, 'Имя: от 3 до 32 латинских букв, цифр, _ или -. Это имя может быть занято');
    }
    if (!password || password.length < 6) {
        throw httpError(400, 'Пароль: не короче 6 символов');
    }
    if (!address || !String(address).trim()) {
        throw httpError(400, 'Не указан адрес');
    }
    // Роль задаёт сервер: самостоятельно можно стать только обычным пользователем.
    await register('Users', name, password, 'user').catch((err) => {
        throw /already registered/.test(err.message) ? httpError(409, `Имя ${name} уже занято`) : err;
    });
    const identity = await enroll('Users', name, password);
    await call('write', identity, 'RegisterUser', address);
    return openSession(identity);
}));

// Вход без выбора организации: имя ищется среди пользователей, затем среди администраторов.
app.post('/api/login', route(async (req) => {
    const { name, password } = req.body;
    for (const org of ['Users', 'Admins']) {
        try {
            return openSession(await enroll(org, name, password));
        } catch {
            // Следующая организация
        }
    }
    throw httpError(401, 'Неверное имя или пароль');
}));

app.post('/api/logout', auth, route(async (req) => {
    sessions.delete(req.token);
    return { ok: true };
}));

app.get('/api/me', auth, route((req) => call('read', req.identity, 'GetMe')));
app.get('/api/users', auth, route((req) => call('read', req.identity, 'GetUsers')));
app.post('/api/users/:name/block', auth, route((req) => call('write', req.identity, 'BlockUser', req.params.name)));
app.post('/api/users/:name/unblock', auth, route((req) => call('write', req.identity, 'UnblockUser', req.params.name)));
app.get('/api/messages', auth, route((req) => call('read', req.identity, 'GetMessages')));
app.post('/api/messages', auth, route((req) => call('write', req.identity, 'SendMessage', String(req.body.text ?? ''))));

/** Администратор существует с момента старта. Повторный запуск ничего не меняет. */
async function createAdmin() {
    await register('Admins', ADMIN.name, ADMIN.password, 'admin').catch((err) => {
        if (!/already registered/.test(err.message)) throw err;
    });
    const identity = await enroll('Admins', ADMIN.name, ADMIN.password);
    await call('write', identity, 'InitLedger', ADMIN.address).catch((err) => {
        if (!/уже инициализирован/.test(errorText(err))) throw err;
    });
}

createAdmin().then(() => {
    app.listen(8090, () => console.log('API: http://localhost:8090'));
}).catch((err) => {
    console.error('Не удалось создать администратора:', errorText(err));
    process.exit(1);
});
