package com.bedirhan.todobackend.security;

import com.bedirhan.todobackend.user.User;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import io.jsonwebtoken.security.Keys;

@Service
public class JwtService {

    private final SecretKey key;

    public JwtService(@Value("${app.jwt.secret}") String secret) {
        // HS256 için anahtar en az 256-bit (32 byte) olmalı.
        byte[] keyBytes = secret.getBytes(StandardCharsets.UTF_8);
        if (keyBytes.length < 32) {
            throw new IllegalArgumentException("app.jwt.secret en az 32 karakter olmalı (HS256 için)." );
        }
        this.key = Keys.hmacShaKeyFor(keyBytes);
    }

    // ✅ AuthController eski haliyle çalışsın diye: generateToken(email)
    public String generateToken(String email) {
        return generateToken(email, "USER");
    }

    // ✅ İstersen rolü de ekleyebilesin
    public String generateToken(String email, String role) {
        long now = System.currentTimeMillis();
        long exp = now + (1000L * 60 * 60 * 24); // 24 saat

        return Jwts.builder()
                .subject(email)
                .claim("role", role)
                .issuedAt(new Date(now))
                .expiration(new Date(exp))
                .signWith(key)
                .compact();
    }

    // ✅ Daha temiz kullanım (istersen controller’dan bunu çağırırsın)
    public String generateToken(User u) {
        String role = (u.getRole() == null) ? "USER" : u.getRole().toString();
        return generateToken(u.getEmail(), role);
    }

    public String extractUsername(String token) {
        return extractAllClaims(token).getSubject();
    }

    public boolean isTokenValid(String token, String username) {
        String subject = extractUsername(token);
        return subject != null && subject.equals(username) && !isTokenExpired(token);
    }

    private boolean isTokenExpired(String token) {
        Date exp = extractAllClaims(token).getExpiration();
        return exp != null && exp.before(new Date());
    }

    private Claims extractAllClaims(String token) {
        // ✅ jjwt 0.12.x uyumlu parse
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }
}