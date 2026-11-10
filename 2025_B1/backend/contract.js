'use strict';
/**
 * Смарт-контракт «Безопасное дорожное движение».
 *
 * Правила, которые определяют устройство кода:
 *
 * 1. Время берётся только из ctx.stub.getTxTimestamp(). Date.now() дал бы на
 *    разных пирах разные значения, и транзакция не прошла бы проверку.
 * 2. Отказ по бизнес-правилу (чужое удостоверение, неверная категория) не
 *    бросает исключение: исключение откатывает транзакцию, и сообщение водителю
 *    не сохранилось бы. Отказ записывается в сообщения и возвращается как ok:false.
 * 3. Исключение бросается только при нарушении доступа и некорректных данных.
 *    В этих случаях в реестр ничего не записывается.
 * 4. Кто вызвал функцию, определяется по сертификату: организация (MSP),
 *    логин (CN) и роль (атрибут role). Параметрам запроса контракт не доверяет.
 */
const { Contract } = require('fabric-contract-api');

const BANK_MSP = 'BankMSP';
const USERS_MSP = 'UsersMSP';
const ROLE_DPS = 'dps';

const BANK_KEY = 'bank';
const START_BANK_BALANCE = 1000;
const START_DRIVER_BALANCE = 50;

const FINE_FULL = 10;
const FINE_DISCOUNT = 5;
const DISCOUNT_DAYS = 5;
const SECONDS_PER_GAME_DAY = 60;       // 1 день в задании = 1 минута реального времени
const RENEWAL_YEARS = 10;              // срок продления: в задании не задан, как у реальных прав

const CATEGORIES = ['A', 'B', 'C'];

// Таблица 1 задания: база водительских удостоверений службы ДПС
const LICENSE_BASE = [
    { number: '000', expiresAt: '11.01.2021', category: 'A' },
    { number: '111', expiresAt: '12.05.2025', category: 'B' },
    { number: '222', expiresAt: '09.09.2020', category: 'C' },
    { number: '333', expiresAt: '13.02.2027', category: 'A' },
    { number: '444', expiresAt: '10.09.2020', category: 'B' },
    { number: '555', expiresAt: '24.06.2029', category: 'C' },
    { number: '666', expiresAt: '31.03.2030', category: 'A' },
];

// Логины и стаж стартовых пользователей
const INITIAL_DRIVERS = [
    { login: 'ivanov', fullName: 'Иванов Иван Иванович', experience: 2 },
    { login: 'semenov', fullName: 'Семенов Семен Семенович', experience: 5 },
    { login: 'petrov', fullName: 'Петров Петр Петрович', experience: 10 },
];

const driverKey = (login) => `driver:${login}`;
const licenseKey = (number) => `license:${number}`;

/** Время транзакции в секундах. Одинаково на всех пирах. */
function txSeconds(ctx) {
    const { seconds } = ctx.stub.getTxTimestamp();
    return typeof seconds.toNumber === 'function' ? seconds.toNumber() : Number(seconds);
}

const toIso = (seconds) => new Date(seconds * 1000).toISOString();

async function readJson(ctx, key) {
    const bytes = await ctx.stub.getState(key);
    return bytes && bytes.length > 0 ? JSON.parse(Buffer.from(bytes).toString('utf8')) : null;
}

async function writeJson(ctx, key, value) {
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(value)));
}

/** Логин вызывающего: поле CN его сертификата. */
function callerLogin(ctx) {
    const match = /CN=([^/:,]+)/.exec(ctx.clientIdentity.getID());
    if (!match) {
        throw new Error('В сертификате не найден CN');
    }
    return match[1];
}

const callerRole = (ctx) => ctx.clientIdentity.getAttributeValue('role');

// Банк — любой пользователь организации Bank
function requireBank(ctx) {
    if (ctx.clientIdentity.getMSPID() !== BANK_MSP) {
        throw new Error('Доступ только для аккаунта банка');
    }
}

// Сотрудник ДПС — пользователь Users с атрибутом role=dps в сертификате
function requireDps(ctx) {
    if (ctx.clientIdentity.getMSPID() !== USERS_MSP || callerRole(ctx) !== ROLE_DPS) {
        throw new Error('Доступ только для сотрудника ДПС');
    }
}

