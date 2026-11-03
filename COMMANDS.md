# Команды Hyperledger Fabric

Шпаргалка для локальной сети `test-network`, Fabric 2.5. Все команды выполняются из папки `fabric-samples/test-network`, если не сказано другое.

## Подготовка терминала

Выполните один раз в каждом новом терминале:

```bash
cd fabric-samples/test-network
export PATH=$PWD/../bin:$PATH FABRIC_CFG_PATH=$PWD/../config CORE_PEER_TLS_ENABLED=true
export ORDERER_CA=$PWD/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem
export ORG1_TLS=$PWD/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export ORG2_TLS=$PWD/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt

# Работать от имени администратора организации: as_org1 или as_org2
as_org1() {
  export CORE_PEER_LOCALMSPID=Org1MSP CORE_PEER_ADDRESS=localhost:7051 CORE_PEER_TLS_ROOTCERT_FILE=$ORG1_TLS
  export CORE_PEER_MSPCONFIGPATH=$PWD/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
  export FABRIC_CA_CLIENT_HOME=$PWD/organizations/peerOrganizations/org1.example.com
}
as_org2() {
  export CORE_PEER_LOCALMSPID=Org2MSP CORE_PEER_ADDRESS=localhost:9051 CORE_PEER_TLS_ROOTCERT_FILE=$ORG2_TLS
  export CORE_PEER_MSPCONFIGPATH=$PWD/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp
  export FABRIC_CA_CLIENT_HOME=$PWD/organizations/peerOrganizations/org2.example.com
}
as_org1
```

## Сеть

```bash
./network.sh up createChannel -ca                # поднять сеть с центрами сертификации и каналом mychannel
./network.sh up createChannel -ca -c mychannel2  # то же с другим именем канала
./network.sh createChannel -c mychannel2         # создать ещё один канал на работающей сети
./network.sh down                                # остановить сеть и удалить все её данные
```

| Что | Порт |
| --- | --- |
| Ордерер / его администрирование / состояние | 7050 / 7053 / 9443 |
| Пир Org1 / состояние | 7051 / 9444 |
| Пир Org2 / состояние | 9051 / 9445 |
| CA Org1 / CA Org2 / CA ордерера | 7054 / 8054 / 9054 |

## Состояние ноды

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'   # какие контейнеры запущены
docker logs --tail 50 peer0.org1.example.com         # журнал пира
docker logs --tail 50 orderer.example.com            # журнал ордерера
curl localhost:9444/healthz                          # пир работает: {"status":"OK",...}
curl localhost:9443/healthz                          # ордерер работает
curl -s localhost:9444/metrics | grep ledger_blockchain_height   # высота цепочки по метрикам

peer channel list                                    # в каких каналах состоит пир
peer channel getinfo -c mychannel                    # высота цепочки и хэш последнего блока
peer lifecycle chaincode queryinstalled              # контракты, установленные на пире
peer lifecycle chaincode querycommitted -C mychannel # контракты, работающие в канале

# Каналы на ордерере
osnadmin channel list -o localhost:7053 --ca-file $ORDERER_CA \
  --client-cert organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.crt \
  --client-key organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.key
```

## Смарт-контракт

```bash
# Деплой. Язык: javascript, java, go, typescript
./network.sh deployCC -ccn users -ccp ../../basic-js/backend -ccl javascript

# Обновление: версию и sequence увеличивайте при каждом обновлении, данные сохраняются
./network.sh deployCC -ccn users -ccp ../../basic-js/backend -ccl javascript -ccv 2 -ccs 2

# Чтение: блок не создаётся
peer chaincode query -C mychannel -n users -c '{"function":"GetUsers","Args":[]}'

# Запись: нужны одобрения обеих организаций, создаётся блок
peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls --cafile $ORDERER_CA \
  -C mychannel -n users \
  --peerAddresses localhost:7051 --tlsRootCertFiles $ORG1_TLS \
  --peerAddresses localhost:9051 --tlsRootCertFiles $ORG2_TLS \
  -c '{"function":"BlockUser","Args":["ivan"]}'
```

Контракты из этого репозитория проверяют организацию и имя вызывающего, поэтому часть методов вернёт отказ от чужого имени.

## Содержимое блока

```bash
peer channel fetch newest newest.block -c mychannel   # последний блок; вместо newest можно указать номер
configtxlator proto_decode --type common.Block --input newest.block --output newest.json

# Что записала последняя транзакция контракта users
jq -r '.data.data[0].payload.data.actions[0].payload.action.proposal_response_payload.extension.results.ns_rwset[]
  | select(.namespace=="users") | .rwset.writes[] | .key + " = " + (.value | @base64d)' newest.json
```

## Пользователи и сертификаты

У каждой организации свой CA. Пример для Org2. Для Org1 выполните `as_org1`, порт `7054`, имя `ca-org1`, сертификат `org1`, подразделение `org1.department1`.

```bash
as_org2
export CA_CERT=$PWD/organizations/fabric-ca/org2/ca-cert.pem

# Список пользователей и подразделений
fabric-ca-client identity list --caname ca-org2 --tls.certfiles $CA_CERT
fabric-ca-client affiliation list --caname ca-org2 --tls.certfiles $CA_CERT

