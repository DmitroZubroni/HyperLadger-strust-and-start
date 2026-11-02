'use strict';
/**
 * REST API. Браузер не работает с ключами: сервер хранит сертификат и закрытый
 * ключ пользователя в памяти на время сессии и подписывает транзакции сам.
 */
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const fabric = require('./fabric');

const PORT = Number(process.env.PORT) || 8090;
const app = express();
const sessions = new Map();           // токен -> { orgName, login, certificate, privateKey }

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function openSession(identity) {
    const token = crypto.randomUUID();
    sessions.set(token, identity);
    return token;
}

/** Обёртка: единая обработка ошибок всех маршрутов. */
const route = (handler) => async (req, res) => {
    try {
        res.json(await handler(req));
    } catch (err) {
        res.status(err.status || 400).json({ error: fabric.errorText(err) });
    }
};

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

/** Проверка токена: пользователь передаётся в req.identity. */
function auth(req, res, next) {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    req.identity = sessions.get(token);
    if (!req.identity) {
        return res.status(401).json({ error: 'Требуется вход в систему' });
    }
    req.token = token;
    return next();
}

// --- Пользователи ---

app.post('/api/register', route(async (req) => {
    const { login, password, fullName, experienceStartYear } = req.body;
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(login || '')) {
        throw httpError(400, 'Логин: от 3 до 32 латинских букв, цифр, _ или -');
    }
    if (!password || password.length < 6) {
        throw httpError(400, 'Пароль: не короче 6 символов');
    }
    if (!fullName || !String(fullName).trim()) {
        throw httpError(400, 'Не указано ФИО');
    }
    const year = Number(experienceStartYear);
    if (!Number.isInteger(year) || year < 1900 || year > new Date().getUTCFullYear()) {
        throw httpError(400, 'Некорректный год начала стажа');
    }
    // Роль задаёт сервер: самостоятельно можно стать только водителем.
    await fabric.registerIdentity('Users', login, password, 'driver').catch((err) => {
        throw /already registered/.test(err.message) ? httpError(409, `Логин ${login} уже занят`) : err;
    });
    const identity = await fabric.enroll('Users', login, password);
    await fabric.submit(identity, 'RegisterDriver', fullName, year);
    return { token: openSession(identity), org: 'Users', login };
}));

app.post('/api/login', route(async (req) => {
    const { org = 'Users', login, password } = req.body;
    if (!login || !password) {
        throw httpError(400, 'Укажите логин и пароль');
    }
    const identity = await fabric.enroll(org, login, password).catch((err) => {
        throw /Unknown organization|Неизвестная/.test(err.message) ? err : httpError(401, 'Неверный логин или пароль');
    });
    return { token: openSession(identity), org, login };
}));

app.post('/api/logout', auth, route(async (req) => {
    sessions.delete(req.token);
    return { ok: true };
}));

// --- Водитель ---

app.get('/api/me', auth, route((req) => fabric.evaluate(req.identity, 'GetMyProfile')));

app.post('/api/license', auth, route((req) => {
    const { number, expiresAt, category } = req.body;
    return fabric.submit(req.identity, 'AddLicense', number, expiresAt, category);
}));

app.post('/api/license/renew', auth, route((req) => fabric.submit(req.identity, 'RenewLicense')));

app.post('/api/vehicles', auth, route((req) => {
    const { category, marketValue, serviceLife } = req.body;
    return fabric.submit(req.identity, 'RegisterVehicle', category, marketValue, serviceLife);
}));

app.post('/api/fines/:id/pay', auth, route((req) => fabric.submit(req.identity, 'PayFine', req.params.id)));

// --- Сотрудник ДПС ---

app.post('/api/fines', auth, route((req) => fabric.submit(req.identity, 'IssueFine', req.body.licenseNumber)));

// --- Банк ---

app.get('/api/bank', auth, route((req) => fabric.evaluate(req.identity, 'GetBankAccount')));

app.listen(PORT, () => {
    console.log(`Интерфейс и API: http://localhost:${PORT}`);
});
