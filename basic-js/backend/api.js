'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const grpc = require('@grpc/grpc-js');
const fabric = require('@hyperledger/fabric-gateway');

// Пользователей создаёт разработчик в терминале (fabric-ca-client register и enroll),
// их ключи лежат в peerOrganizations/<организация>/users/<имя>@<организация>/msp
const NETWORK = path.resolve(__dirname, '../../fabric-samples/test-network/organizations/peerOrganizations');

// Организации сети: MSP и адрес пира
const ORGS = {
    'org1.example.com': { mspId: 'Org1MSP', peer: 'localhost:7051' },
    'org2.example.com': { mspId: 'Org2MSP', peer: 'localhost:9051' },
};


// ===== 1. Подключение к сети =====

// Одно gRPC-соединение на организацию. После перезапуска сети сертификат пира
// другой, тогда соединение создаётся заново
const clients = {};
function grpcClient(org) {
    const tlsCert = fs.readFileSync(NETWORK + '/' + org + '/tlsca/tlsca.' + org + '-cert.pem');
    if (!clients[org] || !clients[org].tlsCert.equals(tlsCert)) {
        if (clients[org]) {
            clients[org].client.close();
        }
        clients[org] = {
            tlsCert: tlsCert,
            client: new grpc.Client(ORGS[org].peer, grpc.credentials.createSsl(tlsCert), {
                'grpc.ssl_target_name_override': 'peer0.' + org,
            }),
        };
    }
    return clients[org].client;
}

// Вызов метода контракта от имени пользователя, например ivan@org2.example.com.
// type: 'evaluate' — чтение, блок не создаётся; 'submit' — запись в блок
async function callContract(type, user, method, args) {
    const org = String(user).split('@')[1];
    const msp = NETWORK + '/' + org + '/users/' + user + '/msp';
    if (!ORGS[org] || !fs.existsSync(msp)) {
        throw new Error('Пользователь не найден');
    }
    const certificate = fs.readFileSync(msp + '/signcerts/cert.pem');
    const keyFile = fs.readdirSync(msp + '/keystore')[0];
    const privateKey = crypto.createPrivateKey(fs.readFileSync(msp + '/keystore/' + keyFile));

    const gateway = fabric.connect({
        client: grpcClient(org),
        identity: { mspId: ORGS[org].mspId, credentials: certificate },
        signer: fabric.signers.newPrivateKeySigner(privateKey),
        hash: fabric.hash.SHA256,
    });
    try {
        // default name for network is "myChannel" and for contract is "basic"
        const contract = gateway.getNetwork('mychannel').getContract('basic');
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


// ===== 2. REST API =====

const app = express();
app.use(cors());
app.use(express.json());

// Чтение: GET /contract/<метод>?args=a&args=b, имя пользователя в заголовке Authorization
app.get('/contract/:method', async function (req, res) {
    try {
        const args = [].concat(req.query.args || []);
        res.json(await callContract('evaluate', req.headers.authorization, req.params.method, args));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Запись: POST /contract/<метод> с телом { args: [...] }
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
