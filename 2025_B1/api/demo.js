'use strict';
/**
 * Демонстрация по сценарию задания через REST API.
 * Новых водителей создаёт только на чистой сети: шаги сценария однократны.
 */
const BASE = process.env.API_URL || 'http://localhost:8090';
const YEAR = new Date().getUTCFullYear();

async function http(method, url, token, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`${method} ${url}: ${data.error}`);
  }
  return data;
}

const tokens = {};
async function loginAs(login, password, org = 'Users') {
  tokens[login] = tokens[login] || (await http('POST', '/api/login', null, { org, login, password })).token;
  return tokens[login];
}

const USERS = { semenov: 'semenov123', petrov: 'petrov123', ivanov: 'ivanov123', romanov: 'romanov123', dmitriev: 'dmitriev123' };
const as = (login) => loginAs(login, USERS[login]);

async function cabinet(login) {
  const me = await http('GET', '/api/me', await as(login));
  const license = me.license ? `${me.license.number}/${me.license.category}` : 'нет';
  console.log(`     кабинет ${me.fullName}: баланс ${me.balance}, стаж ${me.experienceYears}, ВУ ${license}, ТС ${me.vehicles.length}, неоплаченных штрафов ${me.unpaidFines}`);
  if (me.messages.length) {
    console.log(`     последнее сообщение: ${me.messages.at(-1).text}`);
  }
  return me;
}

async function bankBalance() {
  const bank = await http('GET', '/api/bank', await loginAs('bank', 'bank123', 'Bank'));
  console.log(`     счёт банка: ${bank.balance} ProfiCoin`);
  return bank;
}

const LICENSES = { 111: ['12.05.2025', 'B'], 222: ['09.09.2020', 'C'], 333: ['13.02.2027', 'A'], 444: ['10.09.2020', 'B'] };
let step = 0;
const say = (text) => console.log(`${String(++step).padStart(2)}. ${text}`);

/** Проверка ожидаемого результата: при расхождении сценарий останавливается. */
function expect(result, ok) {
  if (result.ok !== ok) {
    throw new Error(`Ожидалось ok=${ok}, получено: ${JSON.stringify(result)}`);
  }
}

async function addLicense(login, number, ok) {
  say(`${login}: добавить удостоверение ${number}`);
  const [expiresAt, category] = LICENSES[number];
  expect(await http('POST', '/api/license', await as(login), { number, expiresAt, category }), ok);
  await cabinet(login);
}

async function addVehicle(login, category, ok) {
  say(`${login}: добавить ТС категории ${category}`);
  expect(await http('POST', '/api/vehicles', await as(login), { category, marketValue: 1000, serviceLife: 3 }), ok);
  await cabinet(login);
}

async function payFine(login) {
  say(`${login}: оплатить штраф`);
  const me = await http('GET', '/api/me', await as(login));
  const fine = me.fines.find((item) => !item.paidAt);
  expect(await http('POST', `/api/fines/${fine.id}/pay`, await as(login)), true);
  await cabinet(login);
  await bankBalance();
}

async function main() {
  say('Банк: проверить баланс');
  await bankBalance();

  say('Зарегистрировать Романова Романа Романовича, стаж 6 лет');
  tokens.romanov = (await http('POST', '/api/register', null, { login: 'romanov', password: USERS.romanov, fullName: 'Романов Роман Романович', experienceStartYear: YEAR - 6 })).token;
  await cabinet('romanov');

  say('Зарегистрировать Дмитриева Дмитрия Дмитриевича, стаж 3 года');
  tokens.dmitriev = (await http('POST', '/api/register', null, { login: 'dmitriev', password: USERS.dmitriev, fullName: 'Дмитриев Дмитрий Дмитриевич', experienceStartYear: YEAR - 3 })).token;
  await cabinet('dmitriev');

  await addLicense('dmitriev', 111, true);
  await addLicense('semenov', 222, true);
  await addLicense('petrov', 222, false);
  await addLicense('romanov', 111, false);
  await addLicense('romanov', 333, true);
  await addLicense('petrov', 444, true);

  await addVehicle('petrov', 'B', true);
  await addVehicle('dmitriev', 'B', true);
  await addVehicle('semenov', 'A', false);
  await addVehicle('romanov', 'C', false);

  say('ДПС: штраф по удостоверению 111');
  expect(await http('POST', '/api/fines', await as('ivanov'), { licenseNumber: '111' }), true);
  await cabinet('dmitriev');
  say('ДПС: штраф по удостоверению 444');
  expect(await http('POST', '/api/fines', await as('ivanov'), { licenseNumber: '444' }), true);
  await cabinet('petrov');

  await payFine('dmitriev');
  await payFine('petrov');
  console.log('\nСценарий выполнен, все результаты совпали с ожидаемыми');
}

main().catch((err) => {
  console.error(`\nОшибка: ${err.message}`);
  process.exit(1);
});
