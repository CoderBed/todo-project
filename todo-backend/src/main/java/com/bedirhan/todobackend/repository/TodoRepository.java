package com.bedirhan.todobackend.repository;

import com.bedirhan.todobackend.model.Todo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;

public interface TodoRepository extends JpaRepository<Todo, Long> {

    @Query("select t from Todo t order by coalesce(t.orderIndex, t.id) desc, t.id desc")
    List<Todo> findAllOrdered();

    @Query("select coalesce(max(coalesce(t.orderIndex, t.id)), 0) from Todo t")
    Long findMaxOrderIndex();
}