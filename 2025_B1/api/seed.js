'use strict';
/**
 * Создаёт стартовых пользователей в CA и заполняет реестр. Повторный запуск безопасен.
 * Логины совпадают с INITIAL_DRIVERS в контракте.
 */
const fabric = require('./fabric');

const ACCOUNTS = [
    { org: 'Bank', login: 'bank', password: 'bank123', role: 'bank' },
    { org: 'Users', login: 'ivanov', password: 'ivanov123', role: 'dps' },
    { org: 'Users', login: 'semenov', password: 'semenov123', role: 'driver' },
    { org: 'Users', login: 'petrov', password: 'petrov123', role: 'driver' },
];

async function main() {
    for (const account of ACCOUNTS) {
        await fabric.registerIdentity(account.org, account.login, account.password, account.role).catch((err) => {
            if (!/already registered/.test(err.message)) {
                throw err;
            }
        });
        console.log(`Пользователь ${account.login} (${account.org}, роль ${account.role}) готов`);
    }
    const bank = await fabric.enroll('Bank', 'bank', 'bank123');
    try {
        await fabric.submit(bank, 'InitLedger');
        console.log('Реестр заполнен');
    } catch (err) {
        if (!/уже инициализирован/.test(fabric.errorText(err))) {
            throw err;
        }
        console.log('Реестр был заполнен раньше');
    }
    process.exit(0);
}

main().catch((err) => {
    console.error('Ошибка заполнения:', fabric.errorText(err));
    process.exit(1);
});
