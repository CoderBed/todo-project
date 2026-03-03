package com.bedirhan.todobackend.dto;

import java.time.LocalDate;
import com.bedirhan.todobackend.model.Priority;

public class TodoCreateRequest {

    private String title;
    private Long orderIndex;
    private LocalDate dueDate;
    private Priority priority;

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public Long getOrderIndex() { return orderIndex; }
    public void setOrderIndex(Long orderIndex) { this.orderIndex = orderIndex; }

    public LocalDate getDueDate() { return dueDate; }
    public void setDueDate(LocalDate dueDate) { this.dueDate = dueDate; }

    public Priority getPriority() { return priority; }
    public void setPriority(Priority priority) { this.priority = priority; }
}