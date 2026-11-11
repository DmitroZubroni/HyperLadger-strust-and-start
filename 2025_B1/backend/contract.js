'use strict';
/**
 * Смарт-контракт «Безопасное дорожное движение».
 *
 * Как устроен:
 * 1. Кто вызвал функцию, контракт узнаёт по сертификату: организация (MSP), имя (CN)
 *    и роль (атрибут role). Параметрам запроса контракт не доверяет.
 * 2. Время берётся из транзакции: ctx.stub.getDateTimestamp(). Date.now() дал бы на разных
 *    пирах разные значения, и транзакция не прошла бы проверку.
 * 3. Отказ по правилам задания (чужое удостоверение, неверная категория) записывается в
 *    сообщения водителя и возвращается как { ok: false }: транзакция проходит, сообщение
 *    сохраняется. Нарушение доступа — исключение, тогда в реестр ничего не пишется.
 * 4. Даты хранятся в формате ГГГГ-ММ-ДД, его понимает встроенный Date.
 */
const { Contract } = require('fabric-contract-api');

const BANK_MSP = 'BankMSP';
const USERS_MSP = 'UsersMSP';

const START_BANK_BALANCE = 1000;
const START_DRIVER_BALANCE = 50;
const FINE = 10;
const FINE_WITH_DISCOUNT = 5;
const DISCOUNT_MS = 5 * 60 * 1000;   // 5 дней задания, 1 день = 1 минута
const RENEWAL_YEARS = 10;            // срок продления в задании не задан, как у настоящих прав

// Таблица 1 задания: база водительских удостоверений
const LICENSES = [
    { number: '000', expiresAt: '2021-01-11', category: 'A' },
    { number: '111', expiresAt: '2025-05-12', category: 'B' },
    { number: '222', expiresAt: '2020-09-09', category: 'C' },
    { number: '333', expiresAt: '2027-02-13', category: 'A' },
    { number: '444', expiresAt: '2020-09-10', category: 'B' },
    { number: '555', expiresAt: '2029-06-24', category: 'C' },
    { number: '666', expiresAt: '2030-03-31', category: 'A' },
];

// Водители при старте системы: логин, ФИО и стаж в годах
const DRIVERS = [
    { login: 'ivanov', fullName: 'Иванов Иван Иванович', experience: 2 },
    { login: 'semenov', fullName: 'Семенов Семен Семенович', experience: 5 },
    { login: 'petrov', fullName: 'Петров Петр Петрович', experience: 10 },
];


// ===== Вспомогательные функции: из сети не вызываются =====

async function read(ctx, key) {
    const data = await ctx.stub.getState(key);
    if (data.length === 0) {
        return null;
    }
    return JSON.parse(data.toString());
}

async function write(ctx, key, value) {
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(value)));
}

// Имя вызывающего: поле CN его сертификата
function callerLogin(ctx) {
    return /CN=([^/:,]+)/.exec(ctx.clientIdentity.getID())[1];
}

function isDps(ctx) {
    return ctx.clientIdentity.getMSPID() === USERS_MSP && ctx.clientIdentity.assertAttributeValue('role', 'dps');
}

// Водитель, который вызвал функцию
async function currentDriver(ctx) {
    const driver = await read(ctx, 'driver:' + callerLogin(ctx));
    if (!driver || ctx.clientIdentity.getMSPID() !== USERS_MSP) {
        throw new Error('Вы не зарегистрированы как водитель');
    }
    return driver;
}

// Сохраняет сообщение в кабинете водителя и возвращает ответ { ok, message }
async function answer(ctx, driver, ok, text) {
    driver.messages.push({ at: ctx.stub.getDateTimestamp().toISOString(), ok: ok, text: text });
    await write(ctx, 'driver:' + driver.login, driver);
    return JSON.stringify({ ok: ok, message: text });
}

// Сумма штрафа сейчас: со скидкой в первые 5 дней
function fineAmount(ctx, fine) {
    const passed = ctx.stub.getDateTimestamp() - new Date(fine.issuedAt);
    if (passed < DISCOUNT_MS) {
        return FINE_WITH_DISCOUNT;
    }
    return FINE;
}


class TrafficContract extends Contract {
    constructor() {
        super('traffic');
    }

    /**
     * Начальное заполнение: счёт банка, база удостоверений, стартовые водители.
     * Вызывается один раз при деплое: deployCC -cci InitLedger.
     * @returns {string} JSON { ok, message }
     */
    async InitLedger(ctx) {
        if (await read(ctx, 'bank')) {
            throw new Error('Реестр уже инициализирован');
        }
        await write(ctx, 'bank', { balance: START_BANK_BALANCE, payments: [] });
        for (const license of LICENSES) {
            license.owner = null;
            await write(ctx, 'license:' + license.number, license);
        }
        const year = ctx.stub.getDateTimestamp().getFullYear();
        for (const driver of DRIVERS) {
            await write(ctx, 'driver:' + driver.login, {
                login: driver.login,
                fullName: driver.fullName,
                experienceStartYear: year - driver.experience,
                balance: START_DRIVER_BALANCE,
                license: null,
                vehicles: [],
                fines: [],
                messages: [],
            });
        }
        return JSON.stringify({ ok: true, message: 'Реестр заполнен' });
    }

