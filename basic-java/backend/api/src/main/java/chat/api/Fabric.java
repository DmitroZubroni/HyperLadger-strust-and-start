package chat.api;

import io.grpc.Grpc;
import io.grpc.InsecureChannelCredentials;
import io.grpc.ManagedChannel;
import io.grpc.Status;
import java.nio.charset.StandardCharsets;
import java.security.PrivateKey;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.hyperledger.fabric.client.Contract;
import org.hyperledger.fabric.client.CommitStatusException;
import org.hyperledger.fabric.client.Gateway;
import org.hyperledger.fabric.client.GatewayException;
import org.hyperledger.fabric.client.Hash;
import org.hyperledger.fabric.client.SubmitException;
import org.hyperledger.fabric.client.identity.Identities;
import org.hyperledger.fabric.client.identity.Signers;
import org.hyperledger.fabric.client.identity.X509Identity;
import org.hyperledger.fabric.sdk.Enrollment;
import org.hyperledger.fabric.sdk.User;
import org.hyperledger.fabric.sdk.security.CryptoSuite;
import org.hyperledger.fabric_ca.sdk.Attribute;
import org.hyperledger.fabric_ca.sdk.HFCAClient;
import org.hyperledger.fabric_ca.sdk.RegistrationRequest;
import org.springframework.stereotype.Service;

/**
 * Связь с нодой. Пользователь сети — это сертификат и закрытый ключ: их выпускает Fabric CA,
 * он же проверяет пароль. Смарт-контракт вызывается через Fabric Gateway.
 */
@Service
public class Fabric {
    private static final String DOMAIN = "127-0-0-1.nip.io:9000";   // Microfab различает сервисы по имени хоста

    private record Org(String mspId, String peer, String caUrl, String caName) {
    }

    private static final Map<String, Org> ORGS = Map.of(
            "Admins", new Org("AdminsMSP", "adminspeer-api." + DOMAIN, "http://adminsca-api." + DOMAIN, "adminsca"),
            "Users", new Org("UsersMSP", "userspeer-api." + DOMAIN, "http://usersca-api." + DOMAIN, "usersca"));

    public record Identity(String org, String name, String certificate, PrivateKey privateKey) {
    }

    private static HFCAClient ca(Org org) throws Exception {
        HFCAClient client = HFCAClient.createNewInstance(org.caName(), org.caUrl(), new Properties());
        client.setCryptoSuite(CryptoSuite.Factory.getCryptoSuite());
        return client;
    }

    /** Выпуск сертификата. При неверном пароле CA вернёт ошибку: это и есть проверка входа. */
    public Identity enroll(String org, String name, String password) throws Exception {
        Enrollment enrollment = ca(ORGS.get(org)).enroll(name, password);
        return new Identity(org, name, enrollment.getCert(), enrollment.getKey());
    }

    /** Регистрация в CA. Атрибут role попадает в сертификат, контракт читает его оттуда. */
    public void register(String orgName, String name, String password, String role) throws Exception {
        Org org = ORGS.get(orgName);
        Enrollment caAdmin = ca(org).enroll("admin", "adminpw");
        RegistrationRequest request = new RegistrationRequest(name);
        request.setSecret(password);
        request.setType("client");
        request.setAffiliation("");
        request.setMaxEnrollments(-1);     // каждый вход выпускает новый сертификат
        request.addAttribute(new Attribute("role", role, true));
        ca(org).register(request, registrar(org, caAdmin));
    }

    private static User registrar(Org org, Enrollment enrollment) {
        return new User() {
            @Override public String getName() { return "admin"; }
            @Override public Set<String> getRoles() { return Set.of(); }
            @Override public String getAccount() { return ""; }
            @Override public String getAffiliation() { return ""; }
            @Override public Enrollment getEnrollment() { return enrollment; }
            @Override public String getMspId() { return org.mspId(); }
        };
    }

    private interface Call {
        byte[] run(Contract contract) throws Exception;
    }

    // Одно gRPC-соединение на организацию
    private final Map<String, ManagedChannel> channels = new ConcurrentHashMap<>();

    private ManagedChannel channel(Org org) {
        return channels.computeIfAbsent(org.mspId(), key ->
                Grpc.newChannelBuilder("localhost:9000", InsecureChannelCredentials.create())
                        .overrideAuthority(org.peer()).build());
    }

    /**
     * Прокси Microfab изредка обрывает запрос (RST_STREAM). Повторять безопасно только чтение
     * и этап одобрения: транзакция ещё не ушла в блок, поэтому дубля не будет.
     */
    private static boolean canRetry(GatewayException e) {
        boolean safeStage = !(e instanceof SubmitException) && !(e instanceof CommitStatusException);
        return safeStage && e.getStatus().getCode() == Status.Code.INTERNAL && String.valueOf(e.getMessage()).contains("RST_STREAM");
    }

    /** Подключается к пиру своей организации от имени пользователя и выполняет вызов. */
    private String withContract(Identity identity, Call call) throws Exception {
        Org org = ORGS.get(identity.org());
        try (Gateway gateway = Gateway.newInstance()
                .identity(new X509Identity(org.mspId(), Identities.readX509Certificate(identity.certificate())))
                .signer(Signers.newPrivateKeySigner(identity.privateKey()))
                .hash(Hash.SHA256)
                .connection(channel(org))
                .connect()) {
            Contract contract = gateway.getNetwork("chatchannel").getContract("chat");
            for (int attempt = 1; ; attempt++) {
                try {
                    return new String(call.run(contract), StandardCharsets.UTF_8);
                } catch (GatewayException e) {
                    if (attempt == 3 || !canRetry(e)) {
                        throw e;
                    }
                    System.out.println("Повтор вызова: " + e.getMessage());
                }
            }
        }
    }

    /** Чтение: выполняется на пире, в блок не попадает. */
    public String evaluate(Identity identity, String function, String... args) throws Exception {
        return withContract(identity, contract -> contract.evaluateTransaction(function, args));
    }

    /** Запись: одобрение пирами, затем запись в блок. */
    public String submit(Identity identity, String function, String... args) throws Exception {
        return withContract(identity, contract -> contract.submitTransaction(function, args));
    }

    /** Текст ошибки контракта лежит в details ошибки Gateway. */
    public static String errorText(Exception e) {
        if (e instanceof GatewayException error && !error.getDetails().isEmpty()) {
            return error.getDetails().get(0).getMessage().replaceFirst("^.*?chaincode response \\d+, ", "");
        }
        return String.valueOf(e.getMessage());
    }
}