/** Запись водителя, от имени которого выполняется вызов. */
async function currentDriver(ctx) {
    if (ctx.clientIdentity.getMSPID() !== USERS_MSP) {
        throw new Error('Функция доступна только пользователям организации Users');
    }
    const login = callerLogin(ctx);
    const driver = await readJson(ctx, driverKey(login));
    if (!driver) {
        throw new Error(`Водитель ${login} не зарегистрирован`);
    }
    return driver;
}

function addMessage(ctx, driver, type, text) {
    driver.messages.push({ at: toIso(txSeconds(ctx)), type, text });
}

/** Отказ: сообщение сохраняется в кабинете водителя, транзакция не откатывается. */
async function reject(ctx, driver, text) {
    addMessage(ctx, driver, 'error', text);
    await writeJson(ctx, driverKey(driver.login), driver);
    return JSON.stringify({ ok: false, message: text });
}

/** Успех: сообщение сохраняется в кабинете водителя. */
async function accept(ctx, driver, text) {
    addMessage(ctx, driver, 'info', text);
    await writeJson(ctx, driverKey(driver.login), driver);
    return JSON.stringify({ ok: true, message: text });
}

function newDriver(login, fullName, experienceStartYear) {
    return {
        login,
        fullName,
        experienceStartYear,
        balance: START_DRIVER_BALANCE,
        license: null,
        vehicles: [],
        fines: [],
        messages: [],
    };
}

/** Стоимость штрафа в момент времени nowSeconds. */
function fineAmount(fine, nowSeconds) {
    const elapsed = nowSeconds - fine.issuedAtSeconds;
    return elapsed < DISCOUNT_DAYS * SECONDS_PER_GAME_DAY ? FINE_DISCOUNT : FINE_FULL;
}

/** Разбор даты ДД.ММ.ГГГГ. Возвращает [год, месяц от 1, день] или null. */
function parseDate(text) {
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(text).trim());
    return match ? [Number(match[3]), Number(match[2]), Number(match[1])] : null;
}

function formatDate(year, month, day) {
    return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}

class TrafficContract extends Contract {
    constructor() {
        super('traffic');
    }

    /**
     * Начальное заполнение реестра: счёт банка (1000 ProfiCoin), база удостоверений
     * и стартовые водители. Вызывается один раз при деплое: deployCC -cci InitLedger.
     * @returns {string} JSON { ok, message }
     */
    async InitLedger(ctx) {
        if (await readJson(ctx, BANK_KEY)) {
            throw new Error('Реестр уже инициализирован');
        }
        await writeJson(ctx, BANK_KEY, { balance: START_BANK_BALANCE, payments: [] });
        for (const license of LICENSE_BASE) {
            await writeJson(ctx, licenseKey(license.number), { ...license, owner: null });
        }
        const year = new Date(txSeconds(ctx) * 1000).getUTCFullYear();
        for (const item of INITIAL_DRIVERS) {
            await writeJson(ctx, driverKey(item.login), newDriver(item.login, item.fullName, year - item.experience));
        }
        return JSON.stringify({ ok: true, message: 'Реестр инициализирован' });
    }

    /**
     * Самостоятельная регистрация водителя. Логин берётся из сертификата.
     * @param {string} fullName ФИО
     * @param {string} experienceStartYear год начала водительского стажа
     * @returns {string} JSON { ok, message }
     */
    async RegisterDriver(ctx, fullName, experienceStartYear) {
        if (ctx.clientIdentity.getMSPID() !== USERS_MSP) {
            throw new Error('Водитель должен принадлежать организации Users');
        }
        const login = callerLogin(ctx);
        if (await readJson(ctx, driverKey(login))) {
            throw new Error(`Водитель ${login} уже зарегистрирован`);
        }
        const name = String(fullName).trim();
        const startYear = Number(experienceStartYear);
        const currentYear = new Date(txSeconds(ctx) * 1000).getUTCFullYear();
        if (!name) {
            throw new Error('Не указано ФИО');
        }
        if (!Number.isInteger(startYear) || startYear < 1900 || startYear > currentYear) {
            throw new Error('Некорректный год начала стажа');
        }
        await writeJson(ctx, driverKey(login), newDriver(login, name, startYear));
        return JSON.stringify({ ok: true, message: `Водитель ${name} зарегистрирован` });
    }

