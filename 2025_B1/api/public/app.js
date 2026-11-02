'use strict';
// Интерфейс личных кабинетов. Все данные приходят из REST API, а значит из реестра.
const $ = (id) => document.getElementById(id);
// Токен живёт и в памяти, и в sessionStorage: хранилище может быть недоступно в приватном режиме.
const session = { token: null, org: null };
function saveSession() {
  try {
    sessionStorage.setItem('session', JSON.stringify(session));
  } catch { /* достаточно памяти */ }
}
function loadSession() {
  try {
    Object.assign(session, JSON.parse(sessionStorage.getItem('session')));
  } catch { /* начинаем без сессии */ }
}
let refreshTimer = null;

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (res.status === 401 && url !== '/api/login') {
    logout();
  }
  if (!res.ok) {
    throw new Error(data.error);
  }
  return data;
}

function toast(text, isError) {
  const el = $('toast');
  el.textContent = text;
  el.className = isError ? 'error' : '';
  el.hidden = false;
}

const fmtTime = (iso) => new Date(iso).toLocaleString('ru-RU');

/** Строка таблицы. textContent защищает от HTML в пользовательских данных. */
function row(cells) {
  const tr = document.createElement('tr');
  for (const cell of cells) {
    const td = document.createElement('td');
    td.append(cell);
    tr.append(td);
  }
  return tr;
}

function emptyRow(text, span) {
  const td = document.createElement('td');
  td.colSpan = span;
  td.className = 'empty';
  td.textContent = text;
  const tr = document.createElement('tr');
  tr.append(td);
  return tr;
}

function show(screen) {
  for (const id of ['auth', 'bank', 'driver']) {
    $(id).hidden = id !== screen;
  }
  $('logout').hidden = screen === 'auth';
}

async function refresh() {
  if (session.org === 'Bank') {
    renderBank(await api('GET', '/api/bank'));
  } else {
    renderDriver(await api('GET', '/api/me'));
  }
}

function renderBank(bank) {
  show('bank');
  $('who').textContent = 'Банк';
  $('bank-balance').textContent = bank.balance;
  const rows = bank.payments.slice().reverse().map((p) => row([fmtTime(p.at), p.from, `${p.amount} ProfiCoin`]));
  $('bank-payments').replaceChildren(...(rows.length ? rows : [emptyRow('Поступлений пока нет', 3)]));
}

function renderDriver(d) {
  show('driver');
  $('who').textContent = d.isDps ? `${d.login}, сотрудник ДПС` : d.login;
  $('d-name').textContent = d.fullName;
  $('d-balance').textContent = `${d.balance} ProfiCoin`;
  $('d-exp').textContent = `${d.experienceYears} лет (с ${d.experienceStartYear})`;
  $('d-unpaid').textContent = d.unpaidFines;
  $('dps-card').hidden = !d.isDps;

  $('d-license').textContent = d.license
    ? `№ ${d.license.number}, категория ${d.license.category}, действует до ${d.license.expiresAt}`
    : 'Удостоверение не добавлено.';
  $('license-form').hidden = Boolean(d.license);
  $('renew').hidden = !d.license;

  const vehicles = d.vehicles.map((v) => row([v.category, v.marketValue, v.serviceLife]));
  $('d-vehicles').replaceChildren(...(vehicles.length ? vehicles : [emptyRow('Транспортных средств нет', 3)]));

  const fines = d.fines.slice().reverse().map((fine) => {
    if (fine.paidAt) {
      return row([fmtTime(fine.issuedAt), 'Оплачен', `${fine.paidAmount} ProfiCoin`, '']);
    }
    const left = fine.discountSecondsLeft;
    const state = left > 0 ? `Скидка ещё ${Math.floor(left / 60)} мин ${left % 60} с` : 'Срок скидки истёк';
    const pay = document.createElement('button');
    pay.textContent = 'Оплатить';
    pay.onclick = () => act(pay, () => api('POST', `/api/fines/${fine.id}/pay`));
    return row([fmtTime(fine.issuedAt), state, `${fine.currentAmount} ProfiCoin`, pay]);
  });
  $('d-fines').replaceChildren(...(fines.length ? fines : [emptyRow('Штрафов нет', 4)]));

  const messages = d.messages.slice().reverse().map((m) => {
    const li = document.createElement('li');
    li.className = m.type;
    const time = document.createElement('time');
    time.textContent = fmtTime(m.at);
    li.append(time, m.text);
    return li;
  });
  $('d-messages').replaceChildren(...(messages.length ? messages : [Object.assign(document.createElement('li'), { textContent: 'Сообщений нет' })]));
}

/** Выполняет действие, показывает ответ контракта, обновляет кабинет. */
async function act(button, action) {
  button.disabled = true;
  try {
    const result = await action();
    toast(result.message, result.ok === false);
    await refresh();
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
  }
}

function enter(result) {
  session.token = result.token;
  session.org = result.org;
  saveSession();
  $('toast').hidden = true;
  clearInterval(refreshTimer);
  // Раз в 5 секунд обновляем кабинет: скидка на штраф меняется со временем.
  refreshTimer = setInterval(() => refresh().catch(() => {}), 5000);
  return refresh();
}

function logout() {
  clearInterval(refreshTimer);
  session.token = null;
  saveSession();
  $('who').textContent = '';
  show('auth');
}

function onSubmit(id, handler) {
  const form = $(id);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(form)), form);
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

onSubmit('login-form', async (data, form) => {
  await enter(await api('POST', '/api/login', data));
  form.reset();
});
onSubmit('register-form', async (data, form) => {
  await enter(await api('POST', '/api/register', data));
  form.reset();
});
const actionForm = (id, url) => onSubmit(id, async (data, form) => {
  const result = await api('POST', url, data);
  toast(result.message, result.ok === false);
  form.reset();
  await refresh();
});
actionForm('license-form', '/api/license');
actionForm('vehicle-form', '/api/vehicles');
actionForm('fine-form', '/api/fines');

$('renew').onclick = () => act($('renew'), () => api('POST', '/api/license/renew'));
$('logout').onclick = async () => {
  await api('POST', '/api/logout').catch(() => {});
  logout();
};

// После перезагрузки страницы сессия продолжается, пока жив токен на сервере.
loadSession();
if (session.token) {
  enter({ token: session.token, org: session.org }).catch(logout);
} else {
  show('auth');
}
