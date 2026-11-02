package chat;

import com.owlike.genson.Genson;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.hyperledger.fabric.contract.ClientIdentity;
import org.hyperledger.fabric.contract.Context;
import org.hyperledger.fabric.contract.ContractInterface;
import org.hyperledger.fabric.contract.annotation.Contract;
import org.hyperledger.fabric.contract.annotation.Default;
import org.hyperledger.fabric.contract.annotation.Info;
import org.hyperledger.fabric.contract.annotation.Transaction;
import org.hyperledger.fabric.shim.ChaincodeException;
import org.hyperledger.fabric.shim.ChaincodeStub;
import org.hyperledger.fabric.shim.ledger.KeyValue;
import org.hyperledger.fabric.shim.ledger.QueryResultsIterator;

/**
 * Смарт-контракт общего чата.
 *
 * <p>Правила, которые определяют устройство кода:
 * <ol>
 *   <li>Кто вызывает функцию, определяется по сертификату: организация (MSP), имя (CN) и
 *       роль (атрибут role). Параметрам запроса контракт не доверяет.</li>
 *   <li>Время берётся из getTxTimestamp(). Instant.now() дал бы на разных пирах разные
 *       значения, и транзакция не прошла бы проверку.</li>
 *   <li>Каждое сообщение лежит под своим ключом. С общим списком сообщений одновременные
 *       отправки конфликтовали бы между собой (MVCC).</li>
 *   <li>Пароль в реестр не попадает: он хранится в Fabric CA.</li>
 * </ol>
 */
@Contract(name = "chat", info = @Info(title = "Chat", version = "1.0.0"))
@Default
public final class ChatContract implements ContractInterface {
    private static final String ADMINS_MSP = "AdminsMSP";
    private static final String USERS_MSP = "UsersMSP";
    private static final String ROLE_ADMIN = "admin";
    private static final String ROLE_USER = "user";
    private static final String ACTIVE = "active";
    private static final String BLOCKED = "blocked";
    private static final int MAX_TEXT_LENGTH = 1000;
    private static final Pattern CN = Pattern.compile("CN=([^,/:]+)");
    private static final Genson JSON = new Genson();

    private static String userKey(String name) {
        return "user:" + name;
    }

    private static User readUser(Context ctx, String name) {
        byte[] bytes = ctx.getStub().getState(userKey(name));
        return bytes == null || bytes.length == 0 ? null : JSON.deserialize(bytes, User.class);
    }

    private static void writeJson(Context ctx, String key, Object value) {
        ctx.getStub().putState(key, JSON.serializeBytes(value));
    }

    /** Все записи с ключами от start до end. Реестр отдаёт их отсортированными по ключу. */
    private static <T> List<T> readRange(Context ctx, String start, String end, Class<T> type) {
        List<T> items = new ArrayList<>();
        try (QueryResultsIterator<KeyValue> results = ctx.getStub().getStateByRange(start, end)) {
            for (KeyValue item : results) {
                items.add(JSON.deserialize(item.getValue(), type));
            }
        } catch (ChaincodeException e) {
            throw e;
        } catch (Exception e) {
            throw new ChaincodeException("Ошибка чтения реестра: " + e.getMessage());
        }
        return items;
    }

    /** Имя вызывающего: поле CN его сертификата. */
    private static String callerName(Context ctx) {
        Matcher matcher = CN.matcher(ctx.getClientIdentity().getId());
        if (!matcher.find()) {
            throw new ChaincodeException("В сертификате не найден CN");
        }
        return matcher.group(1);
    }

    private static void requireAdmin(Context ctx) {
        ClientIdentity identity = ctx.getClientIdentity();
        if (!ADMINS_MSP.equals(identity.getMSPID()) || !ROLE_ADMIN.equals(identity.getAttributeValue("role"))) {
            throw new ChaincodeException("Доступ только для администратора");
        }
    }

    /** Запись вызывающего. Организация записи должна совпадать с организацией сертификата. */
    private static User currentUser(Context ctx) {
        String name = callerName(ctx);
        User user = readUser(ctx, name);
        if (user == null || !user.org.equals(ctx.getClientIdentity().getMSPID())) {
            throw new ChaincodeException("Пользователь " + name + " не зарегистрирован");
        }
        return user;
    }

