package chat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;

import com.owlike.genson.GenericType;
import com.owlike.genson.Genson;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.TreeMap;
import org.hyperledger.fabric.contract.ClientIdentity;
import org.hyperledger.fabric.contract.Context;
import org.hyperledger.fabric.shim.ChaincodeException;
import org.hyperledger.fabric.shim.ChaincodeStub;
import org.hyperledger.fabric.shim.ledger.KeyValue;
import org.hyperledger.fabric.shim.ledger.QueryResultsIterator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Тесты контракта без сети: реестр и личность вызывающего подменены объектами в памяти. */
class ChatContractTest {
    private static final Genson JSON = new Genson();

    private final ChatContract contract = new ChatContract();
    private final TreeMap<String, byte[]> state = new TreeMap<>();
    private Instant now = Instant.parse("2026-11-02T12:00:00.250Z");
    private int tx = 0;
    private Context admin;

    private ChaincodeStub stub() {
        ChaincodeStub stub = mock(ChaincodeStub.class);
        lenient().when(stub.getState(anyString())).thenAnswer(i -> state.getOrDefault(i.getArgument(0, String.class), new byte[0]));
        lenient().doAnswer(i -> {
            state.put(i.getArgument(0), i.getArgument(1));
            return null;
        }).when(stub).putState(anyString(), any(byte[].class));
        lenient().when(stub.getTxTimestamp()).thenAnswer(i -> now);
        lenient().when(stub.getTxId()).thenAnswer(i -> "tx" + (++tx));
        lenient().when(stub.getStateByRange(anyString(), anyString())).thenAnswer(i -> {
            List<KeyValue> items = new ArrayList<>();
            state.subMap(i.getArgument(0, String.class), i.getArgument(1, String.class)).forEach((key, value) -> {
                KeyValue item = mock(KeyValue.class);
                lenient().when(item.getValue()).thenReturn(value);
                items.add(item);
            });
            return new QueryResultsIterator<KeyValue>() {
                @Override
                public Iterator<KeyValue> iterator() {
                    return items.iterator();
                }

                @Override
                public void close() {
                }
            };
        });
        return stub;
    }

    private Context as(String name, String msp, String role) {
        ClientIdentity identity = mock(ClientIdentity.class);
        lenient().when(identity.getMSPID()).thenReturn(msp);
        // Формат getId() в Java-библиотеке: subject и issuer через запятую, CN идёт первым
        lenient().when(identity.getId()).thenReturn("x509::CN=" + name + ", OU=client::CN=ca, O=example");
        lenient().when(identity.getAttributeValue("role")).thenReturn(role);
        Context ctx = mock(Context.class);
        ChaincodeStub stub = stub();
        lenient().when(ctx.getStub()).thenReturn(stub);
        lenient().when(ctx.getClientIdentity()).thenReturn(identity);
        return ctx;
    }

    private Context user(String name) {
        return as(name, "UsersMSP", "user");
    }

    private static void assertFails(String fragment, Runnable action) {
        ChaincodeException e = assertThrows(ChaincodeException.class, action::run);
        assertTrue(e.getMessage().contains(fragment), e.getMessage());
    }

    private List<Message> messages(Context ctx) {
        return JSON.deserialize(contract.getMessages(ctx), new GenericType<List<Message>>() { });
    }

    @BeforeEach
    void start() {
        admin = as("admin", "AdminsMSP", "admin");
        contract.initLedger(admin, "Главный офис");
    }

    @Test
    void adminExistsAfterStartAndInitRunsOnce() {
        User me = JSON.deserialize(contract.getMe(admin), User.class);
        assertEquals("admin", me.role);
        assertEquals("active", me.status);
        assertFails("уже", () -> contract.initLedger(admin, "x"));
    }

    @Test
    void onlyAdminCanInit() {
        state.clear();
        assertFails("администратора", () -> contract.initLedger(user("ivan"), "x"));
        assertFails("администратора", () -> contract.initLedger(as("ivan", "AdminsMSP", "user"), "x"));
    }

