#!/usr/bin/env bash
# Деплой chaincode: упаковка, установка, одобрение обеими организациями, коммит.
# Обновление: ./scripts/deploy.sh <версия> <sequence>, например ./scripts/deploy.sh 1.1 2
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANNEL=blockchain2025
NAME=traffic
VERSION="${1:-1.0}"
SEQUENCE="${2:-1}"
LABEL="${NAME}_${VERSION}"
ORDERER_CA=/work/crypto/ordererOrganizations/orderer.example.com/orderers/orderer.orderer.example.com/tls/ca.crt
ORDERER="-o orderer.orderer.example.com:7050 --tls --cafile $ORDERER_CA"

echo "==> Упаковка"
docker exec cli peer lifecycle chaincode package "/tmp/$LABEL.tar.gz" \
  --path /work/chaincode --lang node --label "$LABEL"

for org in bank users; do
  source "$ROOT/scripts/peer-env.sh" "$org"
  echo "==> $org: установка (первая сборка образа занимает пару минут)"
  docker exec "${PEER_ENV[@]}" cli peer lifecycle chaincode install "/tmp/$LABEL.tar.gz" || true
  PACKAGE_ID=$(docker exec "${PEER_ENV[@]}" cli peer lifecycle chaincode queryinstalled \
    | sed -n "s/^Package ID: \(${LABEL}:[^,]*\), Label.*/\1/p")
  [ -n "$PACKAGE_ID" ] || { echo "Пакет $LABEL не установлен на $org"; exit 1; }

  echo "==> $org: одобрение ($PACKAGE_ID)"
  docker exec "${PEER_ENV[@]}" cli peer lifecycle chaincode approveformyorg $ORDERER \
    --channelID "$CHANNEL" --name "$NAME" --version "$VERSION" \
    --package-id "$PACKAGE_ID" --sequence "$SEQUENCE"
done

echo "==> Готовность к коммиту"
docker exec "${PEER_ENV[@]}" cli peer lifecycle chaincode checkcommitreadiness \
  --channelID "$CHANNEL" --name "$NAME" --version "$VERSION" --sequence "$SEQUENCE"

echo "==> Коммит"
source "$ROOT/scripts/peer-env.sh" bank
BANK_TLS=$PEER_TLS
source "$ROOT/scripts/peer-env.sh" users
USERS_TLS=$PEER_TLS
docker exec "${PEER_ENV[@]}" cli peer lifecycle chaincode commit $ORDERER \
  --channelID "$CHANNEL" --name "$NAME" --version "$VERSION" --sequence "$SEQUENCE" \
  --peerAddresses peer0.bank.example.com:7051 --tlsRootCertFiles "$BANK_TLS" \
  --peerAddresses peer0.users.example.com:9051 --tlsRootCertFiles "$USERS_TLS"

docker exec "${PEER_ENV[@]}" cli peer lifecycle chaincode querycommitted --channelID "$CHANNEL" --name "$NAME"