    /**
     * Регистрация водителя. Логин берётся из сертификата.
     * @param {string} fullName ФИО
     * @param {string} experienceStartYear год начала водительского стажа
     * @returns {string} JSON { ok, message }
     */
    async RegisterDriver(ctx, fullName, experienceStartYear) {
        const login = callerLogin(ctx);
        if (ctx.clientIdentity.getMSPID() !== USERS_MSP) {
            throw new Error('Водитель должен быть из организации Users');
        }
        if (await read(ctx, 'driver:' + login)) {
            throw new Error('Водитель ' + login + ' уже зарегистрирован');
        }
        if (Number(experienceStartYear) > ctx.stub.getDateTimestamp().getFullYear()) {
            throw new Error('Год начала стажа не может быть в будущем');
        }
        await write(ctx, 'driver:' + login, {
            login: login,
            fullName: fullName,
            experienceStartYear: Number(experienceStartYear),
            balance: START_DRIVER_BALANCE,
            license: null,
            vehicles: [],
            fines: [],
            messages: [],
        });
        return JSON.stringify({ ok: true, message: 'Водитель ' + fullName + ' зарегистрирован' });
    }

    /**
     * Добавление удостоверения. ДПС проверяет автоматически: удостоверение есть в базе,
     * срок и категория совпадают, оно ни за кем не закреплено. Истёкший срок не мешает:
     * в сценарии задания добавляются и истёкшие права.
     * @param {string} number номер
     * @param {string} expiresAt срок действия, ГГГГ-ММ-ДД
     * @param {string} category категория A, B или C
     * @returns {string} JSON { ok, message }
     */
    async AddLicense(ctx, number, expiresAt, category) {
        const driver = await currentDriver(ctx);
        const license = await read(ctx, 'license:' + number);
        if (driver.license) {
            return answer(ctx, driver, false, 'Отказ: у вас уже есть удостоверение ' + driver.license.number);
        }
        if (!license) {
            return answer(ctx, driver, false, 'Отказ ДПС: удостоверения ' + number + ' нет в базе');
        }
        if (license.expiresAt !== expiresAt || license.category !== category) {
            return answer(ctx, driver, false, 'Отказ ДПС: срок действия или категория удостоверения ' + number + ' указаны неверно');
        }
        if (license.owner) {
            return answer(ctx, driver, false, 'Отказ ДПС: удостоверение ' + number + ' закреплено за другим водителем');
        }
        license.owner = driver.login;
        await write(ctx, 'license:' + number, license);
        driver.license = { number: number, expiresAt: expiresAt, category: category };
        return answer(ctx, driver, true, 'ДПС подтвердила удостоверение ' + number);
    }

    /**
     * Регистрация транспортного средства: категория должна совпадать с удостоверением.
     * @param {string} category категория A, B или C
     * @param {string} marketValue рыночная стоимость, целое число ProfiCoin от 1 до 1 000 000 000
     * @param {string} serviceLife срок эксплуатации, целое число лет от 0 до 100
     * @returns {string} JSON { ok, message }
     */
    async RegisterVehicle(ctx, category, marketValue, serviceLife) {
        const driver = await currentDriver(ctx);
        const value = Number(marketValue);
        const life = Number(serviceLife);
        if (!Number.isInteger(value) || value < 1 || value > 1000000000) {
            throw new Error('Стоимость ТС: целое число от 1 до 1 000 000 000 ProfiCoin');
        }
        if (!Number.isInteger(life) || life < 0 || life > 100) {
            throw new Error('Срок эксплуатации ТС: целое число лет от 0 до 100');
        }
        if (!driver.license) {
            return answer(ctx, driver, false, 'Отказ ДПС: сначала добавьте водительское удостоверение');
        }
        if (driver.license.category !== category) {
            return answer(ctx, driver, false, 'Отказ ДПС: категория ТС ' + category
                + ' не совпадает с категорией удостоверения ' + driver.license.category);
        }
        driver.vehicles.push({ category: category, marketValue: value, serviceLife: life });
        return answer(ctx, driver, true, 'ДПС зарегистрировала ТС категории ' + category);
    }

    /**
     * Продление удостоверения на 10 лет. Условия: до конца срока месяц или меньше
     * (срок мог и истечь) и нет неоплаченных штрафов.
     * @returns {string} JSON { ok, message }
     */
    async RenewLicense(ctx) {
        const driver = await currentDriver(ctx);
        if (!driver.license) {
            return answer(ctx, driver, false, 'Отказ ДПС: у вас нет удостоверения');
        }
        if (driver.fines.some((fine) => !fine.paidAt)) {
            return answer(ctx, driver, false, 'Отказ ДПС: есть неоплаченные штрафы');
        }
        const now = ctx.stub.getDateTimestamp();
        const expires = new Date(driver.license.expiresAt);
        const monthBefore = new Date(expires);
        monthBefore.setMonth(monthBefore.getMonth() - 1);
        if (now < monthBefore) {
            return answer(ctx, driver, false, 'Отказ ДПС: до окончания срока действия больше месяца');
        }
        // Новый срок считается от окончания старого, а если тот уже прошёл — от сегодня
        const newExpires = new Date(Math.max(now, expires));
        newExpires.setFullYear(newExpires.getFullYear() + RENEWAL_YEARS);
        const expiresAt = newExpires.toISOString().slice(0, 10);

        const license = await read(ctx, 'license:' + driver.license.number);
        license.expiresAt = expiresAt;
        await write(ctx, 'license:' + license.number, license);
        driver.license.expiresAt = expiresAt;
        return answer(ctx, driver, true, 'ДПС продлила удостоверение до ' + expiresAt);
    }

