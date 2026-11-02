package chat.api;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST API. Работает в контейнере рядом с нодой. Браузер не видит ключи: сервер держит их в памяти на время сессии и подписывает
 * транзакции сам. Контракт уже возвращает JSON, поэтому его ответы передаются как есть.
 */
@RestController
@CrossOrigin      // страница открыта с другого порта
@RequestMapping(path = "/api", produces = MediaType.APPLICATION_JSON_VALUE)
public class ChatController {
    private static final String TOKEN = "Authorization";
    private static final Set<String> RESERVED_NAMES = Set.of("admin", ChatApplication.ADMIN_NAME);

    /** Ошибка с заданным HTTP-кодом. */
    static class ApiError extends RuntimeException {
        final int status;

        ApiError(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    private final Fabric fabric;
    private final Map<String, Fabric.Identity> sessions = new ConcurrentHashMap<>();

    public ChatController(Fabric fabric) {
        this.fabric = fabric;
    }

    private Map<String, String> openSession(Fabric.Identity identity) {
        String token = UUID.randomUUID().toString();
        sessions.put(token, identity);
        return Map.of("token", token);
    }

    private static String clean(String header) {
        return header == null ? "" : header.replaceFirst("^Bearer ", "");
    }

    private Fabric.Identity auth(String header) {
        Fabric.Identity identity = sessions.get(clean(header));
        if (identity == null) {
            throw new ApiError(401, "Требуется вход в систему");
        }
        return identity;
    }

    @PostMapping("/register")
    public Map<String, String> register(@RequestBody Map<String, String> body) throws Exception {
        String name = body.getOrDefault("name", "");
        String password = body.getOrDefault("password", "");
        String address = body.getOrDefault("address", "");
        if (!name.matches("[a-zA-Z0-9_-]{3,32}") || RESERVED_NAMES.contains(name)) {
            throw new ApiError(400, "Имя: от 3 до 32 латинских букв, цифр, _ или -. Это имя может быть занято");
        }
        if (password.length() < 6) {
            throw new ApiError(400, "Пароль: не короче 6 символов");
        }
        if (address.isBlank()) {
            throw new ApiError(400, "Не указан адрес");
        }
        // Роль задаёт сервер: самостоятельно можно стать только обычным пользователем.
        try {
            fabric.register("Users", name, password, "user");
        } catch (Exception e) {
            if (String.valueOf(e.getMessage()).contains("already registered")) {
                throw new ApiError(409, "Имя " + name + " уже занято");
            }
            throw e;
        }
        Fabric.Identity identity = fabric.enroll("Users", name, password);
        fabric.submit(identity, "registerUser", address);
        return openSession(identity);
    }

    /** Вход без выбора организации: имя ищется среди пользователей, затем среди администраторов. */
    @PostMapping("/login")
    public Map<String, String> login(@RequestBody Map<String, String> body) {
        for (String org : List.of("Users", "Admins")) {
            try {
                return openSession(fabric.enroll(org, body.getOrDefault("name", ""), body.getOrDefault("password", "")));
            } catch (Exception e) {
                // Следующая организация
            }
        }
        throw new ApiError(401, "Неверное имя или пароль");
    }

    @PostMapping("/logout")
    public Map<String, Boolean> logout(@RequestHeader(value = TOKEN, required = false) String token) {
        auth(token);
        sessions.remove(clean(token));
        return Map.of("ok", true);
    }

    @GetMapping("/me")
    public String me(@RequestHeader(value = TOKEN, required = false) String token) throws Exception {
        return fabric.evaluate(auth(token), "getMe");
    }

    @GetMapping("/users")
    public String users(@RequestHeader(value = TOKEN, required = false) String token) throws Exception {
        return fabric.evaluate(auth(token), "getUsers");
    }

    @PostMapping("/users/{name}/block")
    public String block(@RequestHeader(value = TOKEN, required = false) String token, @PathVariable String name) throws Exception {
        return fabric.submit(auth(token), "blockUser", name);
    }

    @PostMapping("/users/{name}/unblock")
    public String unblock(@RequestHeader(value = TOKEN, required = false) String token, @PathVariable String name) throws Exception {
        return fabric.submit(auth(token), "unblockUser", name);
    }

    @GetMapping("/messages")
    public String messages(@RequestHeader(value = TOKEN, required = false) String token) throws Exception {
        return fabric.evaluate(auth(token), "getMessages");
    }

    @PostMapping("/messages")
    public String send(@RequestHeader(value = TOKEN, required = false) String token,
                       @RequestBody Map<String, String> body) throws Exception {
        return fabric.submit(auth(token), "sendMessage", body.getOrDefault("text", ""));
    }

    @ExceptionHandler(ApiError.class)
    public ResponseEntity<Map<String, String>> apiError(ApiError e) {
        return ResponseEntity.status(e.status).contentType(MediaType.APPLICATION_JSON).body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> otherError(Exception e) {
        return ResponseEntity.badRequest().contentType(MediaType.APPLICATION_JSON).body(Map.of("error", Fabric.errorText(e)));
    }
}
