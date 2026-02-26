package com.bedirhan.todobackend.controller;

import com.bedirhan.todobackend.dto.TodoCreateRequest;
import com.bedirhan.todobackend.model.Todo;
import com.bedirhan.todobackend.repository.TodoRepository;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@CrossOrigin(origins = {"http://localhost:5173", "http://localhost:5174"})
@RestController
@RequestMapping("/api/todos")
public class TodoController {

    private final TodoRepository todoRepository;

    public TodoController(TodoRepository todoRepository) {
        this.todoRepository = todoRepository;
    }

    @GetMapping
    public List<Todo> getTodos() {
        return todoRepository.findAllOrdered();
    }

    @PostMapping
    public Todo addTodo(@Valid @RequestBody TodoCreateRequest request) {
        Todo todo = new Todo();
        todo.setTitle(request.getTitle());
        todo.setCompleted(false);
        todo.setDueDate(request.getDueDate());

        Long max = todoRepository.findMaxOrderIndex();
        todo.setOrderIndex((max == null ? 0L : max) + 1L);

        return todoRepository.save(todo);
    }

    @DeleteMapping("/{id:\\d+}")
    public void deleteTodo(@PathVariable Long id) {
        todoRepository.deleteById(id);
    }

    @PutMapping("/{id:\\d+}")
    public Todo toggleTodo(@PathVariable Long id) {
        Todo todo = todoRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Todo not found: " + id));

        todo.setCompleted(!Boolean.TRUE.equals(todo.isCompleted()));
        return todoRepository.save(todo);
    }

    @PutMapping("/{id:\\d+}/title")
    public Todo updateTitle(@PathVariable Long id, @Valid @RequestBody TodoCreateRequest request) {
        Todo todo = todoRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Todo not found: " + id));

        todo.setTitle(request.getTitle());
        // Always apply dueDate from request (can be null to clear)
        todo.setDueDate(request.getDueDate());
        return todoRepository.save(todo);
    }

    @PutMapping("/reorder")
    public void reorder(@RequestBody List<Long> ids) {
        // ids comes in UI order: first id should appear at the top.
        Map<Long, Todo> byId = new HashMap<>();
        for (Todo t : todoRepository.findAllById(ids)) {
            byId.put(t.getId(), t);
        }

        long order = ids.size();
        for (Long id : ids) {
            Todo t = byId.get(id);
            if (t != null) {
                t.setOrderIndex(order);
                order--;
            }
        }

        todoRepository.saveAll(byId.values());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException ex) {
        Map<String, String> errors = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors().forEach(err -> {
            String field = err.getField();
            String msg = err.getDefaultMessage();
            if (!errors.containsKey(field)) {
                errors.put(field, msg);
            }
        });

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", Instant.now().toString());
        body.put("status", 400);
        body.put("error", "Bad Request");
        body.put("message", "Validation failed");
        body.put("errors", errors);

        return ResponseEntity.badRequest().body(body);
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<Map<String, Object>> handleRuntime(RuntimeException ex) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", Instant.now().toString());
        body.put("status", HttpStatus.NOT_FOUND.value());
        body.put("error", "Not Found");
        body.put("message", ex.getMessage());

        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(body);
    }
}