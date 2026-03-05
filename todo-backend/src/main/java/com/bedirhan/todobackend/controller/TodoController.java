package com.bedirhan.todobackend.controller;

import com.bedirhan.todobackend.dto.TodoCreateRequest;
import com.bedirhan.todobackend.model.Todo;
import com.bedirhan.todobackend.repository.TodoRepository;
import com.bedirhan.todobackend.user.User;
import com.bedirhan.todobackend.user.UserRepository;
import com.bedirhan.todobackend.model.Priority;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;

import com.bedirhan.todobackend.model.Category;
import com.bedirhan.todobackend.repository.CategoryRepository;

@RestController
@RequestMapping("/api/todos")
public class TodoController {

    private final TodoRepository todoRepository;
    private final UserRepository userRepository;
    private final CategoryRepository categoryRepository;

    public TodoController(TodoRepository todoRepository,
                          UserRepository userRepository,
                          CategoryRepository categoryRepository) {
        this.todoRepository = todoRepository;
        this.userRepository = userRepository;
        this.categoryRepository = categoryRepository;
    }

    // DTO to prevent serializing JPA lazy proxies (e.g., Todo.user)
    public record TodoResponse(
            Long id,
            String title,
            String description,
            boolean completed,
            Long orderIndex,
            LocalDate dueDate,
            Priority priority,
            Boolean pinned,
            Long categoryId,
            String categoryName
    ) {}

