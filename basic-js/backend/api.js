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

// Сертификаты и ключи вошедших пользователей: папка на каждую сессию.
// Лежит вне backend, чтобы ключи не попали в пакет контракта при деплое
const WALLET = path.resolve(__dirname, '../wallet');

// Организации сети: org1 — администратор, org2 — пользователи
const ORGS = {
    org1: { mspId: 'Org1MSP', peer: 'localhost:7051', caPort: 7054 },
    org2: { mspId: 'Org2MSP', peer: 'localhost:9051', caPort: 8054 },
};

// Токен сессии -> организация пользователя. Ключи сессии лежат в WALLET/<токен>
const sessions = new Map();


// ===== 1. Fabric CA: пользователи и сертификаты =====

// Запуск утилиты fabric-ca-client от имени администратора CA организации
function runCaClient(org, args, errorMessage) {
    const env = Object.assign({}, process.env, {
        FABRIC_CA_CLIENT_HOME: NETWORK + '/peerOrganizations/' + org + '.example.com',
    });
    const caArgs = ['--caname', 'ca-' + org, '--tls.certfiles', NETWORK + '/fabric-ca/' + org + '/ca-cert.pem'];
    try {
        childProcess.execFileSync(SAMPLES + '/bin/fabric-ca-client', args.concat(caArgs), { env: env, stdio: 'pipe' });
    } catch (error) {
        // Текст ошибки утилиты содержит пароль, поэтому наружу отдаём свой
        throw new Error(errorMessage);
    }
}

// Создать учётную запись в CA организации
function register(org, name, password) {
    runCaClient(org, ['register', '--id.name', name, '--id.secret', password,
        '--id.type', 'client', '--id.affiliation', org + '.department1'], 'Имя уже занято');
}

// Выпустить сертификат и ключ. При неверном пароле CA откажет: это и есть проверка входа
function login(org, name, password) {
    const token = crypto.randomUUID();
    const url = 'https://' + encodeURIComponent(name) + ':' + encodeURIComponent(password) + '@localhost:' + ORGS[org].caPort;
    runCaClient(org, ['enroll', '-u', url, '-M', WALLET + '/' + token], 'Неверное имя или пароль');
    sessions.set(token, org);
    return token;
}


// ===== 2. Смарт-контракт: вызов через Fabric Gateway =====

// type: 'evaluate' — чтение, блок не создаётся; 'submit' — запись в блок
async function callContract(type, token, method, args) {
    const org = sessions.get(token);
    if (!org) {
        throw new Error('Требуется вход');
    }

    // Сертификат и ключ пользователя
    const dir = WALLET + '/' + token;
    const certificate = fs.readFileSync(dir + '/signcerts/cert.pem');
    const keyFile = fs.readdirSync(dir + '/keystore')[0];
    const privateKey = crypto.createPrivateKey(fs.readFileSync(dir + '/keystore/' + keyFile));

    // Соединение с пиром своей организации по TLS
    const peerTls = fs.readFileSync(NETWORK + '/peerOrganizations/' + org + '.example.com/tlsca/tlsca.' + org + '.example.com-cert.pem');
    const client = new grpc.Client(ORGS[org].peer, grpc.credentials.createSsl(peerTls), {
        'grpc.ssl_target_name_override': 'peer0.' + org + '.example.com',
    });
    const gateway = fabric.connect({
        client: client,
        identity: { mspId: ORGS[org].mspId, credentials: certificate },
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

// Ответ с ошибкой. Текст ошибки контракта лежит в details
function sendError(res, error) {
    let message = error.message;
    if (error.details && error.details.length > 0) {
        message = error.details[0].message.replace(/^.*chaincode response \d+, /, '');
    }
    res.status(400).json({ error: message });
}

// Регистрация пользователя в Org2: учётная запись в CA, вход, запись в контракте
app.post('/register', async function (req, res) {
    try {
        register('org2', req.body.name, req.body.password);
        const token = login('org2', req.body.name, req.body.password);
        await callContract('submit', token, 'RegisterUser', [req.body.address]);
        res.json({ token: token });
    } catch (error) {
        sendError(res, error);
    }
});

// Вход: пробуем организации по очереди, первой Org1 с администратором
app.post('/login', function (req, res) {
    for (const org of Object.keys(ORGS)) {
        try {
            res.json({ token: login(org, req.body.name, req.body.password) });
            return;
        } catch (error) {
            // В этой организации такого пользователя нет, пробуем следующую
        }
    }
    sendError(res, new Error('Неверное имя или пароль'));
});

// Любой метод контракта: имя метода в адресе, аргументы в теле { args: [...] }
app.post('/evaluate/:method', async function (req, res) {
    try {
        res.json(await callContract('evaluate', req.headers.authorization, req.params.method, req.body.args || []));
    } catch (error) {
        sendError(res, error);
    }
});

app.post('/submit/:method', async function (req, res) {
    try {
        res.json(await callContract('submit', req.headers.authorization, req.params.method, req.body.args || []));
    } catch (error) {
        sendError(res, error);
    }
});

// Сессии хранятся в памяти, поэтому ключи прошлого запуска больше не нужны
fs.rmSync(WALLET, { recursive: true, force: true });

app.listen(8091, function () {
    console.log('API: http://localhost:8091');
});
