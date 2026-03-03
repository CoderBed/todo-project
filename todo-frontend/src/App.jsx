import { useEffect, useMemo, useState } from "react";
import "./App.css";

const RAW_API_BASE = (import.meta?.env?.VITE_API_BASE ?? "").trim();
// If VITE_API_BASE is not set (or empty), default to Spring Boot (8080)
// Examples:
//   VITE_API_BASE=http://localhost:8080
//   VITE_API_BASE=/api  (when using a Vite proxy)
const API_BASE = (RAW_API_BASE ? RAW_API_BASE : "http://localhost:8080").replace(/\/$/, "");

const API_TODOS = `${API_BASE}/api/todos`;
const API_AUTH_LOGIN = `${API_BASE}/api/auth/login`;
const API_AUTH_REGISTER = `${API_BASE}/api/auth/register`;

function safeJson(res) {
  return res
    .json()
    .catch(() => null);
}

async function readError(res) {
  const data = await safeJson(res);

  // our backend may return { errors: { field: "msg" } } or { errors: { field: ["msg"] } }
  if (data?.errors && typeof data.errors === "object") {
    const firstKey = Object.keys(data.errors)[0];
    if (firstKey) {
      const v = data.errors[firstKey];
      if (Array.isArray(v)) return v[0] || `API hata: ${res.status}`;
      if (typeof v === "string") return v;
    }
  }

  return data?.message || `API hata: ${res.status}`;
}

function getStoredToken() {
  try {
    return localStorage.getItem("todo_token") || localStorage.getItem("token") || "";
  } catch {
    return "";
  }
}

function storeToken(token) {
  try {
    if (token) {
      localStorage.setItem("todo_token", token);
      localStorage.setItem("token", token);
    } else {
      localStorage.removeItem("todo_token");
      localStorage.removeItem("token");
    }
  } catch {
    // ignore
  }
}

