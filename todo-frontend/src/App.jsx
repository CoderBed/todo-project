import { useEffect, useMemo, useState } from "react";
import "./App.css";

const RAW_API_BASE = (import.meta?.env?.VITE_API_BASE ?? "").trim();
// If VITE_API_BASE is not set (or empty), default to Spring Boot (8080)
// Examples:
//   VITE_API_BASE=http://localhost:8080
//   VITE_API_BASE=/api  (when using a Vite proxy)
const API_BASE = (RAW_API_BASE ? RAW_API_BASE : "http://localhost:8080").replace(/\/$/, "");

const API_TODOS = `${API_BASE}/api/todos`;
const API_TODOS_TRASH = `${API_TODOS}/trash`;
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
  const [priorityFilter, setPriorityFilter] = useState("all"); // all | low | medium | high
  const [view, setView] = useState("todos"); // "todos" | "trash"
  const [trashTodos, setTrashTodos] = useState([]);
  const [viewMode, setViewMode] = useState("active"); // active | trash
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

  const [newPriority, setNewPriority] = useState("MEDIUM"); // LOW | MEDIUM | HIGH
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

  async function loadTrash(activeToken) {
    const t = activeToken || token;
    if (!t) return;

    try {
      setLoading(true);
      const res = await apiFetch(API_TODOS_TRASH, { token: t });

      if (res.status === 401) {
        logout();
        throw new Error("Oturum süresi dolmuş olabilir. Lütfen tekrar giriş yap.");
      }
      if (res.status === 403) {
        throw new Error("Yetkin yok (403).");
      }
      if (!res.ok) throw new Error(await readError(res));

      const data = await safeJson(res);
      setTrashTodos(Array.isArray(data) ? data : []);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function restoreTodo(id) {
    try {
      const res = await apiFetch(`${API_TODOS}/${id}/restore`, {
        token,
        method: "PUT",
      });

      if (res.status === 401) {
        logout();
        throw new Error("Oturum süresi dolmuş olabilir. Lütfen tekrar giriş yap.");
      }
      if (res.status === 403) {
        throw new Error("Yetkin yok (403).");
      }
      if (!res.ok) throw new Error(await readError(res));

      // UI: trash listesinden çıkar, normal listeyi de tazele
      setTrashTodos((prev) => prev.filter((t) => t.id !== id));
      await loadTodos(token);

      showToast("Geri yüklendi ✅");
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function hardDeleteTodo(id) {
    const ok = window.confirm("Bu görev kalıcı olarak silinecek. Emin misin?");
    if (!ok) return;

    try {
      // Some backends use different permanent-delete paths. We'll try a couple of common ones.
      const candidates = [
        `${API_TODOS}/${id}/hard`,
        `${API_TODOS}/${id}/hard-delete`,
        `${API_TODOS}/${id}/permanent`,
      ];

      let res = null;
      for (const url of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const r = await apiFetch(url, {
          token,
          method: "DELETE",
        });

        // If endpoint doesn't exist, try next candidate
        if (r.status === 404) {
          res = r;
          continue;
        }

        res = r;
        break;
      }

      if (!res) throw new Error("API isteği başarısız oldu.");

      if (res.status === 401) {
        logout();
        throw new Error("Oturum süresi dolmuş olabilir. Lütfen tekrar giriş yap.");
      }
      if (res.status === 403) throw new Error("Yetkin yok (403).");
      if (res.status === 404) {
        throw new Error(
          "Kalıcı sil endpoint'i bulunamadı (404). Backend'de /api/todos/{id}/hard (veya hard-delete/permanent) tanımlı mı kontrol et."
        );
      }
      if (!res.ok) throw new Error(await readError(res));

      setTrashTodos((prev) => prev.filter((t) => t.id !== id));
      showToast("Kalıcı silindi ❌");
      setError("");
    } catch (err) {
      setError(err.message);
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

    if (viewMode === "active") {
      loadTodos(token);
    } else {
      loadTrash(token);
    }
  }, [token, viewMode]);

  useEffect(() => {
    if (!token) return;
    if (view === "trash") loadTrash(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, view]);

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

      const p = (t.priority || "").toString().toLowerCase(); // low | medium | high
      if (priorityFilter !== "all" && p !== priorityFilter) return false;

      if (!q) return true;

      const title = (t.title || "").toLowerCase();
      return title.includes(q);
    });
  }, [todos, filter, query, priorityFilter]);

  // --- Calendar helpers (month grid for dueDate) ---
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function localYmd(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  const todayStr = localYmd(new Date());

  function ymd(d) {
    return localYmd(d);
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

  const dashboard = useMemo(() => {
    const today = new Date();
    const todayYmd = today.toISOString().slice(0, 10);

    // Pazartesi başlangıçlı hafta
    const day = (today.getDay() + 6) % 7; // 0=Mon..6=Sun
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    start.setDate(today.getDate() - day);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    const total = todos.length;
    const completed = todos.filter((t) => !!t.completed).length;
    const completedPct = total ? Math.round((completed / total) * 100) : 0;

    const overdue = todos.filter((t) => {
      if (t.completed) return false;
      if (!t.dueDate) return false;
      return t.dueDate < todayYmd; // YYYY-MM-DD string compare OK
    }).length;

    const dueThisWeek = todos.filter((t) => {
      if (t.completed) return false;
      if (!t.dueDate) return false;
      const d = new Date(t.dueDate + "T00:00:00");
      return d >= start && d <= end;
    }).length;

    return { overdue, dueThisWeek, completedPct };
  }, [todos]);



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
          priority: newPriority,
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
      setNewPriority("MEDIUM");
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
      const res = await apiFetch(`${API_TODOS}/${id}`, {
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
      <div
        className="app"
        style={{ minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center", padding: 24 }}
      >
        <div className="card" style={{ maxWidth: 1100, width: "100%", margin: "0 auto" }}>
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
    <div
      className="app"
      style={{ minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center", padding: 24 }}
    >
      <div className="card" style={{ maxWidth: 1100, width: "100%", margin: "0 auto" }}>
        {toast && <div className="toast">{toast}</div>}
        <header
          className="header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ flex: "0 0 auto" }}>
            <h1 className="title">To-Do</h1>
          </div>

          <div
            style={{
              flex: "1 1 auto",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 12,
              flexWrap: "nowrap",
              overflowX: "auto",
              padding: "4px 0",
              scrollbarWidth: "none", // Firefox
              msOverflowStyle: "none", // IE/Edge
            }}
          >
            <span className="pill">
              Toplam: <b>{todos.length}</b>
            </span>
            <span className="pill">
              Aktif: <b>{todos.filter((t) => !t.completed).length}</b>
            </span>
            <span className="pill">
              Tamam: <b>{todos.filter((t) => !!t.completed).length}</b>
            </span>

            <button
              type="button"
              className={view === "todos" ? "btnFilter active" : "btnFilter"}
              onClick={async () => {
                setError("");
                setView("todos");
                setViewMode("active");
                await loadTodos(token);
              }}
              title="Aktif görevler"
            >
              Aktif Görevler
            </button>
            <button
              type="button"
              className={view === "trash" ? "btnFilter active" : "btnFilter"}
              onClick={async () => {
                setError("");
                if (view === "trash") {
                  setView("todos");
                } else {
                  setView("trash");
                  await loadTrash(token);
                }
              }}
              title="Çöp kutusu"
            >
              Çöp Kutusu
            </button>
          </div>

          <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className="btnFilter" onClick={logout} title="Çıkış">
              Çıkış
            </button>
          </div>
        </header>

        <div className="stats" style={{ marginTop: 10 }}>
          <span className="pill" title="Son tarihi geçmiş (tamamlanmamış) görev sayısı">
            🔴 Süresi Dolmuş: <b>{dashboard.overdue}</b>
          </span>
          <span className="pill" title="Bu hafta teslim edilecek (tamamlanmamış) görev sayısı">
            🟡 Bu hafta: <b>{dashboard.dueThisWeek}</b>
          </span>
          <span className="pill" title="Tamamlanan görev oranı">
            🟢 Tamamlanan: <b>%{dashboard.completedPct}</b>
          </span>
        </div>

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
          <select
            className="select"
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value)}
            title="Öncelik"
          >
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
          </select>
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
        <div className="filters">
          <button
            type="button"
            className={priorityFilter === "all" ? "btnFilter active" : "btnFilter"}
            onClick={() => { setError(""); setSelectedDueDate(""); setPriorityFilter("all"); }}
            title="Öncelik filtresi"
          >
            Priority: Hepsi
          </button>
          <button
            type="button"
            className={priorityFilter === "high" ? "btnFilter active" : "btnFilter"}
            onClick={() => { setError(""); setSelectedDueDate(""); setPriorityFilter("high"); }}
            title="HIGH"
          >
            High
          </button>
          <button
            type="button"
            className={priorityFilter === "medium" ? "btnFilter active" : "btnFilter"}
            onClick={() => { setError(""); setSelectedDueDate(""); setPriorityFilter("medium"); }}
            title="MEDIUM"
          >
            Medium
          </button>
          <button
            type="button"
            className={priorityFilter === "low" ? "btnFilter active" : "btnFilter"}
            onClick={() => { setError(""); setSelectedDueDate(""); setPriorityFilter("low"); }}
            title="LOW"
          >
            Low
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
              {(view === "trash" ? trashTodos : listTodos).map((t) => (
  <li
    key={t.id}
    className={
      "li" +
      (draggingId === t.id ? " dragging" : "") +
      (dragOverId === t.id ? " dragOver" : "")
    }
    draggable={view !== "trash"}
    onDragStart={() => {
      if (view === "trash") return;
      setDraggingId(t.id);
      setDragOverId(null);
      showToast("Sürükle-bırak: sıralıyor…");
    }}
    onDragEnd={() => {
      if (view === "trash") return;
      setDraggingId(null);
      setDragOverId(null);
    }}
    onDragOver={(e) => {
      if (view === "trash") return;
      e.preventDefault();
      if (dragOverId !== t.id) setDragOverId(t.id);
    }}
    onDrop={() => {
      if (view === "trash") return;
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
        onClick={() => (view === "trash" ? null : toggleTodo(t.id))}
        aria-label="Toggle"
        title={view === "trash" ? "Çöp kutusunda durum değişmez" : "Tamamlandı / Geri al"}
        disabled={view === "trash"}
      >
        {t.completed ? <span className="checkIcon">✓</span> : ""}
      </button>

      {editingId === t.id && view !== "trash" ? (
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
              if (view === "trash") return;
              setEditingId(t.id);
              setEditingTitle(t.title);
              setEditingDueDate(t.dueDate || "");
            }}
            title={view === "trash" ? "Çöp kutusunda düzenleme kapalı" : "Düzenlemek için çift tıkla"}
          >
            {t.title}
          </span>
          {t.priority && (
            <span className={"priorityBadge p-" + String(t.priority).toLowerCase()} title="Öncelik">
              {t.priority}
            </span>
          )}
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

    {view === "trash" ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btnFilter" onClick={() => restoreTodo(t.id)} title="Geri yükle">
            Geri yükle
          </button>
          <button type="button" className="btnDanger" onClick={() => hardDeleteTodo(t.id)} title="Kalıcı sil">
            Kalıcı Sil
          </button>
        </div>
    ) : (
        <button type="button" className="btnDanger" onClick={() => deleteTodo(t.id)} title="Sil">
          Sil
        </button>
    )}
  </li>
))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
