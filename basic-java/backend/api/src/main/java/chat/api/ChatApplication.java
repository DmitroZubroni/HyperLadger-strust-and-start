package chat.api;

import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class ChatApplication {
    public static final String ADMIN_NAME = "administrator";
    private static final String ADMIN_PASSWORD = "admin123";
    private static final String ADMIN_ADDRESS = "Главный офис";

    public static void main(String[] args) {
        SpringApplication.run(ChatApplication.class, args);
    }

    /** Администратор существует с момента старта. Повторный запуск ничего не меняет. */
    @Bean
    CommandLineRunner createAdmin(Fabric fabric) {
        return args -> {
            try {
                fabric.register("Admins", ADMIN_NAME, ADMIN_PASSWORD, "admin");
            } catch (Exception e) {
                if (!String.valueOf(e.getMessage()).contains("already registered")) {
                    throw e;
                }
            }
            Fabric.Identity admin = fabric.enroll("Admins", ADMIN_NAME, ADMIN_PASSWORD);
            try {
                fabric.submit(admin, "initLedger", ADMIN_ADDRESS);
            } catch (Exception e) {
                if (!Fabric.errorText(e).contains("уже инициализирован")) {
                    throw e;
                }
            }
            System.out.println("API: http://localhost:8090");
        };
    }
}
