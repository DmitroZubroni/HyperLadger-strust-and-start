'use strict';
// Тесты контракта без сети: реестр и личность вызывающего подменены простыми объектами.
const test = require('node:test');
const assert = require('node:assert/strict');
const ChatContract = require('./contract');

function ledger() {
    const state = new Map();
    let millis = Date.parse('2026-11-02T12:00:00.250Z');
    let tx = 0;
    const contract = new ChatContract();
    const as = (name, msp = 'UsersMSP', role = 'user') => ({
        stub: {
            getState: async (key) => state.get(key) || Buffer.alloc(0),
            putState: async (key, value) => { state.set(key, value); },
            getTxTimestamp: () => ({ seconds: Math.floor(millis / 1000), nanos: (millis % 1000) * 1e6 }),
            getTxID: () => `tx${++tx}`,
            getStateByRange: async (start, end) => {
                const keys = [...state.keys()].filter((k) => k >= start && k < end).sort();
                let i = 0;
                return {
                    next: async () => (i < keys.length ? { done: false, value: { value: state.get(keys[i++]) } } : { done: true }),
                    close: async () => {},
                };
            },
        },
        clientIdentity: {
            getMSPID: () => msp,
            getID: () => `x509::/OU=client/CN=${name}::/C=US/O=ca`,
            getAttributeValue: (attr) => (attr === 'role' ? role : null),
        },
    });
    return { contract, as, admin: as('admin', 'AdminsMSP', 'admin'), advance: (ms) => { millis += ms; } };
}

async function started() {
    const net = ledger();
    await net.contract.InitLedger(net.admin, 'Главный офис');
    return net;
}

const json = async (promise) => JSON.parse(await promise);

test('администратор существует после старта, повторная инициализация запрещена', async () => {
    const net = await started();
    const me = await json(net.contract.GetMe(net.admin));
    assert.equal(me.role, 'admin');
    assert.equal(me.status, 'active');
    await assert.rejects(net.contract.InitLedger(net.admin, 'x'), /уже/);
});

test('инициализировать реестр может только администратор', async () => {
    const net = ledger();
    await assert.rejects(net.contract.InitLedger(net.as('ivan'), 'x'), /администратора/);
    await assert.rejects(net.contract.InitLedger(net.as('ivan', 'AdminsMSP', 'user'), 'x'), /администратора/);
});

test('регистрация: имя из сертификата, новый пользователь активен', async () => {
    const net = await started();
    const user = await json(net.contract.RegisterUser(net.as('ivan'), ' Москва '));
    assert.deepEqual(user, { name: 'ivan', address: 'Москва', role: 'user', org: 'UsersMSP', status: 'active' });
});

test('регистрация: занятое имя, пустой адрес, чужая организация', async () => {
    const net = await started();
    await net.contract.RegisterUser(net.as('ivan'), 'Москва');
    await assert.rejects(net.contract.RegisterUser(net.as('ivan'), 'Тула'), /занято/);
    await assert.rejects(net.contract.RegisterUser(net.as('admin'), 'Тула'), /занято/);
    await assert.rejects(net.contract.RegisterUser(net.as('petr'), '  '), /адрес/);
    await assert.rejects(net.contract.RegisterUser(net.as('petr', 'AdminsMSP'), 'Тула'), /Users/);
});

test('сообщение содержит автора, время транзакции и текст', async () => {
    const net = await started();
    await net.contract.RegisterUser(net.as('ivan'), 'Москва');
    const message = await json(net.contract.SendMessage(net.as('ivan'), 'Привет'));
    assert.deepEqual(message, { author: 'ivan', time: '2026-11-02T12:00:00.250Z', text: 'Привет' });
});

test('сообщения идут по времени', async () => {
    const net = await started();
    await net.contract.RegisterUser(net.as('ivan'), 'Москва');
    await net.contract.SendMessage(net.as('ivan'), 'первое');
    net.advance(1000);
    await net.contract.SendMessage(net.admin, 'второе');
    const messages = await json(net.contract.GetMessages(net.as('ivan')));
    assert.deepEqual(messages.map((m) => [m.author, m.text]), [['ivan', 'первое'], ['admin', 'второе']]);
});

test('блокировка запрещает отправку, разблокировка возвращает её', async () => {
    const net = await started();
    const ivan = net.as('ivan');
    await net.contract.RegisterUser(ivan, 'Москва');
    assert.equal((await json(net.contract.BlockUser(net.admin, 'ivan'))).status, 'blocked');
    await assert.rejects(net.contract.SendMessage(ivan, 'спам'), /заблокированы/);
    assert.equal((await json(net.contract.GetMessages(ivan))).length, 0);
    assert.equal((await json(net.contract.UnblockUser(net.admin, 'ivan'))).status, 'active');
    await net.contract.SendMessage(ivan, 'снова в чате');
    assert.equal((await json(net.contract.GetMessages(ivan))).length, 1);
});

test('управлять пользователями может только администратор', async () => {
    const net = await started();
    const ivan = net.as('ivan');
    await net.contract.RegisterUser(ivan, 'Москва');
    await net.contract.RegisterUser(net.as('petr'), 'Тула');
    await assert.rejects(net.contract.BlockUser(ivan, 'petr'), /администратора/);
    await assert.rejects(net.contract.UnblockUser(ivan, 'petr'), /администратора/);
    await assert.rejects(net.contract.GetUsers(ivan), /администратора/);
    // Поддельная роль в чужой организации не помогает
    await assert.rejects(net.contract.BlockUser(net.as('ivan', 'UsersMSP', 'admin'), 'petr'), /администратора/);
    assert.equal((await json(net.contract.GetUsers(net.admin))).length, 3);
});

test('нельзя заблокировать администратора и несуществующего пользователя', async () => {
    const net = await started();
    await assert.rejects(net.contract.BlockUser(net.admin, 'admin'), /нельзя/);
    await assert.rejects(net.contract.BlockUser(net.admin, 'nobody'), /не найден/);
});

test('незарегистрированный не читает и не пишет; пустой и длинный текст отклоняются', async () => {
    const net = await started();
    await assert.rejects(net.contract.GetMessages(net.as('ghost')), /не зарегистрирован/);
    await assert.rejects(net.contract.SendMessage(net.as('ghost'), 'x'), /не зарегистрирован/);
    await net.contract.RegisterUser(net.as('ivan'), 'Москва');
    await assert.rejects(net.contract.SendMessage(net.as('ivan'), '   '), /пустым/);
    await assert.rejects(net.contract.SendMessage(net.as('ivan'), 'x'.repeat(1001)), /длиннее/);
});

test('сертификат другой организации с тем же именем не даёт доступа к записи', async () => {
    const net = await started();
    await net.contract.RegisterUser(net.as('ivan'), 'Москва');
    await assert.rejects(net.contract.SendMessage(net.as('ivan', 'AdminsMSP'), 'x'), /не зарегистрирован/);
});
