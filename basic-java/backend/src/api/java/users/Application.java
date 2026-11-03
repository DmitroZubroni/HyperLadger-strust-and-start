package users;

import io.grpc.Grpc;
import io.grpc.ManagedChannel;
import io.grpc.TlsChannelCredentials;
import java.io.File;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.PrivateKey;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.hyperledger.fabric.client.Contract;
import org.hyperledger.fabric.client.Gateway;
import org.hyperledger.fabric.client.GatewayException;
import org.hyperledger.fabric.client.Hash;
import org.hyperledger.fabric.client.identity.Identities;
import org.hyperledger.fabric.client.identity.Signers;
import org.hyperledger.fabric.client.identity.X509Identity;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
@RestController
@CrossOrigin
public class Application {
    private static final Path SAMPLES = Path.of("../../fabric-samples").toAbsolutePath().normalize();
    private static final Path NETWORK = SAMPLES.resolve("test-network/organizations");

    private record Org(String id, String msp, String peer, int caPort) {
        Path dir() {
            return NETWORK.resolve("peerOrganizations/" + id + ".example.com");
        }
    }

    private record Session(Org org, String certificate, PrivateKey key) {
    }

    private static final Org ADMINS = new Org("org1", "Org1MSP", "localhost:7051", 7054);   // администратор
    private static final Org USERS = new Org("org2", "Org2MSP", "localhost:9051", 8054);    // пользователи

    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    private final Map<String, ManagedChannel> channels = new ConcurrentHashMap<>();

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }

    // --- Пользователи: официальная утилита fabric-ca-client ---

    // Команда выполняется от имени администратора CA организации
    private void caCommand(Org org, String... args) throws Exception {
        List<String> command = new ArrayList<>(List.of(SAMPLES.resolve("bin/fabric-ca-client").toString()));
        command.addAll(List.of(args));
        command.addAll(List.of("--caname", "ca-" + org.id(),
                "--tls.certfiles", NETWORK.resolve("fabric-ca/" + org.id() + "/ca-cert.pem").toString()));
        ProcessBuilder builder = new ProcessBuilder(command).redirectErrorStream(true);
        builder.redirectOutput(ProcessBuilder.Redirect.DISCARD);
        builder.environment().put("FABRIC_CA_CLIENT_HOME", org.dir().toString());
        if (builder.start().waitFor() != 0) {
            throw new Exception("Ошибка CA");     // текст утилиты содержит пароль, клиенту его не отдаём
        }
    }

    // Выпуск сертификата. При неверном пароле CA вернёт ошибку: это и есть проверка входа
    private Session enroll(Org org, String name, String password) throws Exception {
        Path dir = Files.createTempDirectory("enroll-");
        try {
            String url = "https://" + URLEncoder.encode(name, StandardCharsets.UTF_8) + ":"
                    + URLEncoder.encode(password, StandardCharsets.UTF_8) + "@localhost:" + org.caPort();
            caCommand(org, "enroll", "-u", url, "-M", dir.toString());
            try (var keys = Files.list(dir.resolve("keystore"))) {
                String certificate = Files.readString(dir.resolve("signcerts/cert.pem"));
                PrivateKey key = Identities.readPrivateKey(Files.readString(keys.findFirst().orElseThrow()));
                return new Session(org, certificate, key);
            }
        } finally {
            try (var files = Files.walk(dir)) {
                files.sorted(Comparator.reverseOrder()).map(Path::toFile).forEach(File::delete);
            }
        }
    }

    // --- Контракт: Fabric Gateway ---

    // Одно gRPC-соединение на организацию: так советует документация Fabric
    private ManagedChannel channel(Org org) {
        return channels.computeIfAbsent(org.id(), id -> {
            File tlsCert = org.dir().resolve("tlsca/tlsca." + id + ".example.com-cert.pem").toFile();
            try {
                return Grpc.newChannelBuilder(org.peer(), TlsChannelCredentials.newBuilder().trustManager(tlsCert).build())
                        .overrideAuthority("peer0." + id + ".example.com")
                        .build();
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        });
    }

    // Вызов любого метода контракта от имени пользователя: evaluate читает, submit записывает в блок
    private String call(String kind, Session user, String method, List<String> args) throws Exception {
        try (Gateway gateway = Gateway.newInstance()
                .identity(new X509Identity(user.org().msp(), Identities.readX509Certificate(user.certificate())))
                .signer(Signers.newPrivateKeySigner(user.key()))
                .hash(Hash.SHA256)
                .connection(channel(user.org()))
                .connect()) {
            Contract contract = gateway.getNetwork("mychannel").getContract("users");
            String[] params = args.toArray(new String[0]);
            byte[] result = "submit".equals(kind)
                    ? contract.submitTransaction(method, params)
                    : contract.evaluateTransaction(method, params);
            return new String(result, StandardCharsets.UTF_8);
        }
    }

    // --- REST API ---

    private Map<String, String> openSession(Session user) {
        String token = UUID.randomUUID().toString();
        sessions.put(token, user);
        return Map.of("token", token);
    }

    @PostMapping("/register")
    public Map<String, String> register(@RequestBody Map<String, String> body) throws Exception {
        String name = body.get("name");
        String password = body.get("password");
        try {
            caCommand(USERS, "register", "--id.name", name, "--id.secret", password,
                    "--id.type", "client", "--id.affiliation", "org2.department1");
        } catch (Exception e) {
            throw new Exception("Не удалось зарегистрировать: имя занято или недопустимо");
        }
        Session user = enroll(USERS, name, password);
        call("submit", user, "RegisterUser", List.of(body.get("address")));
        return openSession(user);
    }

    @PostMapping("/login")
    public Map<String, String> login(@RequestBody Map<String, String> body) throws Exception {
        for (Org org : List.of(ADMINS, USERS)) {
            try {
                return openSession(enroll(org, body.get("name"), body.get("password")));
            } catch (Exception e) {
                // Следующая организация
            }
        }
        throw new Exception("Неверное имя или пароль");
    }

    // Один маршрут на все методы контракта
    @PostMapping(value = "/{kind:evaluate|submit}/{method}", produces = "application/json")
    public String contract(@PathVariable String kind, @PathVariable String method,
                           @RequestHeader(value = "Authorization", required = false) String token,
                           @RequestBody Map<String, List<String>> body) throws Exception {
        Session user = token == null ? null : sessions.get(token);
        if (user == null) {
            throw new Exception("Требуется вход");
        }
        return call(kind, user, method, body.getOrDefault("args", List.of()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> error(Exception e) {
        String message = e instanceof GatewayException gateway && !gateway.getDetails().isEmpty()
                ? gateway.getDetails().get(0).getMessage().replaceFirst("^.*?chaincode response \\d+, ", "")
                : String.valueOf(e.getMessage());
        return ResponseEntity.badRequest().body(Map.of("error", message));
    }
}
