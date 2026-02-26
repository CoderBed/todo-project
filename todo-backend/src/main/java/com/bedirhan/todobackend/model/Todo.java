package com.bedirhan.todobackend.model;

import jakarta.persistence.*;
import java.time.LocalDate;

@Entity
public class Todo {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String title;
    private Boolean completed = false;

    // Higher value means higher in the list (used for drag & drop ordering)
    private Long orderIndex;

    // Optional due date (YYYY-MM-DD)
    private LocalDate dueDate;

    public Todo() {
    }

    public Todo(Long id, String title, Boolean completed, Long orderIndex, LocalDate dueDate) {
        this.id = id;
        this.title = title;
        this.completed = (completed != null) ? completed : false;
        this.orderIndex = orderIndex;
        this.dueDate = dueDate;
    }

    public Long getId() {
        return id;
    }

    public String getTitle() {
        return title;
    }

    public Boolean isCompleted() {
        return completed;
    }

    public Long getOrderIndex() {
        return orderIndex;
    }

    public LocalDate getDueDate() {
        return dueDate;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public void setCompleted(Boolean completed) {
        this.completed = (completed != null) ? completed : false;
    }

    public void setOrderIndex(Long orderIndex) {
        this.orderIndex = orderIndex;
    }

    public void setDueDate(LocalDate dueDate) {
        this.dueDate = dueDate;
    }
}
