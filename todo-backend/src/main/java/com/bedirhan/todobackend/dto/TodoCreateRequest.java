package com.bedirhan.todobackend.dto;

import java.time.LocalDate;

public class TodoCreateRequest {
    private String title;
    private LocalDate dueDate;
    private Long orderIndex;

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public LocalDate getDueDate() { return dueDate; }
    public void setDueDate(LocalDate dueDate) { this.dueDate = dueDate; }

    public Long getOrderIndex() { return orderIndex; }
    public void setOrderIndex(Long orderIndex) { this.orderIndex = orderIndex; }
}