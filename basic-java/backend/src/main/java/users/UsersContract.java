package users;

import com.owlike.genson.Genson;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.hyperledger.fabric.contract.Context;
import org.hyperledger.fabric.contract.ContractInterface;
import org.hyperledger.fabric.contract.annotation.Contract;
import org.hyperledger.fabric.contract.annotation.Default;
import org.hyperledger.fabric.contract.annotation.Info;
import org.hyperledger.fabric.contract.annotation.Transaction;
import org.hyperledger.fabric.shim.ChaincodeException;
import org.hyperledger.fabric.shim.ledger.KeyValue;

@Contract(name = "users", info = @Info(title = "Users", version = "1.0"))
@Default
public final class UsersContract implements ContractInterface {
    private static final String ADMIN_ORG = "Org1MSP";   // администратор: готовый admin из CA организации Org1
    private static final String USERS_ORG = "Org2MSP";   // пользователи регистрируются в организации Org2
    private static final Genson JSON = new Genson();

    // Имя вызывающего берётся из его сертификата (поле CN), подделать его нельзя
    private String callerName(Context ctx) {
        Matcher matcher = Pattern.compile("CN=([^,/:]+)").matcher(ctx.getClientIdentity().getId());
        matcher.find();
        return matcher.group(1);
    }

    private boolean isAdmin(Context ctx) {
        return ADMIN_ORG.equals(ctx.getClientIdentity().getMSPID());
    }

    private User readUser(Context ctx, String name) {
        String data = ctx.getStub().getStringState("user:" + name);
        return data == null || data.isEmpty() ? null : JSON.deserialize(data, User.class);
    }

    private void writeUser(Context ctx, User user) {
        ctx.getStub().putStringState("user:" + user.name, JSON.serialize(user));
    }

    private String setStatus(Context ctx, String name, String status) {
        if (!isAdmin(ctx)) {
            throw new ChaincodeException("Доступ только для администратора");
        }
        User user = readUser(ctx, name);
        if (user == null) {
            throw new ChaincodeException("Пользователь " + name + " не найден");
        }
        user.status = status;
        writeUser(ctx, user);
        return JSON.serialize(user);
    }

    // Регистрация: имя берётся из сертификата, пароль хранит Fabric CA
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public String RegisterUser(Context ctx, String address) {
        if (!USERS_ORG.equals(ctx.getClientIdentity().getMSPID())) {
            throw new ChaincodeException("Пользователь должен быть из организации Org2");
        }
        String name = callerName(ctx);
        if (readUser(ctx, name) != null) {
            throw new ChaincodeException("Имя " + name + " уже занято");
        }
        User user = new User();
        user.name = name;
        user.address = address;
        user.status = "active";
        writeUser(ctx, user);
        return JSON.serialize(user);
    }

    // Свои данные
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public String GetMe(Context ctx) {
        if (isAdmin(ctx)) {
            return JSON.serialize(Map.of("name", callerName(ctx), "role", "admin"));
        }
        return JSON.serialize(readUser(ctx, callerName(ctx)));
    }

    // Изменение своего адреса: заблокированному запрещено
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public String UpdateAddress(Context ctx, String address) {
        User user = readUser(ctx, callerName(ctx));
        if (user == null) {
            throw new ChaincodeException("Пользователь не зарегистрирован");
        }
        if ("blocked".equals(user.status)) {
            throw new ChaincodeException("Вы заблокированы и не можете менять данные");
        }
        user.address = address;
        writeUser(ctx, user);
        return JSON.serialize(user);
    }

    // Все пользователи: только для администратора
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public String GetUsers(Context ctx) {
        if (!isAdmin(ctx)) {
            throw new ChaincodeException("Доступ только для администратора");
        }
        List<User> users = new ArrayList<>();
        for (KeyValue item : ctx.getStub().getStateByRange("user:", "user;")) {
            users.add(JSON.deserialize(item.getStringValue(), User.class));
        }
        return JSON.serialize(users);
    }

    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public String BlockUser(Context ctx, String name) {
        return setStatus(ctx, name, "blocked");
    }

    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public String UnblockUser(Context ctx, String name) {
        return setStatus(ctx, name, "active");
    }
}
