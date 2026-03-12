import { Component, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import logo from "./assets/logo.png";
import DOMPurify from "dompurify";

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
const API_CATEGORIES = `${API_BASE}/api/categories`;

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
  const [token, setToken] = useState("");
  const [authMode, setAuthMode] = useState("login"); // login | register
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");

  // --- Todo state ---
  const [todos, setTodos] = useState([]);
  const [error, setError] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newCategoryId, setNewCategoryId] = useState(""); // "" | "<id>"
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categories, setCategories] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [filter, setFilter] = useState("all"); // all | active | completed
  const [priorityFilter, setPriorityFilter] = useState("all"); // all | low | medium | high
  const [view, setView] = useState("todos"); // "todos" | "trash" | "stats"
  const [trashTodos, setTrashTodos] = useState([]);
  const [viewMode, setViewMode] = useState("active"); // active | trash
  const [query, setQuery] = useState("");
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDueDates, setSelectedDueDates] = useState([]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryAddOpen, setCategoryAddOpen] = useState(false);
  const [filterSections, setFilterSections] = useState({
    category: true,
    status: false,
    priority: false,
  });
  const [toast, setToast] = useState("");
  const [draggingId, setDraggingId] = useState(null);
  const [recentlyAddedId, setRecentlyAddedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [selectedTodoIds, setSelectedTodoIds] = useState([]);
  const [selectedTrashIds, setSelectedTrashIds] = useState([]);

  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDueDate, setEditingDueDate] = useState("");
  const [descOpenId, setDescOpenId] = useState(null);
  const [descDraft, setDescDraft] = useState("");
  const [descCategoryId, setDescCategoryId] = useState("none");
  const [descPriority, setDescPriority] = useState("MEDIUM");
  const [expandedDescId, setExpandedDescId] = useState(null);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState([]);
  const [categoryAccentByKey, setCategoryAccentByKey] = useState(() => {
    try {
      const raw = localStorage.getItem("mytodo-category-accents");
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });

  const [newPriority, setNewPriority] = useState("MEDIUM"); // LOW | MEDIUM | HIGH
  const newTodoInputRef = useRef(null);
  const newCategoryInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [listTransitioning, setListTransitioning] = useState(false);
  const lastReorderToastAtRef = useRef(0);

  function plainTextFromHtml(html) {
    return DOMPurify.sanitize(html || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
  }

  class QuillErrorBoundary extends Component {
    constructor(props) {
      super(props);
      this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
      return { hasError: true };
    }

    componentDidCatch(error) {
      console.error("ReactQuill render error:", error);
    }

    render() {
      if (this.state.hasError) {
        return this.props.fallback ?? null;
      }
      return this.props.children;
    }
  }

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
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setToast((prev) => [...prev, { id, message }]);

    window.setTimeout(() => {
      setToast((prev) => prev.filter((t) => t.id !== id));
    }, 8000);
  }

  function renderEmptyState({ icon, title, description, accent = "#60a5fa" }) {
    return (
      <div
        style={{
          marginTop: 18,
          marginBottom: 8,
          padding: "22px 20px",
          borderRadius: 22,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.02))",
          boxShadow: "0 14px 34px rgba(0,0,0,0.14)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 54,
            height: 54,
            borderRadius: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `${accent}18`,
            border: `1px solid ${accent}2e`,
            color: accent,
            boxShadow: `0 10px 24px ${accent}18`,
          }}
        >
          {icon}
        </div>
        <div style={{ fontWeight: 800, fontSize: 18, color: "#f8fafc" }}>{title}</div>
        <div style={{ color: "#94a3b8", fontSize: 14, maxWidth: 520, lineHeight: 1.55 }}>
          {description}
        </div>
      </div>
    );
  }

  function switchMainView(nextView) {
    if (
      (nextView === "trash" && view === "trash" && viewMode === "trash") ||
      (nextView === "todos" && view === "todos" && viewMode === "active") ||
      (nextView === "stats" && view === "stats")
    ) return;

    setError("");
    setListTransitioning(false);

    if (nextView === "trash") {
      setView("trash");
      setViewMode("trash");
    } else if (nextView === "stats") {
      setView("stats");
    } else {
      setView("todos");
      setViewMode("active");
    }
  }

  async function handleBrandClick() {
    setError("");

    if (view === "todos") {
      setViewMode("active");
      setSelectedDueDates([]);
      setCategoryFilter(null);
      setFilter("all");
      setPriorityFilter("all");
      setQuery("");
      setFiltersOpen(false);
      setCalendarOpen(false);
      setSelectedTodoIds([]);
      setSelectedTrashIds([]);

      if (token) {
        await loadTodos(token);
      }
    }

    setSelectedDueDates([]);
    setCategoryFilter(null);
    setFilter("all");
    setPriorityFilter("all");
    setQuery("");
    setFiltersOpen(false);
    setCalendarOpen(false);
    setSelectedTodoIds([]);
    setSelectedTrashIds([]);
    switchMainView("todos");
  }

  function setTokenAndPersist(next) {
    setToken(next);
    storeToken(next);
  }

  function logout() {
    setTokenAndPersist("");
    setTodos([]);
    setSelectedTodoIds([]);
    setSelectedTrashIds([]);
    setError("");
    setAuthEmail("");
    setAuthPassword("");
    setAuthMode("login");
    showToast("Çıkış yapıldı.");
  }

  function toggleSelectedTodo(id) {
    setSelectedTodoIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleSelectedTrash(id) {
    setSelectedTrashIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function clearSelectedTrash() {
    setSelectedTrashIds([]);
  }

  async function bulkHardDeleteSelectedTrash() {
    if (!selectedTrashIds.length) return;

    const ok = window.confirm(`${selectedTrashIds.length} görev çöp kutusundan kalıcı olarak silinecek. Emin misin?`);
    if (!ok) return;

    try {
      const ids = [...selectedTrashIds];

      for (const id of ids) {
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
        if (res.status === 403) {
          throw new Error("Yetkin yok (403).");
        }
        if (res.status === 404) {
          throw new Error(
            "Kalıcı sil endpoint'i bulunamadı (404). Backend'de /api/todos/{id}/hard (veya hard-delete/permanent) tanımlı mı kontrol et."
          );
        }
        if (!res.ok) throw new Error(await readError(res));
      }

      setTrashTodos((prev) => prev.filter((t) => !ids.includes(t.id)));
      setSelectedTrashIds([]);
      setError("");
      showToast(`${ids.length} görev çöp kutusundan kalıcı olarak silindi. 🗑️`);
    } catch (err) {
      setError(err.message || "Toplu kalıcı silme işlemi başarısız oldu.");
    }
  }

  async function emptyTrash() {
    if (!trashTodos.length) return;

    const ok = window.confirm(`Çöp kutusundaki ${trashTodos.length} görev kalıcı olarak silinecek. Emin misin?`);
    if (!ok) return;

    try {
      const ids = trashTodos.map((t) => t.id);

      for (const id of ids) {
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
        if (res.status === 403) {
          throw new Error("Yetkin yok (403).");
        }
        if (res.status === 404) {
          throw new Error(
              "Kalıcı sil endpoint'i bulunamadı (404). Backend'de /api/todos/{id}/hard (veya hard-delete/permanent) tanımlı mı kontrol et."
          );
        }
        if (!res.ok) throw new Error(await readError(res));
      }

      setTrashTodos([]);
      setSelectedTrashIds([]);
      setError("");
      showToast("Çöp kutusu tamamen boşaltıldı. 🗑️");
    } catch (err) {
      setError(err.message || "Çöp kutusu boşaltılamadı.");
    }
  }

  function clearSelectedTodos() {
    setSelectedTodoIds([]);
  }

  async function bulkDeleteSelectedTodos() {
    if (!selectedTodoIds.length) return;

    const ok = window.confirm(`${selectedTodoIds.length} görev silinecek. Emin misin?`);
    if (!ok) return;

    try {
      const ids = [...selectedTodoIds];

      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
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
      }

      setTodos((prev) => prev.filter((t) => !ids.includes(t.id)));
      setSelectedTodoIds([]);
      setError("");
      showToast(`${ids.length} görev silindi. 🗑️`);
    } catch (err) {
      setError(err.message || "Toplu silme işlemi başarısız oldu.");
    }
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
        if (authMode === "login" && res.status === 401) {
          throw new Error("Hatalı e-mail veya şifre girdiniz. Lütfen tekrar deneyin.");
        }

        if (authMode === "register" && res.status === 409) {
          throw new Error("Bu e-mail adresiyle daha önce kayıt olunmuş. Lütfen başka bir mail adresi ile kaydolunuz.");
        }

        const msg = await readError(res);
        throw new Error(msg);
      }

      const data = await res.json();
      if (!data?.token) throw new Error("Token alınamadı.");

      setTokenAndPersist(data.token);
      setAuthPassword("");
      showToast(authMode === "login" ? "Giriş başarılı ✅" : "Kayıt başarılı ✅");
      await loadTodos(data.token);
      await loadCategories(data.token);
    } catch (err) {
      setError(err.message || "Bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  async function loadCategories(activeToken) {
    const t = activeToken || token;
    if (!t) return;

    try {
      const res = await apiFetch(API_CATEGORIES, { token: t });

      if (res.status === 401) {
        logout();
        throw new Error("Oturum süresi dolmuş olabilir. Lütfen tekrar giriş yap.");
      }
      if (res.status === 403) {
        throw new Error("Yetkin yok (403).");
      }
      if (!res.ok) throw new Error(await readError(res));

      const data = await safeJson(res);
      setCategories(Array.isArray(data) ? data : []);
    } catch (err) {
      // kategori çekme hatası todo listesini bozmasın; sadece console'a yaz
      console.error("Kategori yükleme hatası:", err);
    }
  }

  async function createCategory() {
    const name = newCategoryName.trim();
    if (!name) return;

    try {
      const res = await apiFetch(API_CATEGORIES, {
        token,
        method: "POST",
        body: JSON.stringify({ name }),
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

      // Backend bazı durumlarda boş dönebilir; o durumda yeniden yükle
      if (!created || typeof created !== "object") {
        await loadCategories(token);
        setNewCategoryName("");
        setCategoryAddOpen(false);
        window.requestAnimationFrame(() => newCategoryInputRef.current?.focus());
        return;
      }

      setCategories((prev) => {
        const exists = prev.some((c) => Number(c.id) === Number(created.id));
        if (exists) return prev;
        return [...prev, created];
      });

      // Yeni eklenen kategoriyi seç
      setNewCategoryId("");
      setNewCategoryName("");
      setCategoryAddOpen(false);
      showToast("Kategori eklendi. ✅");
      window.requestAnimationFrame(() => newCategoryInputRef.current?.focus());
    } catch (err) {
      setError(err.message || "Kategori eklenemedi.");
    }
  }

  async function deleteCategory(categoryId) {
    if (!categoryId) return;

    try {
      const res = await apiFetch(`${API_CATEGORIES}/${categoryId}`, {
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

      // Backend may return 204 No Content on success
      if (!res.ok && res.status !== 204) {
        const msg = await readError(res);
        throw new Error(msg);
      }

      // UI: remove from category list
      setCategories((prev) => prev.filter((c) => String(c.id) !== String(categoryId)));

      // Silinen kategoriyi görevlerden de kaldır
      setTodos((prev) =>
          prev.map((t) => {
            const cid = t.categoryId ?? t.category?.id ?? null;

            if (String(cid) === String(categoryId)) {
              return {
                ...t,
                categoryId: null,
                category: null,
                categoryName: null,
              };
            }

            return t;
          })
      );

      // If currently selected in NEW todo form, reset it
      setNewCategoryId((prev) => (String(prev) === String(categoryId) ? "" : prev));

      showToast("Kategori silindi. 🗑️");
      setError("");

      // Also reload categories to be safe (in case backend has different state)
      await loadCategories(token);
    } catch (err) {
      setError(err.message || "Kategori silinemedi.");
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
      setSelectedTrashIds((prev) => prev.filter((x) => x !== id));
      await loadTodos(token);

      showToast("Geri yüklendi. ✅");
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    // Sadece sayfa yenilemeyse token'ı geri yükle
    const nav = performance.getEntriesByType?.("navigation")?.[0];
    const type = nav?.type; // "navigate" | "reload" | "back_forward"

    if (type === "reload") {
      const stored = getStoredToken();
      if (stored) setToken(stored);
    }
  }, []);

  // Keep token synced to localStorage
  useEffect(() => {
    storeToken(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Load todos and categories when token or viewMode changes
  useEffect(() => {
    if (!token) return;

    // kategoriler her iki ekranda da lazım
    loadCategories(token);

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

  useEffect(() => {
    setSelectedTodoIds([]);
    setSelectedTrashIds([]);
  }, [view]);

  useEffect(() => {
    try {
      localStorage.setItem("mytodo-category-accents", JSON.stringify(categoryAccentByKey));
    } catch {
      // storage hatasını sessizce geç
    }
  }, [categoryAccentByKey]);

  // 15 dk = 15 * 60 * 1000
  const IDLE_MS = 15 * 60 * 1000;

  useEffect(() => {
    if (!token) return;

    let timerId = null;

    const resetTimer = () => {
      if (timerId) window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        // 15 dk boyunca hiç hareket yoksa
        showToast("Oturum zaman aşımına uğradı.");
        logout();
      }, IDLE_MS);
    };

    // Kullanıcı etkileşimleri -> timer sıfırlanır
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));

    // ilk başta da başlat
    resetTimer();

    return () => {
      if (timerId) window.clearTimeout(timerId);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
    // logout/showToast fonksiyonları component içinde olduğu için bağımlılığa eklemek gerekmiyor (aynı render scope)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function persistOrder(nextTodos) {
    try {
      // Reorder endpoint payload can differ by backend implementation.
      // We'll try a few common shapes to avoid 400 while keeping UI responsive.
      const ids = nextTodos.map((t) => t.id);
      const payloadObjects = nextTodos.map((t, index) => ({ id: t.id, orderIndex: index }));

      const candidates = [
        ids, // [1,2,3]
        payloadObjects, // [{id, orderIndex}]
        { ids }, // { ids: [1,2,3] }
        { orderIds: ids }, // { orderIds: [1,2,3] }
        { items: payloadObjects }, // { items: [{id, orderIndex}] }
      ];

      let res = null;
      for (const body of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const r = await apiFetch(`${API_TODOS}/reorder`, {
          token,
          method: "PUT",
          body: JSON.stringify(body),
        });

        res = r;

        // Success
        if (r.ok) break;

        // If it's a validation/bad request, try next shape
        if (r.status === 400 || r.status === 415) continue;

        // For other errors (401/403/500...), stop here and handle below
        break;
      }

      if (!res) throw new Error("API isteği başarısız oldu.");
      if (res.status === 401) {
        logout();
        throw new Error("Oturum süresi dolmuş olabilir. Lütfen tekrar giriş yap.");
      }
      if (res.status === 403) {
        throw new Error("Yetkin yok (403).");
      }
      if (!res.ok) throw new Error(await readError(res));
      const now = Date.now();
      if (now - lastReorderToastAtRef.current > 1200) {
        showToast("Sıralama kaydedildi. ✅");
        lastReorderToastAtRef.current = now;
      }
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

      // kategori filtresi
      if (categoryFilter) {
        const cid = t.categoryId ?? t.category?.id ?? null;
        if (String(cid) !== String(categoryFilter)) return false;
      }

      if (!q) return true;

      const title = (t.title || "").toLowerCase();
      const description = (t.description || "").toLowerCase();
      return title.includes(q) || description.includes(q);
    });
  }, [todos, filter, query, priorityFilter, categoryFilter]);

  const categoryNameById = useMemo(() => {
    const map = new Map();
    for (const c of categories) {
      if (c && c.id != null) map.set(Number(c.id), c.name);
    }
    return map;
  }, [categories]);

  function toggleCategoryCollapse(categoryKey) {
    setCollapsedCategoryIds((prev) =>
      prev.includes(categoryKey) ? prev.filter((x) => x !== categoryKey) : [...prev, categoryKey]
    );
  }

  function toggleFilterSection(key) {
    setFilterSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }

  const CATEGORY_COLOR_OPTIONS = [
    "#60a5fa",
    "#34d399",
    "#f59e0b",
    "#f472b6",
    "#a78bfa",
    "#f87171",
    "#22c55e",
    "#38bdf8",
    "#fb7185",
    "#f97316",
    "#84cc16",
    "#14b8a6",
    "#8b5cf6",
    "#ec4899",
    "#eab308",
    "#06b6d4",
  ];

  function defaultCategoryAccent(categoryKey) {
    let hash = 0;
    for (let i = 0; i < categoryKey.length; i += 1) {
      hash = (hash * 31 + categoryKey.charCodeAt(i)) >>> 0;
    }
    return CATEGORY_COLOR_OPTIONS[hash % CATEGORY_COLOR_OPTIONS.length];
  }

  function getCategoryAccent(categoryKey) {
    return categoryAccentByKey[categoryKey] || defaultCategoryAccent(categoryKey);
  }


  const categoryCountById = useMemo(() => {
    const counts = {};
    for (const t of todos) {
      const cid = t.categoryId ?? t.category?.id ?? null;
      if (cid == null) continue;
      const id = Number(cid);
      counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }, [todos]);

  const priorityCountByKey = useMemo(() => {
    const counts = { low: 0, medium: 0, high: 0 };
    for (const t of todos) {
      const p = (t.priority || "").toString().toLowerCase();
      if (counts[p] != null) counts[p] += 1;
    }
    return counts;
  }, [todos]);

  const statusCount = useMemo(() => {
    let active = 0;
    let completed = 0;
    for (const t of todos) {
      if (t.completed) completed += 1;
      else active += 1;
    }
    return {
      all: todos.length,
      active,
      completed,
    };
  }, [todos]);

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
    if (!selectedDueDates.length) return visibleTodos;
    return visibleTodos.filter((t) => selectedDueDates.includes(t.dueDate));
  }, [visibleTodos, selectedDueDates]);

  const groupedListTodos = useMemo(() => {
    if (view === "trash") {
      return [{ key: "trash", title: "", items: trashTodos, collapsible: false }];
    }

    const pinned = listTodos.filter((t) => !!t.pinned);
    const regular = listTodos.filter((t) => !t.pinned);
    const groups = [];

    if (pinned.length > 0) {
      groups.push({
        key: "pinned",
        title: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M14 3L21 10L17 11L13 15L9 11L13 7L14 3Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path
                d="M9 15L4 20"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
        ),
        items: pinned,
        collapsible: true
      });
    }

    const byCategory = new Map();

    for (const todo of regular) {
      const rawCategoryId = todo.categoryId ?? todo.category?.id ?? null;
      const numericCategoryId = rawCategoryId != null ? Number(rawCategoryId) : null;
      const categoryKey = numericCategoryId != null ? `cat-${numericCategoryId}` : "cat-none";
      const categoryTitle = numericCategoryId != null
        ? (todo.categoryName ?? categoryNameById.get(numericCategoryId) ?? "Kategorisiz")
        : "Kategorisiz";

      if (!byCategory.has(categoryKey)) {
        byCategory.set(categoryKey, {
          key: categoryKey,
          title: categoryTitle,
          items: [],
          collapsible: true,
        });
      }

      byCategory.get(categoryKey).items.push(todo);
    }

    const sortedCategoryGroups = [...byCategory.values()].sort((a, b) => {
      if (a.title === "Kategorisiz" && b.title !== "Kategorisiz") return 1;
      if (a.title !== "Kategorisiz" && b.title === "Kategorisiz") return -1;
      return a.title.localeCompare(b.title, "tr");
    });

    groups.push(...sortedCategoryGroups);

    return groups;
  }, [view, listTodos, trashTodos, categoryNameById, categoryAccentByKey]);

  // --- Stats Overview ---
  const statsOverview = useMemo(() => {
    const total = todos.length;
    const completed = todos.filter((t) => !!t.completed).length;
    const active = total - completed;
    const overdue = todos.filter((t) => {
      if (t.completed) return false;
      if (!t.dueDate) return false;
      return t.dueDate < todayStr;
    }).length;
    const pinned = todos.filter((t) => !!t.pinned).length;
    return { total, completed, active, overdue, pinned };
  }, [todos, todayStr]);

  const statsByCategory = useMemo(() => {
    return categories
      .map((c) => {
        const all = todos.filter((t) => {
          const cid = t.categoryId ?? t.category?.id ?? null;
          return String(cid) === String(c.id);
        });
        const completed = all.filter((t) => !!t.completed).length;
        const active = all.length - completed;
        return { id: c.id, name: c.name, total: all.length, active, completed };
      })
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "tr"));
  }, [categories, todos]);

  const statsByPriority = useMemo(() => {
    const source = [
      { key: "HIGH", label: "High" },
      { key: "MEDIUM", label: "Medium" },
      { key: "LOW", label: "Low" },
    ];
    return source.map((item) => {
      const total = todos.filter((t) => String(t.priority || "") === item.key).length;
      return { ...item, total };
    });
  }, [todos]);

  const statsByDue = useMemo(() => {
    let today = 0;
    let future = 0;
    let noDate = 0;
    let overdue = 0;
    for (const t of todos) {
      if (!t.dueDate) noDate += 1;
      else if (t.dueDate < todayStr) overdue += 1;
      else if (t.dueDate === todayStr) today += 1;
      else future += 1;
    }
    return { today, future, noDate, overdue };
  }, [todos, todayStr]);

  const maxCategoryTotal = useMemo(() => Math.max(1, ...statsByCategory.map((x) => x.total)), [statsByCategory]);
  const maxPriorityTotal = useMemo(() => Math.max(1, ...statsByPriority.map((x) => x.total)), [statsByPriority]);

  const generalChartData = [
    { label: "Tamamlanan", value: statsOverview.completed, color: "#22c55e" },
    { label: "Aktif", value: statsOverview.active, color: "#60a5fa" },
    { label: "Süresi Dolmuş", value: statsOverview.overdue, color: "#ef4444" },
    { label: "Sabitlenen", value: statsOverview.pinned, color: "#f59e0b" },
  ];

  const dueChartData = [
    { label: "Bugün", value: statsByDue.today, color: "#facc15" },
    { label: "Gelecek", value: statsByDue.future, color: "#22c55e" },
    { label: "Süresi Dolmuş", value: statsByDue.overdue, color: "#ef4444" },
    { label: "Tarih Belirlenmemiş", value: statsByDue.noDate, color: "#94a3b8" },
  ];


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
          description: "",
          dueDate: newDueDate ? newDueDate : null,
          priority: newPriority,
          categoryId: newCategoryId && newCategoryId !== "none" ? Number(newCategoryId) : null,
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
        setRecentlyAddedId(created.id);
        setTimeout(() => setRecentlyAddedId(null), 900);
      } else {
        // If backend returns empty body, just reload
        await loadTodos(token);
      }
      setNewTitle("");
      setNewDueDate("");
      setNewPriority("MEDIUM");
      setNewCategoryId("");
      setError("");
      showToast("Görev eklendi. ✅");
      window.requestAnimationFrame(() => newTodoInputRef.current?.focus());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    setSelectedTodoIds((prev) => prev.filter((id) => todos.some((t) => t.id === id)));
  }, [todos]);

  useEffect(() => {
    setSelectedTrashIds((prev) => prev.filter((id) => trashTodos.some((t) => t.id === id)));
  }, [trashTodos]);

  async function toggleTodo(id) {
    try {
      const current = todos.find((x) => x.id === id);
      const nextCompleted = current ? !current.completed : true;

      const res = await apiFetch(`${API_TODOS}/${id}`, {
        token,
        method: "PUT",
        body: JSON.stringify({
          title: current?.title ?? "",
          description: current?.description ?? "",
          dueDate: current?.dueDate ?? null,
          priority: current?.priority ?? null,
          completed: nextCompleted,
          pinned: !!current?.pinned,
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
      setError("");
      showToast("Aktiflik durumu güncellendi. ✅");
    } catch (err) {
      setError(err.message);
    }
  }

  async function togglePinTodo(id) {
    try {
      const current = todos.find((x) => x.id === id);
      const nextPinned = current ? !current.pinned : true;

      // Önce backend'de varsa özel endpoint'leri dene
      const candidates = [
        `${API_TODOS}/${id}/pin`,
        `${API_TODOS}/${id}/pinned`,
        `${API_TODOS}/${id}/toggle-pin`,
      ];

      let res = null;

      for (const url of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const r = await apiFetch(url, { token, method: "PUT" });
        res = r;
        if (r.status === 404) continue;
        break;
      }

      // Hepsi 404 ise normal PUT ile pinned alanını update et
      if (res && res.status === 404) {
        res = await apiFetch(`${API_TODOS}/${id}`, {
          token,
          method: "PUT",
          body: JSON.stringify({
            title: current?.title ?? "",
            description: current?.description ?? "",
            dueDate: current?.dueDate ?? null,
            priority: current?.priority ?? null,
            completed: !!current?.completed,
            pinned: nextPinned,
          }),
        });
      }

      if (!res) throw new Error("API isteği başarısız oldu.");
      if (res.status === 401) {
        logout();
        throw new Error("Oturum süresi dolmuş olabilir. Lütfen tekrar giriş yap.");
      }
      if (res.status === 403) throw new Error("Yetkin yok (403).");
      if (!res.ok) throw new Error(await readError(res));

      const updated = await safeJson(res);

      if (updated && typeof updated === "object") {
        setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, ...updated } : t)));
      } else {
        setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, pinned: nextPinned } : t)));
        await loadTodos(token);
      }

      showToast(nextPinned ? "Sabitlendi. 📌" : "Sabitleme kaldırıldı.");
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateTodoDescription(id, nextDescription, nextCategoryId, nextPriority) {
    try {
      const todoId = Number(id);
      const current = todos.find((x) => Number(x.id) === todoId);

      // If we can't find the todo in state, fall back to reloading after save.
      const payload = {
        title: current?.title ?? "",
        description: nextDescription ?? "",
        dueDate: current?.dueDate ?? null,
        priority: nextPriority ?? current?.priority ?? null,
        completed: !!current?.completed,
        pinned: !!current?.pinned,
        categoryId: nextCategoryId === "none" ? 0 : (nextCategoryId ? Number(nextCategoryId) : null),
      };

      const res = await apiFetch(`${API_TODOS}/${todoId}`, {
        token,
        method: "PUT",
        body: JSON.stringify(payload),
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

      // Bazı backend'lerde GET /api/todos cevabında `description` alanı gelmeyebiliyor.
      // Bu yüzden PUT cevabını kullanıp state'i direkt güncelliyoruz.
      if (updated && typeof updated === "object") {
        setTodos((prev) =>
            prev.map((t) => (Number(t.id) === todoId ? { ...t, ...updated } : t))
        );
      } else {
        // body boş dönerse son çare: yeniden yükle
        await loadTodos(token);
      }

      showToast("Açıklama kaydedildi. ✅");
      setError("");
    } catch (err) {
      setError(err.message);
      throw err;
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
          description: (todos.find((x) => x.id === id)?.description) ?? "",
          dueDate: editingDueDate ? editingDueDate : null,
          priority: (todos.find((x) => x.id === id)?.priority) ?? null,
          completed: !!(todos.find((x) => x.id === id)?.completed),
          pinned: !!(todos.find((x) => x.id === id)?.pinned),
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
      showToast("Görev güncellendi. ✍️");
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
          {toast.length > 0 && (
              <div className="toastStack">
                {toast.map((t) => (
                    <div key={t.id} className="toast">
                      {t.message}
                    </div>
                ))}
              </div>
          )}

          <header className="header">
            <div>
              <div className="brand">
                <img src={logo} alt="MyToDo logo" className="brandLogo" />
                <h1 className="title">MyToDo</h1>
              </div>
              <p className="subtitle">Giriş Yap / Kayıt Ol</p>
            </div>
          </header>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                setAuthMode("login");
                setAuthEmail("");
                setAuthPassword("");
                setError("");
              }}
              style={{
                height: 42,
                paddingInline: 22,
                borderRadius: 999,
                border: authMode === "login" ? "1px solid rgba(34,197,94,0.30)" : "1px solid rgba(255,255,255,0.12)",
                background: authMode === "login" ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.04)",
                color: authMode === "login" ? "#dcfce7" : "#e5e7eb",
                fontWeight: 700,
                cursor: "pointer",
                transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, color 0.18s ease, box-shadow 0.18s ease",
                boxShadow: authMode === "login" ? "inset 0 1px 0 rgba(255,255,255,0.04)" : "none",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                if (authMode === "login") {
                  e.currentTarget.style.background = "rgba(34,197,94,0.16)";
                  e.currentTarget.style.borderColor = "rgba(34,197,94,0.42)";
                } else {
                  e.currentTarget.style.background = "rgba(255,255,255,0.07)";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
                  e.currentTarget.style.color = "#ffffff";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                if (authMode === "login") {
                  e.currentTarget.style.background = "rgba(34,197,94,0.12)";
                  e.currentTarget.style.borderColor = "rgba(34,197,94,0.30)";
                  e.currentTarget.style.color = "#dcfce7";
                } else {
                  e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                  e.currentTarget.style.color = "#e5e7eb";
                }
              }}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("register");
                setAuthEmail("");
                setAuthPassword("");
                setError("");
              }}
              style={{
                height: 42,
                paddingInline: 22,
                borderRadius: 999,
                border: authMode === "register" ? "1px solid rgba(96,165,250,0.28)" : "1px solid rgba(255,255,255,0.12)",
                background: authMode === "register" ? "rgba(96,165,250,0.10)" : "rgba(255,255,255,0.04)",
                color: authMode === "register" ? "#dbeafe" : "#e5e7eb",
                fontWeight: 700,
                cursor: "pointer",
                transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, color 0.18s ease, box-shadow 0.18s ease",
                boxShadow: authMode === "register" ? "inset 0 1px 0 rgba(255,255,255,0.04)" : "none",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                if (authMode === "register") {
                  e.currentTarget.style.background = "rgba(96,165,250,0.14)";
                  e.currentTarget.style.borderColor = "rgba(96,165,250,0.38)";
                } else {
                  e.currentTarget.style.background = "rgba(255,255,255,0.07)";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
                  e.currentTarget.style.color = "#ffffff";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                if (authMode === "register") {
                  e.currentTarget.style.background = "rgba(96,165,250,0.10)";
                  e.currentTarget.style.borderColor = "rgba(96,165,250,0.28)";
                  e.currentTarget.style.color = "#dbeafe";
                } else {
                  e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                  e.currentTarget.style.color = "#e5e7eb";
                }
              }}
            >
              Register
            </button>
          </div>

          {authMode === "register" &&
            ((authEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail)) ||
              (authPassword && authPassword.length < 6)) && (
              <div style={{ marginTop: 10, display: "flex", gap: 16, flexWrap: "wrap" }}>
                {authEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail) && (
                  <div className="hint">Geçerli bir e-mail adresi giriniz.</div>
                )}
                {authPassword && authPassword.length < 6 && (
                  <div className="hint">Şifre en az 6 karakter olmalı.</div>
                )}
              </div>
          )}

          <form onSubmit={submitAuth} className="addForm" style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
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

          {error && <div className="error">{error}</div>}
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
        {toast.length > 0 && (
            <div className="toastStack">
              {toast.map((t) => (
                  <div key={t.id} className="toast">
                    {t.message}
                  </div>
              ))}
            </div>
        )}
        <div className="stickyTopBar" style={{ paddingBottom: 1, marginBottom: 2 }}>
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
            <button
                type="button"
                className="brandButton"
                onClick={handleBrandClick}
                title="Tüm görevlere dön"
            >
              <div className="brand">
                <img src={logo} alt="MyToDo logo" className="brandLogo" />
                <h1 className="title">MyToDo</h1>
              </div>
            </button>
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
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            }}
          >
            <button
              type="button"
              onClick={() => switchMainView("todos")}
              title="Aktif Görevler"
              style={{
                background: "transparent",
                border: "none",
                borderBottom: view === "todos" ? "2px solid #22c55e" : "2px solid transparent",
                color: view === "todos" ? "#ffffff" : "#cbd5e1",
                padding: "10px 14px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.18s ease",
              }}
            >
              Tüm Görevler
            </button>
            <button
              type="button"
              onClick={() => switchMainView(view === "trash" ? "todos" : "trash")}
              title="Çöp Kutusu"
              style={{
                background: "transparent",
                border: "none",
                borderBottom: view === "trash" ? "2px solid #22c55e" : "2px solid transparent",
                color: view === "trash" ? "#ffffff" : "#cbd5e1",
                padding: "10px 14px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.18s ease",
              }}
            >
              Çöp Kutusu
            </button>
            <button
              type="button"
              onClick={() => switchMainView("stats")}
              title="İstatistikler"
              style={{
                background: "transparent",
                border: "none",
                borderBottom: view === "stats" ? "2px solid #22c55e" : "2px solid transparent",
                color: view === "stats" ? "#ffffff" : "#cbd5e1",
                padding: "10px 14px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.18s ease",
              }}
            >
              İstatistikler
            </button>
          </div>

          <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btnFilter"
              onClick={logout}
              title="Çıkış Yap"
              aria-label="Çıkış"
              style={{
                width: 40,
                height: 40,
                borderRadius: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                transition: "transform 0.18s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.04)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M12 3V12"
                  stroke="#ef4444"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
                <path
                  d="M7.05 5.8C5.22 7.08 4 9.19 4 11.59C4 15.49 7.13 18.65 11 18.65C14.87 18.65 18 15.49 18 11.59C18 9.19 16.78 7.08 14.95 5.8"
                  stroke="#ef4444"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </header>

          {view !== "trash" && view !== "stats" && selectedTodoIds.length > 0 && (
              <div
                  style={{
                    marginTop: 12,
                    marginBottom: 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    padding: "10px 12px",
                    borderRadius: 18,
                    background: "rgba(255,255,255,0.035)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                  }}
              >
                <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 12px",
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      fontWeight: 600,
                      color: "#e5e7eb",
                    }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <rect x="5" y="7" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M9 5H17C18.1046 5 19 5.89543 19 7V15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  <span>Seçili görev</span>
                  <span
                      style={{
                        minWidth: 24,
                        height: 24,
                        paddingInline: 8,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 999,
                        background: "rgba(96,165,250,0.14)",
                        color: "#dbeafe",
                        fontWeight: 700,
                        fontSize: 13,
                        lineHeight: 1,
                      }}
                  >
        {selectedTodoIds.length}
      </span>
                </div>

                <button
                    type="button"
                    onClick={clearSelectedTodos}
                    title="Seçimi temizle"
                    style={{
                      height: 40,
                      paddingInline: 14,
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(255,255,255,0.03)",
                      color: "#e5e7eb",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, color 0.18s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.07)";
                      e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
                      e.currentTarget.style.color = "#ffffff";
                      e.currentTarget.style.transform = "translateY(-1px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                      e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                      e.currentTarget.style.color = "#e5e7eb";
                      e.currentTarget.style.transform = "translateY(0)";
                    }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M6 6L18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  <span>Seçimi Temizle</span>
                </button>

                <button
                    type="button"
                    onClick={bulkDeleteSelectedTodos}
                    title="Seçili görevleri sil"
                    style={{
                      height: 40,
                      paddingInline: 14,
                      borderRadius: 14,
                      border: "1px solid rgba(239,68,68,0.40)",
                      background: "rgba(239,68,68,0.08)",
                      color: "#fca5a5",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, color 0.18s ease, box-shadow 0.18s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(239,68,68,0.16)";
                      e.currentTarget.style.borderColor = "rgba(239,68,68,0.58)";
                      e.currentTarget.style.color = "#fecaca";
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = "0 8px 18px rgba(239,68,68,0.18)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                      e.currentTarget.style.borderColor = "rgba(239,68,68,0.40)";
                      e.currentTarget.style.color = "#fca5a5";
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M4 7H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    <path d="M9 7V5C9 4.44772 9.44772 4 10 4H14C14.5523 4 15 4.44772 15 5V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    <path d="M6 7L7 19C7.05236 19.5523 7.44772 20 8 20H16C16.5523 20 16.9476 19.5523 17 19L18 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>{selectedTodoIds.length === 1 ? "Sil" : "Toplu Sil"}</span>
                </button>
              </div>
          )}

        {view === "trash" && trashTodos.length > 0 && (
          <div className="filters" style={{ marginTop: 10, marginBottom: 10 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 14px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.10)",
                fontWeight: 600,
              }}
            >
              <span style={{ opacity: 0.85, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 7H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  <path d="M9 7V5C9 4.44772 9.44772 4 10 4H14C14.5523 4 15 4.44772 15 5V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  <path d="M6 7L7 19C7.05236 19.5523 7.44772 20 8 20H16C16.5523 20 16.9476 19.5523 17 19L18 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>Çöp Kutusu</span>
              </span>
              <span
                style={{
                  padding: "2px 10px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.10)",
                  fontWeight: 700,
                  fontSize: 13,
                  lineHeight: "20px",
                  minWidth: 28,
                  textAlign: "center",
                }}
              >
                {trashTodos.length}
              </span>
            </div>
            <button
              type="button"
              className="btnDanger"
              onClick={emptyTrash}
              title="Çöp Kutusunu Boşalt"
              style={{
                background: "transparent",
                border: "1px solid rgba(239,68,68,0.6)",
                color: "#f87171",
                padding: "8px 14px",
                borderRadius: 999,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.18s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#ef4444";
                e.currentTarget.style.color = "#fff";
                e.currentTarget.style.boxShadow = "0 6px 14px rgba(239,68,68,0.35)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "#f87171";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 7H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  <path d="M9 7V5C9 4.44772 9.44772 4 10 4H14C14.5523 4 15 4.44772 15 5V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  <path d="M6 7L7 19C7.05236 19.5523 7.44772 20 8 20H16C16.5523 20 16.9476 19.5523 17 19L18 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>Boşalt</span>
              </span>
            </button>
          </div>
        )}
{view === "trash" && selectedTrashIds.length > 0 && (
  <div
    style={{
      marginTop: 12,
      marginBottom: 10,
      display: "flex",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap",
      padding: "10px 12px",
      borderRadius: 18,
      background: "rgba(255,255,255,0.035)",
      border: "1px solid rgba(255,255,255,0.08)",
      boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
    }}
  >
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.10)",
        fontWeight: 600,
        color: "#e5e7eb",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="5" y="7" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M9 5H17C18.1046 5 19 5.89543 19 7V15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>Seçili görev</span>
      <span
        style={{
          minWidth: 24,
          height: 24,
          paddingInline: 8,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          background: "rgba(96,165,250,0.14)",
          color: "#dbeafe",
          fontWeight: 700,
          fontSize: 13,
          lineHeight: 1,
        }}
      >
        {selectedTrashIds.length}
      </span>
    </div>

    <button
      type="button"
      onClick={clearSelectedTrash}
      title="Seçimi temizle"
      style={{
        height: 40,
        paddingInline: 14,
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.03)",
        color: "#e5e7eb",
        fontWeight: 600,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, color 0.18s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.07)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
        e.currentTarget.style.color = "#ffffff";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.03)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
        e.currentTarget.style.color = "#e5e7eb";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M6 6L18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span>Seçimi Temizle</span>
    </button>

    <button
      type="button"
      onClick={bulkHardDeleteSelectedTrash}
      title="Seçili görevleri kalıcı sil"
      style={{
        height: 40,
        paddingInline: 14,
        borderRadius: 14,
        border: "1px solid rgba(239,68,68,0.40)",
        background: "rgba(239,68,68,0.08)",
        color: "#fca5a5",
        fontWeight: 700,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, color 0.18s ease, box-shadow 0.18s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(239,68,68,0.16)";
        e.currentTarget.style.borderColor = "rgba(239,68,68,0.58)";
        e.currentTarget.style.color = "#fecaca";
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = "0 8px 18px rgba(239,68,68,0.18)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(239,68,68,0.08)";
        e.currentTarget.style.borderColor = "rgba(239,68,68,0.40)";
        e.currentTarget.style.color = "#fca5a5";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M4 7H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        <path d="M9 7V5C9 4.44772 9.44772 4 10 4H14C14.5523 4 15 4.44772 15 5V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        <path d="M6 7L7 19C7.05236 19.5523 7.44772 20 8 20H16C16.5523 20 16.9476 19.5523 17 19L18 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <span>{selectedTrashIds.length === 1 ? "Sil" : "Toplu Sil"}</span>
    </button>
  </div>
)}
        {view !== "trash" && view !== "stats" && (
        <form onSubmit={addTodo} className="addForm">
          <input
              ref={newTodoInputRef}
              className="input"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Yeni görev yaz…"
              style={{ height: 38 }}
          />
          <input
            className="dateInput"
            type="date"
            value={newDueDate}
            onClick={openNativeDatePicker}
            onFocus={openNativeDatePicker}
            onChange={(e) => setNewDueDate(e.target.value)}
            title="Tarih Seç"
            style={{ height: 38 }}
          />
          <select
            className="select"
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value)}
            title="Öncelik"
            style={{ height: 38 }}
          >
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
          </select>
          <select
              className="select"
              value={newCategoryId}
              onChange={(e) => setNewCategoryId(e.target.value)}
              title="Kategori"
              style={{ height: 38 }}
          >
            <option value="" hidden>
              Seç…
            </option>

            <option value="none">
              Yok
            </option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!newTitle.trim()}
            title="Görev Ekle"
            style={{
              height: 38,
              paddingInline: 18,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.12)",
              background: !newTitle.trim() ? "rgba(255,255,255,0.04)" : "rgba(96,165,250,0.10)",
              color: !newTitle.trim() ? "rgba(255,255,255,0.38)" : "#dbeafe",
              fontWeight: 600,
              cursor: !newTitle.trim() ? "not-allowed" : "pointer",
              transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, color 0.18s ease, box-shadow 0.18s ease",
              boxShadow: !newTitle.trim() ? "none" : "inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
            onMouseEnter={(e) => {
              if (!newTitle.trim()) return;
              e.currentTarget.style.background = "rgba(96,165,250,0.14)";
              e.currentTarget.style.borderColor = "rgba(96,165,250,0.24)";
              e.currentTarget.style.color = "#eff6ff";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              if (!newTitle.trim()) {
                e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                e.currentTarget.style.color = "rgba(255,255,255,0.38)";
                e.currentTarget.style.transform = "translateY(0)";
                return;
              }
              e.currentTarget.style.background = "rgba(96,165,250,0.10)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
              e.currentTarget.style.color = "#dbeafe";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, lineHeight: 0 }}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M12 5V19"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M5 12H19"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <span>Ekle</span>
            </span>
          </button>
        </form>
        )}
        </div>

        {view !== "trash" && view !== "stats" && (
            <div
                className="categoryAddRow"
                style={{
                  marginTop: 0,
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                  width: "100%",
                  position: filtersOpen ? "relative" : undefined,
                  zIndex: filtersOpen ? 28 : undefined,
                }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                    type="button"
                    onClick={() => {
                      setCategoryAddOpen((prev) => {
                        const next = !prev;
                        if (!prev) {
                          window.requestAnimationFrame(() => newCategoryInputRef.current?.focus());
                        }
                        return next;
                      });
                    }}
                    title={categoryAddOpen ? "Kategori Alanını Kapat" : "Kategori Ekle"}
                    style={{
                      height: 38,
                      paddingInline: 16,
                      borderRadius: 14,
                      border: categoryAddOpen
                          ? "1px solid rgba(96,165,250,0.22)"
                          : "1px solid rgba(255,255,255,0.12)",
                      background: categoryAddOpen
                          ? "rgba(96,165,250,0.08)"
                          : "rgba(255,255,255,0.04)",
                      color: categoryAddOpen ? "#dbeafe" : "#e5e7eb",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, color 0.18s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = categoryAddOpen
                          ? "rgba(96,165,250,0.10)"
                          : "rgba(255,255,255,0.07)";
                      e.currentTarget.style.transform = "translateY(-1px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = categoryAddOpen
                          ? "rgba(96,165,250,0.08)"
                          : "rgba(255,255,255,0.04)";
                      e.currentTarget.style.transform = "translateY(0)";
                    }}
                >
                  <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true"
                  >
                    <path d="M12 5V19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span>Kategori</span>
                </button>

                {categoryAddOpen && (
                    <>
                      <input
                          ref={newCategoryInputRef}
                          className="input"
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              createCategory();
                            }
                            if (e.key === "Escape") {
                              setCategoryAddOpen(false);
                              setNewCategoryName("");
                            }
                          }}
                          placeholder="Kategori ekle…"
                          style={{ height: 38, maxWidth: 260 }}
                      />

                      <button
                          type="button"
                          onClick={() => {
                            if (!newCategoryName.trim()) return;
                            createCategory();
                          }}
                          disabled={!newCategoryName.trim()}
                          title="Kategori Ekle"
                          style={{
                            height: 38,
                            paddingInline: 16,
                            borderRadius: 14,
                            border: "1px solid rgba(255,255,255,0.12)",
                            background: !newCategoryName.trim()
                                ? "rgba(255,255,255,0.04)"
                                : "rgba(255,255,255,0.05)",
                            color: !newCategoryName.trim()
                                ? "rgba(255,255,255,0.38)"
                                : "#e5e7eb",
                            fontWeight: 600,
                            cursor: !newCategoryName.trim() ? "not-allowed" : "pointer",
                            transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, color 0.18s ease",
                          }}
                          onMouseEnter={(e) => {
                            if (!newCategoryName.trim()) return;
                            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                            e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
                            e.currentTarget.style.color = "#ffffff";
                            e.currentTarget.style.transform = "translateY(-1px)";
                          }}
                          onMouseLeave={(e) => {
                            if (!newCategoryName.trim()) {
                              e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                              e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                              e.currentTarget.style.color = "rgba(255,255,255,0.38)";
                              e.currentTarget.style.transform = "translateY(0)";
                              return;
                            }
                            e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                            e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                            e.currentTarget.style.color = "#e5e7eb";
                            e.currentTarget.style.transform = "translateY(0)";
                          }}
                      >
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, lineHeight: 0 }}>
              <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
              >
                <path
                    d="M4.75 7.75C4.75 6.64543 5.64543 5.75 6.75 5.75H13.6716C14.202 5.75 14.7107 5.96071 15.0858 6.33579L18.1642 9.41421C18.5393 9.78929 18.75 10.298 18.75 10.8284V17.25C18.75 18.3546 17.8546 19.25 16.75 19.25H6.75C5.64543 19.25 4.75 18.3546 4.75 17.25V7.75Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                />
                <path d="M12 10V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M9 13H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span>Ekle</span>
            </span>
                      </button>
                    </>
                )}
              </div>

              <div style={{ marginLeft: "auto", display: "flex", gap: 10, position: "relative", alignItems: "center" }}>
                <button
                    type="button"
                    onClick={() => {
                      setFiltersOpen((p) => {
                        const next = !p;
                        if (next) {
                          setFilterSections({
                            category: false,
                            status: false,
                            priority: false,
                          });
                        }
                        return next;
                      });
                    }}
                    title="Filtreleri Aç / Kapat"
                    style={{
                      background: "transparent",
                      border: "none",
                      borderBottom: filtersOpen ? "2px solid #22c55e" : "2px solid transparent",
                      color: filtersOpen ? "#ffffff" : "#cbd5e1",
                      padding: "10px 14px",
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.18s ease",
                    }}
                >
                  Filtreler
                </button>

                <button
                    type="button"
                    onClick={() => setCalendarOpen((prev) => !prev)}
                    title="Takvimi Aç / Kapat"
                    aria-label="Takvim"
                    style={{
                      background: "transparent",
                      border: "none",
                      borderBottom: calendarOpen ? "2px solid #22c55e" : "2px solid transparent",
                      color: calendarOpen ? "#ffffff" : "#cbd5e1",
                      padding: "10px 14px",
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.18s ease",
                    }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                    <path d="M16 3V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    <path d="M8 3V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    <path d="M3 10H21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                </button>

                {filtersOpen && view === "todos" && (
                    <>
                      <div
                          onClick={() => setFiltersOpen(false)}
                          style={{
                            position: "fixed",
                            inset: 0,
                            backdropFilter: "blur(2px)",
                            WebkitBackdropFilter: "blur(2px)",
                            background: "linear-gradient(rgba(10,14,25,0.35), rgba(10,14,25,0.45))",
                            zIndex: 40,
                          }}
                      />
                      <div
                          style={{
                            position: "fixed",
                            top: 200,
                            right: 72,
                            width: "min(520px, calc(100vw - 80px))",
                            padding: 14,
                            borderRadius: 18,
                            background: "rgba(15, 23, 42, 0.96)",
                            border: "1px solid rgba(255,255,255,0.10)",
                            boxShadow: "0 18px 50px rgba(0,0,0,0.30)",
                            backdropFilter: "blur(12px)",
                            WebkitBackdropFilter: "blur(12px)",
                            zIndex: 80,
                            display: "flex",
                            flexDirection: "column",
                            gap: 10,
                          }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>Filtreler</div>
                          <button
                              type="button"
                              onClick={() => setFiltersOpen(false)}
                              title="Filtreleri kapat"
                              aria-label="Filtreleri kapat"
                              style={{
                                background: "transparent",
                                border: "none",
                                padding: 4,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "#e5e7eb",
                                transition: "transform 0.16s ease, color 0.16s ease"
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = "#f87171";
                                e.currentTarget.style.transform = "scale(1.08)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = "#e5e7eb";
                                e.currentTarget.style.transform = "scale(1)";
                              }}
                          >
                            <svg
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                            >
                              <path d="M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                              <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                          </button>
                        </div>

                        <button
                            type="button"
                            className="btnFilter"
                            onClick={() => toggleFilterSection("category")}
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 600, minHeight: 48 }}
                            title="Kategori filtrelerini Aç / Kapat"
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                              <path d="M20 13L11 22L2 13V4H11L20 13Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                              <circle cx="7" cy="7" r="1.6" fill="currentColor"/>
                            </svg>
                            Kategori
                          </span>
                          <span>{filterSections.category ? "▾" : "▸"}</span>
                        </button>

                        {filterSections.category && categories.length > 0 && (
                            <div className="categoryListRow" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                  type="button"
                                  className={categoryFilter == null ? "categoryBadge active" : "btnFilter"}
                                  onClick={() => setCategoryFilter(null)}
                                  style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                                  title="Tüm kategoriler"
                              >
                                Tümü ({Object.values(categoryCountById).reduce((sum, n) => sum + n, 0)})
                              </button>
                              {categories.map((c) => (
                                  <div
                                      key={c.id}
                                      className={categoryFilter === c.id ? "categoryBadge active" : "btnFilter"}
                                      style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                                      onClick={() => setCategoryFilter((prev) => (prev === c.id ? null : c.id))}
                                      title="Kategoriye göre filtrele"
                                  >
                                    <span>{c.name} <span style={{ opacity: 0.7 }}>({categoryCountById[c.id] || 0})</span></span>
                                    <button
                                        type="button"
                                        className="btnIcon"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          deleteCategory(c.id);
                                        }}
                                        title="Kategoriyi sil"
                                        style={{
                                          width: 26,
                                          height: 26,
                                          borderRadius: 10,
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          padding: 0,
                                          fontSize: "16px",
                                        }}
                                    >
                                      🗑
                                    </button>
                                  </div>
                              ))}
                            </div>
                        )}

                        <button
                            type="button"
                            className="btnFilter"
                            onClick={() => toggleFilterSection("status")}
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 600, minHeight: 48 }}
                            title="Durum filtrelerini Aç / Kapat"
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                              <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8"/>
                              <path d="M8.5 12.5L11 15L16 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            Durum
                          </span>
                          <span>{filterSections.status ? "▾" : "▸"}</span>
                        </button>

                        {filterSections.status && (
                            <div className="filters">
                              <button
                                  type="button"
                                  className={filter === "all" ? "btnFilter active" : "btnFilter"}
                                  onClick={() => { setError(""); setSelectedDueDates([]); setFilter("all"); }}
                              >
                                Tümü ({statusCount.all || 0})
                              </button>
                              <button
                                  type="button"
                                  className={filter === "active" ? "btnFilter active" : "btnFilter"}
                                  onClick={() => { setError(""); setSelectedDueDates([]); setFilter("active"); }}
                              >
                                Aktif ({statusCount.active || 0})
                              </button>
                              <button
                                  type="button"
                                  className={filter === "completed" ? "btnFilter active" : "btnFilter"}
                                  onClick={() => { setError(""); setSelectedDueDates([]); setFilter("completed"); }}
                              >
                                Tamamlandı ({statusCount.completed || 0})
                              </button>
                            </div>
                        )}

                        <button
                            type="button"
                            className="btnFilter"
                            onClick={() => toggleFilterSection("priority")}
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 600, minHeight: 48 }}
                            title="Öncelik filtrelerini Aç / Kapat"
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                              <path d="M13 3L4 14H11L10 21L19 10H12L13 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                            </svg>
                            Öncelik
                          </span>
                          <span>{filterSections.priority ? "▾" : "▸"}</span>
                        </button>

                        {filterSections.priority && (
                            <div className="filters">
                              <button
                                  type="button"
                                  className={priorityFilter === "all" ? "btnFilter active" : "btnFilter"}
                                  onClick={() => { setError(""); setSelectedDueDates([]); setPriorityFilter("all"); }}
                                  title="Öncelik filtresi"
                              >
                                Tümü ({statusCount.all || 0})
                              </button>
                              <button
                                  type="button"
                                  className={priorityFilter === "high" ? "btnFilter active" : "btnFilter"}
                                  onClick={() => { setError(""); setSelectedDueDates([]); setPriorityFilter("high"); }}
                                  title="HIGH"
                              >
                                High ({priorityCountByKey.high || 0})
                              </button>
                              <button
                                  type="button"
                                  className={priorityFilter === "medium" ? "btnFilter active" : "btnFilter"}
                                  onClick={() => { setError(""); setSelectedDueDates([]); setPriorityFilter("medium"); }}
                                  title="MEDIUM"
                              >
                                Medium ({priorityCountByKey.medium || 0})
                              </button>
                              <button
                                  type="button"
                                  className={priorityFilter === "low" ? "btnFilter active" : "btnFilter"}
                                  onClick={() => { setError(""); setSelectedDueDates([]); setPriorityFilter("low"); }}
                                  title="LOW"
                              >
                                Low ({priorityCountByKey.low || 0})
                              </button>
                            </div>
                        )}
                      </div>
                    </>
                )}
              </div>
            </div>
        )}

        {view === "todos" && !filtersOpen && (
            (() => {
              const chips = [];

              if (filter !== "all") {
                chips.push({
                  key: "status",
                  label: filter === "active" ? "Aktif" : "Tamamlandı",
                  clear: () => setFilter("all"),
                });
              }

              if (priorityFilter !== "all") {
                chips.push({
                  key: "priority",
                  label: priorityFilter.charAt(0).toUpperCase() + priorityFilter.slice(1),
                  clear: () => setPriorityFilter("all"),
                });
              }

              if (categoryFilter != null) {
                const cname = categoryNameById.get(Number(categoryFilter));
                if (cname) {
                  chips.push({
                    key: "category",
                    label: cname,
                    clear: () => setCategoryFilter(null),
                  });
                }
              }

              if (selectedDueDates.length > 0) {
                chips.push({
                  key: "date",
                  label: "Gün filtresi",
                  clear: () => setSelectedDueDates([]),
                });
              }

              if (query.trim()) {
                chips.push({
                  key: "query",
                  label: `Arama: ${query.trim()}`,
                  clear: () => setQuery(""),
                });
              }

              if (chips.length === 0) return null;

              return (
                  <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        marginTop: 6,
                        marginBottom: 10,
                      }}
                  >
                    {chips.map((chip) => (
                        <button
                            key={chip.key}
                            type="button"
                            className="btnFilter"
                            onClick={chip.clear}
                            title="Filtreyi kaldır"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              paddingInline: 10,
                              height: 30,
                              fontSize: 13,
                              borderRadius: 999,
                            }}
                        >
                          <span>{chip.label}</span>
                          <span style={{ opacity: 0.6 }}>✕</span>
                        </button>
                    ))}
                  </div>
              );
            })()
        )}

        {view !== "trash" && view !== "stats" && (
          <div
            className="searchRow"
            style={{
              marginBottom: 12,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ position: "relative", width: "100%" }}>
              <input
                className="searchInput"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="🔍 Notlarda ara..."
                style={{ paddingRight: query.trim() ? 36 : undefined }}
              />

              {query.trim() && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  title="Aramayı temizle"
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.04)",
                    color: "#cbd5e1",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    fontSize: 14,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.10)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {query.trim() && (
              <div
                style={{
                  fontSize: 13,
                  opacity: 0.7,
                  paddingLeft: 2,
                }}
              >
                {listTodos.length} sonuç bulundu
              </div>
            )}
          </div>
        )}


        {view !== "trash" && view !== "stats" && calendarOpen && (
          <div className="calendar" style={{ marginBottom: 15 }}>
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

            {selectedDueDates.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[...selectedDueDates].sort().map((date) => (
                  <button
                    key={date}
                    type="button"
                    className="btnFilter"
                    onClick={() =>
                      setSelectedDueDates((cur) => cur.filter((d) => d !== date))
                    }
                    title="Bu gün filtresini kaldır"
                  >
                    Gün filtresi: {date} ✕
                  </button>
                ))}
              </div>
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
              // const hasManyTasks = count > 1;
              const isToday = c.key === todayStr;
              const isSelected = selectedDueDates.includes(c.key);
              const isPastDueDay = count > 0 && c.key < todayStr;

              return (
                <button
                  key={c.key + (c.inMonth ? "m" : "o")}
                  type="button"
                  className={
                    "day" +
                    (c.inMonth ? "" : " other") +
                    (count ? " has" : "") +
                    (isToday ? " today" : "") +
                    (isSelected ? " selected" : "") +
                    (isPastDueDay ? " overdue" : "")
                  }
                  style={
                    isToday
                      ? {
                          border: "1.5px solid rgba(34,197,94,0.7)",
                          boxShadow: "0 0 0 2px rgba(34,197,94,0.10)",
                        }
                      : isPastDueDay
                        ? {
                            border: "1.5px solid rgba(239,68,68,0.42)",
                            boxShadow: "0 0 0 2px rgba(239,68,68,0.10), 0 8px 18px rgba(239,68,68,0.10)",
                          }
                        : undefined
                  }
                  onClick={() => {
                    if (!count) return;

                    setSelectedDueDates((cur) =>
                      cur.includes(c.key)
                        ? cur.filter((d) => d !== c.key)
                        : [...cur, c.key]
                    );
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
        )}

        {error && <div className="error">{error}</div>}

        {view === "stats" ? (
          <div style={{ marginTop: 24, marginBottom: 24 }}>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M4 20V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M10 20V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M16 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M22 20V7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span>Görev İstatistikleri</span>
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(320px, 1fr))",
                gap: 20,
                marginTop: 16,
                alignItems: "stretch",
              }}
            >
              <section
                style={{
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 18,
                  padding: 18,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
                  maxHeight: 520,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <h3 style={{ margin: 0, marginBottom: 14 }}>Genel</h3>
                <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
                  <svg
                    width="160"
                    height="160"
                    viewBox="0 0 160 160"
                    style={{ flex: "0 0 auto" }}
                  >
                    <circle
                      cx="80"
                      cy="80"
                      r="70"
                      stroke="rgba(255,255,255,0.10)"
                      strokeWidth="18"
                      fill="none"
                    />

                    {(() => {
                      const total = Math.max(statsOverview.total || 0, 1);
                      let cumulative = 0;

                      return generalChartData
                        .filter((item) => item.value > 0)
                        .map((item, idx) => {
                          const percent = (item.value / total) * 100;
                          const dashOffset = 25 - cumulative;
                          cumulative += percent;

                          return (
                            <circle
                              key={item.label}
                              cx="80"
                              cy="80"
                              r="70"
                              fill="none"
                              stroke={item.color}
                              strokeWidth="18"
                              strokeLinecap="round"
                              pathLength="100"
                              strokeDasharray={`0 100`}
                              strokeDashoffset={dashOffset}
                              transform="rotate(-90 80 80)"
                            >
                              <animate
                                attributeName="stroke-dasharray"
                                from="0 100"
                                to={`${percent} ${100 - percent}`}
                                dur="0.9s"
                                begin={`${idx * 0.16}s`}
                                fill="freeze"
                                calcMode="spline"
                                keySplines="0.22 1 0.36 1"
                              />
                            </circle>
                          );
                        });
                    })()}

                    <foreignObject x="0" y="0" width="160" height="160">
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          textAlign: "center",
                          color: "white",
                          fontFamily: "inherit",
                        }}
                      >
                        <div style={{ fontSize: 12, opacity: 0.72 }}>Toplam</div>
                        <div style={{ fontSize: 28, fontWeight: 700 }}>{statsOverview.total}</div>
                      </div>
                    </foreignObject>
                  </svg>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 180, flex: 1 }}>
                    {generalChartData.map((item) => (
                      <div
                        key={item.label}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              background: item.color,
                              display: "inline-block",
                            }}
                          />
                          <span>{item.label}</span>
                        </div>
                        <b>{item.value}</b>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section
                style={{
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 18,
                  padding: 18,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
                  maxHeight: 260,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <h3 style={{ margin: 0, marginBottom: 14 }}>Kategoriye Göre</h3>
                {statsByCategory.length === 0 ? (
                  <div className="hint">Henüz kategori eklenmedi.</div>
                ) : (
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: 0,
                      overflowY: "auto",
                      paddingRight: 6,
                      flex: 1,
                    }}
                  >
                    {statsByCategory.map((cat) => (
                      <li key={cat.id} style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                          <span style={{ fontWeight: 600 }}>{cat.name}</span>
                          <span style={{ opacity: 0.86 }}>{cat.total}</span>
                        </div>
                        <div style={{ fontSize: 13, opacity: 0.78, marginBottom: 6 }}>
                          Aktif: {cat.active} • Tamamlanan: {cat.completed}
                        </div>
                        <div style={{ background: "rgba(255,255,255,0.10)", height: 8, borderRadius: 999, width: "100%" }}>
                          <div
                            style={{
                              background: "#1b8cfc",
                              height: 8,
                              borderRadius: 999,
                              width: `${(cat.total / maxCategoryTotal) * 100}%`,
                              transition: "width 1.15s ease",
                              animation: "statsBarIn 1.15s ease both",
                              transformOrigin: "left center",
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section
                style={{
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 18,
                  padding: 18,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
                }}
              >
                <h3 style={{ margin: 0, marginBottom: 14 }}>Önceliğe Göre</h3>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {statsByPriority.map((p) => (
                    <li key={p.key} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                        <span style={{ fontWeight: 600 }}>{p.label}</span>
                        <span>{p.total}</span>
                      </div>
                      <div style={{ background: "rgba(255,255,255,0.10)", height: 8, borderRadius: 999, width: "100%" }}>
                        <div
                          style={{
                            background:
                              p.key === "HIGH"
                                ? "#ef4444"
                                : p.key === "MEDIUM"
                                  ? "#fbbf24"
                                  : "#22c55e",
                            height: 8,
                            borderRadius: 999,
                            width: `${(p.total / maxPriorityTotal) * 100}%`,
                            transition: "width 1.15s ease",
                            animation: "statsBarIn 1.15s ease both",
                            transformOrigin: "left center",
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section
                style={{
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 18,
                  padding: 18,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
                }}
              >
                <h3 style={{ margin: 0, marginBottom: 14 }}>Son Tarihe Göre</h3>
                <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
                  <svg
                    width="160"
                    height="160"
                    viewBox="0 0 160 160"
                    style={{ flex: "0 0 auto" }}
                  >
                    <circle
                      cx="80"
                      cy="80"
                      r="70"
                      stroke="rgba(255,255,255,0.10)"
                      strokeWidth="18"
                      fill="none"
                    />

                    {(() => {
                      const totalAll = Math.max(
                          statsByDue.today + statsByDue.future + statsByDue.overdue + statsByDue.none,
                          1
                      );

                      const datedTotal = Math.max(
                          statsByDue.today + statsByDue.future + statsByDue.overdue,
                          1
                      );

                      const noneItem = dueChartData.find(
                          (item) => item.label === "Tarih Belirlenmemiş" && item.value > 0
                      );

                      const datedItems = dueChartData.filter(
                          (item) => item.label !== "Tarih Belirlenmemiş" && item.value > 0
                      );

                      let cumulativeAll = 0;
                      const allSegments = dueChartData
                          .filter((item) => item.value > 0)
                          .map((item) => {
                            const percent = (item.value / totalAll) * 100;
                            const dashOffset = 25 - cumulativeAll;
                            cumulativeAll += percent;
                            return { ...item, percent, dashOffset };
                          });

                      let cumulativeDated = 0;
                      const animatedDatedSegments = datedItems.map((item, idx) => {
                        const percent = (item.value / datedTotal) * 100;
                        const dashOffset = 25 - cumulativeDated;
                        cumulativeDated += percent;
                        return { ...item, idx, percent, dashOffset };
                      });

                      const noneSegment = noneItem
                          ? allSegments.find((item) => item.label === "Tarih Belirlenmemiş")
                          : null;

                      return [
                        noneSegment ? (
                            <circle
                                key="none-segment"
                                cx="80"
                                cy="80"
                                r="70"
                                fill="none"
                                stroke={noneSegment.color}
                                strokeWidth="18"
                                strokeLinecap="butt"
                                pathLength="100"
                                strokeDasharray={`${noneSegment.percent} ${100 - noneSegment.percent}`}
                                strokeDashoffset={noneSegment.dashOffset}
                                transform="rotate(-90 80 80)"
                            />
                        ) : null,

                        ...animatedDatedSegments.map((item) => (
                            <circle
                                key={item.label}
                                cx="80"
                                cy="80"
                                r="70"
                                fill="none"
                                stroke={item.color}
                                strokeWidth="18"
                                strokeLinecap="round"
                                pathLength="100"
                                strokeDasharray={`0 100`}
                                strokeDashoffset={item.dashOffset}
                                transform="rotate(-90 80 80)"
                            >
                              <animate
                                  attributeName="stroke-dasharray"
                                  from="0 100"
                                  to={`${item.percent} ${100 - item.percent}`}
                                  dur="1s"
                                  begin={`${item.idx * 0.12}s`}
                                  fill="freeze"
                                  calcMode="spline"
                                  keySplines="0.22 1 0.36 1"
                              />
                            </circle>
                        )),
                      ];
                    })()}

                    <foreignObject x="0" y="0" width="160" height="160">
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          textAlign: "center",
                          color: "white",
                          fontFamily: "inherit",
                        }}
                      >
                        <div style={{ fontSize: 12, opacity: 0.72 }}>Tarih Belirlenmiş</div>
                        <div style={{ fontSize: 28, fontWeight: 700 }}>
                          {statsByDue.today + statsByDue.future + statsByDue.overdue}
                        </div>
                      </div>
                    </foreignObject>
                  </svg>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 190, flex: 1 }}>
                    {dueChartData.map((item) => (
                      <div
                        key={item.label}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              background: item.color,
                              display: "inline-block",
                            }}
                          />
                          <span>{item.label}</span>
                        </div>
                        <b>{item.value}</b>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : (
        <div className={"list" + (listTransitioning ? " isSwitching" : "")}>
          {((view === "trash" && trashTodos.length === 0) || (view !== "trash" && listTodos.length === 0)) && !loading ? (
            <div className="hint">
              {view === "trash"
                ? "Çöp Kutusu Boş."
                : selectedDueDates.length
                  ? "Seçili günlere atanmış görev yok."
                  : query.trim()
                  ? " Bu aramaya uygun görev bulunamadı... \n" +
                          "Başka bir şey aramayı deneyin."
                  : categoryFilter
                  ? ` ${categoryNameById.get(Number(categoryFilter)) || "Bu"} kategorisinde görev yok.\nİlk görevi eklemek için yukarıdaki formu kullan.`
                  : filter === "all"
                  ? "Henüz görev yok. İlk görevini ekle. ☝️"
                  : "Bu filtrelemeye uygun görev yok."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {!loading && view !== "stats" && groupedListTodos.length === 0 && (
                  (() => {
                    const hasActiveFilters =
                        !!query.trim() ||
                        selectedDueDates.length > 0 ||
                        categoryFilter != null ||
                        priorityFilter !== "all" ||
                        filter !== "all";

                    const selectedCategory =
                        categoryFilter != null
                            ? categories.find((c) => String(c.id) === String(categoryFilter))
                            : null;

                    if (view === "trash") {
                      return renderEmptyState({
                        accent: "#94a3b8",
                        icon: (
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M4 7H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                              <path d="M9 7V5C9 4.44772 9.44772 4 10 4H14C14.5523 4 15 4.44772 15 5V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                              <path d="M6 7L7 19C7.05236 19.5523 7.44772 20 8 20H16C16.5523 20 16.9476 19.5523 17 19L18 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        ),
                        title: "Çöp kutusu boş",
                        description: "Silinen görevler burada görünür. Bir görevi sildiğinde geri yüklemek için bu alandan ulaşabilirsin.",
                      });
                    }

                    if (selectedCategory) {
                      return renderEmptyState({
                        accent: "#60a5fa",
                        icon: (
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M20 13L11 22L2 13V4H11L20 13Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                              <circle cx="7" cy="7" r="1.6" fill="currentColor" />
                            </svg>
                        ),
                        title: `${selectedCategory.name} kategorisinde görev yok`,
                        description: "İlk görevi eklemek için yukarıdaki formu kullan ya da filtreleri temizleyerek diğer görevleri görüntüle.",
                      });
                    }

                    if (hasActiveFilters) {
                      return renderEmptyState({
                        accent: "#f59e0b",
                        icon: (
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M4 5H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                              <path d="M7 12H17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                              <path d="M10 19H14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                        ),
                        title: "Bu filtrede görev bulunamadı",
                        description: "Arama veya filtre kriterlerini değiştirerek tekrar deneyebilirsin. Görevler farklı bir kategori ya da öncelikte olabilir.",
                      });
                    }

                    return renderEmptyState({
                      accent: "#22c55e",
                      icon: (
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 5V19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            <path d="M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                      ),
                      title: "Henüz görev yok",
                      description: "İlk görevini ekleyerek başlayabilirsin. Tarih, öncelik ve kategori belirleyerek düzenli bir liste oluştur.",
                    });
                  })()
              )}
              {groupedListTodos.length > 0 && groupedListTodos.map((group) => (
                <div key={group.key}>
              {group.title ? (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 10,
                      paddingInline: 4,
                      flexWrap: "wrap",
                    }}
                  >
                    {group.collapsible ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        {(group.key.startsWith("cat-") || group.key === "pinned") && (
                          <div
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: "50%",
                              background: getCategoryAccent(group.key),
                              position: "relative",
                              cursor: "pointer",
                              flex: "0 0 auto",
                            }}
                            onClick={(e) => e.stopPropagation()}
                            title="Kategori rengini seç"
                          >
                            <input
                              type="color"
                              value={getCategoryAccent(group.key)}
                              onChange={(e) => {
                                const color = e.target.value;
                                setCategoryAccentByKey((prev) => ({ ...prev, [group.key]: color }));
                              }}
                              style={{
                                position: "absolute",
                                inset: 0,
                                opacity: 0,
                                cursor: "pointer",
                                width: "100%",
                                height: "100%",
                                border: "none",
                                padding: 0,
                              }}
                            />
                          </div>
                        )}
                        <button
                          type="button"
                          className="btnFilter"
                          onClick={() => toggleCategoryCollapse(group.key)}
                          title="Kategori grubunu Aç / Kapat"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            fontWeight: 700,
                            paddingInline: 12,
                            transition: "transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              opacity: 0.78,
                              transform: collapsedCategoryIds.includes(group.key) ? "rotate(0deg)" : "rotate(90deg)",
                              transition: "transform 0.18s ease",
                              display: "inline-block",
                              width: 10,
                            }}
                          >
                            ▸
                          </span>
                          <span>{group.title}</span>
                          <span style={{ opacity: 0.72 }}>({group.items.length})</span>
                        </button>
                      </div>
                    ) : (
                      <div style={{ fontWeight: 700, fontSize: 16, opacity: 0.96 }}>{group.title}</div>
                    )}
                    <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.10)" }} />
                  </div>
                </>
              ) : null}

              <div
                style={{
                  display: "grid",
                  gridTemplateRows: !group.collapsible || !collapsedCategoryIds.includes(group.key) ? "1fr" : "0fr",
                  transition: "grid-template-rows 0.22s ease, opacity 0.22s ease",
                  opacity: !group.collapsible || !collapsedCategoryIds.includes(group.key) ? 1 : 0.72,
                }}
              >
                <div style={{ overflow: "hidden" }}>
                  {!group.collapsible || !collapsedCategoryIds.includes(group.key) ? (
                    <ul className="ul">
                    {group.items.map((t) => (
  <li
    key={t.id}
    className={
        "li" +
        ((view === "trash" ? selectedTrashIds.includes(t.id) : selectedTodoIds.includes(t.id)) ? " selected" : "") +
        (draggingId === t.id ? " dragging" : "") +
        (dragOverId === t.id ? " dragOver" : "")
    }
    style={(() => {
      const isSelectedCard = view === "trash"
        ? selectedTrashIds.includes(t.id)
        : selectedTodoIds.includes(t.id);

      if (draggingId === t.id) {
        return {
          transform: "scale(1.02)",
          boxShadow: "0 12px 28px rgba(0,0,0,0.28)",
          opacity: 0.72,
          zIndex: 10,
        };
      }

      if (dragOverId === t.id) {
        return undefined;
      }

      if (recentlyAddedId === t.id) {
        return {
          boxShadow: "0 0 0 2px rgba(34,197,94,0.35)",
          background: "rgba(34,197,94,0.06)",
        };
      }

      if (isSelectedCard) {
        return {
          boxShadow: "0 0 0 1px rgba(96,165,250,0.22), 0 0 0 4px rgba(96,165,250,0.08)",
          background: "linear-gradient(180deg, rgba(96,165,250,0.05), rgba(96,165,250,0.02))",
          position: "relative",
        };
      }

      return undefined;
    })()}
    draggable={view !== "trash"}
    onDragStart={() => {
      if (view === "trash") return;
      setDraggingId(t.id);
      setDragOverId(null);
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
    <div className="left" style={{ position: "relative" }}>
      {((view === "trash" ? selectedTrashIds.includes(t.id) : selectedTodoIds.includes(t.id))) && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: -12,
            top: 6,
            bottom: 6,
            width: 3,
            borderRadius: 999,
            background: "linear-gradient(180deg, rgba(96,165,250,0.95), rgba(59,130,246,0.65))",
            boxShadow: "0 0 0 1px rgba(96,165,250,0.08), 0 0 12px rgba(59,130,246,0.18)",
          }}
        />
      )}
      <button
        type="button"
        className={
          ((view === "trash" ? selectedTrashIds.includes(t.id) : selectedTodoIds.includes(t.id)) ? "btnFilter active" : "btnFilter") +
          " selectTodoBtn" +
          ((view === "trash" ? selectedTrashIds.includes(t.id) : selectedTodoIds.includes(t.id)) ? " isSelected" : "")
        }
        style={{ width: 28, height: 28, padding: 0, fontSize: 14, borderRadius: 10 }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (view === "trash") {
            toggleSelectedTrash(t.id);
          } else {
            toggleSelectedTodo(t.id);
          }
        }}
        title={
          view === "trash"
            ? (selectedTrashIds.includes(t.id) ? "Seçimi kaldır" : "Görevi seç")
            : (selectedTodoIds.includes(t.id) ? "Seçimi kaldır" : "Görevi seç")
        }
      >
        {(view === "trash" ? selectedTrashIds.includes(t.id) : selectedTodoIds.includes(t.id)) ? (
            <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
            >
              <rect x="5" y="7" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
              <path
                  d="M10 11.5L12 13.5L15.5 10"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
              />
              <path
                  d="M9 5H17C18.1046 5 19 5.89543 19 7V15"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
              />
            </svg>
        ) : (
            <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
            >
              <rect x="5" y="7" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
              <path
                  d="M9 5H17C18.1046 5 19 5.89543 19 7V15"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
              />
            </svg>
        )}
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
        <div className="todoMain" style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            className={t.completed ? "todoText done" : "todoText"}
            onDoubleClick={() => {
              if (view === "trash") return;
              setEditingId(t.id);
              setEditingTitle(t.title);
              setEditingDueDate(t.dueDate || "");
            }}
            title={view === "trash" ? "Çöp kutusunda düzenleme kapalı" : "Düzenlemek için çift tıkla"}
            style={{ minWidth: 0 }}
          >
            {renderHighlightedText(t.title, query)}
          </span>

          {plainTextFromHtml(t.description).trim() !== "" && (
            <>
              <div
                className={"todoDesc" + (expandedDescId === t.id ? " expanded" : "")}
                style={{
                  wordBreak: "break-word",
                  opacity: 0.78,
                  minWidth: 0,
                  whiteSpace: "pre-wrap",
                }}
              >
                {renderHighlightedText(plainTextFromHtml(t.description || ""), query)}
              </div>

              {(() => {
                const desc = plainTextFromHtml(t.description || "");
                const showToggle = desc.length > 80;

                if (!showToggle) return null;

                return (
                  <button
                    type="button"
                    draggable={false}
                    className="descToggle"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setExpandedDescId((cur) => (cur === t.id ? null : t.id));
                    }}
                    title={expandedDescId === t.id ? "Daha az göster" : "Devamını gör"}
                    style={{
                      marginTop: 6,
                      height: 26,
                      paddingInline: 12,
                      borderRadius: 11,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.03)",
                      color: "#cbd5f5",
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      transition: "all 0.18s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.07)";
                      e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
                      e.currentTarget.style.transform = "translateY(-1px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                      e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)";
                      e.currentTarget.style.transform = "translateY(0)";
                    }}
                  >
                    {expandedDescId === t.id ? (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                          <path
                            d="M6 15L12 9L18 15"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span>Daha az göster</span>
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                          <path
                            d="M6 9L12 15L18 9"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span>Devamını gör</span>
                      </>
                    )}
                  </button>
                );
              })()}
            </>
          )}
          {view !== "trash" && descOpenId === t.id && (
            <div className="descEditor">
              <div className="descRichEditor">
  <textarea
      className="descTextarea"
      value={typeof descDraft === "string" ? descDraft : ""}
      onChange={(e) => setDescDraft(e.target.value)}
      placeholder="Açıklama yaz…"
      rows={5}
  />
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  className="select"
                  value={descCategoryId}
                  onChange={(e) => setDescCategoryId(e.target.value)}
                  style={{
                    height: 38,
                    minWidth: 172,
                    padding: "0 38px 0 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    backgroundColor: "rgba(255,255,255,0.04)",
                    color: "#ffffff",
                    fontWeight: 600,
                    outline: "none",
                    appearance: "none",
                    WebkitAppearance: "none",
                    MozAppearance: "none",
                    backgroundImage:
                        "linear-gradient(45deg, transparent 50%, #cbd5e1 50%), linear-gradient(135deg, #cbd5e1 50%, transparent 50%)",
                    backgroundPosition:
                        "calc(100% - 18px) calc(50% - 3px), calc(100% - 10px) calc(50% - 3px)",
                    backgroundSize: "8px 8px, 8px 8px",
                    backgroundRepeat: "no-repeat",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
                    transition: "border-color 0.18s ease, background 0.18s ease",
                    maxWidth: 220
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "rgba(96,165,250,0.45)";
                    e.currentTarget.style.backgroundColor = "rgba(96,165,250,0.08)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
                  }}
                  title="Kategori"
                >
                  <option value="none">Yok</option>
                  {categories.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <select
                  className="select"
                  value={descPriority}
                  onChange={(e) => setDescPriority(e.target.value)}
                  style={{
                    height: 38,
                    minWidth: 154,
                    padding: "0 38px 0 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    backgroundColor: "rgba(255,255,255,0.04)",
                    color: "#ffffff",
                    fontWeight: 600,
                    outline: "none",
                    appearance: "none",
                    WebkitAppearance: "none",
                    MozAppearance: "none",
                    backgroundImage:
                        "linear-gradient(45deg, transparent 50%, #cbd5e1 50%), linear-gradient(135deg, #cbd5e1 50%, transparent 50%)",
                    backgroundPosition:
                        "calc(100% - 18px) calc(50% - 3px), calc(100% - 10px) calc(50% - 3px)",
                    backgroundSize: "8px 8px, 8px 8px",
                    backgroundRepeat: "no-repeat",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
                    transition: "border-color 0.18s ease, background 0.18s ease",
                    maxWidth: 180
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "rgba(251,191,36,0.45)";
                    e.currentTarget.style.backgroundColor = "rgba(251,191,36,0.08)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
                  }}
                  title="Öncelik"
                >
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                </select>
              </div>
              <div className="descEditorActions">
                <button
                    type="button"
                    draggable={false}
                    className="btnPrimarySmall"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      await updateTodoDescription(t.id, descDraft, descCategoryId, descPriority);
                      setDescOpenId(null);
                      setDescCategoryId("none");
                      setDescPriority("MEDIUM");
                    }}
                >
                  Kaydet
                </button>
                <button
                    type="button"
                    draggable={false}
                    className="btnGhostSmall"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDescOpenId(null);
                      setDescCategoryId("none");
                      setDescPriority("MEDIUM");
                    }}
                >
                  İptal
                </button>
              </div>
            </div>
          )}

          <div className="todoMetaRow" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {t.priority && (
              <span className={"priorityBadge p-" + String(t.priority).toLowerCase()} title="Öncelik">
                {t.priority}
              </span>
            )}
            {(() => {
              const cid = t.categoryId ?? t.category?.id ?? null;
              const cname = t.categoryName ?? (cid != null ? categoryNameById.get(Number(cid)) : null);
              return cname ? (
                <span className="categoryBadge" title="Kategori">
                  {cname}
                </span>
              ) : null;
            })()}
            {t.dueDate ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  opacity: 0.9,
                }}
                title="Son tarih"
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "#60a5fa",
                    display: "inline-block",
                    flex: "0 0 auto",
                  }}
                />
                <span>{t.dueDate}</span>
              </span>
            ) : null}

            {t.dueDate && t.dueDate < localYmd(new Date()) && !t.completed ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  color: "#f87171",
                  fontWeight: 600,
                }}
                title="Geciken görev"
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "#ef4444",
                    display: "inline-block",
                    flex: "0 0 auto",
                  }}
                />
                <span>Süresi Doldu</span>
              </span>
            ) : null}

            {t.dueDate && t.dueDate === localYmd(new Date()) && !t.completed ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  color: "#fbbf24",
                  fontWeight: 600,
                }}
                title="Bugün son gün"
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "#fbbf24",
                    display: "inline-block",
                    flex: "0 0 auto",
                  }}
                />
                <span>Bugün Son Gün</span>
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>

    {view === "trash" ? (
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => restoreTodo(t.id)}
          title="Geri Yükle"
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.02)",
            color: "#cbd5e1",
            transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, color 0.18s ease",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(96,165,250,0.08)";
            e.currentTarget.style.borderColor = "rgba(96,165,250,0.24)";
            e.currentTarget.style.color = "#bfdbfe";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.02)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
            e.currentTarget.style.color = "#cbd5e1";
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M8 7L4 12L8 17"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M5 12H14.5C17.5376 12 20 9.53757 20 6.5V6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    ) : (
      <div className="todoActions">
        <button
            type="button"
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleTodo(t.id);
            }}
            title={t.completed ? "Aktif yap" : "Tamamlandı olarak işaretle"}
            aria-label={t.completed ? "Aktif yap" : "Tamamlandı olarak işaretle"}
            style={{
              width: 42,
              height: 42,
              borderRadius: 14,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              border: t.completed
                  ? "1px solid rgba(34,197,94,0.28)"
                  : "1px solid rgba(255,255,255,0.12)",
              background: t.completed
                  ? "rgba(34,197,94,0.12)"
                  : "rgba(255,255,255,0.02)",
              color: t.completed ? "#86efac" : "#e5e7eb",
              transition:
                  "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, color 0.18s ease",
              cursor: "pointer",
              flex: "0 0 auto",
            }}
            onMouseEnter={(e) => {
              if (t.completed) {
                e.currentTarget.style.background = "rgba(34,197,94,0.16)";
                e.currentTarget.style.borderColor = "rgba(34,197,94,0.38)";
              } else {
                e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
              }
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = t.completed
                  ? "rgba(34,197,94,0.12)"
                  : "rgba(255,255,255,0.02)";
              e.currentTarget.style.borderColor = t.completed
                  ? "rgba(34,197,94,0.28)"
                  : "rgba(255,255,255,0.12)";
              e.currentTarget.style.color = t.completed ? "#86efac" : "#e5e7eb";
              e.currentTarget.style.transform = "translateY(0)";
            }}
        >
          {t.completed ? (
              <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
              >
                <path
                    d="M6 12.5L10 16.5L18 7.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
              </svg>
          ) : (
              <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
              >
                <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.8" />
              </svg>
          )}
        </button>
        <button
          type="button"
          draggable={false}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePinTodo(t.id);
          }}
          title={t.pinned ? "Sabitlemeyi kaldır" : "Sabitle"}
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            border: t.pinned ? "1px solid rgba(34,197,94,0.28)" : "1px solid rgba(255,255,255,0.12)",
            background: t.pinned ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.02)",
            color: t.pinned ? "#86efac" : "#cbd5e1",
            transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, color 0.18s ease",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            if (t.pinned) {
              e.currentTarget.style.background = "rgba(34,197,94,0.16)";
              e.currentTarget.style.borderColor = "rgba(34,197,94,0.38)";
              e.currentTarget.style.transform = "translateY(-1px)";
            } else {
              e.currentTarget.style.background = "rgba(34,197,94,0.08)";
              e.currentTarget.style.borderColor = "rgba(34,197,94,0.24)";
              e.currentTarget.style.color = "#bbf7d0";
              e.currentTarget.style.transform = "translateY(-1px)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = t.pinned ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.02)";
            e.currentTarget.style.borderColor = t.pinned ? "rgba(34,197,94,0.28)" : "rgba(255,255,255,0.12)";
            e.currentTarget.style.color = t.pinned ? "#86efac" : "#cbd5e1";
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M8 3.75H16C17.2426 3.75 18.25 4.75736 18.25 6V20.25L12 15.75L5.75 20.25V6C5.75 4.75736 6.75736 3.75 8 3.75Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          draggable={false}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const willOpen = descOpenId !== t.id;
            setDescOpenId(willOpen ? t.id : null);
            setDescDraft(willOpen ? (t.description || "") : "");
            setDescCategoryId(willOpen
              ? (
                  (typeof t.categoryId !== "undefined" && t.categoryId !== null)
                    ? String(t.categoryId)
                    : (
                        t.category && typeof t.category.id !== "undefined"
                          ? String(t.category.id)
                          : "none"
                      )
                )
              : "none"
            );
            setDescPriority(willOpen ? (t.priority || "MEDIUM") : "MEDIUM");
          }}
          title="Açıklama yaz"
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.02)",
            color: "#cbd5e1",
            transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease, color 0.18s ease",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(251,191,36,0.08)";
            e.currentTarget.style.borderColor = "rgba(251,191,36,0.24)";
            e.currentTarget.style.color = "#fde68a";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.02)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
            e.currentTarget.style.color = "#cbd5e1";
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M4.75 19.25L8.8 18.35L17.9 9.25C18.681 8.469 18.681 7.203 17.9 6.422L17.578 6.1C16.797 5.319 15.531 5.319 14.75 6.1L5.65 15.2L4.75 19.25Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path
              d="M13.5 7.35L16.65 10.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    )}
  </li>
                    ))}
                    </ul>
                  ) : (
                    <div className="hint" style={{ marginTop: 2, marginLeft: 6, paddingBottom: 4 }}>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
  // --- Highlight helpers ---
  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function renderHighlightedText(text, search) {
    const source = String(text ?? "");
    const needle = String(search ?? "").trim();

    if (!needle) return source;

    const parts = source.split(new RegExp(`(${escapeRegExp(needle)})`, "gi"));

    return parts.map((part, idx) =>
      part.toLowerCase() === needle.toLowerCase() ? (
        <span
          key={idx}
          style={{
            background: "rgba(251,191,36,0.22)",
            color: "#fde68a",
            borderRadius: 6,
            padding: "0 2px",
            boxShadow: "inset 0 0 0 1px rgba(251,191,36,0.14)",
          }}
        >
          {part}
        </span>
      ) : part
    );
  }
}
