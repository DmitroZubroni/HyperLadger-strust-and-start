# Подключается через source: задаёт массив PEER_ENV с окружением CLI "от имени"
# администратора организации. Аргумент: bank | users
case "$1" in
  bank)  MSP=BankMSP;  DOMAIN=bank.example.com;  PORT=7051 ;;
  users) MSP=UsersMSP; DOMAIN=users.example.com; PORT=9051 ;;
  *) echo "Неизвестная организация: $1"; exit 1 ;;
esac
ORG_DIR=/work/crypto/peerOrganizations/$DOMAIN
PEER_ADDR=peer0.$DOMAIN:$PORT
PEER_TLS=$ORG_DIR/peers/peer0.$DOMAIN/tls/ca.crt
PEER_ENV=(
  -e CORE_PEER_LOCALMSPID=$MSP
  -e CORE_PEER_ADDRESS=$PEER_ADDR
  -e CORE_PEER_TLS_ROOTCERT_FILE=$PEER_TLS
  -e CORE_PEER_MSPCONFIGPATH=$ORG_DIR/users/Admin@$DOMAIN/msp
)
