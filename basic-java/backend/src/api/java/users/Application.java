package users;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.hyperledger.fabric.gateway.Contract;
import org.hyperledger.fabric.gateway.Gateway;
import org.hyperledger.fabric.gateway.Identities;
import org.hyperledger.fabric.gateway.Wallet;
import org.hyperledger.fabric.gateway.Wallets;
import org.hyperledger.fabric.sdk.Enrollment;
import org.hyperledger.fabric.sdk.User;
import org.hyperledger.fabric.sdk.security.CryptoSuite;
import org.hyperledger.fabric_ca.sdk.HFCAClient;
import org.hyperledger.fabric_ca.sdk.RegistrationRequest;
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
    private static final Path NETWORK = Path.of("../../fabric-samples/test-network/organizations");

    private record Org(String id, String msp, String caUrl) {
        Path profile() {
            return NETWORK.resolve("peerOrganizations/" + id + ".example.com/connection-" + id + ".json");
        }
    }

    private record Session(Org org, String name) {
    }

    private static final Org ADMINS = new Org("org1", "Org1MSP", "https://localhost:7054");   // администратор
    private static final Org USERS = new Org("org2", "Org2MSP", "https://localhost:8054");    // пользователи

    private final Wallet wallet = Wallets.newInMemoryWallet();      // сертификаты и ключи вошедших пользователей
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();

    public Application() throws Exception {
    }

    public static void main(String[] args) {
        System.setProperty("org.hyperledger.fabric.sdk.service_discovery.as_localhost", "true");
        SpringApplication.run(Application.class, args);
    }

    private HFCAClient ca(Org org) throws Exception {
        Properties props = new Properties();
        props.put("pemFile", NETWORK.resolve("fabric-ca/" + org.id() + "/ca-cert.pem").toString());
        props.put("allowAllHostNames", "true");
        HFCAClient client = HFCAClient.createNewInstance("ca-" + org.id(), org.caUrl(), props);
        client.setCryptoSuite(CryptoSuite.Factory.getCryptoSuite());
        return client;
    }

    // Выпуск сертификата. При неверном пароле CA вернёт ошибку: это и есть проверка входа
    private Enrollment enroll(Org org, String name, String password) throws Exception {
        Enrollment enrollment = ca(org).enroll(name, password);
        wallet.put(org.id() + ":" + name, Identities.newX509Identity(org.msp(), enrollment));
        return enrollment;
    }

    // Новый пользователь в CA организации: его регистрирует admin этой организации
    private void register(String name, String password) throws Exception {
        Enrollment adminEnrollment = enroll(USERS, "admin", "adminpw");
        User admin = new User() {
            @Override public String getName() { return "admin"; }
            @Override public Set<String> getRoles() { return Set.of(); }
            @Override public String getAccount() { return ""; }
            @Override public String getAffiliation() { return "org2.department1"; }
            @Override public Enrollment getEnrollment() { return adminEnrollment; }
            @Override public String getMspId() { return USERS.msp(); }
        };
        RegistrationRequest request = new RegistrationRequest(name, "org2.department1");
        request.setSecret(password);
        request.setType("client");
        request.setMaxEnrollments(-1);
        try {
            ca(USERS).register(request, admin);
        } catch (Exception e) {
            // Текст ошибки библиотеки содержит пароль, клиенту его не отдаём
            throw new Exception("Не удалось зарегистрировать: имя занято или недопустимо");
        }
        enroll(USERS, name, password);
    }

    // Вызов любого метода контракта от имени пользователя
    private String call(String kind, Session user, String method, List<String> args) throws Exception {
        try (Gateway gateway = Gateway.createBuilder()
                .identity(wallet, user.org().id() + ":" + user.name())
                .networkConfig(user.org().profile())
                .discovery(true)
                .connect()) {
            Contract contract = gateway.getNetwork("mychannel").getContract("users");
            String[] params = args.toArray(new String[0]);
            byte[] result = "submit".equals(kind)
                    ? contract.submitTransaction(method, params)
                    : contract.evaluateTransaction(method, params);
            return new String(result, StandardCharsets.UTF_8);
        }
    }

    private Map<String, String> openSession(Org org, String name) {
        String token = UUID.randomUUID().toString();
        sessions.put(token, new Session(org, name));
        return Map.of("token", token);
    }

    @PostMapping("/register")
    public Map<String, String> register(@RequestBody Map<String, String> body) throws Exception {
        String name = body.get("name");
        register(name, body.get("password"));
        call("submit", new Session(USERS, name), "RegisterUser", List.of(body.get("address")));
        return openSession(USERS, name);
    }

    @PostMapping("/login")
    public Map<String, String> login(@RequestBody Map<String, String> body) throws Exception {
        String name = body.get("name");
        for (Org org : List.of(ADMINS, USERS)) {
            try {
                enroll(org, name, body.get("password"));
                return openSession(org, name);
            } catch (Exception e) {
                // Следующая организация
            }
        }
        throw new Exception("Неверное имя или пароль");
    }

    // Один маршрут на все методы контракта: evaluate читает, submit записывает в блок
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
        return ResponseEntity.badRequest().body(Map.of("error", String.valueOf(e.getMessage())));
    }
}
