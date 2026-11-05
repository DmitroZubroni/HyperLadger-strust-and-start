'use strict';
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const cors = require('cors');
const express = require('express');
const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');

const SAMPLES = path.resolve(__dirname, '../../fabric-samples');
const NETWORK = `${SAMPLES}/test-network/organizations`;
const ORGS = {
    org1: { msp: 'Org1MSP', peer: 'localhost:7051', caPort: 7054 },   // администратор
    org2: { msp: 'Org2MSP', peer: 'localhost:9051', caPort: 8054 },   // пользователи
};
const sessions = new Map();     // токен -> { org, name, certificate, key }

// --- Пользователи: официальная утилита fabric-ca-client ---

// Команда выполняется от имени администратора CA организации
function caCommand(org, args) {
    return promisify(execFile)(`${SAMPLES}/bin/fabric-ca-client`,
        [...args, '--caname', `ca-${org}`, '--tls.certfiles', `${NETWORK}/fabric-ca/${org}/ca-cert.pem`],
        { env: { ...process.env, FABRIC_CA_CLIENT_HOME: `${NETWORK}/peerOrganizations/${org}.example.com` } });
}

function register(name, password) {
    return caCommand('org2', ['register', '--id.name', name, '--id.secret', password,
        '--id.type', 'client', '--id.affiliation', 'org2.department1']);
}

// Выпуск сертификата. При неверном пароле CA вернёт ошибку: это и есть проверка входа
async function enroll(org, name, password) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enroll-'));
    try {
        const url = `https://${encodeURIComponent(name)}:${encodeURIComponent(password)}@localhost:${ORGS[org].caPort}`;
        await caCommand(org, ['enroll', '-u', url, '-M', dir]);
        const keyFile = fs.readdirSync(`${dir}/keystore`)[0];
        return {
            org,
            name,
            certificate: fs.readFileSync(`${dir}/signcerts/cert.pem`),
            key: crypto.createPrivateKey(fs.readFileSync(`${dir}/keystore/${keyFile}`)),
        };
    } finally {
        fs.rmSync(dir, { recursive: true });
    }
}

// --- Контракт: Fabric Gateway ---

// Одно gRPC-соединение на организацию: так советует документация Fabric.
// После перезапуска сети сертификат другой, тогда соединение создаётся заново
const clients = {};
function grpcClient(org) {
    const tlsCert = fs.readFileSync(`${NETWORK}/peerOrganizations/${org}.example.com/tlsca/tlsca.${org}.example.com-cert.pem`);
    if (!clients[org]?.tlsCert.equals(tlsCert)) {
        clients[org]?.client.close();
        clients[org] = {
            tlsCert,
            client: new grpc.Client(ORGS[org].peer, grpc.credentials.createSsl(tlsCert), {
                'grpc.ssl_target_name_override': `peer0.${org}.example.com`,
            }),
        };
    }
    return clients[org].client;
}

// Вызов любого метода контракта от имени пользователя: evaluate читает, submit записывает в блок
async function callContract(kind, user, method, args) {
    const gateway = connect({
        client: grpcClient(user.org),
        identity: { mspId: ORGS[user.org].msp, credentials: user.certificate },
        signer: signers.newPrivateKeySigner(user.key),
        hash: hash.SHA256,
    });
    try {
        const contract = gateway.getNetwork('mychannel').getContract('users');
        const call = kind === 'submit' ? contract.submitTransaction(method, ...args) : contract.evaluateTransaction(method, ...args);
        return JSON.parse(Buffer.from(await call).toString());
    } finally {
        gateway.close();
    }
}

// --- REST API ---

function openSession(user) {
    const token = crypto.randomUUID();
    sessions.set(token, user);
    return { token };
}

const app = express();
app.use(cors());
app.use(express.json());

const route = (handler) => (req, res) => handler(req).then((data) => res.json(data)).catch((err) => {
    res.status(400).json({ error: err.details?.[0]?.message.replace(/^.*?chaincode response \d+, /, '') || err.message });
});

app.post('/register', route(async (req) => {
    const { name, password, address } = req.body;
    if (!name || !password || !address) throw new Error('Укажите имя, пароль и адрес');
    await register(name, password).catch(() => {
        throw new Error('Не удалось зарегистрировать: имя занято или недопустимо');   // текст утилиты содержит пароль
    });
    const user = await enroll('org2', name, password);
    await callContract('submit', user, 'RegisterUser', [address]);
    return openSession(user);
}));

app.post('/login', route(async (req) => {
    const { name, password } = req.body;
    for (const org of ['org1', 'org2']) {
        const user = await enroll(org, name, password).catch(() => null);
        if (user) return openSession(user);
    }
    throw new Error('Неверное имя или пароль');
}));

// Один маршрут на все методы контракта
app.post('/:kind(evaluate|submit)/:method', route(async (req) => {
    const user = sessions.get(req.headers.authorization);
    if (!user) throw new Error('Требуется вход');
    return callContract(req.params.kind, user, req.params.method, req.body.args || []);
}));

app.listen(8091, () => console.log('API: http://localhost:8091'));
