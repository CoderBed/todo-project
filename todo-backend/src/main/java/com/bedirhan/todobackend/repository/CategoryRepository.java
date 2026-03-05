package com.bedirhan.todobackend.repository;

import com.bedirhan.todobackend.model.Category;
import com.bedirhan.todobackend.user.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CategoryRepository extends JpaRepository<Category, Long> {

    // Kullanıcının tüm kategorileri
    List<Category> findByUser(User user);

    // Aynı isimde kategori var mı kontrolü
    Optional<Category> findByUserAndName(User user, String name);
}