    private TodoResponse toResponse(Todo t) {
        Long categoryId = null;
        String categoryName = null;
        if (t.getCategory() != null) {
            categoryId = t.getCategory().getId();
            categoryName = t.getCategory().getName();
        }

        return new TodoResponse(
                t.getId(),
                t.getTitle(),
                t.getDescription(),
                Boolean.TRUE.equals(t.getCompleted()),
                t.getOrderIndex(),
                t.getDueDate(),
                t.getPriority(),
                Boolean.TRUE.equals(t.getPinned()),
                categoryId,
                categoryName
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

    private Category requireCategoryForUser(Long categoryId, User user) {
        Category category = categoryRepository.findById(categoryId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Category not found"));

        // category ownership check (if Category has a user field)
        if (category.getUser() != null && category.getUser().getId() != null) {
            if (!category.getUser().getId().equals(user.getId())) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Forbidden");
            }
        }

        return category;
    }

    @Transactional(readOnly = true)
    @GetMapping
    public List<TodoResponse> list(@AuthenticationPrincipal UserDetails userDetails) {
        String email = requireEmail(userDetails);
        User user = requireUserByEmail(email);

        return todoRepository.findByUserIdAndDeletedFalseOrderByPinnedDescOrderIndexDescIdDesc(user.getId())
                .stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    @GetMapping("/trash")
    public List<TodoResponse> trash(@AuthenticationPrincipal UserDetails userDetails) {
        String email = requireEmail(userDetails);
        User user = requireUserByEmail(email);

        return todoRepository
                .findByUserIdAndDeletedTrueOrderByPinnedDescOrderIndexDescIdDesc(user.getId())
                .stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional
    @PutMapping("/{id}/restore")
    public TodoResponse restore(@PathVariable Long id,
                                @AuthenticationPrincipal UserDetails userDetails) {
        String email = requireEmail(userDetails);
        User user = requireUserByEmail(email);

        Todo todo = todoRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Todo not found"));

        // başkasının todo’sunu restore etmesin
        if (todo.getUser() == null || !todo.getUser().getId().equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        todo.setDeleted(false);
        Todo saved = todoRepository.save(todo);
        return toResponse(saved);
    }

    @DeleteMapping({"/{id}/hard", "/{id}/hard-delete", "/{id}/permanent"})
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void hardDelete(@PathVariable Long id,
                           @AuthenticationPrincipal UserDetails userDetails) {
        String email = requireEmail(userDetails);
        User user = requireUserByEmail(email);

        Todo todo = todoRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Todo not found"));

        // güvenlik: sadece kendi todo’sunu silebilsin.
        if (todo.getUser() == null || todo.getUser().getId() == null || !todo.getUser().getId().equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        // sadece deleted=true ise kalıcı sil (çöp kutusundan)
        if (!Boolean.TRUE.equals(todo.getDeleted())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Önce çöp kutusuna taşı (deleted=true) olmalı.");
        }

        todoRepository.delete(todo);
    }

    @Transactional
    @PostMapping
    public TodoResponse create(@RequestBody TodoCreateRequest req,
                              @AuthenticationPrincipal UserDetails userDetails) {

        String email = requireEmail(userDetails);
        User user = requireUserByEmail(email);

        Todo todo = new Todo();
        todo.setTitle(req.getTitle());
        todo.setDescription(req.getDescription());
        todo.setCompleted(false);
        todo.setOrderIndex(req.getOrderIndex());
        todo.setDueDate(req.getDueDate());
        todo.setPriority(req.getPriority() == null ? Priority.MEDIUM : req.getPriority());
        if (req.getCategoryId() != null) {
            Category category = requireCategoryForUser(req.getCategoryId(), user);
            todo.setCategory(category);
        }
        todo.setUser(user);

        Todo saved = todoRepository.save(todo);
        return toResponse(saved);
    }

    // PUT body is optional for your curl tests. If body is empty, we will toggle completed.
    public record TodoUpdateRequest(
            Boolean completed,
            String title,
            String description,
            LocalDate dueDate,
            Long orderIndex,
            Priority priority,
            Long categoryId
    ) {}

    @Transactional
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
        boolean hasAnyField = req != null && (
                req.completed != null
                        || req.title != null
                        || req.description != null
                        || req.dueDate != null
                        || req.orderIndex != null
                        || req.priority != null
                        || req.categoryId != null
        );
        if (!hasAnyField) {
            todo.setCompleted(!Boolean.TRUE.equals(todo.getCompleted()));
        } else {
            if (req.completed != null) todo.setCompleted(req.completed);
            if (req.title != null) todo.setTitle(req.title);
            if (req.description != null) todo.setDescription(req.description);
            if (req.dueDate != null) todo.setDueDate(req.dueDate);
            if (req.orderIndex != null) todo.setOrderIndex(req.orderIndex);
            if (req.priority != null) todo.setPriority(req.priority);
            if (req.categoryId != null) {
                Category category = requireCategoryForUser(req.categoryId, user);
                todo.setCategory(category);
            }
        }

        Todo saved = todoRepository.save(todo);
        return toResponse(saved);
    }

    @Transactional
    @PutMapping("/{id}/pin")
    public TodoResponse togglePin(@PathVariable Long id,
                                  @AuthenticationPrincipal UserDetails userDetails) {

        String email = requireEmail(userDetails);
        User user = requireUserByEmail(email);

        Todo todo = todoRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Todo not found"));

        if (todo.getUser() == null || todo.getUser().getId() == null || !todo.getUser().getId().equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        todo.setPinned(!Boolean.TRUE.equals(todo.getPinned()));
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

        todo.setDeleted(true);
        // güvenli: soft delete her zaman idempotent kalsın
        todoRepository.save(todo);
    }


    @PutMapping("/reorder")
    public ResponseEntity<Void> reorder(@RequestBody List<Long> ids,
                                        @AuthenticationPrincipal UserDetails userDetails) {

        if (ids == null || ids.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "ids boş olamaz");
        }

        String email = requireEmail(userDetails);
        User user = requireUserByEmail(email);

        // 1) Verilen id'lere karşılık gelen todo'ları çek
        List<Todo> todos = todoRepository.findAllById(ids);
        if (todos.size() != ids.size()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Bazı todo id'leri bulunamadı");
        }

        // 2) Güvenlik: sadece kendi todo'larını reorder edebilsin + deleted=false olanları
        for (Todo t : todos) {
            if (t.getUser() == null || t.getUser().getId() == null || !t.getUser().getId().equals(user.getId())) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Forbidden");
            }
            if (Boolean.TRUE.equals(t.getDeleted())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Çöp kutusundaki todo reorder edilemez");
            }
        }

        // 3) İstenen sıraya göre orderIndex ata.
        // UI'da ilk gelen (ids[0]) en üstte görünsün diye daha büyük orderIndex veriyoruz.
        Map<Long, Todo> byId = new HashMap<>();
        for (Todo t : todos) {
            byId.put(t.getId(), t);
        }

        long base = ids.size();
        for (int i = 0; i < ids.size(); i++) {
            Long id = ids.get(i);
            Todo t = byId.get(id);
            if (t == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Geçersiz id: " + id);
            }
            t.setOrderIndex(base - i);
        }

        todoRepository.saveAll(todos);
        return ResponseEntity.ok().build();
    }
}