    /**
     * Выписать штраф по номеру удостоверения. Только для сотрудника ДПС.
     * @param {string} licenseNumber номер удостоверения
     * @returns {string} JSON { ok, message, fineId }
     */
    async IssueFine(ctx, licenseNumber) {
        if (!isDps(ctx)) {
            throw new Error('Доступ только для сотрудника ДПС');
        }
        const license = await read(ctx, 'license:' + licenseNumber);
        if (!license) {
            throw new Error('Удостоверения ' + licenseNumber + ' нет в базе');
        }
        if (!license.owner) {
            throw new Error('Удостоверение ' + licenseNumber + ' ни за кем не закреплено');
        }
        const driver = await read(ctx, 'driver:' + license.owner);
        const fineId = ctx.stub.getTxID();      // ID транзакции уникален и одинаков на всех пирах
        driver.fines.push({ id: fineId, issuedAt: ctx.stub.getDateTimestamp().toISOString(), paidAt: null, paidAmount: null });
        await answer(ctx, driver, true, 'Выписан штраф по удостоверению ' + licenseNumber);

        // Если сотрудник ДПС сам водитель, запись о штрафе появится и в его истории
        const officer = await read(ctx, 'driver:' + callerLogin(ctx));
        if (officer && officer.login !== driver.login) {
            await answer(ctx, officer, true, 'Вы выписали штраф водителю ' + driver.fullName);
        }
        return JSON.stringify({ ok: true, message: 'Штраф выписан водителю ' + driver.fullName, fineId: fineId });
    }

    /**
     * Оплата своего штрафа: 5 ProfiCoin в первые 5 минут, затем 10. Деньги поступают банку.
     * @param {string} fineId ID штрафа
     * @returns {string} JSON { ok, message }
     */
    async PayFine(ctx, fineId) {
        const driver = await currentDriver(ctx);
        const fine = driver.fines.find((item) => item.id === fineId);
        if (!fine) {
            throw new Error('У вас нет штрафа с таким ID');
        }
        if (fine.paidAt) {
            return answer(ctx, driver, false, 'Отказ: штраф уже оплачен');
        }
        const amount = fineAmount(ctx, fine);
        if (driver.balance < amount) {
            return answer(ctx, driver, false, 'Отказ: недостаточно средств, нужно ' + amount + ' ProfiCoin');
        }
        const bank = await read(ctx, 'bank');
        const now = ctx.stub.getDateTimestamp().toISOString();
        driver.balance -= amount;
        bank.balance += amount;
        bank.payments.push({ at: now, from: driver.fullName, amount: amount });
        fine.paidAt = now;
        fine.paidAmount = amount;
        await write(ctx, 'bank', bank);
        return answer(ctx, driver, true, 'Штраф оплачен: ' + amount + ' ProfiCoin');
    }

    /**
     * Личный кабинет водителя.
     * @returns {string} JSON: данные водителя, стаж, число неоплаченных штрафов и сумма каждого штрафа сейчас
     */
    async GetMyProfile(ctx) {
        const driver = await currentDriver(ctx);
        driver.experienceYears = ctx.stub.getDateTimestamp().getFullYear() - driver.experienceStartYear;
        driver.unpaidFines = driver.fines.filter((fine) => !fine.paidAt).length;
        for (const fine of driver.fines) {
            if (!fine.paidAt) {
                fine.currentAmount = fineAmount(ctx, fine);
            }
        }
        return JSON.stringify(driver);
    }

    /**
     * Счёт банка. Только для пользователей организации Bank.
     * @returns {string} JSON { balance, payments }
     */
    async GetBankAccount(ctx) {
        if (ctx.clientIdentity.getMSPID() !== BANK_MSP) {
            throw new Error('Доступ только для аккаунта банка');
        }
        return JSON.stringify(await read(ctx, 'bank'));
    }

    /**
     * Кто вызвал: интерфейс по ответу решает, какие функции показать.
     * @returns {string} JSON { login, isBank, isDps, isDriver }
     */
    async WhoAmI(ctx) {
        const login = callerLogin(ctx);
        return JSON.stringify({
            login: login,
            isBank: ctx.clientIdentity.getMSPID() === BANK_MSP,
            isDps: isDps(ctx),
            isDriver: ctx.clientIdentity.getMSPID() === USERS_MSP && (await read(ctx, 'driver:' + login)) !== null,
        });
    }
}

// Fabric загружает контракты из этого массива
module.exports.contracts = [TrafficContract];
