'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const cors = require('cors');
const express = require('express');
const FabricCAServices = require('fabric-ca-client');
const { Gateway, Wallets } = require('fabric-network');

const NETWORK = path.resolve(__dirname, '../../fabric-samples/test-network/organizations/peerOrganizations');
const ORGS = {
    org1: { msp: 'Org1MSP', ccp: require(`${NETWORK}/org1.example.com/connection-org1.json`) },   // администратор
    org2: { msp: 'Org2MSP', ccp: require(`${NETWORK}/org2.example.com/connection-org2.json`) },   // пользователи
};
const sessions = new Map();                     // токен -> { org, name }
const walletPromise = Wallets.newInMemoryWallet();   // сертификаты и ключи вошедших пользователей

function caClient(org) {
    const ca = ORGS[org].ccp.certificateAuthorities[`ca.${org}.example.com`];
    return new FabricCAServices(ca.url, { trustedRoots: ca.tlsCACerts.pem, verify: false }, ca.caName);
}

// Выпуск сертификата. При неверном пароле CA вернёт ошибку: это и есть проверка входа
async function enroll(org, name, password) {
    const { certificate, key } = await caClient(org).enroll({ enrollmentID: name, enrollmentSecret: password });
    const wallet = await walletPromise;
    await wallet.put(`${org}:${name}`, {
        credentials: { certificate, privateKey: key.toBytes() },
        mspId: ORGS[org].msp,
        type: 'X.509',
    });
}

// Новый пользователь в CA организации: его регистрирует admin этой организации
async function register(name, password) {
    await enroll('org2', 'admin', 'adminpw');
    const wallet = await walletPromise;
    const identity = await wallet.get('org2:admin');
    const admin = await wallet.getProviderRegistry().getProvider(identity.type).getUserContext(identity, 'admin');
    await caClient('org2').register({
        enrollmentID: name, enrollmentSecret: password, role: 'client', affiliation: 'org2.department1', maxEnrollments: -1,
    }, admin);
    await enroll('org2', name, password);
}

// Вызов любого метода контракта от имени пользователя
async function callContract(kind, { org, name }, method, args) {
    const gateway = new Gateway();
    await gateway.connect(ORGS[org].ccp, {
        wallet: await walletPromise,
        identity: `${org}:${name}`,
        discovery: { enabled: true, asLocalhost: true },
    });
    try {
        const contract = (await gateway.getNetwork('mychannel')).getContract('users');
        const result = kind === 'submit' ? await contract.submitTransaction(method, ...args) : await contract.evaluateTransaction(method, ...args);
        return JSON.parse(result.toString());
    } finally {
        gateway.disconnect();
    }
}

function openSession(org, name) {
    const token = crypto.randomUUID();
    sessions.set(token, { org, name });
    return { token };
}

const app = express();
app.use(cors());
app.use(express.json());

const route = (handler) => (req, res) => handler(req).then((data) => res.json(data)).catch((err) => {
    res.status(400).json({ error: /message=(.*)/.exec(err.message)?.[1] || err.message });   // текст ошибки контракта
});

app.post('/register', route(async (req) => {
    const { name, password, address } = req.body;
    await register(name, password);
    await callContract('submit', { org: 'org2', name }, 'RegisterUser', [address]);
    return openSession('org2', name);
}));

app.post('/login', route(async (req) => {
    const { name, password } = req.body;
    try {
        await enroll('org1', name, password);
        return openSession('org1', name);
    } catch {
        await enroll('org2', name, password).catch(() => {
            throw new Error('Неверное имя или пароль');
        });
        return openSession('org2', name);
    }
}));

// Один маршрут на все методы контракта: evaluate читает, submit записывает в блок
app.post('/:kind(evaluate|submit)/:method', route(async (req) => {
    const user = sessions.get(req.headers.authorization);
    if (!user) throw new Error('Требуется вход');
    return callContract(req.params.kind, user, req.params.method, req.body.args || []);
}));

app.listen(8091, () => console.log('API: http://localhost:8091'));
