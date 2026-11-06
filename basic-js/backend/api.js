'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const grpc = require('@grpc/grpc-js');
const fabric = require('@hyperledger/fabric-gateway');

// Организации и пользователи сети лежат в fabric-samples:
// peerOrganizations/<организация>/users/<имя>@<организация>/msp — сертификат и ключ пользователя
const PEER_ORGS = path.resolve(__dirname, '../../fabric-samples/test-network/organizations/peerOrganizations');
const PORT = process.env.PORT || 8091;

// Пользователь — имя его папки: <имя>@<организация>. Только буквы, цифры, точка, дефис и подчёркивание
const USER = /^([\w.-]+)@([\w.-]+)$/;


// ===== 1. Подключение к сети =====

// Подключение к пиру организации от имени пользователя.
// Организация — часть имени (после @), поэтому здесь её не ищем.
// Адрес пира и его TLS-сертификат — из профиля connection-<org>.json, который создаёт network.sh
function connect(user) {
    const match = USER.exec(user || '');
    const msp = PEER_ORGS + '/' + (match && match[2]) + '/users/' + user + '/msp';
    if (!match || !fs.existsSync(msp)) {
        throw new Error('Требуется вход');
    }
    const orgDir = match[2];
    const profile = JSON.parse(fs.readFileSync(PEER_ORGS + '/' + orgDir + '/connection-' + orgDir.split('.')[0] + '.json'));
    const org = Object.values(profile.organizations)[0];
    const peer = profile.peers[org.peers[0]];

    const certificate = fs.readFileSync(msp + '/signcerts/' + fs.readdirSync(msp + '/signcerts')[0]);
    const privateKey = crypto.createPrivateKey(fs.readFileSync(msp + '/keystore/' + fs.readdirSync(msp + '/keystore')[0]));

    const client = new grpc.Client(peer.url.replace('grpcs://', ''), grpc.credentials.createSsl(Buffer.from(peer.tlsCACerts.pem)), {
        'grpc.ssl_target_name_override': peer.grpcOptions['ssl-target-name-override'],
    });
    const gateway = fabric.connect({
        client: client,
        identity: { mspId: org.mspid, credentials: certificate },
        signer: fabric.signers.newPrivateKeySigner(privateKey),
        hash: fabric.hash.SHA256,
    });
    return { client: client, gateway: gateway };
}

// Вызов метода контракта от имени пользователя из заголовка Authorization.
// type: 'evaluate' — чтение, блок не создаётся; 'submit' — запись в блок.
// Кому какой метод доступен, решает контракт по организации и имени из сертификата
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

// Вход по имени: ищем папку пользователя во всех организациях сети — только здесь.
// Можно ввести и полное имя папки (Admin@org1.example.com), если имя есть в нескольких организациях.
// Токен — полное имя папки: по нему connect сразу знает организацию
app.post('/login', function (req, res) {
    const name = String(req.body.name || '').toLowerCase();
    const found = [];
    for (const orgDir of fs.readdirSync(PEER_ORGS)) {
        const users = PEER_ORGS + '/' + orgDir + '/users';
        if (!fs.existsSync(users)) {
            continue;
        }
        for (const user of fs.readdirSync(users)) {
            if (USER.test(user) && (user.toLowerCase() === name || user.split('@')[0].toLowerCase() === name)) {
                found.push(user);
            }
        }
    }
    if (found.length === 0) {
        res.status(400).json({ error: 'Пользователь не найден' });
        return;
    }
    if (found.length > 1) {
        res.status(400).json({ error: 'Имя есть в нескольких организациях, введите полностью: ' + found.join(', ') });
        return;
    }
    res.json({ token: found[0] });
});

// Чтение: GET /contract/<метод>?args=a&args=b
app.get('/contract/:method', function (req, res) {
    callContract('evaluate', req, res, [].concat(req.query.args || []));
});

// Запись: POST /contract/<метод> с телом { args: [...] }
app.post('/contract/:method', function (req, res) {
    callContract('submit', req, res, req.body.args || []);
});

app.listen(PORT, function () {
    console.log('API: http://localhost:' + PORT);
});
