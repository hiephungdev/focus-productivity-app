'use strict';

/* ==========================================================
   FOCUS — Trung tâm năng suất
   Thuần JavaScript + DOM, dữ liệu lưu trong localStorage
   ========================================================== */
(() => {

  /* ---------- Tiện ích ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const pad = (n) => String(n).padStart(2, '0');
  const DAY = 864e5;

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('focus:' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('focus:' + key, JSON.stringify(value)); } catch { /* bỏ qua */ }
    },
    clear() {
      try {
        Object.keys(localStorage).filter((k) => k.startsWith('focus:') && k !== 'focus:theme')
          .forEach((k) => localStorage.removeItem(k));
      } catch { /* bỏ qua */ }
    },
  };

  const API_DATA_URL = '/api/data';
  let backendData = null;
  let backendSaveTimer = null;

  const focusArrayToLog = (items) => {
    if (!Array.isArray(items)) return {};
    return items.reduce((acc, item) => {
      if (item && item.date) acc[item.date] = { min: Number(item.minutes || item.min || 0), sessions: Number(item.sessions || 0) };
      return acc;
    }, {});
  };

  const focusLogToArray = (log) => Object.entries(log || {}).map(([date, value]) => ({
    date,
    userId: null,
    minutes: Number(value.min || value.minutes || 0),
    sessions: Number(value.sessions || 0),
    createdAt: null,
    updatedAt: new Date().toISOString(),
  }));

  function applyBackendData(data) {
    backendData = data && typeof data === 'object' ? data : {};
    if (Array.isArray(backendData.tasks)) tasks = backendData.tasks;
    if (Array.isArray(backendData.notes)) notes = backendData.notes;
    if (Array.isArray(backendData.focusLogs)) focusLog = focusArrayToLog(backendData.focusLogs);
    else if (backendData.focusLog && typeof backendData.focusLog === 'object') focusLog = backendData.focusLog;

    const pomoData = backendData.pomodoro || {};
    if (pomoData.settings) {
      P.dur = {
        focus: Number(pomoData.settings.focusMinutes || P.dur.focus),
        short: Number(pomoData.settings.shortBreakMinutes || P.dur.short),
        long: Number(pomoData.settings.longBreakMinutes || P.dur.long),
      };
      P.remaining = P.dur[P.mode] * 60;
    }
    if (pomoData.currentState) {
      P.taskId = pomoData.currentState.selectedTaskId || P.taskId;
      P.cycle = Number(pomoData.currentState.cycle || P.cycle || 0);
    }

    store.set('tasks', tasks);
    store.set('notes', notes);
    store.set('focusLog', focusLog);
    store.set('dur', P.dur);
    store.set('cycle', P.cycle);
    store.set('pomoTask', P.taskId);
  }

  function buildBackendData() {
    const now = new Date().toISOString();
    const total = tasks.length;
    const done = tasks.filter((t) => t.done).length;
    const today = focusLog[dayKey()] || { min: 0, sessions: 0 };
    const data = backendData && typeof backendData === 'object' ? backendData : {};

    data.meta = data.meta || {};
    data.meta.updatedAt = now;
    if (!data.meta.createdAt) data.meta.createdAt = now;
    data.appSettings = data.appSettings || {};
    data.appSettings.theme = document.documentElement.dataset.theme || data.appSettings.theme || 'light';
    data.appSettings.defaultView = view;
    data.appSettings.defaultSort = state.sort;
    data.tasks = tasks;
    data.notes = notes;
    data.focusLogs = focusLogToArray(focusLog);
    data.pomodoro = data.pomodoro || {};
    data.pomodoro.settings = {
      focusMinutes: P.dur.focus,
      shortBreakMinutes: P.dur.short,
      longBreakMinutes: P.dur.long,
      longBreakAfterSessions: 4,
      autoStartNextSession: false,
      soundEnabled: true,
    };
    data.pomodoro.currentState = {
      mode: P.mode,
      isRunning: P.running,
      remainingSeconds: P.remaining,
      cycle: P.cycle,
      selectedTaskId: P.taskId,
      startedAt: null,
      endedAt: P.endAt ? new Date(P.endAt).toISOString() : null,
      updatedAt: now,
    };
    data.statistics = data.statistics || {};
    data.statistics.summary = {
      totalTasks: total,
      completedTasks: done,
      activeTasks: total - done,
      overdueTasks: tasks.filter((t) => !t.done && t.due && dueInfo(t.due).diff < 0).length,
      completionRate: total ? Math.round((done / total) * 100) : 0,
      currentStreak: calcStreak(),
      todayFocusMinutes: Number(today.min || 0),
      todayFocusSessions: Number(today.sessions || 0),
      updatedAt: now,
    };
    return data;
  }

  async function loadBackendData() {
    try {
      const res = await fetch(API_DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('Khong tai duoc du lieu backend');
      applyBackendData(await res.json());
      return true;
    } catch (error) {
      return false;
    }
  }

  async function saveBackendNow() {
    try {
      await fetch(API_DATA_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBackendData()),
      });
    } catch (error) {
      /* Neu khong chay qua server, localStorage van giu du lieu tren trinh duyet hien tai. */
    }
  }

  function scheduleBackendSave() {
    clearTimeout(backendSaveTimer);
    backendSaveTimer = setTimeout(saveBackendNow, 250);
  }

  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayKey = (d = new Date()) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
  const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

  const CATS = {
    work:     { label: 'Công việc', color: '#4f8fc0' },
    study:    { label: 'Học tập',   color: '#c29a3c' },
    personal: { label: 'Cá nhân',   color: '#a4789e' },
    health:   { label: 'Sức khỏe',  color: '#4e9a72' },
  };
  const PRIOS = { high: 'Ưu tiên cao', medium: 'Trung bình', low: 'Thấp' };
  const PRIO_ORDER = { high: 0, medium: 1, low: 2 };
  const NOTE_COLORS = ['default', 'sand', 'mint', 'sky', 'rose'];
  const NOTE_HEX = { default: 'var(--text-3)', sand: '#c79a3a', mint: '#45a27a', sky: '#4a8fc4', rose: '#c8677a' };
  const DAILY_GOAL = 5;
  const APP_TITLE = 'Focus — Trung tâm năng suất';

  /* ---------- Dữ liệu mẫu (chỉ lần đầu) ---------- */
  function seedTasks() {
    const now = Date.now();
    const iso = (offset) => dayKey(now + offset * DAY);
    const mk = (title, desc, priority, category, dueOffset, doneAgo) => ({
      id: uid(), title, desc, priority, category,
      due: dueOffset === null ? '' : iso(dueOffset),
      done: doneAgo !== undefined,
      createdAt: now - (doneAgo || 0) * DAY - 3600e3,
      completedAt: doneAgo !== undefined ? now - doneAgo * DAY - 1800e3 : null,
      pomos: 0,
    });
    return [
      mk('Lên kế hoạch cho tuần mới', 'Sắp xếp mục tiêu và thứ tự ưu tiên cho 5 ngày tới.', 'high', 'work', 0),
      mk('Thiết kế lại trang chủ', 'Gửi bản phác thảo đầu tiên cho nhóm xem xét.', 'high', 'work', -1),
      mk('Đọc 20 trang sách', 'Tiếp tục chương đang đọc dở.', 'medium', 'study', 1),
      mk('Tập thể dục 30 phút', '', 'low', 'health', null),
      mk('Gọi điện cho gia đình', '', 'medium', 'personal', 3),
      mk('Gửi báo cáo tháng', '', 'medium', 'work', null, 0),
      mk('Họp nhóm sản phẩm', '', 'medium', 'work', null, 1),
      mk('Chạy bộ buổi sáng', '', 'low', 'health', null, 1),
      mk('Ôn từ vựng tiếng Anh', '', 'low', 'study', null, 2),
      mk('Dọn bàn làm việc', '', 'low', 'personal', null, 3),
      mk('Nộp bài tập tuần', '', 'high', 'study', null, 5),
    ];
  }
  function seedNotes() {
    return [
      { id: uid(), text: 'Ý tưởng cho dự án cuối tuần:\n• Thử bố cục lưới không đối xứng\n• Ghi lại bảng màu đang dùng\n• Đo lại độ tương phản chữ', color: 'sky', updatedAt: Date.now() - 36e5 },
      { id: uid(), text: 'Mẹo nhỏ: nhấn N để thêm việc mới, / để tìm kiếm, Space để bật/tắt đồng hồ tập trung.', color: 'sand', updatedAt: Date.now() - 3 * 36e5 },
    ];
  }
  function seedFocus() {
    const now = Date.now();
    return {
      [dayKey(now - 1 * DAY)]: { min: 50, sessions: 2 },
      [dayKey(now - 2 * DAY)]: { min: 75, sessions: 3 },
      [dayKey(now - 3 * DAY)]: { min: 25, sessions: 1 },
      [dayKey(now - 5 * DAY)]: { min: 100, sessions: 4 },
    };
  }

  /* ---------- Trạng thái ---------- */
  let tasks = store.get('tasks', []);
  if (!Array.isArray(tasks)) tasks = [];
  let notes = store.get('notes', []);
  if (!Array.isArray(notes)) notes = [];
  let focusLog = store.get('focusLog', {});
  if (!focusLog || typeof focusLog !== 'object') focusLog = {};

  const state = { filter: 'all', category: 'all', sort: store.get('sort', 'manual'), search: '' };
  let view = store.get('view', 'tasks');
  let flashId = null;
  let editingId = null;
  let animTimer = null;

  const saveTasks = () => { store.set('tasks', tasks); scheduleBackendSave(); };
  const saveNotes = () => { store.set('notes', notes); scheduleBackendSave(); };
  const saveFocus = () => { store.set('focusLog', focusLog); scheduleBackendSave(); };

  /* ---------- Phần tử DOM chính ---------- */
  const el = {
    list: $('#taskList'), empty: $('#emptyTasks'),
    search: $('#searchInput'), sidebar: $('#sidebar'), overlay: $('#overlay'),
    modal: $('#modal'), form: $('#taskForm'), toasts: $('#toasts'),
    fTitle: $('#fTitle'), fDesc: $('#fDesc'), fCat: $('#fCat'), fDue: $('#fDue'),
  };

  /* ==========================================================
     Hoạt ảnh phụ trợ
     ========================================================== */

  // Đếm số mượt từ giá trị cũ tới giá trị mới
  function countTo(node, to) {
    if (!node) return;
    const from = Number(node.dataset.v || 0);
    node.dataset.v = to;
    if (from === to) { node.textContent = to; return; }
    const start = performance.now();
    const dur = 700;
    const step = (now) => {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = Math.round(from + (to - from) * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // FLIP: các phần tử trượt mượt tới vị trí mới sau khi render lại
  function withFlip(container, itemSelector, render) {
    const first = new Map($$(itemSelector, container).map((n) => [n.dataset.id, n.getBoundingClientRect().top]));
    render();
    $$(itemSelector, container).forEach((n) => {
      const before = first.get(n.dataset.id);
      if (before === undefined) return;
      const dy = before - n.getBoundingClientRect().top;
      if (!dy) return;
      n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.22,1,.36,1)' });
    });
  }

  /* ==========================================================
     Toast
     ========================================================== */
  function toast(message, opts = {}) {
    const node = document.createElement('div');
    node.className = 'toast';
    const dur = opts.duration || 4200;
    node.style.setProperty('--dur', dur + 'ms');
    node.innerHTML =
      `<span class="toast-dot ${opts.type || ''}"></span>` +
      `<span class="toast-msg">${esc(message)}</span>` +
      (opts.action ? `<button class="toast-action" type="button">${esc(opts.action.label)}</button>` : '') +
      '<span class="toast-bar"></span>';
    el.toasts.appendChild(node);
    requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('show')));

    let timer;
    const close = () => {
      clearTimeout(timer);
      node.classList.remove('show');
      node.classList.add('hide');
      setTimeout(() => node.remove(), 450);
    };
    timer = setTimeout(close, dur);
    if (opts.action) {
      $('.toast-action', node).addEventListener('click', () => { opts.action.fn(); close(); });
    }
    // Giới hạn tối đa 3 toast
    while (el.toasts.children.length > 3) el.toasts.firstElementChild.remove();
  }

  /* ==========================================================
     Công việc
     ========================================================== */
  function dueInfo(due) {
    if (!due) return null;
    const [y, m, d] = due.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const diff = Math.round((date - startOfDay()) / DAY);
    let label = '', cls = '';
    if (diff === 0) { label = 'Hôm nay'; cls = 'today'; }
    else if (diff === 1) label = 'Ngày mai';
    else if (diff === -1) { label = 'Hôm qua'; cls = 'overdue'; }
    else if (diff < 0) { label = `Quá hạn ${-diff} ngày`; cls = 'overdue'; }
    else if (diff < 7) label = `${diff} ngày nữa`;
    else label = date.toLocaleDateString('vi-VN', { day: 'numeric', month: 'short' });
    return { label, cls, diff };
  }

  function visibleTasks() {
    const q = state.search.trim().toLowerCase();
    let items = tasks.filter((t) => {
      if (state.filter === 'active' && t.done) return false;
      if (state.filter === 'done' && !t.done) return false;
      if (state.category !== 'all' && t.category !== state.category) return false;
      if (q && !(`${t.title} ${t.desc}`.toLowerCase().includes(q))) return false;
      return true;
    });
    if (state.sort === 'due') {
      items = items.slice().sort((a, b) => (a.due || '9999') .localeCompare(b.due || '9999'));
    } else if (state.sort === 'priority') {
      items = items.slice().sort((a, b) => PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority]);
    } else if (state.sort === 'newest') {
      items = items.slice().sort((a, b) => b.createdAt - a.createdAt);
    }
    return items;
  }

  function taskHTML(t, i) {
    const cat = CATS[t.category] || CATS.work;
    const due = dueInfo(t.due);
    const dueCls = due && !t.done ? due.cls : '';
    return `
      <li class="task p-${t.priority}${t.done ? ' done' : ''}${t.id === flashId ? ' new' : ''}" data-id="${t.id}" style="--i:${Math.min(i, 12)}" draggable="${state.sort === 'manual'}">
        <span class="grip" aria-hidden="true"><svg class="icon"><use href="#i-grip"/></svg></span>
        <button class="check" data-action="toggle" type="button" aria-label="Đánh dấu hoàn thành" aria-pressed="${t.done}">
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <div class="task-body">
          <span class="task-title">${esc(t.title)}</span>
          ${t.desc ? `<p class="task-desc">${esc(t.desc)}</p>` : ''}
          <div class="task-meta">
            <span class="chip"><i class="dot" style="--c:${cat.color}"></i>${cat.label}</span>
            <span class="chip prio-chip"><i class="dot"></i>${PRIOS[t.priority]}</span>
            ${due ? `<span class="chip due ${dueCls}"><svg class="icon"><use href="#i-calendar"/></svg>${due.label}</span>` : ''}
            ${t.pomos ? `<span class="chip"><svg class="icon"><use href="#i-timer"/></svg>${t.pomos} phiên</span>` : ''}
          </div>
        </div>
        <div class="task-actions">
          <button class="icon-btn" type="button" data-action="focus" title="Tập trung vào việc này" aria-label="Tập trung vào việc này"><svg class="icon"><use href="#i-timer"/></svg></button>
          <button class="icon-btn" type="button" data-action="edit" title="Chỉnh sửa" aria-label="Chỉnh sửa"><svg class="icon"><use href="#i-edit"/></svg></button>
          <button class="icon-btn" type="button" data-action="delete" title="Xóa" aria-label="Xóa"><svg class="icon"><use href="#i-trash"/></svg></button>
        </div>
      </li>`;
  }

  function renderTasks({ animate = false, flip = false } = {}) {
    const draw = () => {
      const items = visibleTasks();
      el.list.classList.toggle('manual', state.sort === 'manual');
      el.list.classList.toggle('animate', animate);
      el.list.innerHTML = items.map(taskHTML).join('');
      el.empty.hidden = items.length > 0;
      flashId = null;
    };
    if (flip && !animate) withFlip(el.list, '.task', draw); else draw();
    if (animate) {
      clearTimeout(animTimer);
      animTimer = setTimeout(() => el.list.classList.remove('animate'), 1200);
    }
  }

  function addTask(data) {
    const task = {
      id: uid(), title: data.title, desc: data.desc || '',
      priority: data.priority || 'medium', category: data.category || 'work',
      due: data.due || '', done: false, createdAt: Date.now(), completedAt: null, pomos: 0,
    };
    tasks.unshift(task);
    saveTasks();

    // Đảm bảo việc mới luôn nhìn thấy được
    if (state.filter === 'done') setFilter('all');
    if (state.category !== 'all' && state.category !== task.category) setCategory('all');
    if (state.search && !`${task.title} ${task.desc}`.toLowerCase().includes(state.search.toLowerCase())) {
      state.search = ''; el.search.value = '';
    }
    flashId = task.id;
    if (view !== 'tasks') switchView('tasks');
    renderTasks({ flip: true });
    renderStats();
    return task;
  }

  function updateTask(id, data) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, data);
    saveTasks();
    renderTasks({ flip: true });
    renderStats();
  }

  function toggleTask(id) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    t.done = !t.done;
    t.completedAt = t.done ? Date.now() : null;
    saveTasks();

    const li = $(`.task[data-id="${id}"]`, el.list);
    if (li) {
      li.classList.toggle('done', t.done);
      $('.check', li).setAttribute('aria-pressed', String(t.done));
      const dueEl = $('.due', li);
      if (dueEl) {
        const info = dueInfo(t.due);
        dueEl.classList.toggle('overdue', !t.done && info.cls === 'overdue');
        dueEl.classList.toggle('today', !t.done && info.cls === 'today');
      }
    }
    renderStats();

    // Nếu đang lọc theo trạng thái, để hiệu ứng tick hoàn tất rồi mới ẩn mục
    if (state.filter !== 'all') setTimeout(() => renderTasks({ flip: true }), 520);

    if (t.done && tasks.length > 0 && tasks.every((x) => x.done)) {
      toast('Bạn đã hoàn thành mọi việc. Làm tốt lắm!', { type: 'ok' });
    }
  }

  function deleteTask(id) {
    const index = tasks.findIndex((t) => t.id === id);
    if (index < 0) return;
    const [removed] = tasks.splice(index, 1);
    saveTasks();
    if (P.taskId === id) { P.taskId = null; store.set('pomoTask', null); scheduleBackendSave(); }

    const finish = () => { renderTasks({ flip: true }); renderStats(); };
    const li = $(`.task[data-id="${id}"]`, el.list);
    if (li) { li.classList.add('removing'); setTimeout(finish, 290); } else finish();

    toast('Đã xóa công việc', {
      action: {
        label: 'Hoàn tác',
        fn: () => { tasks.splice(Math.min(index, tasks.length), 0, removed); saveTasks(); renderTasks({ flip: true }); renderStats(); },
      },
    });
  }

  function clearCompleted() {
    const removed = tasks.map((t, i) => ({ t, i })).filter((x) => x.t.done);
    if (!removed.length) { toast('Chưa có việc nào hoàn thành để dọn.', { type: 'warn' }); return; }
    tasks = tasks.filter((t) => !t.done);
    saveTasks();
    renderTasks({ flip: true });
    renderStats();
    toast(`Đã dọn ${removed.length} việc đã xong`, {
      action: {
        label: 'Hoàn tác',
        fn: () => {
          removed.forEach(({ t, i }) => tasks.splice(Math.min(i, tasks.length), 0, t));
          saveTasks(); renderTasks({ flip: true }); renderStats();
        },
      },
    });
  }

  /* ---------- Sự kiện danh sách ---------- */
  el.list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const li = btn.closest('.task');
    const id = li && li.dataset.id;
    const action = btn.dataset.action;
    if (action === 'toggle') toggleTask(id);
    else if (action === 'delete') deleteTask(id);
    else if (action === 'edit') openModal(tasks.find((t) => t.id === id));
    else if (action === 'focus') {
      P.taskId = id; store.set('pomoTask', id); scheduleBackendSave();
      switchView('pomodoro');
      toast('Đã chọn việc để tập trung');
    }
  });

  // Kéo thả sắp xếp lại (chỉ khi sắp xếp thủ công)
  let dragId = null;
  el.list.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.task');
    if (!li || state.sort !== 'manual') { e.preventDefault(); return; }
    dragId = li.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    requestAnimationFrame(() => li.classList.add('dragging'));
  });
  el.list.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const li = e.target.closest('.task');
    $$('.task.over', el.list).forEach((n) => n !== li && n.classList.remove('over'));
    if (li && li.dataset.id !== dragId) li.classList.add('over');
  });
  el.list.addEventListener('drop', (e) => {
    e.preventDefault();
    const li = e.target.closest('.task');
    if (!li || !dragId || li.dataset.id === dragId) return;
    const from = tasks.findIndex((t) => t.id === dragId);
    const to = tasks.findIndex((t) => t.id === li.dataset.id);
    if (from < 0 || to < 0) return;
    const [moved] = tasks.splice(from, 1);
    tasks.splice(to, 0, moved);
    saveTasks();
    dragId = null;
    renderTasks({ flip: true });
  });
  el.list.addEventListener('dragend', () => {
    dragId = null;
    $$('.task.dragging, .task.over', el.list).forEach((n) => n.classList.remove('dragging', 'over'));
  });

  /* ---------- Thêm nhanh ---------- */
  $('#quickForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#quickInput');
    const title = input.value.trim();
    if (!title) return;
    addTask({ title, category: state.category !== 'all' ? state.category : 'work' });
    input.value = '';
  });

  /* ---------- Bộ lọc ---------- */
  function setFilter(value) {
    state.filter = value;
    $$('#filterSeg button').forEach((b) => b.classList.toggle('active', b.dataset.filter === value));
    placeSeg($('#filterSeg'));
  }
  function setCategory(value) {
    state.category = value;
    $$('#catChips .chip-btn').forEach((b) => b.classList.toggle('active', b.dataset.cat === value));
  }
  $('#filterSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-filter]');
    if (!b) return;
    setFilter(b.dataset.filter);
    renderTasks({ animate: true });
  });
  $('#catChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip-btn');
    if (!b) return;
    setCategory(b.dataset.cat);
    renderTasks({ animate: true });
  });
  $('#sortSelect').value = state.sort;
  $('#sortSelect').addEventListener('change', (e) => {
    state.sort = e.target.value;
    store.set('sort', state.sort);
    scheduleBackendSave();
    renderTasks({ flip: true });
  });
  $('#clearDone').addEventListener('click', clearCompleted);

  /* ---------- Tìm kiếm ---------- */
  let searchTimer;
  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = el.search.value;
      if (view !== 'tasks' && view !== 'notes') switchView('tasks');
      if (view === 'tasks') renderTasks({ flip: true });
      if (view === 'notes') renderNotes(false);
    }, 140);
  });

  /* ==========================================================
     Thống kê nhanh + sidebar
     ========================================================== */
  const ringFg = $('#ringFg');
  const RING_C = 2 * Math.PI * Number(ringFg.getAttribute('r'));
  ringFg.style.strokeDasharray = RING_C;
  ringFg.style.strokeDashoffset = RING_C;

  function renderStats() {
    const total = tasks.length;
    const done = tasks.filter((t) => t.done).length;
    const active = total - done;
    const overdue = tasks.filter((t) => !t.done && t.due && dueInfo(t.due).diff < 0).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    countTo($('#statTotal'), total);
    countTo($('#statDone'), done);
    countTo($('#statActive'), active);
    countTo($('#statOverdue'), overdue);
    countTo($('#ringPercent'), pct);
    ringFg.style.strokeDashoffset = RING_C * (1 - pct / 100);
    $('#ringSub').textContent = `${done} / ${total} việc hoàn thành`;

    $('#progressText').textContent = !total
      ? 'Danh sách đang trống. Hãy thêm việc đầu tiên của bạn.'
      : active === 0 ? 'Mọi việc đã xong. Bạn có thể nghỉ ngơi rồi.'
      : `Bạn còn ${active} việc đang chờ${overdue ? `, trong đó ${overdue} việc đã quá hạn` : ''}.`;

    const badge = $('#navBadge');
    if (badge.textContent !== String(active)) {
      badge.textContent = active;
      badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
    }

    const key = dayKey();
    const doneToday = tasks.filter((t) => t.completedAt && dayKey(t.completedAt) === key).length;
    const f = focusLog[key] || { min: 0, sessions: 0 };
    $('#dayDone').textContent = doneToday;
    $('#dayFocus').textContent = f.min;
    $('#dayBar').style.width = Math.min(100, (doneToday / DAILY_GOAL) * 100) + '%';

    refreshPomoTasks();
  }

  /* ==========================================================
     Modal thêm / sửa
     ========================================================== */
  let lastFocus = null;

  function openModal(task) {
    editingId = task ? task.id : null;
    lastFocus = document.activeElement;
    $('#modalTitle').textContent = task ? 'Chỉnh sửa công việc' : 'Thêm công việc mới';
    $('#saveBtn').textContent = task ? 'Lưu thay đổi' : 'Thêm công việc';
    el.fTitle.value = task ? task.title : '';
    el.fDesc.value = task ? task.desc : '';
    el.fCat.value = task ? task.category : (state.category !== 'all' ? state.category : 'work');
    el.fDue.value = task ? task.due : '';
    $$('input[name="priority"]').forEach((r) => { r.checked = r.value === (task ? task.priority : 'medium'); });
    el.fTitle.classList.remove('invalid');
    $('#fTitleErr').hidden = true;
    el.modal.classList.add('open');
    el.modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => el.fTitle.focus(), 60);
  }

  function closeModal() {
    el.modal.classList.remove('open');
    el.modal.setAttribute('aria-hidden', 'true');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  const isModalOpen = () => el.modal.classList.contains('open');

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = el.fTitle.value.trim();
    if (!title) {
      el.fTitle.classList.remove('invalid'); void el.fTitle.offsetWidth; el.fTitle.classList.add('invalid');
      $('#fTitleErr').hidden = false;
      el.fTitle.focus();
      return;
    }
    const data = {
      title,
      desc: el.fDesc.value.trim(),
      priority: ($('input[name="priority"]:checked') || {}).value || 'medium',
      category: el.fCat.value,
      due: el.fDue.value,
    };
    if (editingId) { updateTask(editingId, data); toast('Đã cập nhật công việc', { type: 'ok' }); }
    else { addTask(data); toast('Đã thêm công việc mới', { type: 'ok' }); }
    closeModal();
  });
  el.fTitle.addEventListener('input', () => { el.fTitle.classList.remove('invalid'); $('#fTitleErr').hidden = true; });
  el.modal.addEventListener('mousedown', (e) => { if (e.target === el.modal) closeModal(); });
  $$('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
  $('#addBtn').addEventListener('click', () => openModal());
  document.addEventListener('click', (e) => { if (e.target.closest('[data-open-modal]')) openModal(); });

  /* ==========================================================
     Đồng hồ Pomodoro
     ========================================================== */
  const P = {
    mode: 'focus',
    dur: store.get('dur', { focus: 25, short: 5, long: 15 }),
    remaining: 0,
    running: false,
    endAt: 0,
    timer: null,
    taskId: store.get('pomoTask', null),
    cycle: store.get('cycle', 0),
  };
  P.remaining = P.dur[P.mode] * 60;

  const pomo = {
    card: $('#pomoCard'), ring: $('#pomoRing'), time: $('#pomoTime'), label: $('#pomoLabel'),
    toggle: $('#pomoToggle'), reset: $('#pomoReset'), skip: $('#pomoSkip'),
    dots: $$('#pomoDots i'), select: $('#pomoTask'),
    durVal: $('#pomoDurVal'), minus: $('#pomoMinus'), plus: $('#pomoPlus'),
  };
  const POMO_R = Number(pomo.ring.getAttribute('r'));
  const POMO_C = 2 * Math.PI * POMO_R;
  pomo.ring.style.strokeDasharray = POMO_C;

  const MODE_LABEL = { focus: 'Tập trung', short: 'Nghỉ ngắn', long: 'Nghỉ dài' };
  const fmt = (s) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;

  function renderPomo() {
    const total = P.dur[P.mode] * 60;
    pomo.ring.style.strokeDashoffset = POMO_C * (1 - P.remaining / total);
    pomo.time.textContent = fmt(P.remaining);
    pomo.card.dataset.mode = P.mode;
    pomo.card.classList.toggle('running', P.running);

    const idle = !P.running && P.remaining === total;
    pomo.label.textContent = P.running
      ? (P.mode === 'focus' ? 'Đang tập trung…' : 'Đang nghỉ ngơi…')
      : idle ? (P.mode === 'focus' ? 'Sẵn sàng tập trung' : 'Sẵn sàng nghỉ ngơi') : 'Đã tạm dừng';

    pomo.toggle.querySelector('use').setAttribute('href', P.running ? '#i-pause' : '#i-play');
    pomo.toggle.setAttribute('aria-label', P.running ? 'Tạm dừng' : 'Bắt đầu');
    pomo.durVal.textContent = P.dur[P.mode];
    pomo.minus.disabled = pomo.plus.disabled = P.running;

    const filled = P.mode === 'long' ? 4 : P.cycle % 4;
    pomo.dots.forEach((d, i) => d.classList.toggle('on', i < filled));

    $$('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === P.mode));
    placeSeg($('#modeSeg'));

    document.title = P.running ? `${fmt(P.remaining)} · ${MODE_LABEL[P.mode]}` : APP_TITLE;

    const f = focusLog[dayKey()] || { min: 0, sessions: 0 };
    $('#pomoSessions').textContent = f.sessions;
    $('#pomoMinutes').textContent = f.min;
  }

  function stopTimer() {
    clearInterval(P.timer);
    P.timer = null;
    P.running = false;
  }

  function startTimer() {
    if (P.running) return;
    if (P.remaining <= 0) P.remaining = P.dur[P.mode] * 60;
    P.running = true;
    P.endAt = Date.now() + P.remaining * 1000;
    P.timer = setInterval(tick, 250);
    renderPomo();
  }

  function tick() {
    const left = Math.max(0, Math.round((P.endAt - Date.now()) / 1000));
    if (left !== P.remaining) { P.remaining = left; renderPomo(); }
    if (left <= 0) completeSession();
  }

  function beep() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      [0, 0.28, 0.56].forEach((t, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = i === 2 ? 880 : 660;
        const t0 = ctx.currentTime + t;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
        o.connect(g).connect(ctx.destination);
        o.start(t0); o.stop(t0 + 0.26);
      });
      setTimeout(() => ctx.close(), 1200);
    } catch { /* trình duyệt không hỗ trợ */ }
  }

  function advanceMode(logSession) {
    stopTimer();
    if (P.mode === 'focus') {
      if (logSession) {
        const key = dayKey();
        const f = focusLog[key] || { min: 0, sessions: 0 };
        f.min += P.dur.focus; f.sessions += 1;
        focusLog[key] = f; saveFocus();
        P.cycle += 1; store.set('cycle', P.cycle); scheduleBackendSave();
        const t = tasks.find((x) => x.id === P.taskId);
        if (t) { t.pomos = (t.pomos || 0) + 1; saveTasks(); renderTasks(); }
      }
      P.mode = P.cycle > 0 && P.cycle % 4 === 0 && logSession ? 'long' : 'short';
    } else {
      P.mode = 'focus';
    }
    P.remaining = P.dur[P.mode] * 60;
    renderPomo();
    renderStats();
  }

  function completeSession() {
    const wasFocus = P.mode === 'focus';
    beep();
    advanceMode(true);
    toast(wasFocus ? 'Hoàn thành một phiên. Nghỉ ngơi một chút nhé.' : 'Hết giờ nghỉ. Sẵn sàng cho phiên tiếp theo?', { type: 'ok', duration: 6000 });
  }

  function setMode(mode) {
    stopTimer();
    P.mode = mode;
    P.remaining = P.dur[mode] * 60;
    renderPomo();
  }

  pomo.toggle.addEventListener('click', () => {
    if (P.running) { stopTimer(); renderPomo(); } else startTimer();
  });
  pomo.reset.addEventListener('click', () => { stopTimer(); P.remaining = P.dur[P.mode] * 60; renderPomo(); });
  pomo.skip.addEventListener('click', () => advanceMode(false));
  $('#modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (b && b.dataset.mode !== P.mode) setMode(b.dataset.mode);
  });

  function stepDuration(dir) {
    const isFocus = P.mode === 'focus';
    const step = isFocus ? 5 : 1;
    const [min, max] = isFocus ? [5, 90] : [1, 30];
    P.dur[P.mode] = Math.min(max, Math.max(min, P.dur[P.mode] + dir * step));
    store.set('dur', P.dur);
    scheduleBackendSave();
    P.remaining = P.dur[P.mode] * 60;
    renderPomo();
  }
  pomo.minus.addEventListener('click', () => stepDuration(-1));
  pomo.plus.addEventListener('click', () => stepDuration(1));

  function refreshPomoTasks() {
    const active = tasks.filter((t) => !t.done);
    if (P.taskId && !active.some((t) => t.id === P.taskId)) { P.taskId = null; store.set('pomoTask', null); scheduleBackendSave(); }
    pomo.select.innerHTML =
      '<option value="">Không chọn việc cụ thể</option>' +
      active.map((t) => `<option value="${t.id}">${esc(t.title)}</option>`).join('');
    pomo.select.value = P.taskId || '';
  }
  pomo.select.addEventListener('change', () => { P.taskId = pomo.select.value || null; store.set('pomoTask', P.taskId); scheduleBackendSave(); });

  // Khi quay lại tab, cập nhật ngay theo thời gian thực
  document.addEventListener('visibilitychange', () => { if (P.running && !document.hidden) tick(); });

  /* ==========================================================
     Ghi chú
     ========================================================== */
  const notesGrid = $('#notesGrid');

  function timeAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'Vừa xong';
    if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
    if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)} ngày trước`;
    return new Date(ts).toLocaleDateString('vi-VN', { day: 'numeric', month: 'short' });
  }

  function noteHTML(n, i) {
    return `
      <article class="note" data-id="${n.id}" data-color="${n.color}" style="--n:${Math.min(i, 10)}">
        <textarea rows="3" placeholder="Viết điều gì đó…" aria-label="Nội dung ghi chú">${esc(n.text)}</textarea>
        <div class="note-foot">
          <div class="note-colors">
            ${NOTE_COLORS.map((c) => `<button class="dot-btn${c === n.color ? ' on' : ''}" type="button" data-color="${c}" style="--c:${NOTE_HEX[c]}" aria-label="Màu ${c}"></button>`).join('')}
          </div>
          <span class="note-time">${timeAgo(n.updatedAt)}</span>
          <button class="icon-btn" type="button" data-del aria-label="Xóa ghi chú"><svg class="icon"><use href="#i-trash"/></svg></button>
        </div>
      </article>`;
  }

  const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = Math.max(96, ta.scrollHeight) + 'px'; };

  function renderNotes(animate = false) {
    const q = state.search.trim().toLowerCase();
    const items = notes.filter((n) => !q || n.text.toLowerCase().includes(q));
    notesGrid.classList.toggle('animate', animate);
    notesGrid.innerHTML = items.map(noteHTML).join('');
    $('#emptyNotes').hidden = items.length > 0;
    requestAnimationFrame(() => $$('textarea', notesGrid).forEach(grow));
    if (animate) setTimeout(() => notesGrid.classList.remove('animate'), 1000);
  }

  let noteTimer;
  notesGrid.addEventListener('input', (e) => {
    const ta = e.target.closest('textarea');
    if (!ta) return;
    grow(ta);
    const card = ta.closest('.note');
    const n = notes.find((x) => x.id === card.dataset.id);
    if (!n) return;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      n.text = ta.value; n.updatedAt = Date.now();
      saveNotes();
      $('.note-time', card).textContent = 'Vừa xong';
    }, 350);
  });
  notesGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.note');
    if (!card) return;
    const n = notes.find((x) => x.id === card.dataset.id);
    const colorBtn = e.target.closest('.dot-btn');
    if (colorBtn && n) {
      n.color = colorBtn.dataset.color; n.updatedAt = Date.now(); saveNotes();
      card.dataset.color = n.color;
      $$('.dot-btn', card).forEach((b) => b.classList.toggle('on', b === colorBtn));
      return;
    }
    if (e.target.closest('[data-del]') && n) {
      const index = notes.indexOf(n);
      notes.splice(index, 1); saveNotes();
      card.classList.add('removing');
      setTimeout(() => renderNotes(false), 290);
      toast('Đã xóa ghi chú', {
        action: { label: 'Hoàn tác', fn: () => { notes.splice(Math.min(index, notes.length), 0, n); saveNotes(); renderNotes(false); } },
      });
    }
  });
  $('#addNote').addEventListener('click', () => {
    state.search = ''; el.search.value = '';
    const n = { id: uid(), text: '', color: 'default', updatedAt: Date.now() };
    notes.unshift(n); saveNotes();
    renderNotes(false);
    const first = $('.note textarea', notesGrid);
    if (first) first.focus();
  });

  /* ==========================================================
     Thống kê 7 ngày
     ========================================================== */
  const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  function last7() {
    const today = startOfDay();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today); d.setDate(d.getDate() - (6 - i));
      return { date: d, key: dayKey(d), label: WEEKDAY[d.getDay()], today: i === 6 };
    });
  }

  function drawBars(container, data) {
    const max = Math.max(1, ...data.map((d) => d.value));
    container.innerHTML = data.map((d) => `
      <div class="bar-col${d.today ? ' is-today' : ''}">
        <div class="bar-track"><div class="bar" data-v="${d.value}"><span class="bar-val">${d.value}</span></div></div>
        <span class="bar-label">${d.label}</span>
      </div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $$('.bar', container).forEach((b, i) => {
        const v = Number(b.dataset.v);
        b.style.transitionDelay = i * 70 + 'ms';
        b.style.height = v > 0 ? Math.max(8, (v / max) * 100) + '%' : '4px';
      });
    }));
  }

  function calcStreak() {
    const days = new Set(tasks.filter((t) => t.completedAt).map((t) => dayKey(t.completedAt)));
    const d = startOfDay();
    if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
    let streak = 0;
    while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
    return streak;
  }

  function renderInsights() {
    const week = last7();
    const doneBy = (k) => tasks.filter((t) => t.completedAt && dayKey(t.completedAt) === k).length;
    const taskData = week.map((d) => ({ ...d, value: doneBy(d.key) }));
    const focusData = week.map((d) => ({ ...d, value: (focusLog[d.key] || {}).min || 0 }));

    drawBars($('#barsTasks'), taskData);
    drawBars($('#barsFocus'), focusData);

    const total = tasks.length;
    const done = tasks.filter((t) => t.done).length;
    countTo($('#kStreak'), calcStreak());
    countTo($('#kFocus'), (focusLog[dayKey()] || {}).min || 0);
    countTo($('#kWeek'), taskData.reduce((s, d) => s + d.value, 0));
    countTo($('#kRate'), total ? Math.round((done / total) * 100) : 0);

    const list = $('#catList');
    list.innerHTML = Object.entries(CATS).map(([key, c]) => {
      const all = tasks.filter((t) => t.category === key);
      const fin = all.filter((t) => t.done).length;
      const pct = all.length ? Math.round((fin / all.length) * 100) : 0;
      return `<div class="cat-row" style="--c:${c.color}">
        <span class="cat-name"><i class="dot"></i>${c.label}</span>
        <div class="cat-track"><div class="cat-fill" data-w="${pct}"></div></div>
        <span class="cat-count">${fin}/${all.length}</span>
      </div>`;
    }).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $$('.cat-fill', list).forEach((f, i) => { f.style.transitionDelay = i * 90 + 'ms'; f.style.width = f.dataset.w + '%'; });
    }));
  }

  /* ==========================================================
     Điều hướng giữa các màn hình
     ========================================================== */
  const SEARCH_HINT = { tasks: 'Tìm công việc…', notes: 'Tìm ghi chú…', pomodoro: 'Tìm công việc…', insights: 'Tìm công việc…' };

  function switchView(name) {
    if (!$('#view-' + name)) name = 'tasks';
    view = name;
    store.set('view', name);
    scheduleBackendSave();
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    el.search.placeholder = SEARCH_HINT[name];

    if (name === 'insights') renderInsights();
    if (name === 'notes') renderNotes(true);
    if (name === 'pomodoro') { refreshPomoTasks(); renderPomo(); }
    if (name === 'tasks') renderTasks({ animate: true });

    closeSidebar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    requestAnimationFrame(updateSegs);
  }

  $$('.nav-item').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

  function openSidebar() { el.sidebar.classList.add('open'); el.overlay.classList.add('show'); }
  function closeSidebar() { el.sidebar.classList.remove('open'); el.overlay.classList.remove('show'); }
  $('#menuBtn').addEventListener('click', openSidebar);
  el.overlay.addEventListener('click', closeSidebar);

  /* ==========================================================
     Segmented control có thanh trượt
     ========================================================== */
  function placeSeg(seg) {
    if (!seg) return;
    const ind = $('.seg-indicator', seg);
    const active = $('button.active', seg);
    if (!ind || !active || !seg.offsetWidth) return;
    const first = !ind.dataset.ready;
    if (first) ind.style.transition = 'none';
    ind.style.width = active.offsetWidth + 'px';
    ind.style.transform = `translateX(${active.offsetLeft}px)`;
    if (first) { void ind.offsetWidth; ind.style.transition = ''; ind.dataset.ready = '1'; }
  }
  const updateSegs = () => $$('.seg').forEach(placeSeg);
  window.addEventListener('resize', updateSegs);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { $$('.seg-indicator').forEach((i) => delete i.dataset.ready); updateSegs(); });

  /* ==========================================================
     Theme, lời chào, đồng hồ
     ========================================================== */
  $('#themeToggle').addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.classList.add('theme-switching');
    root.dataset.theme = next;
    store.set('theme', next);
    scheduleBackendSave();
    setTimeout(() => root.classList.remove('theme-switching'), 600);
  });

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return 'Khuya rồi, nghỉ sớm nhé';
    if (h < 11) return 'Chào buổi sáng';
    if (h < 14) return 'Chào buổi trưa';
    if (h < 18) return 'Chào buổi chiều';
    return 'Chào buổi tối';
  }

  function tickClock() {
    const now = new Date();
    $('#clockTime').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    $('#clockDate').textContent = now.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#greeting').textContent = greeting();
  }

  /* ==========================================================
     Xóa dữ liệu
     ========================================================== */
  $('#resetData').addEventListener('click', () => {
    if (!confirm('Xóa toàn bộ công việc, ghi chú và thống kê? Hành động này không thể hoàn tác.')) return;
    stopTimer();
    store.clear();
    tasks = []; notes = []; focusLog = {};
    P.taskId = null; P.cycle = 0; P.mode = 'focus'; P.remaining = P.dur.focus * 60;
    saveTasks(); saveNotes(); saveFocus();
    renderTasks({ animate: true }); renderStats(); renderPomo();
    if (view === 'notes') renderNotes(false);
    if (view === 'insights') renderInsights();
    toast('Đã xóa toàn bộ dữ liệu');
  });

  /* ==========================================================
     Phím tắt
     ========================================================== */
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;

    if (e.key === 'Escape') {
      if (isModalOpen()) closeModal();
      else if (el.sidebar.classList.contains('open')) closeSidebar();
      else if (document.activeElement === el.search) { el.search.blur(); }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); el.search.focus(); el.search.select(); return; }
    // Giữ phím Tab trong hộp thoại khi đang mở
    if (e.key === 'Tab' && isModalOpen()) {
      const items = $$('input:not([type="radio"]), textarea, select, button, input[type="radio"]:checked', el.form).filter((n) => !n.disabled && n.offsetParent !== null);
      if (!items.length) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey || isModalOpen()) return;

    switch (e.key.toLowerCase()) {
      case 'n': e.preventDefault(); openModal(); break;
      case '/': e.preventDefault(); el.search.focus(); break;
      case '1': switchView('tasks'); break;
      case '2': switchView('pomodoro'); break;
      case '3': switchView('notes'); break;
      case '4': switchView('insights'); break;
      case ' ':
        if (view === 'pomodoro' && (t.tagName !== 'BUTTON' || t.classList.contains('nav-item'))) { e.preventDefault(); pomo.toggle.click(); }
        break;
      default:
    }
  });

  /* ==========================================================
     Khởi động
     ========================================================== */
  initApp();

  async function initApp() {
    tickClock();
    setInterval(tickClock, 15000);

    const hasBackend = await loadBackendData();
    renderTasks({ animate: true });
    renderStats();
    renderPomo();
    switchViewInitial();
    if (!hasBackend) toast('Äang cháº¡y báº±ng localStorage. Háº·y má»Ÿ web qua server Ä‘á»ƒ lÆ°u vÃ o backend-data.json.', { type: 'warn' });
  }

  function switchViewInitial() {
    // Hiển thị màn hình đã dùng lần trước mà không cuộn/chạy lại hiệu ứng thừa
    if (!$('#view-' + view)) view = 'tasks';
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    el.search.placeholder = SEARCH_HINT[view];
    if (view === 'insights') renderInsights();
    if (view === 'notes') renderNotes(true);
    requestAnimationFrame(updateSegs);
  }

})();
