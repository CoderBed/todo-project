import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import logo from "./assets/logo.png";

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
  const [categoryAccentByKey, setCategoryAccentByKey] = useState({});

  const [newPriority, setNewPriority] = useState("MEDIUM"); // LOW | MEDIUM | HIGH
  const newTodoInputRef = useRef(null);
  const newCategoryInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [listTransitioning, setListTransitioning] = useState(false);
  const lastReorderToastAtRef = useRef(0);

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
        // If login credentials are wrong
        if (authMode === "login" && res.status === 401) {
          throw new Error("Hatalı email veya şifre girdiniz.");
        }

        // register on existing user may return 409 or other validation errors
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
      groups.push({ key: "pinned", title: "📌 ", items: pinned, collapsible: true });
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
    { label: "Süresi dolmuş", value: statsOverview.overdue, color: "#ef4444" },
    { label: "Sabitlenen", value: statsOverview.pinned, color: "#f59e0b" },
  ];

  const dueChartData = [
    { label: "Bugün", value: statsByDue.today, color: "#facc15" },
    { label: "Gelecek", value: statsByDue.future, color: "#22c55e" },
    { label: "Süresi dolmuş", value: statsByDue.overdue, color: "#ef4444" },
    { label: "Tarih belirlenmemiş", value: statsByDue.noDate, color: "#94a3b8" },
  ];

  function donutSegments(items) {
    const total = items.reduce((sum, item) => sum + item.value, 0);
    if (!total) return [];

    let acc = 0;
    return items.map((item) => {
      const start = (acc / total) * 100;
      acc += item.value;
      const end = (acc / total) * 100;
      return { ...item, start, end };
    });
  }

  function donutBackground(items) {
    const segments = donutSegments(items);
    if (!segments.length) {
      return "conic-gradient(rgba(255,255,255,0.08) 0 100%)";
    }

    return `conic-gradient(${segments
        .map((item) => `${item.color} ${item.start}% ${item.end}%`)
        .join(", ")})`;
  }

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
      showToast("Durum güncellendi. ✅");
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

          <div className="filters">
            <button
              type="button"
              className={authMode === "login" ? "btnFilter active" : "btnFilter"}
              onClick={() => {
                setAuthMode("login");
                setAuthEmail("");
                setAuthPassword("");
                setError("");
              }}
            >
              Login
            </button>
            <button
              type="button"
              className={authMode === "register" ? "btnFilter active" : "btnFilter"}
              onClick={() => {
                setAuthMode("register");
                setAuthEmail("");
                setAuthPassword("");
                setError("");
              }}
            >
              Register
            </button>
          </div>

          {authMode === "register" && (
            <div style={{ marginTop: 10, display: "flex", gap: 16, flexWrap: "wrap" }}>
              {authEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail) && (
                <div className="hint">Geçerli bir email adresi giriniz.</div>
              )}
              {authPassword && authPassword.length < 6 && (
                <div className="hint">Şifre en az 6 karakter olmalı.</div>
              )}
            </div>
          )}

          <form onSubmit={submitAuth} className="addForm" style={{ marginTop: 0 }}>
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
                className={view === "todos" ? "btnFilter active" : "btnFilter"}
                onClick={() => switchMainView("todos")}
                title="Aktif görevler"
            >
              Tüm Görevler
            </button>
            <button
                type="button"
                className={view === "trash" ? "btnFilter active" : "btnFilter"}
                onClick={() => switchMainView(view === "trash" ? "todos" : "trash")}
                title="Çöp kutusu"
            >
              Çöp Kutusu
            </button>
            <button
                type="button"
                className={view === "stats" ? "btnFilter active" : "btnFilter"}
                onClick={() => switchMainView("stats")}
                title="İstatistikler"
            >
              İstatistikler
            </button>
          </div>

          <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btnFilter"
              onClick={logout}
              title="Çıkış"
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
          <div className="filters" style={{ marginTop: 10, marginBottom: 10 }}>
            <span className="pill">
              Seçili görev: <b>{selectedTodoIds.length}</b>
            </span>
            <button
              type="button"
              className="btnFilter"
              onClick={clearSelectedTodos}
              title="Seçimi temizle"
            >
              Seçimi Temizle
            </button>
            <button
              type="button"
              className="btnDanger"
              onClick={bulkDeleteSelectedTodos}
              title="Seçili görevleri sil"
            >
              {selectedTodoIds.length === 1 ? "Sil" : "Toplu Sil"}
            </button>
          </div>
        )}
        {view === "trash" && trashTodos.length > 0 && (
          <div className="filters" style={{ marginTop: 10, marginBottom: 10 }}>
            <span className="pill">
              Çöp kutusunda toplam: <b>{trashTodos.length}</b>
            </span>
            <button
              type="button"
              className="btnDanger"
              onClick={emptyTrash}
              title="Çöp kutusunu tamamen boşalt"
            >
              Çöp Kutusunu Boşalt
            </button>
          </div>
        )}
{view === "trash" && selectedTrashIds.length > 0 && (
  <div className="filters" style={{ marginTop: 12, marginBottom: 10 }}>
            <span className="pill">
              Seçili görev: <b>{selectedTrashIds.length}</b>
            </span>
            <button
              type="button"
              className="btnFilter"
              onClick={clearSelectedTrash}
              title="Seçimi temizle"
            >
              Seçimi Temizle
            </button>
            <button
              type="button"
              className="btnDanger"
              onClick={bulkHardDeleteSelectedTrash}
              title="Seçili görevleri kalıcı sil"
            >
              {selectedTrashIds.length === 1 ? "Sil" : "Toplu Sil"}
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
            title="Son tarih"
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
            className="btnPrimary"
            type="submit"
            disabled={!newTitle.trim()}
            title="Görev ekle"
            style={{ height: 38 }}
          >
            Ekle
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
              }}
              placeholder="Kategori ekle…"
              style={{ height: 38 }}
            />
            <button
                type="button"
                className="btnPrimary"
                onClick={() => {
                  if (!newCategoryName.trim()) return;
                  createCategory();
                }}
                disabled={!newCategoryName.trim()}
                title="Kategori ekle"
                style={{ height: 44, paddingInline: 16 }}
            >
              + Ekle
            </button>

            <div style={{ marginLeft: "auto", display: "flex", gap: 10, position: "relative", alignItems: "center" }}>
              <button
                type="button"
                className={filtersOpen ? "btnFilter active" : "btnFilter"}
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
                title="Filtreleri aç / kapat"
                style={filtersOpen ? { background: "rgba(34,197,94,0.18)" } : undefined}
              >
                Filtreler
              </button>

              <button
                type="button"
                className={calendarOpen ? "btnFilter active" : "btnFilter"}
                onClick={() => setCalendarOpen((prev) => !prev)}
                title="Takvimi Aç / Kapat"
              >
                {calendarOpen ? "📅 " : "📅 "}
              </button>

              {filtersOpen && view === "todos" && (
                <>
                  {/* Dim + blur backdrop behind the popup */}
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
                      className="btnFilter"
                      onClick={() => setFiltersOpen(false)}
                      title="Filtreleri kapat"
                      style={{ paddingInline: 12, minHeight: 36 }}
                    >
                      ❌
                    </button>
                  </div>

                  <button
                    type="button"
                    className="btnFilter"
                    onClick={() => toggleFilterSection("category")}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 600, minHeight: 48 }}
                    title="Kategori filtrelerini aç / kapat"
                  >
                    <span>🏷️ Kategori</span>
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
                    title="Durum filtrelerini aç / kapat"
                  >
                    <span>✅ Durum</span>
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
                    title="Öncelik filtrelerini aç / kapat"
                  >
                    <span>⚡ Öncelik</span>
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


        {view !== "trash" && view !== "stats" && (
            <div
              className="searchRow"
              style={{
                marginBottom: 12,
              }}
            >
              <input
                  className="searchInput"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="🔍 Notlarda ara..."
              />

              {query.trim() && (
                  <button type="button" className="btnFilter" onClick={() => setQuery("")} title="Aramayı temizle">
                    Temizle
                  </button>
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
            <h2>📊 Görev İstatistikleri</h2>

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
                  <div
                    style={{
                      width: 160,
                      height: 160,
                      borderRadius: "50%",
                      background: donutBackground(generalChartData),
                      position: "relative",
                      flex: "0 0 auto",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 22,
                        borderRadius: "50%",
                        background: "#111827",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: 12, opacity: 0.72 }}>Toplam</div>
                      <div style={{ fontSize: 28, fontWeight: 700 }}>{statsOverview.total}</div>
                    </div>
                  </div>

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
                  <div className="hint">Hiç kategori yok.</div>
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
                              transition: "width 0.4s",
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
                            transition: "width 0.4s",
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
                  <div
                    style={{
                      width: 160,
                      height: 160,
                      borderRadius: "50%",
                      background: donutBackground(dueChartData),
                      position: "relative",
                      flex: "0 0 auto",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 22,
                        borderRadius: "50%",
                        background: "#111827",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: 12, opacity: 0.72 }}>Tarihli</div>
                      <div style={{ fontSize: 28, fontWeight: 700 }}>
                        {statsByDue.today + statsByDue.future + statsByDue.overdue}
                      </div>
                    </div>
                  </div>

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
                ? "Çöp kutusu boş."
                : selectedDueDates.length
                  ? "Seçili günlere atanmış görev yok."
                  : query.trim()
                  ? "Aramana uygun görev bulunamadı."
                  : filter === "all"
                  ? "Henüz görev yok. İlk görevini ekle. ☝️"
                  : "Bu filtrelemeye uygun görev yok."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {groupedListTodos.map((group) => (
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
                          title="Kategori grubunu aç / kapat"
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
    style={
      draggingId === t.id
        ? {
            transform: "scale(1.02)",
            boxShadow: "0 12px 28px rgba(0,0,0,0.28)",
            opacity: 0.72,
            zIndex: 10,
          }
        : dragOverId === t.id
        ? undefined
        : recentlyAddedId === t.id
        ? {
            boxShadow: "0 0 0 2px rgba(34,197,94,0.35)",
            background: "rgba(34,197,94,0.06)",
          }
        : undefined
    }
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
    <div className="left">
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
        {(view === "trash" ? selectedTrashIds.includes(t.id) : selectedTodoIds.includes(t.id)) ? "✓" : "○"}
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
            {t.title}
          </span>

          {t.description && t.description.trim() !== "" && (
            <div className="todoDescWrap" style={{ minWidth: 0 }}>
              <div
                className={"todoDesc" + (expandedDescId === t.id ? " expanded" : "")}
                style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", opacity: 0.78, minWidth: 0 }}
              >
                {t.description}
              </div>

              {(() => {
                const desc = (t.description || "").toString();
                const showToggle = desc.length > 80 || desc.split("\n").length > 2;

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
                  >
                    {expandedDescId === t.id ? "Daha az göster" : "Devamını gör"}
                  </button>
                );
              })()}
            </div>
          )}
          {view !== "trash" && descOpenId === t.id && (
            <div className="descEditor">
              <textarea
                className="descTextarea"
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                placeholder="Açıklama yaz…"
                rows={2}
              />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  className="select"
                  value={descCategoryId}
                  onChange={(e) => setDescCategoryId(e.target.value)}
                  title="Kategori"
                  style={{ maxWidth: 220 }}
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
                  title="Öncelik"
                  style={{ maxWidth: 180 }}
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
            {t.dueDate && (
                <span
                    className={
                      t.dueDate < localYmd(new Date())
                          ? "dueBadge overdue"
                          : "dueBadge"
                    }
                    title="Son tarih"
                >
                    {t.dueDate}

                  {t.dueDate < localYmd(new Date())
                      ? " • SÜRESİ DOLMUŞ"
                      : t.dueDate === localYmd(new Date())
                          ? " • GÖREVİN SON GÜNÜ"
                          : ""}
                </span>
            )}
          </div>
        </div>
      )}
    </div>

    {view === "trash" ? (
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btnFilter" onClick={() => restoreTodo(t.id)} title="Geri yükle">
          Geri Yükle
        </button>
      </div>
    ) : (
      <div className="todoActions">
        <button
          type="button"
          draggable={false}
          className={t.completed ? "checkBtn done" : "checkBtn"}
          style={{ marginTop: 8 }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (view !== "trash") toggleTodo(t.id);
          }}
          title={view === "trash" ? "Çöp kutusunda durum değişmez" : "Aktif / Tamamlandı"}
          disabled={view === "trash"}
        >
          {t.completed ? <span className="checkIcon">✓</span> : ""}
        </button>
        <button
          type="button"
          draggable={false}
          className={t.pinned ? "btnFilter active" : "btnFilter"}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePinTodo(t.id);
          }}
          title={t.pinned ? "Sabitlemeyi kaldır" : "Sabitle"}
        >
          📌
        </button>
        <button
          type="button"
          draggable={false}
          className="btnSecondary"
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
        >
          ✏️
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
}
