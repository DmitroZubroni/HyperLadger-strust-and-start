package chat;

/** Запись пользователя в реестре. Пароля здесь нет: он хранится в Fabric CA. */
public class User {
    public String name;
    public String address;
    public String role;
    public String org;
    public String status;

    public User() {
    }

    public User(String name, String address, String role, String org, String status) {
        this.name = name;
        this.address = address;
        this.role = role;
        this.org = org;
        this.status = status;
    }
}
