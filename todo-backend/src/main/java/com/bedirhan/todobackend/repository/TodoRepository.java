package com.bedirhan.todobackend.repository;

import com.bedirhan.todobackend.model.Todo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.EntityGraph;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface TodoRepository extends JpaRepository<Todo, Long> {
    @EntityGraph(attributePaths = {"category"})
    List<Todo> findByUserIdAndDeletedFalseOrderByPinnedDescOrderIndexDescIdDesc(Long userId);
    @EntityGraph(attributePaths = {"category"})
    List<Todo> findByUserIdAndDeletedTrueOrderByPinnedDescOrderIndexDescIdDesc(Long userId);

    @EntityGraph(attributePaths = {"category"})
    Optional<Todo> findWithCategoryById(Long id);

    @Modifying
    @Transactional
    @Query("update Todo t set t.category = null where t.category.id = :categoryId")
    int clearCategoryFromTodos(@Param("categoryId") Long categoryId);
}