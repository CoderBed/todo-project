package com.bedirhan.todobackend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import io.swagger.v3.oas.annotations.OpenAPIDefinition;
import io.swagger.v3.oas.annotations.info.Contact;
import io.swagger.v3.oas.annotations.info.Info;

@OpenAPIDefinition(
        info = @Info(
                title = "Todo API",
                version = "1.0.0",
                description = "Spring Boot + React To-Do uygulaması için REST API.",
                contact = @Contact(name = "Bedirhan")
        )
)
@SpringBootApplication
public class TodoBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(TodoBackendApplication.class, args);
    }

}