    private static String setStatus(Context ctx, String name, String status) {
        requireAdmin(ctx);
        User user = readUser(ctx, name);
        if (user == null) {
            throw new ChaincodeException("Пользователь " + name + " не найден");
        }
        if (ROLE_ADMIN.equals(user.role)) {
            throw new ChaincodeException("Администратора нельзя заблокировать");
        }
        user.status = status;
        writeJson(ctx, userKey(name), user);
        return JSON.serialize(user);
    }

    /**
     * Создаёт запись администратора. Вызывается один раз самим администратором.
     *
     * @param address адрес администратора
     * @return JSON записи администратора
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public String initLedger(Context ctx, String address) {
        requireAdmin(ctx);
        String name = callerName(ctx);
        if (readUser(ctx, name) != null) {
            throw new ChaincodeException("Реестр уже инициализирован");
        }
        User admin = new User(name, address, ROLE_ADMIN, ADMINS_MSP, ACTIVE);
        writeJson(ctx, userKey(name), admin);
        return JSON.serialize(admin);
    }

    /**
     * Регистрация пользователя. Имя берётся из сертификата, пароль проверяет Fabric CA.
     *
     * @param address адрес пользователя
     * @return JSON записи пользователя
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public String registerUser(Context ctx, String address) {
        if (!USERS_MSP.equals(ctx.getClientIdentity().getMSPID())) {
            throw new ChaincodeException("Пользователь должен принадлежать организации Users");
        }
        String name = callerName(ctx);
        if (readUser(ctx, name) != null) {
            throw new ChaincodeException("Имя " + name + " уже занято");
        }
        String cleanAddress = address.strip();
        if (cleanAddress.isEmpty()) {
            throw new ChaincodeException("Не указан адрес");
        }
        User user = new User(name, cleanAddress, ROLE_USER, USERS_MSP, ACTIVE);
        writeJson(ctx, userKey(name), user);
        return JSON.serialize(user);
    }

    /**
     * Данные вызывающего пользователя.
     *
     * @return JSON { name, address, role, org, status }
     */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public String getMe(Context ctx) {
        return JSON.serialize(currentUser(ctx));
    }

    /**
     * Список всех пользователей. Только для администратора.
     *
     * @return JSON-массив записей пользователей
     */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public String getUsers(Context ctx) {
        requireAdmin(ctx);
        return JSON.serialize(readRange(ctx, "user:", "user;", User.class));
    }

    /**
     * Заблокировать пользователя. Только для администратора.
     *
     * @param name имя пользователя
     * @return JSON обновлённой записи
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public String blockUser(Context ctx, String name) {
        return setStatus(ctx, name, BLOCKED);
    }

    /**
     * Разблокировать пользователя. Только для администратора.
     *
     * @param name имя пользователя
     * @return JSON обновлённой записи
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public String unblockUser(Context ctx, String name) {
        return setStatus(ctx, name, ACTIVE);
    }

    /**
     * Отправить сообщение в общий чат. Только для активного пользователя.
     *
     * @param text текст сообщения
     * @return JSON сообщения { author, time, text }
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public String sendMessage(Context ctx, String text) {
        User user = currentUser(ctx);
        if (!ACTIVE.equals(user.status)) {
            throw new ChaincodeException("Вы заблокированы и не можете отправлять сообщения");
        }
        String cleanText = text.strip();
        if (cleanText.isEmpty()) {
            throw new ChaincodeException("Сообщение не может быть пустым");
        }
        if (cleanText.length() > MAX_TEXT_LENGTH) {
            throw new ChaincodeException("Сообщение длиннее " + MAX_TEXT_LENGTH + " символов");
        }
        ChaincodeStub stub = ctx.getStub();
        long millis = stub.getTxTimestamp().toEpochMilli();
        Message message = new Message(user.name, Instant.ofEpochMilli(millis).toString(), cleanText);
        // Время в начале ключа выстраивает сообщения по порядку, ID транзакции делает ключ уникальным.
        String key = String.format("message:%015d:%s", millis, stub.getTxId());
        writeJson(ctx, key, message);
        return JSON.serialize(message);
    }

    /**
     * Все сообщения чата по времени. Для любого зарегистрированного пользователя.
     *
     * @return JSON-массив сообщений { author, time, text }
     */
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public String getMessages(Context ctx) {
        currentUser(ctx);
        return JSON.serialize(readRange(ctx, "message:", "message;", Message.class));
    }
}
