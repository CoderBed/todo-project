package com.bedirhan.todobackend;

import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

/**
 * Şimdilik Spring context / DB gerektiren testleri kapatıyoruz.
 * Böylece `mvn test` çalışırken DB bağlantısı beklemez.
 */
@Disabled("Şimdilik kapalı: test ortamında DB/datasource ayarlı değil")
class TodoBackendApplicationTests {

    @Test
    void placeholder() {
        // intentionally empty
    }
}