# 1. Зарегистрировать пользователя. Атрибут с :ecert попадёт в сертификат
fabric-ca-client register --caname ca-org2 --id.name ivan --id.secret ivanpw --id.type client \
  --id.affiliation org2.department1 --id.attrs 'role=driver:ecert' --tls.certfiles $CA_CERT

# 2. Выпустить сертификат и ключ в папку
fabric-ca-client enroll -u https://ivan:ivanpw@localhost:8054 --caname ca-org2 --tls.certfiles $CA_CERT \
  -M $PWD/wallet/ivan/msp
cp organizations/peerOrganizations/org2.example.com/msp/config.yaml wallet/ivan/msp/config.yaml

# 3. Посмотреть сертификат: имя, срок, издатель, атрибуты
openssl x509 -in wallet/ivan/msp/signcerts/cert.pem -noout -subject -issuer -enddate
openssl x509 -in wallet/ivan/msp/signcerts/cert.pem -noout -text | grep -A1 '1.2.3.4.5.6.7.8.1'

# 4. Работать от имени пользователя: дальше peer chaincode query и invoke идут от него
export CORE_PEER_MSPCONFIGPATH=$PWD/wallet/ivan/msp

# Вернуться к администратору
as_org2

# Отозвать пользователя в CA
fabric-ca-client revoke --caname ca-org2 -e ivan -r cessationofoperation --gencrl --tls.certfiles $CA_CERT
```

После `revoke` сеть не начнёт отклонять сертификат сразу. Список отозванных сертификатов (`crl.pem`) нужно добавить в папку `crls` локальных MSP пиров и в MSP конфигурации канала. Этих шагов в файле нет.

## Новая организация

```bash
cd addOrg3
./addOrg3.sh up -ca     # создаёт Org3 с пиром и CA и подключает её к каналу mychannel
cd ..

docker ps | grep org3   # peer0.org3.example.com и ca_org3

# Работать от имени администратора Org3
export CORE_PEER_LOCALMSPID=Org3MSP CORE_PEER_ADDRESS=localhost:11051
export CORE_PEER_TLS_ROOTCERT_FILE=$PWD/organizations/peerOrganizations/org3.example.com/tlsca/tlsca.org3.example.com-cert.pem
export CORE_PEER_MSPCONFIGPATH=$PWD/organizations/peerOrganizations/org3.example.com/users/Admin@org3.example.com/msp
peer channel list
```

CA новой организации работает на порту `11054`, имя `ca-org3`, сертификат `addOrg3/fabric-ca/org3/ca-cert.pem`.

Подключение к каналу не устанавливает на неё контракт. Чтобы вызывать его через пир Org3, установите контракт и одобрите его определение от имени Org3.

## Смена имён организаций

В `network.sh` нет параметра с именем организации, поэтому делается копия сети с заменой имён в её файлах. Документация Fabric не рекомендует менять скрипты тестовой сети, так как это может её сломать, поэтому оригинал остаётся нетронутым. Набор ниже я проверил на Fabric 2.5.16; при другой версии проверьте заново. Команды выполняются из папки `fabric-samples`, старая сеть должна быть остановлена. Пример: Org1 → Bank, Org2 → Users. Имя пишется латиницей и начинается с заглавной буквы, короткое имя тем же словом строчными буквами.

```bash
A=Bank; a=bank; B=Users; b=users; NET=test-network-$a

cp -R test-network $NET && cd $NET
mv organizations/fabric-ca/org1 organizations/fabric-ca/$a
mv organizations/fabric-ca/org2 organizations/fabric-ca/$b
mv organizations/cryptogen/crypto-config-org1.yaml organizations/cryptogen/crypto-config-$a.yaml
mv organizations/cryptogen/crypto-config-org2.yaml organizations/cryptogen/crypto-config-$b.yaml

# Шаблоны профилей подключения собирали имя из номера: Org${ORG}
perl -pi -e 's/org\$\{ORG\}/\${ORG}/g; s/Org\$\{ORG\}/\${ORGNAME}/g' organizations/ccp-template.json organizations/ccp-template.yaml
perl -pi -e 's/sed -e "s\/\\\$\{ORG\}\/\$1\/" /sed -e "s\/\\\${ORG}\/\$1\/" -e "s\/\\\${ORGNAME}\/\$6\/" /; s/^ORG=1$/ORG=org1\nNAME=Org1/; s/^ORG=2$/ORG=org2\nNAME=Org2/; s/\$CAPEM\)/\$CAPEM \$NAME)/' organizations/ccp-generate.sh

# Замена имён во всех файлах сети
LC_ALL=C grep -rIlE '[oO]rg[12]' network.sh setOrgEnv.sh organizations/ccp-generate.sh organizations/fabric-ca organizations/cryptogen compose configtx scripts \
  | LC_ALL=C xargs perl -pi -e "s/org1/$a/g; s/Org1/$A/g; s/org2/$b/g; s/Org2/$B/g"

./network.sh up createChannel -ca
```

После этого MSP называются `BankMSP` и `UsersMSP`, а файлы лежат в `organizations/peerOrganizations/bank.example.com`. Дальше работайте из этой новой папки.

Вместе с именами поменяйте их в своём коде: константы `Org1MSP` и `Org2MSP` в контракте, а в API пути, имена CA (`ca-bank`), адрес пира (`peer0.bank.example.com`) и подразделения (`bank.department1`). Скрипт `addOrg3` в такой копии не обновлён, новую организацию в ней он не добавит.