    /**
     * Добавление удостоверения. Проверка ДПС выполняется автоматически:
     * номер есть в базе, срок и категория совпадают, удостоверение не занято.
     * Срок действия не проверяется: в сценарии задания добавляются и истёкшие права.
     * @param {string} number номер
     * @param {string} expiresAt срок действия, ДД.ММ.ГГГГ
     * @param {string} category категория A, B или C
     * @returns {string} JSON { ok, message }
     */
    async AddLicense(ctx, number, expiresAt, category) {
        const driver = await currentDriver(ctx);
        if (driver.license) {
            return reject(ctx, driver, `Отказ: у вас уже есть удостоверение ${driver.license.number}`);
        }
        const license = await readJson(ctx, licenseKey(String(number).trim()));
        if (!license) {
            return reject(ctx, driver, `Отказ ДПС: удостоверения ${number} нет в базе`);
        }
        if (license.expiresAt !== String(expiresAt).trim() || license.category !== String(category).trim().toUpperCase()) {
            return reject(ctx, driver, `Отказ ДПС: срок действия или категория удостоверения ${number} указаны неверно`);
        }
        if (license.owner) {
            return reject(ctx, driver, `Отказ ДПС: удостоверение ${number} уже закреплено за другим водителем`);
        }
        license.owner = driver.login;
        await writeJson(ctx, licenseKey(license.number), license);
        driver.license = { number: license.number, expiresAt: license.expiresAt, category: license.category };
        return accept(ctx, driver, `ДПС подтвердила удостоверение ${license.number}`);
    }

