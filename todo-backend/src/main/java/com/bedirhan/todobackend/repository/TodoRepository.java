package com.bedirhan.todobackend.repository;

import com.bedirhan.todobackend.model.Todo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.EntityGraph;

import java.util.List;
import java.util.Optional;

public interface TodoRepository extends JpaRepository<Todo, Long> {
    @EntityGraph(attributePaths = {"category"})
    List<Todo> findByUserIdAndDeletedFalseOrderByPinnedDescOrderIndexDescIdDesc(Long userId);
    @EntityGraph(attributePaths = {"category"})
    List<Todo> findByUserIdAndDeletedTrueOrderByPinnedDescOrderIndexDescIdDesc(Long userId);

    @EntityGraph(attributePaths = {"category"})
    Optional<Todo> findWithCategoryById(Long id);
}