package com.bedirhan.todobackend.repository;

import com.bedirhan.todobackend.model.Todo;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TodoRepository extends JpaRepository<Todo, Long> {
    List<Todo> findByUserIdAndDeletedFalseOrderByPinnedDescOrderIndexDescIdDesc(Long userId);
    List<Todo> findByUserIdAndDeletedTrueOrderByPinnedDescOrderIndexDescIdDesc(Long userId);
}