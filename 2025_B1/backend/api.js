'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const cors = require('cors');
const grpc = require('@grpc/grpc-js');
const fabric = require('@hyperledger/fabric-gateway');

// Сеть Fabric с организациями Bank и Users
const SAMPLES = path.resolve(__dirname, '../../fabric-samples');
const NETWORK = SAMPLES + '/test-network-2025/organizations';

// Организации: MSP, адрес пира и порт центра сертификации (CA)
const ORGS = {
    bank: { mspId: 'BankMSP', peer: 'localhost:7051', caPort: 7054 },
    users: { mspId: 'UsersMSP', peer: 'localhost:9051', caPort: 8054 },
};

// Токен сессии -> { org, certificate, privateKey }: сертификат выдаётся при входе и живёт в памяти
const sessions = new Map();


// ===== 1. Fabric CA: регистрация и выдача сертификатов =====

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

// Регистрация: учётная запись водителя в CA организации Users
function register(name, password) {
    runCaClient('users', ['register', '--id.name', name, '--id.secret', password, '--id.type', 'client',
        '--id.affiliation', 'users.department1', '--id.attrs', 'role=driver:ecert'], 'Имя ' + name + ' уже занято');
}

// Вход: CA выдаёт сертификат и ключ, если пароль верный. Возвращает токен сессии
function login(org, name, password) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enroll-'));
    try {
        const url = 'https://' + encodeURIComponent(name) + ':' + encodeURIComponent(password) + '@localhost:' + ORGS[org].caPort;
        runCaClient(org, ['enroll', '-u', url, '-M', dir], 'Неверное имя или пароль');
        const keyFile = fs.readdirSync(dir + '/keystore')[0];
        const token = crypto.randomUUID();
        sessions.set(token, {
            org: org,
            certificate: fs.readFileSync(dir + '/signcerts/cert.pem'),
            privateKey: crypto.createPrivateKey(fs.readFileSync(dir + '/keystore/' + keyFile)),
        });
        return token;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}


// ===== 2. Смарт-контракт: вызов через Fabric Gateway =====

// Одно gRPC-соединение на организацию. После перезапуска сети сертификат пира
// другой, тогда соединение создаётся заново
const clients = {};
function grpcClient(org) {
    const tlsCert = fs.readFileSync(NETWORK + '/peerOrganizations/' + org + '.example.com/tlsca/tlsca.' + org + '.example.com-cert.pem');
    if (!clients[org] || !clients[org].tlsCert.equals(tlsCert)) {
        if (clients[org]) {
            clients[org].client.close();
        }
        clients[org] = {
            tlsCert: tlsCert,
            client: new grpc.Client(ORGS[org].peer, grpc.credentials.createSsl(tlsCert), {
                'grpc.ssl_target_name_override': 'peer0.' + org + '.example.com',
            }),
        };
    }
    return clients[org].client;
}

// Вызов функции контракта от имени пользователя сессии.
// type: 'evaluate' — чтение, блок не создаётся; 'submit' — запись в блок
async function callContract(type, token, method, args) {
    const user = sessions.get(token);
    if (!user) {
        throw new Error('Требуется вход');
    }
    const gateway = fabric.connect({
        client: grpcClient(user.org),
        identity: { mspId: ORGS[user.org].mspId, credentials: user.certificate },
        signer: fabric.signers.newPrivateKeySigner(user.privateKey),
        hash: fabric.hash.SHA256,
    });
    try {
        const contract = gateway.getNetwork('blockchain2025').getContract('traffic');
        let result;
        if (type === 'submit') {
            result = await contract.submit(method, { arguments: args });
        } else {
            result = await contract.evaluate(method, { arguments: args });
        }
        return JSON.parse(Buffer.from(result).toString());
    } catch (error) {
        // Текст ошибки контракта лежит в details
        if (error.details && error.details.length > 0) {
            throw new Error(error.details[0].message.replace(/^.*chaincode response \d+, /, ''));
        }
        throw error;
    } finally {
        gateway.close();
    }
}


// ===== 3. REST API =====

const app = express();
app.use(cors());
app.use(express.json());

// Регистрация водителя: учётная запись в CA, вход, запись водителя в контракте
app.post('/register', async function (req, res) {
    try {
        register(req.body.name, req.body.password);
        const token = login('users', req.body.name, req.body.password);
        await callContract('submit', token, 'RegisterDriver', [req.body.fullName, req.body.experienceStartYear]);
        res.json({ token: token });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Вход: сначала ищем пользователя в Bank, потом в Users
app.post('/login', function (req, res) {
    for (const org of Object.keys(ORGS)) {
        try {
            res.json({ token: login(org, req.body.name, req.body.password) });
            return;
        } catch (error) {
            // В этой организации такого пользователя нет, пробуем следующую
        }
    }
    res.status(400).json({ error: 'Неверное имя или пароль' });
});

// Чтение: GET /contract/<функция>?args=a&args=b, токен в заголовке Authorization
app.get('/contract/:method', async function (req, res) {
    try {
        const args = [].concat(req.query.args || []);
        res.json(await callContract('evaluate', req.headers.authorization, req.params.method, args));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Запись: POST /contract/<функция> с телом { args: [...] }
app.post('/contract/:method', async function (req, res) {
    try {
        const args = req.body.args || [];
        res.json(await callContract('submit', req.headers.authorization, req.params.method, args));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.listen(8091, function () {
    console.log('API: http://localhost:8091');
});
