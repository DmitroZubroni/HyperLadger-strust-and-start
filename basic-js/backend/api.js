'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const grpc = require('@grpc/grpc-js');
const fabric = require('@hyperledger/fabric-gateway');

// Сертификаты сети и папка с пользователями, созданными в терминале:
// wallet/<организация>/<имя> — результат fabric-ca-client enroll
const NETWORK = path.resolve(__dirname, '../../fabric-samples/test-network/organizations');
const WALLET = path.resolve(__dirname, '../wallet');

// Организации сети: org1 — администратор, org2 — пользователи
const ORGS = {
    org1: { mspId: 'Org1MSP', peer: 'localhost:7051' },
    org2: { mspId: 'Org2MSP', peer: 'localhost:9051' },
};

// Имя пользователя -> контракт, подключённый от его имени
const contracts = new Map();


// ===== 1. Подключение к сети: один раз при запуске API =====

for (const org of Object.keys(ORGS)) {
    const orgWallet = WALLET + '/' + org;
    if (!fs.existsSync(orgWallet)) {
        continue;
    }

    // gRPC-соединение с пиром организации по TLS
    const peerTls = fs.readFileSync(NETWORK + '/peerOrganizations/' + org + '.example.com/tlsca/tlsca.' + org + '.example.com-cert.pem');
    const client = new grpc.Client(ORGS[org].peer, grpc.credentials.createSsl(peerTls), {
        'grpc.ssl_target_name_override': 'peer0.' + org + '.example.com',
    });

    // Каждый пользователь организации подключается со своим сертификатом и ключом
    for (const name of fs.readdirSync(orgWallet)) {
        const msp = orgWallet + '/' + name;
        const certificate = fs.readFileSync(msp + '/signcerts/cert.pem');
        const keyFile = fs.readdirSync(msp + '/keystore')[0];
        const privateKey = crypto.createPrivateKey(fs.readFileSync(msp + '/keystore/' + keyFile));

        const gateway = fabric.connect({
            client: client,
            identity: { mspId: ORGS[org].mspId, credentials: certificate },
            signer: fabric.signers.newPrivateKeySigner(privateKey),
            hash: fabric.hash.SHA256,
        });
        contracts.set(name, gateway.getNetwork('mychannel').getContract('users'));
        console.log('Пользователь ' + name + ' (' + ORGS[org].mspId + ')');
    }
}


// ===== 2. REST API =====

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

// Контракт пользователя из заголовка Authorization (в нём имя пользователя)
function getContract(req) {
    const contract = contracts.get(req.headers.authorization);
    if (!contract) {
        throw new Error('Требуется вход');
    }
    return contract;
}

// Вход: пользователь должен быть в wallet
app.post('/login', function (req, res) {
    if (!contracts.has(req.body.name)) {
        sendError(res, new Error('Пользователь не найден'));
        return;
    }
    res.json({ token: req.body.name });
});

// Чтение: GET /contract/<метод>?args=a&args=b, блок не создаётся
app.get('/contract/:method', async function (req, res) {
    try {
        const args = [].concat(req.query.args || []);
        const result = await getContract(req).evaluate(req.params.method, { arguments: args });
        res.json(JSON.parse(Buffer.from(result).toString()));
    } catch (error) {
        sendError(res, error);
    }
});

// Запись: POST /contract/<метод> с телом { args: [...] }, транзакция попадает в блок
app.post('/contract/:method', async function (req, res) {
    try {
        const args = req.body.args || [];
        const result = await getContract(req).submit(req.params.method, { arguments: args });
        res.json(JSON.parse(Buffer.from(result).toString()));
    } catch (error) {
        sendError(res, error);
    }
});

app.listen(8091, function () {
    console.log('API: http://localhost:8091');
});
