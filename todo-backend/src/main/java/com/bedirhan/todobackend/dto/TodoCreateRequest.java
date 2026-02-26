package com.bedirhan.todobackend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

public class TodoCreateRequest {

    @NotBlank(message = "Title boş olamaz")
    @Size(max = 100, message = "Title en fazla 100 karakter olabilir")
    private String title;

    // Optional due date (YYYY-MM-DD)
    private LocalDate dueDate;

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public LocalDate getDueDate() {
        return dueDate;
    }

    public void setDueDate(LocalDate dueDate) {
        this.dueDate = dueDate;
    }
}