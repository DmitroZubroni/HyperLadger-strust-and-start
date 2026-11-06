'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const grpc = require('@grpc/grpc-js');
const fabric = require('@hyperledger/fabric-gateway');

// Где лежит сеть Fabric
const SAMPLES = path.resolve(__dirname, '../../fabric-samples');
const NETWORK = SAMPLES + '/test-network/organizations';

// Сертификаты и ключи пользователей. Папка лежит вне backend,
// чтобы ключи не попали в пакет контракта при деплое
const WALLET = path.resolve(__dirname, '../wallet');

// org1 — администратор, org2 — пользователи
const ORGS = {
    org1: { mspId: 'Org1MSP', peer: 'localhost:7051', caPort: 7054 },
    org2: { mspId: 'Org2MSP', peer: 'localhost:9051', caPort: 8054 },
};

// Токен сессии -> пользователь { org, name }
const sessions = new Map();


// ===== 1. Fabric CA: пользователи и сертификаты =====

// Запуск утилиты fabric-ca-client от имени администратора CA организации
function runCaClient(org, args) {
    const caCert = NETWORK + '/fabric-ca/' + org + '/ca-cert.pem';
    const env = Object.assign({}, process.env, {
        FABRIC_CA_CLIENT_HOME: NETWORK + '/peerOrganizations/' + org + '.example.com',
    });
    const fullArgs = args.concat(['--caname', 'ca-' + org, '--tls.certfiles', caCert]);
    try {
        childProcess.execFileSync(SAMPLES + '/bin/fabric-ca-client', fullArgs, { env: env, stdio: 'pipe' });
    } catch (error) {
        // Текст ошибки утилиты содержит пароль, поэтому наружу его не отдаём
        throw new Error('Fabric CA отклонил запрос');
    }
}

// Создать учётную запись пользователя в CA организации Org2
function register(name, password) {
    runCaClient('org2', [
        'register',
        '--id.name', name,
        '--id.secret', password,
        '--id.type', 'client',
        '--id.affiliation', 'org2.department1',
    ]);
}

// Выпустить сертификат и ключ в wallet. Неверный пароль CA отклонит: это и есть проверка входа
function enroll(org, name, password) {
    const dir = WALLET + '/' + org + '-' + name;
    fs.rmSync(dir, { recursive: true, force: true });
    const url = 'https://' + encodeURIComponent(name) + ':' + encodeURIComponent(password)
        + '@localhost:' + ORGS[org].caPort;
    runCaClient(org, ['enroll', '-u', url, '-M', dir]);
}


// ===== 2. Смарт-контракт: вызов через Fabric Gateway =====

// type: 'evaluate' — чтение, блок не создаётся; 'submit' — запись в блок
async function callContract(type, user, method, args) {
    const org = ORGS[user.org];
    const dir = WALLET + '/' + user.org + '-' + user.name;

    // Сертификат и ключ пользователя из wallet
    const certificate = fs.readFileSync(dir + '/signcerts/cert.pem');
    const keyFile = fs.readdirSync(dir + '/keystore')[0];
    const privateKey = crypto.createPrivateKey(fs.readFileSync(dir + '/keystore/' + keyFile));

    // Соединение с пиром своей организации по TLS
    const tlsCert = fs.readFileSync(NETWORK + '/peerOrganizations/' + user.org + '.example.com/tlsca/tlsca.'
        + user.org + '.example.com-cert.pem');
    const client = new grpc.Client(org.peer, grpc.credentials.createSsl(tlsCert), {
        'grpc.ssl_target_name_override': 'peer0.' + user.org + '.example.com',
    });

    const gateway = fabric.connect({
        client: client,
        identity: { mspId: org.mspId, credentials: certificate },
        signer: fabric.signers.newPrivateKeySigner(privateKey),
        hash: fabric.hash.SHA256,
    });

    try {
        const contract = gateway.getNetwork('mychannel').getContract('users');
        let result;
        if (type === 'submit') {
            result = await contract.submit(method, { arguments: args });
        } else {
            result = await contract.evaluate(method, { arguments: args });
        }
        return JSON.parse(Buffer.from(result).toString());
    } finally {
        gateway.close();
        client.close();
    }
}


// ===== 3. REST API =====

const app = express();
app.use(cors());
app.use(express.json());

function createSession(user) {
    const token = crypto.randomUUID();
    sessions.set(token, user);
    return token;
}

// Ответ с ошибкой. Текст ошибки контракта лежит в details
function sendError(res, error) {
    let message = error.message;
    if (error.details && error.details.length > 0) {
        message = error.details[0].message.replace(/^.*chaincode response \d+, /, '');
    }
    res.status(400).json({ error: message });
}

// Имя попадает в путь к папке wallet, поэтому только латиница, цифры, _ и -
function checkName(name) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        throw new Error('Имя: латинские буквы, цифры, _ и -');
    }
}

// Регистрация: учётная запись в CA, сертификат, запись в контракте
app.post('/register', async function (req, res) {
    try {
        const name = req.body.name;
        const password = req.body.password;
        const address = req.body.address;
        if (!name || !password || !address) {
            throw new Error('Укажите имя, пароль и адрес');
        }
        checkName(name);
        try {
            register(name, password);
        } catch (error) {
            throw new Error('Имя ' + name + ' уже занято');
        }
        enroll('org2', name, password);
        const user = { org: 'org2', name: name };
        await callContract('submit', user, 'RegisterUser', [address]);
        res.json({ token: createSession(user) });
    } catch (error) {
        sendError(res, error);
    }
});

// Вход: сначала ищем пользователя в Org1 (администратор), потом в Org2
app.post('/login', function (req, res) {
    try {
        const name = req.body.name;
        const password = req.body.password;
        if (!name || !password) {
            throw new Error('Укажите имя и пароль');
        }
        checkName(name);
        for (const org of ['org1', 'org2']) {
            try {
                enroll(org, name, password);
                res.json({ token: createSession({ org: org, name: name }) });
                return;
            } catch (error) {
                // В этой организации не нашли, пробуем следующую
            }
        }
        throw new Error('Неверное имя или пароль');
    } catch (error) {
        sendError(res, error);
    }
});

// Вызов любого метода контракта: имя метода в адресе, аргументы в теле { args: [...] }
async function handleContract(type, req, res) {
    try {
        const user = sessions.get(req.headers.authorization);
        if (!user) {
            throw new Error('Требуется вход');
        }
        const args = req.body.args || [];
        res.json(await callContract(type, user, req.params.method, args));
    } catch (error) {
        sendError(res, error);
    }
}

app.post('/evaluate/:method', function (req, res) {
    handleContract('evaluate', req, res);
});

app.post('/submit/:method', function (req, res) {
    handleContract('submit', req, res);
});

app.listen(8091, function () {
    console.log('API: http://localhost:8091');
});
