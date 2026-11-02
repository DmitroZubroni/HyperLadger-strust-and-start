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

    // Все пользователи: только для администратора
    async GetUsers(ctx) {
        if (!isAdmin(ctx)) throw new Error('Доступ только для администратора');
        const users = [];
        for await (const { value } of ctx.stub.getStateByRange('user:', 'user;')) {
            users.push(JSON.parse(value.toString()));
        }
        return JSON.stringify(users);
    }

    async BlockUser(ctx, name) {
        return setStatus(ctx, name, 'blocked');
    }

    async UnblockUser(ctx, name) {
        return setStatus(ctx, name, 'active');
    }
}

module.exports.contracts = [UsersContract];
