package com.bedirhan.todobackend.controller;

import com.bedirhan.todobackend.model.Category;
import com.bedirhan.todobackend.repository.CategoryRepository;
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
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@RestController
@RequestMapping("/api/categories")
public class CategoryController {

    private final CategoryRepository categoryRepository;
    private final TodoRepository todoRepository;
    private final UserRepository userRepository;

    public CategoryController(CategoryRepository categoryRepository,
                              TodoRepository todoRepository,
                              UserRepository userRepository) {
        this.categoryRepository = categoryRepository;
        this.todoRepository = todoRepository;
        this.userRepository = userRepository;
    }

    public record CategoryResponse(Long id, String name) {}

    public record CategoryCreateRequest(String name) {}

    private CategoryResponse toResponse(Category c) {
        return new CategoryResponse(c.getId(), c.getName());
    }

    private String requireEmail(@AuthenticationPrincipal UserDetails userDetails) {
        if (userDetails != null && userDetails.getUsername() != null && !userDetails.getUsername().isBlank()) {
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
    public List<CategoryResponse> list(@AuthenticationPrincipal UserDetails userDetails) {
        String email = requireEmail(userDetails);
        User user = requireUserByEmail(email);

        return categoryRepository.findByUser(user).stream()
                .map(this::toResponse)
                .toList();
    }

    @PostMapping
    public CategoryResponse create(@RequestBody CategoryCreateRequest req,
                                   @AuthenticationPrincipal UserDetails userDetails) {
        String email = requireEmail(userDetails);
        User user = requireUserByEmail(email);

        String name = (req == null || req.name() == null) ? "" : req.name().trim();
        if (name.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Category name is required");
        }

        // Aynı kullanıcıda aynı isim olmasın.
        if (categoryRepository.findByUserAndName(user, name).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Category already exists");
        }

        Category c = new Category();
        c.setName(name);
        c.setUser(user);

        Category saved = categoryRepository.save(c);
        return toResponse(saved);
    }

    @Transactional
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id,
                       @AuthenticationPrincipal UserDetails userDetails) {
        String email = requireEmail(userDetails);
        User user = requireUserByEmail(email);

        Category c = categoryRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Category not found"));

        // Başkasının kategorisini sildirmeyelim.
        if (c.getUser() == null || c.getUser().getId() == null || !c.getUser().getId().equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        // Önce bu kategoriye bağlı todo'ların category alanını null yap.
        // (FK / constraint hatası almamak için)
        todoRepository.clearCategoryFromTodos(id);

        categoryRepository.delete(c);
    }
}