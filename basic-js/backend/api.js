'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const grpc = require('@grpc/grpc-js');
const fabric = require('@hyperledger/fabric-gateway');

// Сертификаты сети и папка с пользователями, созданными в терминале:
// wallet/<имя> — результат fabric-ca-client enroll
const NETWORK = path.resolve(__dirname, '../../fabric-samples/test-network/organizations');
const WALLET = path.resolve(__dirname, '../wallet');

// Организации сети: org1 — администратор, org2 — пользователи
const ORGS = {
    org1: { mspId: 'Org1MSP', peer: 'localhost:7051' },
    org2: { mspId: 'Org2MSP', peer: 'localhost:9051' },
};


// ===== 1. Подключение к сети =====

// Подключение к пиру от имени пользователя: его сертификат и ключ из wallet/<имя>.
// Администратор состоит в Org1, все остальные пользователи — в Org2
function connect(name) {
    const msp = WALLET + '/' + name;
    if (!fs.existsSync(msp)) {
        throw new Error('Требуется вход');
    }
    let org = 'org2';
    if (name === 'admin') {
        org = 'org1';
    }

    const certificate = fs.readFileSync(msp + '/signcerts/cert.pem');
    const keyFile = fs.readdirSync(msp + '/keystore')[0];
    const privateKey = crypto.createPrivateKey(fs.readFileSync(msp + '/keystore/' + keyFile));
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
    return { client: client, gateway: gateway };
}

// Вызов метода контракта от имени пользователя из заголовка Authorization.
// type: 'evaluate' — чтение, блок не создаётся; 'submit' — запись в блок
async function callContract(type, req, res, args) {
    let connection = null;
    try {
        connection = connect(req.headers.authorization);
        const contract = connection.gateway.getNetwork('mychannel').getContract('users');
        let result;
        if (type === 'submit') {
            result = await contract.submit(req.params.method, { arguments: args });
        } else {
            result = await contract.evaluate(req.params.method, { arguments: args });
        }
        res.json(JSON.parse(Buffer.from(result).toString()));
    } catch (error) {
        // Текст ошибки контракта лежит в details
        let message = error.message;
        if (error.details && error.details.length > 0) {
            message = error.details[0].message.replace(/^.*chaincode response \d+, /, '');
        }
        res.status(400).json({ error: message });
    } finally {
        if (connection) {
            connection.gateway.close();
            connection.client.close();
        }
    }
}


// ===== 2. REST API =====

const app = express();
app.use(cors());
app.use(express.json());

// Вход: пользователь должен быть в wallet. Токен — его имя
app.post('/login', function (req, res) {
    if (!fs.existsSync(WALLET + '/' + req.body.name)) {
        res.status(400).json({ error: 'Пользователь не найден' });
        return;
    }
    res.json({ token: req.body.name });
});

// Чтение: GET /contract/<метод>?args=a&args=b
app.get('/contract/:method', function (req, res) {
    callContract('evaluate', req, res, [].concat(req.query.args || []));
});

// Запись: POST /contract/<метод> с телом { args: [...] }
app.post('/contract/:method', function (req, res) {
    callContract('submit', req, res, req.body.args || []);
});

app.listen(8091, function () {
    console.log('API: http://localhost:8091');
});
