'use strict';
// Тесты контракта без сети: реестр и личность вызывающего подменены простыми объектами.
const test = require('node:test');
const assert = require('node:assert/strict');
const TrafficContract = require('../lib/trafficContract');

/** Мини-сеть в памяти: as(login, msp, role) возвращает контекст вызова. */
function ledger(startIso = '2026-11-02T12:00:00Z') {
    const state = new Map();
    let seconds = Date.parse(startIso) / 1000;
    let tx = 0;
    const contract = new TrafficContract();
    const as = (login, msp = 'UsersMSP', role = 'driver') => ({
        stub: {
            getState: async (key) => state.get(key) || Buffer.alloc(0),
            putState: async (key, value) => { state.set(key, value); },
            getTxTimestamp: () => ({ seconds, nanos: 0 }),
            getTxID: () => `tx${++tx}`,
        },
        clientIdentity: {
            getMSPID: () => msp,
            getID: () => `x509::/OU=client/CN=${login}::/C=US/O=ca`,
            getAttributeValue: (name) => (name === 'role' ? role : null),
        },
    });
    return { contract, as, advance: (s) => { seconds += s; }, setNow: (iso) => { seconds = Date.parse(iso) / 1000; } };
}

async function started(startIso) {
    const net = ledger(startIso);
    await net.contract.InitLedger(net.as('bank', 'BankMSP', 'bank'));
    return net;
}

const call = async (promise) => JSON.parse(await promise);
const profile = (net, login) => call(net.contract.GetMyProfile(net.as(login)));
const bank = (net) => call(net.contract.GetBankAccount(net.as('bank', 'BankMSP', 'bank')));
const lastMessage = (driver) => driver.messages.at(-1);

test('старт: банк 1000, водители по 50, стаж считается по году', async () => {
    const net = await started();
    assert.equal((await bank(net)).balance, 1000);
    const ivanov = await profile(net, 'ivanov');
    assert.equal(ivanov.balance, 50);
    assert.equal(ivanov.experienceYears, 2);
    assert.equal(ivanov.unpaidFines, 0);
    assert.equal(ivanov.license, null);
});

test('InitLedger: только банк и только один раз', async () => {
    const net = ledger();
    await assert.rejects(net.contract.InitLedger(net.as('ivanov')), /банка/);
    await net.contract.InitLedger(net.as('bank', 'BankMSP', 'bank'));
    await assert.rejects(net.contract.InitLedger(net.as('bank', 'BankMSP', 'bank')), /уже/);
});

test('доступ: роль и организация проверяются по сертификату', async () => {
    const net = await started();
    await assert.rejects(net.contract.IssueFine(net.as('petrov'), '111'), /ДПС/);
    await assert.rejects(net.contract.IssueFine(net.as('x', 'BankMSP', 'dps'), '111'), /ДПС/);
    await assert.rejects(net.contract.GetBankAccount(net.as('petrov')), /банка/);
    await assert.rejects(net.contract.GetMyProfile(net.as('bank', 'BankMSP', 'bank')), /Users/);
    await assert.rejects(net.contract.GetMyProfile(net.as('nobody')), /не зарегистрирован/);
});

test('сквозной сценарий демонстрации из задания', async () => {
    const net = await started();
    const { contract, as } = net;
    const dps = as('ivanov', 'UsersMSP', 'dps');

    await call(contract.RegisterDriver(as('romanov'), 'Романов Роман Романович', '2020'));
    await call(contract.RegisterDriver(as('dmitriev'), 'Дмитриев Дмитрий Дмитриевич', '2023'));
    assert.equal((await profile(net, 'romanov')).experienceYears, 6);

    assert.equal((await call(contract.AddLicense(as('dmitriev'), '111', '12.05.2025', 'B'))).ok, true);
    assert.equal((await call(contract.AddLicense(as('semenov'), '222', '09.09.2020', 'C'))).ok, true);

    assert.equal((await call(contract.AddLicense(as('petrov'), '222', '09.09.2020', 'C'))).ok, false);
    assert.match(lastMessage(await profile(net, 'petrov')).text, /закреплено/);
    assert.equal((await profile(net, 'petrov')).license, null);

    assert.equal((await call(contract.AddLicense(as('romanov'), '111', '12.05.2025', 'B'))).ok, false);
    assert.match(lastMessage(await profile(net, 'romanov')).text, /закреплено/);

    assert.equal((await call(contract.AddLicense(as('romanov'), '333', '13.02.2027', 'A'))).ok, true);
    assert.equal((await call(contract.AddLicense(as('petrov'), '444', '10.09.2020', 'B'))).ok, true);

    assert.equal((await call(contract.RegisterVehicle(as('petrov'), 'B', '1000', '3'))).ok, true);
    assert.equal((await profile(net, 'petrov')).vehicles.length, 1);
    assert.equal((await call(contract.RegisterVehicle(as('dmitriev'), 'B', '1000', '3'))).ok, true);

    assert.equal((await call(contract.RegisterVehicle(as('semenov'), 'A', '1000', '3'))).ok, false);
    assert.match(lastMessage(await profile(net, 'semenov')).text, /не совпадает/);
    assert.equal((await call(contract.RegisterVehicle(as('romanov'), 'C', '1000', '3'))).ok, false);
    assert.match(lastMessage(await profile(net, 'romanov')).text, /не совпадает/);

    await call(contract.IssueFine(dps, '111'));
    await call(contract.IssueFine(dps, '444'));
    const dmitrievFine = (await profile(net, 'dmitriev')).fines[0];
    const petrovFine = (await profile(net, 'petrov')).fines[0];
    assert.equal((await profile(net, 'dmitriev')).unpaidFines, 1);

    await call(contract.PayFine(as('dmitriev'), dmitrievFine.id));
    const dmitriev = await profile(net, 'dmitriev');
    assert.equal(dmitriev.balance, 45);
    assert.equal(dmitriev.unpaidFines, 0);
    assert.equal((await bank(net)).balance, 1005);

    await call(contract.PayFine(as('petrov'), petrovFine.id));
    assert.equal((await profile(net, 'petrov')).balance, 45);
    const account = await bank(net);
    assert.equal(account.balance, 1010);
    assert.equal(account.payments.length, 2);
});

