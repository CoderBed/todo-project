import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE = "/api/todos";

async function readError(res) {
  try {
    const data = await res.json();
    if (data?.errors) {
      const firstKey = Object.keys(data.errors)[0];
      if (firstKey) return data.errors[firstKey];
    }
    return data?.message || `API hata: ${res.status}`;
  } catch {
    return `API hata: ${res.status}`;
  }
}

function App() {
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

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => {
      setToast("");
    }, 2000);
  }

  async function persistOrder(nextTodos) {
    try {
      const ids = nextTodos.map((t) => t.id);
      const res = await fetch(`${API_BASE}/reorder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify(ids),
      });
      if (!res.ok) throw new Error(await readError(res));
      // UI order is already updated; no need to overwrite from response.
    } catch (err) {
      setError(err.message);
    }
  }
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDueDate, setEditingDueDate] = useState("");

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(API_BASE)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        return res.json();
      })
      .then((data) => {
        setTodos(data);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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

  async function addTodo(e) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    try {
      const res = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({
          title,
          dueDate: newDueDate ? newDueDate : null,
        }),
      });

      if (!res.ok) throw new Error(await readError(res));

      const created = await res.json();
      setTodos((prev) => [created, ...prev]);
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
      const res = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
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
      const res = await fetch(`${API_BASE}/${id}`, { method: "PUT" });
      if (!res.ok) throw new Error(await readError(res));
      const updated = await res.json();
      setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
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
      const res = await fetch(`${API_BASE}/${id}/title`, {
        method: "PUT",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({
          title,
          dueDate: editingDueDate ? editingDueDate : null,
        }),
      });

      if (!res.ok) throw new Error(await readError(res));

      const updated = await res.json();
      setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
      setEditingId(null);
      setEditingTitle("");
      setEditingDueDate("");
      setError("");
      showToast("Görev güncellendi ✍️");
    } catch (err) {
      setError(err.message);
    }
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
            onClick={() => setFilter("all")}
          >
            Tümü
          </button>
          <button
            type="button"
            className={filter === "active" ? "btnFilter active" : "btnFilter"}
            onClick={() => setFilter("active")}
          >
            Aktif
          </button>
          <button
            type="button"
            className={filter === "completed" ? "btnFilter active" : "btnFilter"}
            onClick={() => setFilter("completed")}
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
            <button
              type="button"
              className="btnFilter"
              onClick={() => setQuery("")}
              title="Aramayı temizle"
            >
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
                      // Persist order in background
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
                          // Only save when focus leaves the whole edit group
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

                  <button
                    type="button"
                    className="btnDanger"
                    onClick={() => deleteTodo(t.id)}
                    title="Sil"
                  >
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

export default App;