    /**
     * Запрос на регистрацию транспортного средства. Проверка автоматическая:
     * категория ТС должна совпадать с категорией удостоверения.
     * @param {string} category категория A, B или C
     * @param {string} marketValue рыночная стоимость, ProfiCoin
     * @param {string} serviceLife срок эксплуатации, лет
     * @returns {string} JSON { ok, message }
     */
    async RegisterVehicle(ctx, category, marketValue, serviceLife) {
        const driver = await currentDriver(ctx);
        const value = Number(marketValue);
        const life = Number(serviceLife);
        const vehicleCategory = String(category).trim().toUpperCase();
        if (!CATEGORIES.includes(vehicleCategory)) {
            throw new Error('Категория ТС должна быть A, B или C');
        }
        if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(life) || life < 0) {
            throw new Error('Некорректная стоимость или срок эксплуатации ТС');
        }
        if (!driver.license) {
            return reject(ctx, driver, 'Отказ ДПС: сначала добавьте водительское удостоверение');
        }
        if (driver.license.category !== vehicleCategory) {
            return reject(ctx, driver, `Отказ ДПС: категория ТС ${vehicleCategory} не совпадает с категорией удостоверения ${driver.license.category}`);
        }
        driver.vehicles.push({ category: vehicleCategory, marketValue: value, serviceLife: life });
        return accept(ctx, driver, `ДПС зарегистрировала ТС категории ${vehicleCategory}`);
    }

    /**
     * Запрос на продление удостоверения. Условия: до окончания срока остался
     * месяц или меньше (срок мог и истечь) и нет неоплаченных штрафов.
     * Срок сравнивается с настоящей датой, так как даты в базе календарные.
     * @returns {string} JSON { ok, message }
     */
    async RenewLicense(ctx) {
        const driver = await currentDriver(ctx);
        if (!driver.license) {
            return reject(ctx, driver, 'Отказ ДПС: у вас нет удостоверения');
        }
        if (driver.fines.some((fine) => !fine.paidAt)) {
            return reject(ctx, driver, 'Отказ ДПС: есть неоплаченные штрафы');
        }
        const [year, month, day] = parseDate(driver.license.expiresAt);
        const now = txSeconds(ctx) * 1000;
        if (now < Date.UTC(year, month - 2, day)) {
            return reject(ctx, driver, 'Отказ ДПС: до окончания срока действия больше месяца');
        }
        const expiry = Date.UTC(year, month - 1, day);
        const from = new Date(Math.max(now, expiry));
        const newExpiry = formatDate(from.getUTCFullYear() + RENEWAL_YEARS, from.getUTCMonth() + 1, from.getUTCDate());

        const license = await readJson(ctx, licenseKey(driver.license.number));
        license.expiresAt = newExpiry;
        await writeJson(ctx, licenseKey(license.number), license);
        driver.license.expiresAt = newExpiry;
        return accept(ctx, driver, `ДПС продлила удостоверение до ${newExpiry}`);
    }

    /**
     * Выписать штраф по номеру удостоверения. Только для сотрудника ДПС.
     * @param {string} licenseNumber номер удостоверения
     * @returns {string} JSON { ok, message, fineId }
     */
    async IssueFine(ctx, licenseNumber) {
        requireDps(ctx);
        const license = await readJson(ctx, licenseKey(String(licenseNumber).trim()));
        if (!license || !license.owner) {
            throw new Error(`Удостоверение ${licenseNumber} не закреплено ни за одним водителем`);
        }
        const driver = await readJson(ctx, driverKey(license.owner));
        const now = txSeconds(ctx);
        const fineId = ctx.stub.getTxID();     // ID транзакции уникален и одинаков на всех пирах
        driver.fines.push({ id: fineId, issuedAtSeconds: now, issuedAt: toIso(now), issuedBy: callerLogin(ctx), paidAt: null, paidAmount: null });
        addMessage(ctx, driver, 'info', `Выписан штраф по удостоверению ${license.number}`);
        await writeJson(ctx, driverKey(driver.login), driver);
        return JSON.stringify({ ok: true, message: `Штраф выписан водителю ${driver.fullName}`, fineId });
    }

    /**
     * Оплата штрафа. 5 ProfiCoin в первые 5 дней (минут), затем 10 ProfiCoin.
     * Деньги поступают на счёт банка.
     * @param {string} fineId ID штрафа
     * @returns {string} JSON { ok, message }
     */
    async PayFine(ctx, fineId) {
        const driver = await currentDriver(ctx);
        const fine = driver.fines.find((item) => item.id === fineId);
        if (!fine) {
            throw new Error('Штраф не найден');
        }
        if (fine.paidAt) {
            return reject(ctx, driver, 'Отказ: штраф уже оплачен');
        }
        const now = txSeconds(ctx);
        const amount = fineAmount(fine, now);
        if (driver.balance < amount) {
            return reject(ctx, driver, `Отказ: недостаточно средств, нужно ${amount} ProfiCoin`);
        }
        const bank = await readJson(ctx, BANK_KEY);
        driver.balance -= amount;
        bank.balance += amount;
        bank.payments.push({ at: toIso(now), from: driver.fullName, amount });
        fine.paidAt = toIso(now);
        fine.paidAmount = amount;
        await writeJson(ctx, BANK_KEY, bank);
        return accept(ctx, driver, `Штраф оплачен: ${amount} ProfiCoin`);
    }

    /**
     * Личный кабинет вызывающего водителя.
     * @returns {string} JSON: данные водителя, стаж, число неоплаченных штрафов,
     * текущая стоимость каждого штрафа и признак сотрудника ДПС
     */
    async GetMyProfile(ctx) {
        const driver = await currentDriver(ctx);
        const now = txSeconds(ctx);
        return JSON.stringify({
            ...driver,
            isDps: callerRole(ctx) === ROLE_DPS,
            experienceYears: new Date(now * 1000).getUTCFullYear() - driver.experienceStartYear,
            unpaidFines: driver.fines.filter((fine) => !fine.paidAt).length,
            fines: driver.fines.map((fine) => ({
                ...fine,
                currentAmount: fine.paidAt ? null : fineAmount(fine, now),
                discountSecondsLeft: fine.paidAt ? 0 : Math.max(0, fine.issuedAtSeconds + DISCOUNT_DAYS * SECONDS_PER_GAME_DAY - now),
            })),
        });
    }

    /**
     * Счёт банка. Только для аккаунта банка.
     * @returns {string} JSON { balance, payments }
     */
    async GetBankAccount(ctx) {
        requireBank(ctx);
        const bank = await readJson(ctx, BANK_KEY);
        if (!bank) {
            throw new Error('Реестр не инициализирован');
        }
        return JSON.stringify(bank);
    }
}

// Fabric загружает контракты из этого массива
module.exports = TrafficContract;
module.exports.contracts = [TrafficContract];