test('удостоверение: неверные данные и повторное добавление', async () => {
    const net = await started();
    const petrov = net.as('petrov');
    assert.match((await call(net.contract.AddLicense(petrov, '999', '01.01.2030', 'A'))).message, /нет в базе/);
    assert.match((await call(net.contract.AddLicense(petrov, '555', '24.06.2029', 'A'))).message, /неверно/);
    assert.match((await call(net.contract.AddLicense(petrov, '555', '01.01.2029', 'C'))).message, /неверно/);
    assert.equal((await call(net.contract.AddLicense(petrov, '555', '24.06.2029', 'C'))).ok, true);
    assert.match((await call(net.contract.AddLicense(petrov, '666', '31.03.2030', 'A'))).message, /уже есть/);
});

test('штраф: граница скидки в 5 минут и повторная оплата', async () => {
    const net = await started();
    const { contract, as } = net;
    const dps = as('ivanov', 'UsersMSP', 'dps');
    await call(contract.AddLicense(as('petrov'), '444', '10.09.2020', 'B'));

    await call(contract.IssueFine(dps, '444'));
    net.advance(299);
    assert.equal((await profile(net, 'petrov')).fines[0].currentAmount, 5);
    net.advance(1);
    const fine = (await profile(net, 'petrov')).fines[0];
    assert.equal(fine.currentAmount, 10);
    await call(contract.PayFine(as('petrov'), fine.id));
    assert.equal((await profile(net, 'petrov')).balance, 40);
    assert.equal((await bank(net)).balance, 1010);

    const again = await call(contract.PayFine(as('petrov'), fine.id));
    assert.equal(again.ok, false);
    assert.equal((await profile(net, 'petrov')).balance, 40);
    assert.equal((await bank(net)).balance, 1010);

    await assert.rejects(contract.IssueFine(dps, '000'), /не закреплено/);
    await assert.rejects(contract.PayFine(as('petrov'), 'нет такого'), /не найден/);
});

test('штраф: не хватает денег, состояние счетов не меняется', async () => {
    const net = await started();
    const { contract, as } = net;
    const dps = as('ivanov', 'UsersMSP', 'dps');
    await call(contract.AddLicense(as('petrov'), '444', '10.09.2020', 'B'));
    for (let i = 0; i < 6; i++) {
        await call(contract.IssueFine(dps, '444'));
    }
    net.advance(600);
    const { fines } = await profile(net, 'petrov');
    for (const fine of fines.slice(0, 5)) {
        assert.equal((await call(contract.PayFine(as('petrov'), fine.id))).ok, true);
    }
    const result = await call(contract.PayFine(as('petrov'), fines[5].id));
    assert.equal(result.ok, false);
    assert.match(result.message, /недостаточно/);
    assert.equal((await profile(net, 'petrov')).balance, 0);
    assert.equal((await bank(net)).balance, 1050);
});

test('продление: срок и штрафы', async () => {
    const net = await started('2027-01-01T00:00:00Z');
    const { contract, as } = net;
    const romanov = as('petrov');
    await call(contract.AddLicense(romanov, '333', '13.02.2027', 'A'));

    assert.match((await call(contract.RenewLicense(romanov))).message, /больше месяца/);

    net.setNow('2027-01-13T00:00:00Z');
    await call(contract.IssueFine(as('ivanov', 'UsersMSP', 'dps'), '333'));
    assert.match((await call(contract.RenewLicense(romanov))).message, /неоплаченные/);

    const { fines } = await profile(net, 'petrov');
    await call(contract.PayFine(romanov, fines[0].id));
    assert.equal((await call(contract.RenewLicense(romanov))).ok, true);
    assert.equal((await profile(net, 'petrov')).license.expiresAt, '13.02.2037');
});

test('продление истёкших прав считается от текущей даты', async () => {
    const net = await started('2026-11-02T12:00:00Z');
    await call(net.contract.AddLicense(net.as('petrov'), '444', '10.09.2020', 'B'));
    assert.equal((await call(net.contract.RenewLicense(net.as('petrov')))).ok, true);
    assert.equal((await profile(net, 'petrov')).license.expiresAt, '02.11.2036');
});

test('регистрация: проверка данных и повторная попытка', async () => {
    const net = await started();
    await assert.rejects(net.contract.RegisterDriver(net.as('new'), '', '2020'), /ФИО/);
    await assert.rejects(net.contract.RegisterDriver(net.as('new'), 'Имя', '3000'), /стажа/);
    await assert.rejects(net.contract.RegisterDriver(net.as('petrov'), 'Имя', '2020'), /уже/);
    await assert.rejects(net.contract.RegisterDriver(net.as('x', 'BankMSP'), 'Имя', '2020'), /Users/);
});
