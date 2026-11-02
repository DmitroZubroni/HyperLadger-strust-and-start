'use strict';
/**
 * Смарт-контракт общего чата.
 *
 * Правила, которые определяют устройство кода:
 * 1. Кто вызывает функцию, определяется по сертификату: организация (MSP),
 *    имя (CN) и роль (атрибут role). Параметрам запроса контракт не доверяет.
 * 2. Время берётся из ctx.stub.getTxTimestamp(). Date.now() дал бы на разных
 *    пирах разные значения, и транзакция не прошла бы проверку.
 * 3. Каждое сообщение лежит под своим ключом. С общим списком сообщений
 *    одновременные отправки конфликтовали бы между собой (MVCC).
 * 4. Пароль в реестр не попадает: он хранится в Fabric CA.
 */
const { Contract } = require('fabric-contract-api');

const ADMINS_MSP = 'AdminsMSP';
const USERS_MSP = 'UsersMSP';
const ROLE_ADMIN = 'admin';
const ROLE_USER = 'user';
const ACTIVE = 'active';
const BLOCKED = 'blocked';
const MAX_TEXT_LENGTH = 1000;

const userKey = (name) => `user:${name}`;

/** Время транзакции в миллисекундах. Одинаково на всех пирах. */
function txMillis(ctx) {
    const { seconds, nanos } = ctx.stub.getTxTimestamp();
    const whole = typeof seconds.toNumber === 'function' ? seconds.toNumber() : Number(seconds);
    return whole * 1000 + Math.floor(nanos / 1e6);
}

async function readJson(ctx, key) {
    const bytes = await ctx.stub.getState(key);
    return bytes && bytes.length > 0 ? JSON.parse(Buffer.from(bytes).toString('utf8')) : null;
}

async function writeJson(ctx, key, value) {
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(value)));
}

/** Все записи с ключами от start до end. Реестр отдаёт их отсортированными по ключу. */
async function readRange(ctx, start, end) {
    const iterator = await ctx.stub.getStateByRange(start, end);
    const items = [];
    let next = await iterator.next();
    while (!next.done) {
        items.push(JSON.parse(Buffer.from(next.value.value).toString('utf8')));
        next = await iterator.next();
    }
    await iterator.close();
    return items;
}

/** Имя вызывающего: поле CN его сертификата. */
function callerName(ctx) {
    const match = /CN=([^/:,]+)/.exec(ctx.clientIdentity.getID());
    if (!match) {
        throw new Error('В сертификате не найден CN');
    }
    return match[1];
}

function requireAdmin(ctx) {
    if (ctx.clientIdentity.getMSPID() !== ADMINS_MSP || ctx.clientIdentity.getAttributeValue('role') !== ROLE_ADMIN) {
        throw new Error('Доступ только для администратора');
    }
}

/** Запись вызывающего. Организация записи должна совпадать с организацией сертификата. */
async function currentUser(ctx) {
    const name = callerName(ctx);
    const user = await readJson(ctx, userKey(name));
    if (!user || user.org !== ctx.clientIdentity.getMSPID()) {
        throw new Error(`Пользователь ${name} не зарегистрирован`);
    }
    return user;
}

async function setStatus(ctx, name, status) {
    requireAdmin(ctx);
    const user = await readJson(ctx, userKey(name));
    if (!user) {
        throw new Error(`Пользователь ${name} не найден`);
    }
    if (user.role === ROLE_ADMIN) {
        throw new Error('Администратора нельзя заблокировать');
    }
    user.status = status;
    await writeJson(ctx, userKey(name), user);
    return JSON.stringify(user);
}

class ChatContract extends Contract {
    constructor() {
        super('chat');
    }

    /**
     * Создаёт запись администратора. Вызывается один раз самим администратором.
     * @param {string} address адрес администратора
     * @returns {string} JSON записи администратора
     */
    async InitLedger(ctx, address) {
        requireAdmin(ctx);
        const name = callerName(ctx);
        if (await readJson(ctx, userKey(name))) {
            throw new Error('Реестр уже инициализирован');
        }
        const admin = { name, address, role: ROLE_ADMIN, org: ADMINS_MSP, status: ACTIVE };
        await writeJson(ctx, userKey(name), admin);
        return JSON.stringify(admin);
    }

    /**
     * Регистрация пользователя. Имя берётся из сертификата, пароль проверяет Fabric CA.
     * @param {string} address адрес пользователя
     * @returns {string} JSON записи пользователя
     */
    async RegisterUser(ctx, address) {
        if (ctx.clientIdentity.getMSPID() !== USERS_MSP) {
            throw new Error('Пользователь должен принадлежать организации Users');
        }
        const name = callerName(ctx);
        if (await readJson(ctx, userKey(name))) {
            throw new Error(`Имя ${name} уже занято`);
        }
        const cleanAddress = String(address).trim();
        if (!cleanAddress) {
            throw new Error('Не указан адрес');
        }
        const user = { name, address: cleanAddress, role: ROLE_USER, org: USERS_MSP, status: ACTIVE };
        await writeJson(ctx, userKey(name), user);
        return JSON.stringify(user);
    }

    /**
     * Данные вызывающего пользователя.
     * @returns {string} JSON { name, address, role, org, status }
     */
    async GetMe(ctx) {
        return JSON.stringify(await currentUser(ctx));
    }

    /**
     * Список всех пользователей. Только для администратора.
     * @returns {string} JSON-массив записей пользователей
     */
    async GetUsers(ctx) {
        requireAdmin(ctx);
        return JSON.stringify(await readRange(ctx, 'user:', 'user;'));
    }

    /**
     * Заблокировать пользователя. Только для администратора.
     * @param {string} name имя пользователя
     * @returns {string} JSON обновлённой записи
     */
    async BlockUser(ctx, name) {
        return setStatus(ctx, name, BLOCKED);
    }

    /**
     * Разблокировать пользователя. Только для администратора.
     * @param {string} name имя пользователя
     * @returns {string} JSON обновлённой записи
     */
    async UnblockUser(ctx, name) {
        return setStatus(ctx, name, ACTIVE);
    }

    /**
     * Отправить сообщение в общий чат. Только для активного пользователя.
     * @param {string} text текст сообщения
     * @returns {string} JSON сообщения { author, time, text }
     */
    async SendMessage(ctx, text) {
        const user = await currentUser(ctx);
        if (user.status !== ACTIVE) {
            throw new Error('Вы заблокированы и не можете отправлять сообщения');
        }
        const cleanText = String(text).trim();
        if (!cleanText) {
            throw new Error('Сообщение не может быть пустым');
        }
        if (cleanText.length > MAX_TEXT_LENGTH) {
            throw new Error(`Сообщение длиннее ${MAX_TEXT_LENGTH} символов`);
        }
        const millis = txMillis(ctx);
        const message = { author: user.name, time: new Date(millis).toISOString(), text: cleanText };
        // Время в начале ключа выстраивает сообщения по порядку, ID транзакции делает ключ уникальным.
        const key = `message:${String(millis).padStart(15, '0')}:${ctx.stub.getTxID()}`;
        await writeJson(ctx, key, message);
        return JSON.stringify(message);
    }

    /**
     * Все сообщения чата по времени. Для любого зарегистрированного пользователя.
     * @returns {string} JSON-массив сообщений { author, time, text }
     */
    async GetMessages(ctx) {
        await currentUser(ctx);
        return JSON.stringify(await readRange(ctx, 'message:', 'message;'));
    }
}

// Fabric загружает контракты из этого массива.
module.exports = ChatContract;
module.exports.contracts = [ChatContract];