    @Test
    void registrationTakesNameFromCertificate() {
        User created = JSON.deserialize(contract.registerUser(user("ivan"), " Москва "), User.class);
        assertEquals("ivan", created.name);
        assertEquals("Москва", created.address);
        assertEquals("user", created.role);
        assertEquals("active", created.status);
    }

    @Test
    void registrationRejectsBadInput() {
        contract.registerUser(user("ivan"), "Москва");
        assertFails("занято", () -> contract.registerUser(user("ivan"), "Тула"));
        assertFails("занято", () -> contract.registerUser(user("admin"), "Тула"));
        assertFails("адрес", () -> contract.registerUser(user("petr"), "  "));
        assertFails("Users", () -> contract.registerUser(as("petr", "AdminsMSP", "user"), "Тула"));
    }

    @Test
    void messageHasAuthorTransactionTimeAndText() {
        contract.registerUser(user("ivan"), "Москва");
        Message message = JSON.deserialize(contract.sendMessage(user("ivan"), "Привет"), Message.class);
        assertEquals("ivan", message.author);
        assertEquals("2026-11-02T12:00:00.250Z", message.time);
        assertEquals("Привет", message.text);
    }

    @Test
    void messagesAreOrderedByTime() {
        contract.registerUser(user("ivan"), "Москва");
        contract.sendMessage(user("ivan"), "первое");
        now = now.plusSeconds(1);
        contract.sendMessage(admin, "второе");
        List<Message> all = messages(user("ivan"));
        assertEquals("первое", all.get(0).text);
        assertEquals("admin", all.get(1).author);
    }

    @Test
    void blockForbidsSendingAndUnblockRestoresIt() {
        contract.registerUser(user("ivan"), "Москва");
        assertTrue(contract.blockUser(admin, "ivan").contains("blocked"));
        assertFails("заблокированы", () -> contract.sendMessage(user("ivan"), "спам"));
        assertTrue(messages(user("ivan")).isEmpty());
        assertFalse(contract.unblockUser(admin, "ivan").contains("blocked"));
        contract.sendMessage(user("ivan"), "снова в чате");
        assertEquals(1, messages(user("ivan")).size());
    }

    @Test
    void onlyAdminManagesUsers() {
        contract.registerUser(user("ivan"), "Москва");
        contract.registerUser(user("petr"), "Тула");
        assertFails("администратора", () -> contract.blockUser(user("ivan"), "petr"));
        assertFails("администратора", () -> contract.unblockUser(user("ivan"), "petr"));
        assertFails("администратора", () -> contract.getUsers(user("ivan")));
        // Поддельная роль в чужой организации не помогает
        assertFails("администратора", () -> contract.blockUser(as("ivan", "UsersMSP", "admin"), "petr"));
        assertEquals(3, JSON.deserialize(contract.getUsers(admin), new GenericType<List<User>>() { }).size());
    }

    @Test
    void cannotBlockAdminOrUnknownUser() {
        assertFails("нельзя", () -> contract.blockUser(admin, "admin"));
        assertFails("не найден", () -> contract.blockUser(admin, "nobody"));
    }

    @Test
    void unregisteredCannotReadOrWriteAndBadTextIsRejected() {
        assertFails("не зарегистрирован", () -> contract.getMessages(user("ghost")));
        assertFails("не зарегистрирован", () -> contract.sendMessage(user("ghost"), "x"));
        contract.registerUser(user("ivan"), "Москва");
        assertFails("пустым", () -> contract.sendMessage(user("ivan"), "   "));
        assertFails("длиннее", () -> contract.sendMessage(user("ivan"), "x".repeat(1001)));
    }

    @Test
    void sameNameFromAnotherOrganizationHasNoAccess() {
        contract.registerUser(user("ivan"), "Москва");
        assertFails("не зарегистрирован", () -> contract.sendMessage(as("ivan", "AdminsMSP", "user"), "x"));
    }
}
