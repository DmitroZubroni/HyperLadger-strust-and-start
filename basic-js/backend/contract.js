'use strict';
const { Contract } = require('fabric-contract-api');

const ADMIN_ORG = 'Org1MSP';   // администратор: готовый admin из CA организации Org1
const USERS_ORG = 'Org2MSP';   // пользователи регистрируются в организации Org2

// Имя вызывающего берётся из его сертификата (поле CN), подделать его нельзя
const callerName = (ctx) => /CN=([^/,]+)/.exec(ctx.clientIdentity.getID().split('::')[1])[1];
const isAdmin = (ctx) => ctx.clientIdentity.getMSPID() === ADMIN_ORG;

async function readUser(ctx, name) {
    const data = await ctx.stub.getState(`user:${name}`);
    return data.length ? JSON.parse(data.toString()) : null;
}

const writeUser = (ctx, user) => ctx.stub.putState(`user:${user.name}`, Buffer.from(JSON.stringify(user)));

// Все записи с данным началом ключа. Реестр отдаёт их отсортированными по ключу
async function readAll(ctx, prefix) {
    const items = [];
    for await (const { value } of ctx.stub.getStateByRange(`${prefix}:`, `${prefix};`)) {
        items.push(JSON.parse(value.toString()));
    }
    return items;
}

async function setStatus(ctx, name, status) {
    if (!isAdmin(ctx)) throw new Error('Доступ только для администратора');
    const user = await readUser(ctx, name);
    if (!user) throw new Error(`Пользователь ${name} не найден`);
    user.status = status;
    await writeUser(ctx, user);
    return JSON.stringify(user);
}

class UsersContract extends Contract {
    // Регистрация: имя берётся из сертификата, пароль хранит Fabric CA
    async RegisterUser(ctx, address) {
        if (ctx.clientIdentity.getMSPID() !== USERS_ORG) throw new Error('Пользователь должен быть из организации Org2');
        const name = callerName(ctx);
        if (await readUser(ctx, name)) throw new Error(`Имя ${name} уже занято`);
        const user = { name, address, status: 'active' };
        await writeUser(ctx, user);
        return JSON.stringify(user);
    }

    // Свои данные
    async GetMe(ctx) {
        if (isAdmin(ctx)) return JSON.stringify({ name: callerName(ctx), role: 'admin' });
        return JSON.stringify(await readUser(ctx, callerName(ctx)));
    }

    // Изменение своего адреса: заблокированному запрещено
    async UpdateAddress(ctx, address) {
        const user = await readUser(ctx, callerName(ctx));
        if (!user) throw new Error('Пользователь не зарегистрирован');
        if (user.status === 'blocked') throw new Error('Вы заблокированы и не можете менять данные');
        user.address = address;
        await writeUser(ctx, user);
        return JSON.stringify(user);
    }

    // Все пользователи: только для администратора
    async GetUsers(ctx) {
        if (!isAdmin(ctx)) throw new Error('Доступ только для администратора');
        return JSON.stringify(await readAll(ctx, 'user'));
    }

    // Сообщение в общий чат: автор из сертификата, время из транзакции, заблокированному запрещено
    async SendMessage(ctx, text) {
        const user = await readUser(ctx, callerName(ctx));
        if (!user) throw new Error('Писать могут только зарегистрированные пользователи');
        if (user.status === 'blocked') throw new Error('Вы заблокированы и не можете писать сообщения');
        const time = ctx.stub.getDateTimestamp();
        const message = { author: user.name, time: time.toISOString(), text };
        // Время в начале ключа выстраивает сообщения по порядку, ID транзакции делает ключ уникальным
        const key = `message:${String(time.getTime()).padStart(15, '0')}:${ctx.stub.getTxID()}`;
        await ctx.stub.putState(key, Buffer.from(JSON.stringify(message)));
        return JSON.stringify(message);
    }

    // Все сообщения по времени: их видят все участники
    async GetMessages(ctx) {
        return JSON.stringify(await readAll(ctx, 'message'));
    }

    async BlockUser(ctx, name) {
        return setStatus(ctx, name, 'blocked');
    }

    async UnblockUser(ctx, name) {
        return setStatus(ctx, name, 'active');
    }
}

module.exports.contracts = [UsersContract];
