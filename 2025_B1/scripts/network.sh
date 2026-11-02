#!/usr/bin/env bash
# Управление сетью: ./scripts/network.sh up | down
# up   — генерирует криптоматериал и блок канала, поднимает контейнеры, создаёт канал
# down — останавливает сеть и удаляет все её данные
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NET="$ROOT/network"
CHANNEL=blockchain2025
IMAGE=hyperledger/fabric-tools:2.5
compose() { docker compose -f "$NET/docker-compose.yaml" "$@"; }

# Запуск утилиты Fabric в одноразовом контейнере (нужен до старта сети)
tools() { docker run --rm -v "$NET:/work" -w /work -e FABRIC_CFG_PATH=/work/config "$IMAGE" "$@"; }

down() {
  compose down --volumes --remove-orphans
  # Контейнеры и образы chaincode создаёт пир, compose про них не знает
  docker ps -aq --filter 'name=dev-peer0' | xargs -r docker rm -f
  docker images -q 'dev-peer0*' | xargs -r docker rmi -f
  # Файлы могли быть созданы контейнером от root — удаляем через контейнер
  docker run --rm -v "$NET:/work" -w /work "$IMAGE" rm -rf crypto channel-artifacts
}

up() {
  echo "==> Криптоматериал организаций"
  tools cryptogen generate --config=config/crypto-config.yaml --output=crypto

  echo "==> Блок канала $CHANNEL"
  mkdir -p "$NET/channel-artifacts"
  tools configtxgen -profile TrafficChannel -channelID "$CHANNEL" \
    -outputBlock channel-artifacts/$CHANNEL.block

  echo "==> Контейнеры"
  compose up -d

  echo "==> Ордерер входит в канал"
  local ORD=crypto/ordererOrganizations/orderer.example.com/orderers/orderer.orderer.example.com/tls
  for i in $(seq 1 15); do
    docker exec cli osnadmin channel join --channelID "$CHANNEL" \
      --config-block channel-artifacts/$CHANNEL.block \
      -o orderer.orderer.example.com:7053 --ca-file $ORD/ca.crt \
      --client-cert $ORD/server.crt --client-key $ORD/server.key && break
    [ "$i" = 15 ] && { echo "ордерер не ответил"; exit 1; }
    sleep 2
  done

  echo "==> Пиры входят в канал"
  for org in bank users; do
    source "$ROOT/scripts/peer-env.sh" "$org"
    for i in $(seq 1 15); do
      docker exec "${PEER_ENV[@]}" cli peer channel join -b channel-artifacts/$CHANNEL.block && break
      [ "$i" = 15 ] && { echo "пир $org не вошёл в канал"; exit 1; }
      sleep 2
    done
  done
  echo "Сеть поднята, канал $CHANNEL создан"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "Использование: $0 up|down"; exit 1 ;;
esac
