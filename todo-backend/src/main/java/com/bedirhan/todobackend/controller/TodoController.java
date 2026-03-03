package com.bedirhan.todobackend.controller;

import com.bedirhan.todobackend.dto.TodoCreateRequest;
import com.bedirhan.todobackend.model.Todo;
import com.bedirhan.todobackend.repository.TodoRepository;
import com.bedirhan.todobackend.user.User;
import com.bedirhan.todobackend.user.UserRepository;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("/api/todos")
public class TodoController {

    private final TodoRepository todoRepository;
    private final UserRepository userRepository;

    public TodoController(TodoRepository todoRepository, UserRepository userRepository) {
        this.todoRepository = todoRepository;
        this.userRepository = userRepository;
    }

    // DTO to prevent serializing JPA lazy proxies (e.g., Todo.user)
    public record TodoResponse(
            Long id,
            String title,
            boolean completed,
            Long orderIndex,
            LocalDate dueDate
    ) {}

    private TodoResponse toResponse(Todo t) {
        return new TodoResponse(
                t.getId(),
                t.getTitle(),
                Boolean.TRUE.equals(t.getCompleted()),
                t.getOrderIndex(),
                t.getDueDate()
        );
    }

    /**
     * Returns the authenticated user's email (JWT subject) from either:
     * - @AuthenticationPrincipal (preferred when available)
     * - SecurityContext Authentication name (fallback)
     *
     * Throws 401 if request is unauthenticated.
     */
    private String requireEmail(UserDetails userDetails) {
        if (userDetails != null
                && userDetails.getUsername() != null
                && !userDetails.getUsername().isBlank()) {
            return userDetails.getUsername();
        }

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unauthorized");
        }

        String name = auth.getName();
        if (name == null || name.isBlank() || "anonymousUser".equalsIgnoreCase(name)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unauthorized");
        }

        return name;
    }

    private User requireUserByEmail(String email) {
        return userRepository.findByEmail(email)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));
    }

    @GetMapping
    public List<TodoResponse> list(@AuthenticationPrincipal UserDetails userDetails) {
        String email = requireEmail(userDetails);
        User user = requireUserByEmail(email);

        return todoRepository.findByUserIdOrderByOrderIndexDescIdDesc(user.getId())
                .stream()
                .map(this::toResponse)
                .toList();
    }

    @PostMapping
    public TodoResponse create(@RequestBody TodoCreateRequest req,
                              @AuthenticationPrincipal UserDetails userDetails) {

        String email = requireEmail(userDetails);
        User user = requireUserByEmail(email);

        Todo todo = new Todo();
        todo.setTitle(req.getTitle());
        todo.setCompleted(false);
        todo.setOrderIndex(req.getOrderIndex());
        todo.setDueDate(req.getDueDate());
        todo.setUser(user);

        Todo saved = todoRepository.save(todo);
        return toResponse(saved);
    }

    // PUT body is optional for your curl tests. If body is empty, we will toggle completed.
    public record TodoUpdateRequest(Boolean completed, String title, LocalDate dueDate, Long orderIndex) {}

    @PutMapping("/{id}")
    public TodoResponse update(@PathVariable Long id,
                               @RequestBody(required = false) TodoUpdateRequest req,
                               @AuthenticationPrincipal UserDetails userDetails) {

        String email = requireEmail(userDetails);
        User user = requireUserByEmail(email);

        Todo todo = todoRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Todo not found"));

        // Ownership check: user can only update their own todos
        if (todo.getUser() == null || todo.getUser().getId() == null || !todo.getUser().getId().equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        // If no body (or all fields null), treat as toggle completed
        boolean hasAnyField = req != null && (req.completed != null || req.title != null || req.dueDate != null || req.orderIndex != null);
        if (!hasAnyField) {
            todo.setCompleted(!Boolean.TRUE.equals(todo.getCompleted()));
        } else {
            if (req.completed != null) todo.setCompleted(req.completed);
            if (req.title != null) todo.setTitle(req.title);
            if (req.dueDate != null) todo.setDueDate(req.dueDate);
            if (req.orderIndex != null) todo.setOrderIndex(req.orderIndex);
        }

        Todo saved = todoRepository.save(todo);
        return toResponse(saved);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id,
                       @AuthenticationPrincipal UserDetails userDetails) {

        String email = requireEmail(userDetails);
        User user = requireUserByEmail(email);

        Todo todo = todoRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Todo not found"));

        if (todo.getUser() == null || todo.getUser().getId() == null || !todo.getUser().getId().equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        todoRepository.delete(todo);
    }
}