async function apiFetch(url, { token, ...opts } = {}) {
  const headers = new Headers(opts.headers || {});

  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  // If body is JSON, ensure content-type
  if (opts.body != null && typeof opts.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=UTF-8");
  }

  // If caller didn't pass token explicitly, try to use stored token
  const effectiveToken = token || getStoredToken();
  if (effectiveToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${effectiveToken}`);
  }

  return fetch(url, { ...opts, headers });
}

export default function App() {
  // --- Auth ---
  const [token, setToken] = useState(() => getStoredToken());
  const [authMode, setAuthMode] = useState("login"); // login | register
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");

  // --- Todo state ---
  const [todos, setTodos] = useState([]);
  const [error, setError] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [filter, setFilter] = useState("all"); // all | active | completed
  const [query, setQuery] = useState("");
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDueDate, setSelectedDueDate] = useState("");
  const [toast, setToast] = useState("");
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDueDate, setEditingDueDate] = useState("");

  const [loading, setLoading] = useState(false);

  // Some browsers / custom CSS may prevent the native date picker from opening.
  // Calling showPicker() (when available) forces it to open on a user gesture.
  function openNativeDatePicker(e) {
    const el = e?.currentTarget;
    if (el && typeof el.showPicker === "function") {
      try {
        el.showPicker();
      } catch {
        // ignore
      }
    }
  }

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2000);
  }

  function setTokenAndPersist(next) {
    setToken(next);
    storeToken(next);
  }

  function logout() {
    setTokenAndPersist("");
    setTodos([]);
    setError("");
    showToast("Çıkış yapıldı");
  }

  async function submitAuth(e) {
    e.preventDefault();
    const email = authEmail.trim();
    const password = authPassword;
    if (!email || !password) {
      setError("Email ve şifre zorunlu.");
      return;
    }

    if (authMode === "register" && password.length < 6) {
      setError("Şifre en az 6 karakter olmalı.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const url = authMode === "login" ? API_AUTH_LOGIN : API_AUTH_REGISTER;
      const res = await apiFetch(url, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        // register on existing user may return 409
        const msg = await readError(res);
        throw new Error(msg);
      }

      const data = await res.json();
      if (!data?.token) throw new Error("Token alınamadı.");

      setTokenAndPersist(data.token);
      setAuthPassword("");
      showToast(authMode === "login" ? "Giriş başarılı ✅" : "Kayıt başarılı ✅");
      await loadTodos(data.token);
    } catch (err) {
      setError(err.message || "Bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  async function loadTodos(activeToken) {
    const t = activeToken || token;
    if (!t) return;

    try {
      setLoading(true);
      const res = await apiFetch(API_TODOS, { token: t });

      if (res.status === 401) {
        // 401 = token invalid/expired
        logout();
        throw new Error("Oturum süresi dolmuş olabilir. Lütfen tekrar giriş yap.");
      }
      if (res.status === 403) {
        // 403 can happen for CORS / missing permission / backend config.
        // Do NOT auto-logout; keep token so user can retry.
        throw new Error("Yetkin yok (403). Token gönderildi mi ve backend izin veriyor mu kontrol et.");
      }
      if (!res.ok) throw new Error(await readError(res));

      const data = await safeJson(res);
      setTodos(Array.isArray(data) ? data : []);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Keep token synced to localStorage
  useEffect(() => {
    storeToken(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Load todos when token changes
  useEffect(() => {
    if (!token) return;
    loadTodos(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function persistOrder(nextTodos) {
    try {
      const ids = nextTodos.map((t) => t.id);
      const res = await apiFetch(`${API_TODOS}/reorder`, {
        token,
        method: "PUT",
        body: JSON.stringify(ids),
      });
      if (res.status === 401) {
        logout();
        throw new Error("Oturum süresi dolmuş olabilir. Lütfen tekrar giriş yap.");
      }
      if (res.status === 403) {
        throw new Error("Yetkin yok (403).");
      }
      if (!res.ok) throw new Error(await readError(res));
      await loadTodos(token);
    } catch (err) {
      setError(err.message);
    }
  }

  const visibleTodos = useMemo(() => {
    const q = query.trim().toLowerCase();

    return todos.filter((t) => {
      if (filter === "active" && t.completed) return false;
      if (filter === "completed" && !t.completed) return false;

      if (!q) return true;

      const title = (t.title || "").toLowerCase();
      return title.includes(q);
    });
  }, [todos, filter, query]);

  // --- Calendar helpers (month grid for dueDate) ---
  const todayStr = new Date().toISOString().slice(0, 10);

  function ymd(d) {
    return d.toISOString().slice(0, 10);
  }

  function addMonths(base, delta) {
    return new Date(base.getFullYear(), base.getMonth() + delta, 1);
  }

  function monthLabel(d) {
    return d.toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
  }

  const dueCountByDay = useMemo(() => {
    const map = {};
    for (const t of todos) {
      if (!t.dueDate) continue;
      map[t.dueDate] = (map[t.dueDate] || 0) + 1;
    }
    return map;
  }, [todos]);

  const calendarCells = useMemo(() => {
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const first = new Date(year, month, 1);

    // Monday-based week (TR). JS: 0=Sun..6=Sat
    const firstDow = (first.getDay() + 6) % 7; // 0=Mon..6=Sun
    const start = new Date(year, month, 1 - firstDow);

    const total = 42; // 6 weeks grid
    const cells = [];
    for (let i = 0; i < total; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      cells.push({
        date: d,
        key: ymd(d),
        inMonth: d.getMonth() === month,
      });
    }
    return cells;
  }, [calMonth]);

  const listTodos = useMemo(() => {
    if (!selectedDueDate) return visibleTodos;
    return visibleTodos.filter((t) => t.dueDate === selectedDueDate);
  }, [visibleTodos, selectedDueDate]);

  console.log("FILTER:", filter);

  async function addTodo(e) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    try {
      const res = await apiFetch(API_TODOS, {
        token,
        method: "POST",
        body: JSON.stringify({
          title,
          dueDate: newDueDate ? newDueDate : null,
        }),
      });

      if (res.status === 401) {
        logout();
        throw new Error("Oturum süresi dolmuş olabilir. Lütfen tekrar giriş yap.");
      }
      if (res.status === 403) {
        throw new Error("Yetkin yok (403).");
      }

      if (!res.ok) throw new Error(await readError(res));

      const created = await safeJson(res);
      if (created && typeof created === "object") {
        setTodos((prev) => [created, ...prev]);
      } else {
        // If backend returns empty body, just reload
        await loadTodos(token);
      }
      setNewTitle("");
      setNewDueDate("");
      setError("");
      showToast("Görev eklendi ✅");
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteTodo(id) {
    const ok = window.confirm("Bu görevi silmek istediğine emin misin?");
    if (!ok) return;

    try {
      const res = await apiFetch(`${API_TODOS}/${id}`, {
        token,
        method: "DELETE",
      });

      if (res.status === 401) {
        logout();
        throw new Error("Oturum süresi dolmuş olabilir. Lütfen tekrar giriş yap.");
      }
      if (res.status === 403) {
        throw new Error("Yetkin yok (403).");
      }

      if (!res.ok) throw new Error(await readError(res));
      setTodos((prev) => prev.filter((t) => t.id !== id));
      setError("");
      showToast("Görev silindi 🗑️");
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleTodo(id) {
    try {
      const current = todos.find((x) => x.id === id);
      const nextCompleted = current ? !current.completed : true;

      const res = await apiFetch(`${API_TODOS}/${id}`, {
        token,
        method: "PUT",
        body: JSON.stringify({ completed: nextCompleted }),
      });

      if (res.status === 401) {
        logout();
        throw new Error("Oturum süresi dolmuş olabilir. Lütfen tekrar giriş yap.");
      }
      if (res.status === 403) {
        throw new Error("Yetkin yok (403).");
      }

      if (!res.ok) throw new Error(await readError(res));
      const updated = await safeJson(res);
      if (updated && typeof updated === "object") {
        setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
      } else {
        await loadTodos(token);
      }
      setError("");
      showToast("Durum güncellendi ✅");
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveTitle(id) {
    const title = editingTitle.trim();
    if (!title) {
      setEditingId(null);
      setEditingTitle("");
      setEditingDueDate("");
      return;
    }

    try {
      const res = await apiFetch(`${API_TODOS}/${id}/title`, {
        token,
        method: "PUT",
        body: JSON.stringify({
          title,
          dueDate: editingDueDate ? editingDueDate : null,
        }),
      });

      if (res.status === 401) {
        logout();
        throw new Error("Oturum süresi dolmuş olabilir. Lütfen tekrar giriş yap.");
      }
      if (res.status === 403) {
        throw new Error("Yetkin yok (403).");
      }

      if (!res.ok) throw new Error(await readError(res));

      const updated = await safeJson(res);
      if (updated && typeof updated === "object") {
        setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
      } else {
        await loadTodos(token);
      }
      setEditingId(null);
      setEditingTitle("");
      setEditingDueDate("");
      setError("");
      showToast("Görev güncellendi ✍️");
    } catch (err) {
      setError(err.message);
    }
  }

  // --- UI: If not logged in, show auth screen ---
  if (!token) {
    return (
      <div className="app">
        <div className="card">
          {toast && <div className="toast">{toast}</div>}

          <header className="header">
            <div>
              <h1 className="title">To-Do</h1>
              <p className="subtitle">Giriş yap / kayıt ol</p>
            </div>
          </header>

          <div className="filters">
            <button
              type="button"
              className={authMode === "login" ? "btnFilter active" : "btnFilter"}
              onClick={() => setAuthMode("login")}
            >
              Login
            </button>
            <button
              type="button"
              className={authMode === "register" ? "btnFilter active" : "btnFilter"}
              onClick={() => setAuthMode("register")}
            >
              Register
            </button>
          </div>

          <form onSubmit={submitAuth} className="addForm">
            <input
              className="input"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="Email"
              type="email"
              autoComplete="email"
            />
            <input
              className="input"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              placeholder="Şifre"
              type="password"
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
            />
            {authMode === "register" &&
              authEmail &&
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail) && (
                <div className="hint" style={{ marginTop: 8 }}>
                  Geçerli bir email adresi giriniz.
                </div>
              )}
            {authMode === "register" && authPassword && authPassword.length < 6 && (
              <div className="hint" style={{ marginTop: 8 }}>
                Şifre en az 6 karakter olmalı.
              </div>
            )}
            <button
              className="btnPrimary"
              type="submit"
              disabled={
                !authEmail.trim() ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail) ||
                !authPassword ||
                (authMode === "register" && authPassword.length < 6)
              }
            >
              {loading ? "..." : authMode === "login" ? "Giriş Yap" : "Kayıt Ol"}
            </button>
          </form>

          {error && <div className="error">Hata: {error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="card">
        {toast && <div className="toast">{toast}</div>}
        <header className="header">
          <div>
            <h1 className="title">To-Do</h1>
            <p className="subtitle">React + Spring Boot + PostgreSQL</p>
          </div>

          <div className="stats">
            <span className="pill">
              Toplam: <b>{todos.length}</b>
            </span>
            <span className="pill">
              Aktif: <b>{todos.filter((t) => !t.completed).length}</b>
            </span>
            <span className="pill">
              Tamam: <b>{todos.filter((t) => !!t.completed).length}</b>
            </span>
            <button type="button" className="btnFilter" onClick={logout} title="Çıkış">
              Çıkış
            </button>
          </div>
        </header>

        <form onSubmit={addTodo} className="addForm">
          <input
            className="input"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Yeni görev yaz…"
          />
          <input
            className="dateInput"
            type="date"
            value={newDueDate}
            onClick={openNativeDatePicker}
            onFocus={openNativeDatePicker}
            onChange={(e) => setNewDueDate(e.target.value)}
            title="Son tarih"
          />
          <button className="btnPrimary" type="submit" disabled={!newTitle.trim()}>
            Ekle
          </button>
        </form>

        <div className="filters">
          <button
            type="button"
            className={filter === "all" ? "btnFilter active" : "btnFilter"}
            onClick={() => { setError(""); setSelectedDueDate(""); setFilter("all"); }}
          >
            Tümü
          </button>
          <button
            type="button"
            className={filter === "active" ? "btnFilter active" : "btnFilter"}
            onClick={() => { setError(""); setSelectedDueDate(""); setFilter("active"); }}
          >
            Aktif
          </button>
          <button
            type="button"
            className={filter === "completed" ? "btnFilter active" : "btnFilter"}
            onClick={() => { setError(""); setSelectedDueDate(""); setFilter("completed"); }}
          >
            Tamamlandı
          </button>
        </div>

        <div className="searchRow">
          <input
            className="searchInput"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ara: görev başlığı…"
          />
          {query.trim() && (
            <button type="button" className="btnFilter" onClick={() => setQuery("")} title="Aramayı temizle">
              Temizle
            </button>
          )}
        </div>

        <div className="calendar">
          <div className="calendarHeader">
            <button
              type="button"
              className="btnIcon"
              onClick={() => setCalMonth((m) => addMonths(m, -1))}
              title="Önceki ay"
            >
              ‹
            </button>

            <div className="calendarTitle">{monthLabel(calMonth)}</div>

            <button
              type="button"
              className="btnIcon"
              onClick={() => setCalMonth((m) => addMonths(m, 1))}
              title="Sonraki ay"
            >
              ›
            </button>

            {selectedDueDate && (
              <button
                type="button"
                className="btnFilter"
                onClick={() => setSelectedDueDate("")}
                title="Gün filtresini temizle"
              >
                Gün filtresi: {selectedDueDate} ✕
              </button>
            )}
          </div>

          <div className="dowRow">
            <span>Pzt</span>
            <span>Sal</span>
            <span>Çar</span>
            <span>Per</span>
            <span>Cum</span>
            <span>Cmt</span>
            <span>Paz</span>
          </div>

          <div className="grid">
            {calendarCells.map((c) => {
              const count = dueCountByDay[c.key] || 0;
              const isToday = c.key === todayStr;
              const isSelected = selectedDueDate === c.key;

              return (
                <button
                  key={c.key + (c.inMonth ? "m" : "o")}
                  type="button"
                  className={
                    "day" +
                    (c.inMonth ? "" : " other") +
                    (count ? " has" : "") +
                    (isToday ? " today" : "") +
                    (isSelected ? " selected" : "")
                  }
                  onClick={() => {
                    if (count) {
                      setSelectedDueDate((cur) => (cur === c.key ? "" : c.key));
                    } else {
                      setSelectedDueDate("");
                    }
                  }}
                  title={count ? `${count} görev` : ""}
                >
                  <span className="num">{c.date.getDate()}</span>
                  {count ? <span className="dot" /> : null}
                </button>
              );
            })}
          </div>
        </div>

        {error && <div className="error">Hata: {error}</div>}

        <div className="list">
          {loading ? (
            <div className="hint">Yükleniyor…</div>
          ) : listTodos.length === 0 ? (
            <div className="hint">
              {selectedDueDate
                ? "Bu güne atanmış görev yok."
                : query.trim()
                ? "Aramana uygun görev bulunamadı."
                : filter === "all"
                ? "Henüz görev yok. İlk görevini ekle 👇"
                : "Bu filtreye uygun görev yok."}
            </div>
          ) : (
            <ul className="ul">
              {listTodos.map((t) => (
                <li
                  key={t.id}
                  className={
                    "li" +
                    (draggingId === t.id ? " dragging" : "") +
                    (dragOverId === t.id ? " dragOver" : "")
                  }
                  draggable
                  onDragStart={() => {
                    setDraggingId(t.id);
                    setDragOverId(null);
                    showToast("Sürükle-bırak: sıralıyor…");
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDragOverId(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverId !== t.id) setDragOverId(t.id);
                  }}
                  onDrop={() => {
                    if (draggingId == null || draggingId === t.id) return;
                    setDragOverId(null);
                    setTodos((prev) => {
                      const from = prev.findIndex((x) => x.id === draggingId);
                      const to = prev.findIndex((x) => x.id === t.id);
                      if (from === -1 || to === -1) return prev;
                      const copy = [...prev];
                      const [moved] = copy.splice(from, 1);
                      copy.splice(to, 0, moved);
                      persistOrder(copy);
                      return copy;
                    });
                  }}
                >
                  <div className="left">
                    <button
                      type="button"
                      className={t.completed ? "checkBtn done" : "checkBtn"}
                      onClick={() => toggleTodo(t.id)}
                      aria-label="Toggle"
                      title="Tamamlandı / Geri al"
                    >
                      {t.completed ? "✓" : ""}
                    </button>

                    {editingId === t.id ? (
                      <div
                        className="editGroup"
                        tabIndex={-1}
                        onBlur={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget)) {
                            saveTitle(t.id);
                          }
                        }}
                      >
                        <input
                          className="editInput"
                          value={editingTitle}
                          autoFocus
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveTitle(t.id);
                            if (e.key === "Escape") {
                              setEditingId(null);
                              setEditingTitle("");
                              setEditingDueDate("");
                            }
                          }}
                        />
                        <input
                          className="dateInput"
                          type="date"
                          value={editingDueDate}
                          onClick={openNativeDatePicker}
                          onFocus={openNativeDatePicker}
                          onChange={(e) => setEditingDueDate(e.target.value)}
                          title="Son tarih"
                        />
                      </div>
                    ) : (
                      <>
                        <span
                          className={t.completed ? "todoText done" : "todoText"}
                          onDoubleClick={() => {
                            setEditingId(t.id);
                            setEditingTitle(t.title);
                            setEditingDueDate(t.dueDate || "");
                          }}
                          title="Düzenlemek için çift tıkla"
                        >
                          {t.title}
                        </span>
                        {t.dueDate && (
                          <span
                            className={
                              !t.completed && t.dueDate < new Date().toISOString().slice(0, 10)
                                ? "dueBadge overdue"
                                : "dueBadge"
                            }
                            title="Son tarih"
                          >
                            {t.dueDate}
                            {!t.completed && t.dueDate < new Date().toISOString().slice(0, 10)
                              ? " • GEÇMİŞ"
                              : ""}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  <button type="button" className="btnDanger" onClick={() => deleteTodo(t.id)} title="Sil">
                    Sil
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
