'use strict';
/**
 * Связь с сетью Fabric:
 *  - Fabric CA: регистрация и выпуск сертификатов пользователей;
 *  - Fabric Gateway: вызов функций смарт-контракта от имени пользователя.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const grpc = require('@grpc/grpc-js');
const { connect, hash, signers, GatewayError } = require('@hyperledger/fabric-gateway');
const FabricCAServices = require('fabric-ca-client');
const { User } = require('fabric-common');

const CHANNEL = 'blockchain2025';
const CHAINCODE = 'traffic';
const CRYPTO = path.join(__dirname, '..', 'network', 'crypto', 'peerOrganizations');
const CA_ADMIN = { login: 'admin', password: process.env.CA_ADMIN_PASSWORD || 'adminpw' };

// Каждая организация обращается к своему пиру и к своему центру сертификации.
const ORGS = {
    Bank: { mspId: 'BankMSP', domain: 'bank.example.com', peer: 'localhost:7051', caUrl: 'https://localhost:7054', caName: 'ca-bank' },
    Users: { mspId: 'UsersMSP', domain: 'users.example.com', peer: 'localhost:9051', caUrl: 'https://localhost:8054', caName: 'ca-users' },
};

const readCaCert = (org) => fs.readFileSync(path.join(CRYPTO, org.domain, 'ca', `ca.${org.domain}-cert.pem`));

function getOrg(orgName) {
    const org = ORGS[orgName];
    if (!org) {
        throw new Error(`Неизвестная организация: ${orgName}`);
    }
    return org;
}

function caClient(org) {
    return new FabricCAServices(org.caUrl, { trustedRoots: [readCaCert(org)], verify: true }, org.caName);
}

/** Выпуск сертификата. Неверный пароль вызовет ошибку CA, поэтому это и есть проверка входа. */
async function enroll(orgName, login, password) {
    const org = getOrg(orgName);
    const result = await caClient(org).enroll({ enrollmentID: login, enrollmentSecret: password });
    return { orgName, login, certificate: result.certificate, privateKey: result.key.toBytes() };
}

/**
 * Регистрация пользователя в CA организации. Регистрирует администратор CA.
 * Атрибут role с ecert:true попадает в сертификат, и контракт читает его оттуда.
 */
async function registerIdentity(orgName, login, password, role) {
    const org = getOrg(orgName);
    const admin = await enroll(orgName, CA_ADMIN.login, CA_ADMIN.password);
    const adminUser = User.createUser(admin.login, CA_ADMIN.password, org.mspId, admin.certificate, admin.privateKey);
    await caClient(org).register({
        enrollmentID: login,
        enrollmentSecret: password,
        role: 'client',
        affiliation: '',
        maxEnrollments: -1,               // каждый вход выпускает новый сертификат
        attrs: [{ name: 'role', value: role, ecert: true }],
    }, adminUser);
}

// Одно gRPC-соединение на организацию, общее для всех её пользователей.
const clients = new Map();

function grpcClient(org) {
    if (!clients.has(org.mspId)) {
        const tlsCert = fs.readFileSync(path.join(CRYPTO, org.domain, 'peers', `peer0.${org.domain}`, 'tls', 'ca.crt'));
        clients.set(org.mspId, new grpc.Client(org.peer, grpc.credentials.createSsl(tlsCert)));
    }
    return clients.get(org.mspId);
}

/** Контракт, подключённый от имени пользователя identity. */
function contractFor(identity) {
    const org = getOrg(identity.orgName);
    const gateway = connect({
        client: grpcClient(org),
        identity: { mspId: org.mspId, credentials: Buffer.from(identity.certificate) },
        signer: signers.newPrivateKeySigner(crypto.createPrivateKey(identity.privateKey)),
        hash: hash.SHA256,
    });
    return gateway.getNetwork(CHANNEL).getContract(CHAINCODE);
}

const decode = (bytes) => JSON.parse(Buffer.from(bytes).toString('utf8'));

/** Чтение: выполняется на пире, в реестр не попадает. */
async function evaluate(identity, fn, ...args) {
    return decode(await contractFor(identity).evaluateTransaction(fn, ...args.map(String)));
}

/**
 * Запись: одобрение пирами, упорядочивание, запись в блок.
 * Транзакции над одним ключом могут конфликтовать (MVCC), тогда запрос повторяется.
 */
async function submit(identity, fn, ...args) {
    const MVCC_READ_CONFLICT = 11;
    for (let attempt = 1; ; attempt++) {
        try {
            return decode(await contractFor(identity).submitTransaction(fn, ...args.map(String)));
        } catch (err) {
            if (err.code !== MVCC_READ_CONFLICT || attempt === 3) {
                throw err;
            }
        }
    }
}

/** Понятный текст ошибки: сообщение контракта лежит в details ошибки Gateway. */
function errorText(err) {
    if (err instanceof GatewayError && err.details && err.details.length > 0) {
        return err.details[0].message.replace(/^.*?(chaincode response \d+, )/, '');
    }
    return err.message;
}

module.exports = { enroll, registerIdentity, evaluate, submit, errorText };
